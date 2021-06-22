// SPDX-License-Identifier: MIT
// WARNING, WARNING, WARNING
// If you modify this contract, you need to re-install the binary into the validator 
// genesis file for the chain you wish to run. See ./docs/CompilingContracts.md for more information.
// You have been warned. That is all.
pragma solidity 0.7.6;
pragma abicoder v2;

import { GovernedAtGenesis } from "../../governance/implementation/GovernedAtGenesis.sol";
import { Inflation } from "../../inflation/implementation/Inflation.sol";
import { IFlareKeep } from "../interface/IFlareKeep.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafePct } from "../../utils/implementation/SafePct.sol";


/**
 * @title Flare Keeper contract
 * @notice This contract exists to coordinate regular daemon-like polling of contracts
 *   that are registered to receive said polling. The trigger method is called by the 
 *   validator right at the end of block state transition.
 */
contract FlareKeeper is GovernedAtGenesis {
    using SafeMath for uint256;
    using SafePct for uint256;

    //====================================================================
    // Data Structures
    //====================================================================
    struct KeptError {
        uint192 lastErrorBlock;
        uint64 numErrors;
        address fromContract;
        uint64 errorTypeIndex;
        string errorMessage;
    }

    struct LastErrorData {
        uint192 totalKeptErrors;
        uint64 lastErrorTypeIndex;
    }

    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_NOT_INFLATION = "not inflation";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_TOO_BIG = "too big";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_CONTRACT_NOT_FOUND = "contract not found";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_BLOCK_NUMBER_SMALL = "block.number small";
    string internal constant ERR_TRANSFER_FAILED = "transfer failed";
    string internal constant INDEX_TOO_HIGH = "start index high";
    string internal constant UPDATE_GAP_TOO_SHORT = "time gap too short";
    string internal constant MAX_MINT_TOO_HIGH = "Max mint too high";

    uint256 internal constant MAX_KEEP_CONTRACTS = 10;
    uint256 internal constant MAX_MINTING_REQUEST_DEFAULT = 50000000 ether; // 50 million FLR
    uint256 internal constant MAX_MINTING_FREQUENCY_SEC = 82800; // 23 hours constant

    IFlareKeep[] public keepContracts;
    Inflation public inflation;
    uint256 public systemLastTriggeredAt;
    uint256 public totalMintingRequestedWei;
    uint256 public totalMintingReceivedWei;
    uint256 public totalMintingWithdrawnWei;
    uint256 public totalSelfDestructReceivedWei;
    //slither-disable-next-line uninitialized-state                     // no problem, will be zero initialized anyway
    uint256 public totalSelfDestructWithdrawnWei;
    uint256 public maxMintingRequestWei;
    uint256 public lastMintRequestTs;
    uint256 public lastUpdateMaxMintRequestTs;

    uint256 private lastBalance;
    uint256 private expectedMintRequest;
    bool private initialized;
    // track keep errors
    mapping(bytes32 => KeptError) internal keptErrors;
    bytes32 [] internal keepErrorHashes;
    LastErrorData public errorData;

    event ContractKept(address theContract);
    event ContractKeepErrored(address theContract, uint256 atBlock, string theMessage);
    event MintingRequested (uint256 amountWei);
    event MintingReceived (uint256 amountWei);
    event MintingWithdrawn(uint256 amountWei);
    event RegistrationUpdated (IFlareKeep theContract, bool add);
    event SelfDestructReceived (uint256 amountWei);
    event InflationSet(Inflation theNewContract, Inflation theOldContract);

    //====================================================================
    // Constructor for pre-compiled code
    //====================================================================

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructor is called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) {
        /* empty block */
    }

    /**
     * @dev As there is not a constructor, this modifier exists to make sure the inflation
     *   contract is set for methods that require it.
     */
    modifier inflationSet {
        // Don't revert...just report.
        if (address(inflation) == address(0)) {
            addKeepError(address(this), ERR_INFLATION_ZERO);
        }
        _;
    }

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        // We should be in balance - don't revert, just report...
        uint256 contractBalanceExpected = getExpectedBalance();
        if (contractBalanceExpected != address(this).balance) {
            addKeepError(address(this), ERR_OUT_OF_BALANCE);
        }
    }

    /**
     * @dev Access control to protect methods to allow only minters to call select methods
     *   (like transferring balance out).
     */
    modifier onlyInflation (address _inflation) {
        require (address(inflation) == _inflation, ERR_NOT_INFLATION);
        _;
    }

    //====================================================================
    // Functions
    //====================================================================  

    /**
     * @notice Set the governance address to a hard-coded known address.
     * @dev This should be done at contract deployment time.
     * @return The governance address.
     */
    function initialiseFixedAddress() public override returns(address) {
        if (!initialized) {
            initialized = true;
            address governanceAddress = super.initialiseFixedAddress();
            return governanceAddress;
        } else {
            return governance;
        }
    }

    /**
     * @notice Register a contract to be polled by the keeper process.
     * @param _keep     The address of the contract to poll.
     */
    function registerToKeep(IFlareKeep _keep) external onlyGovernance {

        uint256 len = keepContracts.length;
        require(len + 1 < MAX_KEEP_CONTRACTS, ERR_TOO_MANY);

        for (uint256 i = 0; i < len; i++) {
            if (_keep == keepContracts[i]) {
                return; // already registered
            }
        }

        keepContracts.push(_keep);
        emit RegistrationUpdated (_keep, true);
    }

    /**
     * @notice Queue up a minting request to send to the validator at next trigger.
     * @param _amountWei    The amount to mint.
     */
    function requestMinting(uint256 _amountWei) external onlyInflation(msg.sender) {
        require (_amountWei <= maxMintingRequestWei, ERR_TOO_BIG);
        require (lastMintRequestTs.add(MAX_MINTING_FREQUENCY_SEC) < block.timestamp, ERR_TOO_OFTEN);
        if (_amountWei > 0) {
            lastMintRequestTs = block.timestamp;
            totalMintingRequestedWei = totalMintingRequestedWei.add(_amountWei);
            emit MintingRequested(_amountWei);
        }
    }

    /**
     * @notice Set limit on how much can be minted per request.
     * @param _maxMintingRequestWei    The request maximum in wei.
     * @notice this number can't be udated too often
     */
    function setMaxMintingRequest(uint256 _maxMintingRequestWei) external onlyGovernance {
        // make sure increase amount is reasonable
        require(_maxMintingRequestWei <= (maxMintingRequestWei.mulDiv(11, 10)), MAX_MINT_TOO_HIGH);
        // make sure enough time since last update
        require(block.timestamp > lastUpdateMaxMintRequestTs + (60 * 60 * 24), UPDATE_GAP_TOO_SHORT);

        maxMintingRequestWei = _maxMintingRequestWei;
        lastUpdateMaxMintRequestTs = block.timestamp;
    }

    /**
     * @notice Sets the inflation contract, which will receive minted inflation funds for funding to
     *   rewarding contracts.
     * @param _inflation   The inflation contract.
     */
    function setInflation(Inflation _inflation) external onlyGovernance {
        require(address(_inflation) != address(0), ERR_INFLATION_ZERO);
        emit InflationSet(inflation, _inflation);
        inflation = _inflation;
        if (maxMintingRequestWei == 0) {
            maxMintingRequestWei = MAX_MINTING_REQUEST_DEFAULT;
        }
    }

    /**
     * @notice Unregister a contract from being polled by the keeper process.
     * @param _keep     The address of the contract to unregister.
     */
    function unregisterToKeep(IFlareKeep _keep) external onlyGovernance {

        uint256 len = keepContracts.length;

        for (uint256 i = 0; i < len; i++) {
            if (_keep == keepContracts[i]) {
                keepContracts[i] = keepContracts[len -1];
                keepContracts.pop();
                emit RegistrationUpdated (_keep, false);
                return;
            }
        }

        revert(ERR_CONTRACT_NOT_FOUND);
    }

    /**
     * @notice The meat of this contract. Poll all registered contracts, calling the keep() method of each,
     *   in the order in which registered.
     * @return  _toMintWei     Return the amount to mint back to the validator. The asked for balance will show
     *                          up in the next block (it is actually added right before this block's state transition,
     *                          but well after this method call will see it.)
     * @dev This method watches for balances being added to this contract and handles appropriately - legit
     *   mint requests as made via requestMinting, and also self-destruct sending to this contract, should
     *   it happen for some reason.
     */
    //slither-disable-next-line reentrancy-eth      // method protected by reentrancy guard (see comment below)
    function trigger() external inflationSet mustBalance returns (uint256 _toMintWei) {
        // only one trigger() call per block allowed
        // this also serves as reentrancy guard, since any re-entry will happen in the same block
        require(block.number > systemLastTriggeredAt, ERR_BLOCK_NUMBER_SMALL);
        systemLastTriggeredAt = block.number;

        uint256 currentBalance = address(this).balance;

        // Did the validator or a self-destructor conjure some FLR?
        if (currentBalance > lastBalance) {
            uint256 balanceExpected = lastBalance.add(expectedMintRequest);
            // Did we get what was last asked for?
            if (currentBalance == balanceExpected) {
                // Yes, so assume it all came from the validator.
                uint256 minted = currentBalance.sub(lastBalance);
                totalMintingReceivedWei = totalMintingReceivedWei.add(minted);
                emit MintingReceived(minted);
                //slither-disable-next-line arbitrary-send          // only sent to inflation, set by governance
                try inflation.receiveMinting{ value: minted }() {
                    totalMintingWithdrawnWei = totalMintingWithdrawnWei.add(minted);
                    emit MintingWithdrawn(minted);
                } catch Error(string memory message) {
                    addKeepError(address(this), message);
                }
            } else if (currentBalance < balanceExpected) {
                // No, and if less, there are two possibilities: 1) the validator did not
                // send us what we asked (not possible unless a bug), or 2) an attacker
                // sent us something in between a request and a mint. Assume 2.
                uint256 selfDestructReceived = currentBalance.sub(lastBalance);
                totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(selfDestructReceived);
                emit SelfDestructReceived(selfDestructReceived);
            } else {
                // No, so assume we got a minting request (perhaps zero...does not matter)
                // and some self-destruct proceeds (unlikely but can happen).
                totalMintingReceivedWei = totalMintingReceivedWei.add(expectedMintRequest);
                uint256 selfDestructReceived = currentBalance.sub(lastBalance).sub(expectedMintRequest);
                totalSelfDestructReceivedWei = totalSelfDestructReceivedWei.add(selfDestructReceived);
                emit MintingReceived(expectedMintRequest);
                emit SelfDestructReceived(selfDestructReceived);
                //slither-disable-next-line arbitrary-send          // only sent to inflation, set by governance
                try inflation.receiveMinting{ value: expectedMintRequest }() {
                    totalMintingWithdrawnWei = totalMintingWithdrawnWei.add(expectedMintRequest);
                    emit MintingWithdrawn(expectedMintRequest);
                } catch Error(string memory message) {
                    addKeepError(address(this), message);
                }
            }
        }

        // Perform trigger operations here
        uint256 len = keepContracts.length;

        for (uint256 i = 0; i < len; i++) {
            // Consume errors and record
            try keepContracts[i].keep() {
                emit ContractKept(address(keepContracts[i]));
            } catch Error(string memory message) {
                addKeepError(address(keepContracts[i]), message);
            }
        }

        // Get any requested minting and return to validator
        _toMintWei = getPendingMintRequest();
        if (_toMintWei > 0) {
            expectedMintRequest = _toMintWei;
            emit MintingRequested(_toMintWei);
        } else {
            expectedMintRequest = 0;            
        }

        lastBalance = address(this).balance;
    }

    /**
     * @notice Net totals to obtain the expected balance of the contract.
     */
    function getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        _balanceExpectedWei = totalMintingReceivedWei.
            sub(totalMintingWithdrawnWei).
            add(totalSelfDestructReceivedWei).
            sub(totalSelfDestructWithdrawnWei);
    }

    function showKeptErrors (uint startIndex, uint numErrorTypesToShow) public view 
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalKeptErrors
        )
    {
        require(startIndex < keepErrorHashes.length, INDEX_TOO_HIGH);
        uint256 numReportElements = 
            keepErrorHashes.length >= startIndex + numErrorTypesToShow ?
            numErrorTypesToShow :
            keepErrorHashes.length - startIndex;

        _lastErrorBlock = new uint256[] (numReportElements);
        _numErrors = new uint256[] (numReportElements);
        _errorString = new string[] (numReportElements);
        _erroringContract = new address[] (numReportElements);

        // we have error data error type.
        // error type is hash(error_string, source contract)
        // per error type we report how many times it happened.
        // what was last block it happened.
        // what is the error string.
        // what is the erroring contract
        for (uint i = 0; i < numReportElements; i++) {
            bytes32 hash = keepErrorHashes[startIndex + i];

            _lastErrorBlock[i] = keptErrors[hash].lastErrorBlock;
            _numErrors[i] = keptErrors[hash].numErrors;
            _errorString[i] = keptErrors[hash].errorMessage;
            _erroringContract[i] = keptErrors[hash].fromContract;
        }
        _totalKeptErrors = errorData.totalKeptErrors;
    }

    function showLastKeptError () external view 
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalKeptErrors
        )
    {
        return showKeptErrors(errorData.lastErrorTypeIndex, 1);
    }

    /**
     * @notice Net total received from total requested.
     */
    function getPendingMintRequest() private view returns(uint256 _mintRequestPendingWei) {
        _mintRequestPendingWei = totalMintingRequestedWei.sub(totalMintingReceivedWei);
    }

    function addKeepError(address keptContract, string memory message) internal {
        bytes32 errorStringHash = keccak256(abi.encode(keptContract, message));

        errorData.totalKeptErrors += 1;
        keptErrors[errorStringHash].numErrors += 1;
        keptErrors[errorStringHash].lastErrorBlock = uint192(block.number);
        emit ContractKeepErrored(keptContract, block.number, message);

        if (keptErrors[errorStringHash].numErrors > 1) {
            // not first time this errors
            errorData.lastErrorTypeIndex = keptErrors[errorStringHash].errorTypeIndex;
            return;
        }

        // first time we recieve this error string.
        keepErrorHashes.push(errorStringHash);
        keptErrors[errorStringHash].fromContract = keptContract;
        keptErrors[errorStringHash].errorMessage = message;
        keptErrors[errorStringHash].errorTypeIndex = uint64(keepErrorHashes.length - 1);

        errorData.lastErrorTypeIndex = keptErrors[errorStringHash].errorTypeIndex;        
    }
}
