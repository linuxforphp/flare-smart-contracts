// SPDX-License-Identifier: MIT
// WARNING, WARNING, WARNING
// If you modify this contract, you need to re-install the binary into the validator 
// genesis file for the chain you wish to run. See ./docs/CompilingContracts.md for more information.
// You have been warned. That is all.
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/GovernedAtGenesis.sol";
import "../../inflation/implementation/Inflation.sol";
import "../interface/IFlareDaemonize.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * @title Flare Daemon contract
 * @notice This contract exists to coordinate regular daemon-like polling of contracts
 *   that are registered to receive said polling. The trigger method is called by the 
 *   validator right at the end of block state transition.
 */
contract FlareDaemon is GovernedAtGenesis {
    using SafeMath for uint256;
    using SafePct for uint256;

    //====================================================================
    // Data Structures
    //====================================================================
    struct DaemonizedError {
        uint192 lastErrorBlock;
        uint64 numErrors;
        address fromContract;
        uint64 errorTypeIndex;
        string errorMessage;
    }

    struct LastErrorData {
        uint192 totalDaemonizedErrors;
        uint64 lastErrorTypeIndex;
    }

    struct Registration {
        IFlareDaemonize daemonizedContract;
        uint256 gasLimit;
    }

    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_NOT_INFLATION = "not inflation";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_TOO_BIG = "too big";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";
    string internal constant ERR_BLOCK_NUMBER_SMALL = "block.number small";
    string internal constant INDEX_TOO_HIGH = "start index high";
    string internal constant UPDATE_GAP_TOO_SHORT = "time gap too short";
    string internal constant MAX_MINT_TOO_HIGH = "max mint too high";
    string internal constant MAX_MINT_IS_ZERO = "max mint is zero";
    string internal constant ERR_DUPLICATE_ADDRESS = "dup address";
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_OUT_OF_GAS = "out of gas";

    uint256 internal constant MAX_DAEMONIZE_CONTRACTS = 10;
    // Initial max mint request - 50 million native token
    uint256 internal constant MAX_MINTING_REQUEST_DEFAULT = 50000000 ether;
    // How often can inflation request minting from the validator - 23 hours constant
    uint256 internal constant MAX_MINTING_FREQUENCY_SEC = 23 hours;
    // How often can the maximal mint request amount be updated
    uint256 internal constant MAX_MINTING_REQUEST_FREQUENCY_SEC = 24 hours;
    // By how much can the maximum be increased (as a percentage of the previous maximum)
    uint256 internal constant MAX_MINTING_REQUEST_INCREASE_PERCENT = 110;

    IFlareDaemonize[] public daemonizeContracts;
    mapping (IFlareDaemonize => uint256) public gasLimits;
    mapping (IFlareDaemonize => uint256) public blockHoldoffsRemaining;
    Inflation public inflation;
    uint256 public systemLastTriggeredAt;
    uint256 public totalMintingRequestedWei;
    uint256 public totalMintingReceivedWei;
    uint256 public totalMintingWithdrawnWei;
    uint256 public totalSelfDestructReceivedWei;
    uint256 public maxMintingRequestWei;
    uint256 public lastMintRequestTs;
    uint256 public lastUpdateMaxMintRequestTs;
    LastErrorData public errorData;
    uint256 public blockHoldoff;

    uint256 private lastBalance;
    uint256 private expectedMintRequest;
    bool private initialized;
    // track daemonize errors
    mapping(bytes32 => DaemonizedError) internal daemonizedErrors;
    bytes32 [] internal daemonizeErrorHashes;

    event ContractDaemonized(address theContract);
    event ContractDaemonizeErrored(address theContract, uint256 atBlock, string theMessage);
    event ContractHeldOff(address theContract, uint256 blockHoldoffsRemaining);
    event MintingRequested (uint256 amountWei);
    event MintingReceived (uint256 amountWei);
    event MintingWithdrawn(uint256 amountWei);
    event RegistrationUpdated (IFlareDaemonize theContract, bool add);
    event SelfDestructReceived (uint256 amountWei);
    event InflationSet(Inflation theNewContract, Inflation theOldContract);

    /**
     * @dev As there is not a constructor, this modifier exists to make sure the inflation
     *   contract is set for methods that require it.
     */
    modifier inflationSet {
        // Don't revert...just report.
        if (address(inflation) == address(0)) {
            addDaemonizeError(address(this), ERR_INFLATION_ZERO);
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
            addDaemonizeError(address(this), ERR_OUT_OF_BALANCE);
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
    // Constructor for pre-compiled code
    //====================================================================

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructor is called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) {
        /* empty block */
    }

    //====================================================================
    // Functions
    //====================================================================  

    /**
     * @notice Register contracts to be polled by the daemon process.
     * @param _registrations    An array of Registration structures of IFlareDaemonize contracts to daemonize
     *                          and gas limits for each contract.
     * @dev A gas limit of zero will set no limit for the contract but the validator has an overall
     *   limit for the trigger() method.
     * @dev If any registrations already exist, they will be unregistered.
     * @dev Contracts will be daemonized in the order in which presented via the _registrations array.
     */
    function registerToDaemonize(Registration[] calldata _registrations) external onlyGovernance {
        // Make sure there are not too many contracts to register.
        uint256 registrationsLength = _registrations.length;
        require(registrationsLength <= MAX_DAEMONIZE_CONTRACTS, ERR_TOO_MANY);

        // Unregister everything first
        _unregisterAll();

        // Loop over all contracts to register
        for (uint256 registrationIndex = 0; registrationIndex < registrationsLength; registrationIndex++) {
            // Address cannot be zero
            require(address(_registrations[registrationIndex].daemonizedContract) != address(0), ERR_ADDRESS_ZERO);

            uint256 daemonizeContractsLength = daemonizeContracts.length;
            // Make sure no dups...yes, inefficient. Registration should not be done often.
            for (uint256 i = 0; i < daemonizeContractsLength; i++) {
                require(_registrations[registrationIndex].daemonizedContract != daemonizeContracts[i], 
                    ERR_DUPLICATE_ADDRESS); // already registered
            }
            // Store off the registered contract to daemonize, in the order presented.
            daemonizeContracts.push(_registrations[registrationIndex].daemonizedContract);
            // Record the gas limit for the contract.
            gasLimits[_registrations[registrationIndex].daemonizedContract] = 
                _registrations[registrationIndex].gasLimit;
            // Clear any blocks being held off for the given contract, if any. Contracts may be re-presented
            // if only order is being modified, for example.
            blockHoldoffsRemaining[_registrations[registrationIndex].daemonizedContract] = 0;
            emit RegistrationUpdated (_registrations[registrationIndex].daemonizedContract, true);
        }
    }

    /**
     * @notice Queue up a minting request to send to the validator at next trigger.
     * @param _amountWei    The amount to mint.
     */
    function requestMinting(uint256 _amountWei) external onlyInflation(msg.sender) {
        require(_amountWei <= maxMintingRequestWei, ERR_TOO_BIG);
        require(lastMintRequestTs.add(MAX_MINTING_FREQUENCY_SEC) < block.timestamp, ERR_TOO_OFTEN);
        if (_amountWei > 0) {
            lastMintRequestTs = block.timestamp;
            totalMintingRequestedWei = totalMintingRequestedWei.add(_amountWei);
            emit MintingRequested(_amountWei);
        }
    }

    /**
     * @notice Set number of blocks that must elapse before a daemonized contract exceeding gas limit can have
     *   its daemonize() method called again.
     * @param _blockHoldoff    The number of blocks to holdoff.
     */
    function setBlockHoldoff(uint256 _blockHoldoff) external onlyGovernance {
        blockHoldoff = _blockHoldoff;
    }

    /**
     * @notice Set limit on how much can be minted per request.
     * @param _maxMintingRequestWei    The request maximum in wei.
     * @notice this number can't be udated too often
     */
    function setMaxMintingRequest(uint256 _maxMintingRequestWei) external onlyGovernance {
        // make sure increase amount is reasonable
        require(
            _maxMintingRequestWei <= (maxMintingRequestWei.mulDiv(MAX_MINTING_REQUEST_INCREASE_PERCENT,100)),
            MAX_MINT_TOO_HIGH
        );
        require(_maxMintingRequestWei > 0, MAX_MINT_IS_ZERO);
        // make sure enough time since last update
        require(
            block.timestamp > lastUpdateMaxMintRequestTs + MAX_MINTING_REQUEST_FREQUENCY_SEC,
            UPDATE_GAP_TOO_SHORT
        );

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
     * @notice The meat of this contract. Poll all registered contracts, calling the daemonize() method of each,
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

        // Did the validator or a self-destructor conjure some native token?
        if (currentBalance > lastBalance) {
            uint256 balanceExpected = lastBalance.add(expectedMintRequest);
            // Did we get what was last asked for?
            if (currentBalance == balanceExpected) {
                // Yes, so assume it all came from the validator.
                uint256 minted = expectedMintRequest;
                totalMintingReceivedWei = totalMintingReceivedWei.add(minted);
                emit MintingReceived(minted);
                //slither-disable-next-line arbitrary-send          // only sent to inflation, set by governance
                try inflation.receiveMinting{ value: minted }() {
                    totalMintingWithdrawnWei = totalMintingWithdrawnWei.add(minted);
                    emit MintingWithdrawn(minted);
                } catch Error(string memory message) {
                    addDaemonizeError(address(this), message);
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
                    addDaemonizeError(address(this), message);
                }
            }
        }

        uint256 len = daemonizeContracts.length;

        // Perform trigger operations here
        for (uint256 i = 0; i < len; i++) {
            uint256 blockHoldoffRemainingForContract = blockHoldoffsRemaining[daemonizeContracts[i]];
            if (blockHoldoffRemainingForContract > 0) {
                blockHoldoffsRemaining[daemonizeContracts[i]] = blockHoldoffRemainingForContract - 1;
                emit ContractHeldOff(address(daemonizeContracts[i]), blockHoldoffRemainingForContract);
            } else {
                // Figure out what gas to limit call by
                uint256 startGas = gasleft();
                uint256 gasLimit = gasLimits[daemonizeContracts[i]];
                // Use ternary in needless variable because slither has problems with some in-line ternary expressions
                uint256 useGas = gasLimit > 0 ? gasLimit : startGas; 
                // Run daemonize for the contract, consume errors, and record
                try daemonizeContracts[i].daemonize{gas: useGas} ()
                {
                    emit ContractDaemonized(address(daemonizeContracts[i]));
                // Catch all requires with messages
                } catch Error(string memory message) {
                    addDaemonizeError(address(daemonizeContracts[i]), message);
                // Catch everything else...out of gas, div by zero, asserts, etc.
                } catch {
                    uint256 endGas = gasleft();
                    // Interpret out of gas errors
                    if (startGas.sub(endGas) >= gasLimits[daemonizeContracts[i]]) {
                        blockHoldoffsRemaining[daemonizeContracts[i]] = blockHoldoff;
                        addDaemonizeError(address(daemonizeContracts[i]), ERR_OUT_OF_GAS);
                    } else {
                        // Don't know error cause...just log it as unknown
                        addDaemonizeError(address(daemonizeContracts[i]), "unknown");
                    }
                }
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
     * @notice Unregister all contracts from being polled by the daemon process.
     */
    function unregisterAll() external onlyGovernance {
        _unregisterAll();
    }

    function showLastDaemonizedError () external view 
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalDaemonizedErrors
        )
    {
        return showDaemonizedErrors(errorData.lastErrorTypeIndex, 1);
    }

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

    function showDaemonizedErrors (uint startIndex, uint numErrorTypesToShow) public view 
        returns(
            uint256[] memory _lastErrorBlock,
            uint256[] memory _numErrors,
            string[] memory _errorString,
            address[] memory _erroringContract,
            uint256 _totalDaemonizedErrors
        )
    {
        require(startIndex < daemonizeErrorHashes.length, INDEX_TOO_HIGH);
        uint256 numReportElements = 
            daemonizeErrorHashes.length >= startIndex + numErrorTypesToShow ?
            numErrorTypesToShow :
            daemonizeErrorHashes.length - startIndex;

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
            bytes32 hash = daemonizeErrorHashes[startIndex + i];

            _lastErrorBlock[i] = daemonizedErrors[hash].lastErrorBlock;
            _numErrors[i] = daemonizedErrors[hash].numErrors;
            _errorString[i] = daemonizedErrors[hash].errorMessage;
            _erroringContract[i] = daemonizedErrors[hash].fromContract;
        }
        _totalDaemonizedErrors = errorData.totalDaemonizedErrors;
    }

    function addDaemonizeError(address daemonizedContract, string memory message) internal {
        bytes32 errorStringHash = keccak256(abi.encode(daemonizedContract, message));

        errorData.totalDaemonizedErrors += 1;
        daemonizedErrors[errorStringHash].numErrors += 1;
        daemonizedErrors[errorStringHash].lastErrorBlock = uint192(block.number);
        emit ContractDaemonizeErrored(daemonizedContract, block.number, message);

        if (daemonizedErrors[errorStringHash].numErrors > 1) {
            // not first time this errors
            errorData.lastErrorTypeIndex = daemonizedErrors[errorStringHash].errorTypeIndex;
            return;
        }

        // first time we recieve this error string.
        daemonizeErrorHashes.push(errorStringHash);
        daemonizedErrors[errorStringHash].fromContract = daemonizedContract;
        daemonizedErrors[errorStringHash].errorMessage = message;
        daemonizedErrors[errorStringHash].errorTypeIndex = uint64(daemonizeErrorHashes.length - 1);

        errorData.lastErrorTypeIndex = daemonizedErrors[errorStringHash].errorTypeIndex;        
    }

    /**
     * @notice Unregister all contracts from being polled by the daemon process.
     */
    function _unregisterAll() private {

        uint256 len = daemonizeContracts.length;

        for (uint256 i = 0; i < len; i++) {
            IFlareDaemonize daemonizedContract = daemonizeContracts[daemonizeContracts.length - 1];
            daemonizeContracts.pop();
            emit RegistrationUpdated (daemonizedContract, false);
        }
    }

    /**
     * @notice Net totals to obtain the expected balance of the contract.
     */
    function getExpectedBalance() private view returns(uint256 _balanceExpectedWei) {
        _balanceExpectedWei = totalMintingReceivedWei.
            sub(totalMintingWithdrawnWei).
            add(totalSelfDestructReceivedWei);
    }

    /**
     * @notice Net total received from total requested.
     */
    function getPendingMintRequest() private view returns(uint256 _mintRequestPendingWei) {
        _mintRequestPendingWei = totalMintingRequestedWei.sub(totalMintingReceivedWei);
    }
}
