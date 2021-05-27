// SPDX-License-Identifier: MIT
// WARNING, WARNING, WARNING
// If you modify this contract, you need to re-install the binary into the validator 
// genesis file for the chain you wish to run. See ./docs/CompilingContracts.md for more information.
// You have been warned. That is all.
pragma solidity 0.7.6;

import { GovernedAtGenesis } from "../../governance/implementation/GovernedAtGenesis.sol";
import { Inflation } from "../../inflation/implementation/Inflation.sol";
import { IFlareKeep } from "../interfaces/IFlareKeep.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
*  @title Flare Keeper contract
 * @notice This contract exists to coordinate regular daemon-like polling of contracts
 *   that are registered to receive said polling. The trigger method is called by the 
 *   validator right at the end of block state transition.
 */
contract FlareKeeper is GovernedAtGenesis {
    using SafeMath for uint256;

    //====================================================================
    // Data Structures
    //====================================================================
    struct KeptError {
        address contractInError;
        string message;
    }

    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_NOT_INFLATION = "not inflation";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_CONTRACT_NOT_FOUND = "contract not found";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_BLOCK_NUMBER_SMALL = "block.number small";
    string internal constant ERR_TRANSFER_FAILED = "transfer failed";

    uint256 internal constant MAX_KEEP_CONTRACTS = 10;
    IFlareKeep[] public keepContracts;
    uint256 public systemLastTriggeredAt;
    uint256 private lastBalance;
    uint256 private expectedMintRequest;
    uint256 public totalMintingRequested;
    uint256 public totalMintingReceived;
    uint256 public totalMintingWithdrawn;
    uint256 public totalSelfDestructReceived;
    uint256 public totalSelfDestructWithdrawn;
    Inflation public inflation;
    bool private initialized;
    mapping(uint256 => KeptError[]) public errorsByBlock;

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
        require(address(inflation) != address(0), ERR_INFLATION_ZERO);
        _;
    }

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance.
     */
    modifier mustBalance {
        _;
        // We should now be in balance - don't revert, just report...
        uint256 contractBalanceExpected = getExpectedBalance();
        if (contractBalanceExpected != address(this).balance) {
            KeptError[] storage keptErrors = errorsByBlock[block.number];
            keptErrors.push(KeptError({contractInError: address(this), message: ERR_OUT_OF_BALANCE}));            
            emit ContractKeepErrored(address(this), block.number, ERR_OUT_OF_BALANCE);
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
            _setupRole(DEFAULT_ADMIN_ROLE, governanceAddress);
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
        if (_amountWei > 0) {
            totalMintingRequested = totalMintingRequested.add(_amountWei);
            emit MintingRequested(_amountWei);
        }
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
    function trigger() public mustBalance returns (uint256 _toMintWei) {
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
                totalMintingReceived = totalMintingReceived.add(minted);
                totalMintingWithdrawn = totalMintingWithdrawn.add(minted);
                (bool success, ) = (payable(address(inflation))).call{value: minted}(""); // solhint-disable-line
                require(success, ERR_TRANSFER_FAILED);      // TODO: Change to report error once Ilan's code is merged.
                emit MintingReceived(minted);
                emit MintingWithdrawn(minted);
            } else if (currentBalance < balanceExpected) {
                // No, and if less, assume it was a self-destructor. 
                uint256 selfDestructReceived = currentBalance.sub(lastBalance);
                totalSelfDestructReceived = totalSelfDestructReceived.add(selfDestructReceived);
                emit SelfDestructReceived(selfDestructReceived);
            } else {
                // No, so assume we got a minting request (perhaps zero...does not matter)
                // and some self-destruct proceeds (unlikely but can happen).
                totalMintingReceived = totalMintingReceived.add(expectedMintRequest);
                totalMintingWithdrawn = totalMintingWithdrawn.add(expectedMintRequest);
                uint256 selfDestructReceived = currentBalance.sub(lastBalance).sub(expectedMintRequest);
                totalSelfDestructReceived = totalSelfDestructReceived.add(selfDestructReceived);
                (bool success, ) = (payable(address(inflation))).call{value: expectedMintRequest}(""); // solhint-disable-line
                require(success, ERR_TRANSFER_FAILED);      // TODO: Change to report error once Ilan's code is merged.
                emit MintingReceived(expectedMintRequest);
                emit MintingWithdrawn(expectedMintRequest);
                emit SelfDestructReceived(selfDestructReceived);
            }
        }

        // Perform trigger operations here
        uint256 len = keepContracts.length;

        for (uint256 i = 0; i < len; i++) {
            // Consume errors and record
            try keepContracts[i].keep() {
                emit ContractKept(address(keepContracts[i]));
            } catch Error(string memory message) {
                KeptError[] storage keptErrors = errorsByBlock[block.number];
                keptErrors.push(KeptError({contractInError: address(keepContracts[i]), message: message}));
                emit ContractKeepErrored(address(keepContracts[i]), block.number, message);
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
        _balanceExpectedWei = totalMintingReceived.
            sub(totalMintingWithdrawn).
            add(totalSelfDestructReceived).
            sub(totalSelfDestructWithdrawn);
    }

    /**
     * @notice Net total received from total requested.
     */
    function getPendingMintRequest() private view returns(uint256 _mintRequestPendingWei) {
        _mintRequestPendingWei = totalMintingRequested.sub(totalMintingReceived);
    }
}
