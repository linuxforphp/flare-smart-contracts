// SPDX-License-Identifier: MIT
// WARNING, WARNING, WARNING
// If you modify this contract, you need to re-install the binary into the validator 
// genesis file for the chain you wish to run. See ./docs/CompilingContracts.md for more information.
// You have been warned. That is all.
pragma solidity 0.7.6;

import { GovernedAtGenesis } from "../governance/implementation/GovernedAtGenesis.sol";
import { MintAccounting } from "../accounting/implementation/MintAccounting.sol";
import { IFlareKeep } from "../interfaces/IFlareKeep.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
*  @title Flare Keeper contract
 * @notice This contract exists to coordinate regular daemon-like polling of contracts
 *   that are registered to receive said polling. The trigger method is called by the 
 *   validator right at the end of block state transition.
 */
contract FlareKeeper is GovernedAtGenesis, ReentrancyGuard {
    using SafeMath for uint256;

    //====================================================================
    // Data Structures
    //====================================================================
    struct KeptError {
        address contractInError;
        string message;
    }

    string internal constant ERR_OUT_OF_BALANCE = "out of balance";
    string internal constant ERR_NOT_A_MINTER = "not minter";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_CONTRACT_NOT_FOUND = "contract not found";
    string internal constant ERR_MINT_ACCOUNTING_ZERO = "mint accounting zero";
    string internal constant ERR_BLOCK_NUMBER_SMALL = "block.number small";
    string internal constant ERR_TRANSFER_FAILED = "transfer failed";

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant MAX_KEEP_CONTRACTS = 10;
    IFlareKeep[] public keepContracts;
    uint256 public systemLastTriggeredAt;
    MintAccounting public mintAccounting;
    uint256 private lastBalance;
    uint256 private nextMintRequest;
    bool private initialized;
    mapping(uint256 => KeptError[]) public errorsByBlock;

    event RegistrationUpdated (IFlareKeep theContract, bool add);
    event MintingRequested (uint256 toMintTWei);
    event MintingReceived (uint256 toMintTWei);
    event MintAccountingUpdated (MintAccounting from, MintAccounting to);
    event ContractKept(address theContract);
    event ContractKeepErrored(address theContract, uint256 atBlock, string theMessage);
    event Transferred(uint256 amountTWei);

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
     * @dev As there is not a constructor, this modifier exists to make sure the mint accounting
     *   contract is set for methods that require it.
     */
    modifier mintAccountingSet {
        require(address(mintAccounting) != address(0), ERR_MINT_ACCOUNTING_ZERO);
        _;
    }

    /**
     * @dev This modifier ensures that this contract's balance matches the expected balance
     *   within the general ledger accounting contract, referenced mint accounting;
     */
    modifier mustBalance {
        _;
        require(address(mintAccounting) != address(0), ERR_MINT_ACCOUNTING_ZERO);
        uint256 flareKeeperAccountingBalance = mintAccounting.getKeeperBalance();
        require(address(this).balance == flareKeeperAccountingBalance, ERR_OUT_OF_BALANCE);
    }

    /**
     * @dev Access control to protect methods to allow only minters to call select methods
     *   (like transferring balance out).
     */
    modifier onlyMinters () {
        require (hasRole(MINTER_ROLE, msg.sender), ERR_NOT_A_MINTER);
        _;
    }

    //====================================================================
    // Functions
    //====================================================================  

    /**
     *  @dev The validators will NOT wind up calling this function when inflating
     *  FLR. The receive method is here for testing purposes only, but if FLR is sent via
     *  this venue, then it will be received and will balance to the accounting system without
     *  issue.
     */
    receive() external payable mintAccountingSet mustBalance {
        lastBalance = address(this).balance.add(msg.value);
        if (msg.value <= nextMintRequest) {
            mintAccounting.receiveMinting(msg.value);
            emit MintingReceived(msg.value);
        } else {
            mintAccounting.receiveMinting(nextMintRequest);
            emit MintingReceived(nextMintRequest);
            mintAccounting.receiveSelfDestructProceeds(msg.value.sub(nextMintRequest));
        }
        nextMintRequest = 0;
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
     * @notice Sets the mint accounting contract to report and fetch accounting activity from the general ledger.
     * @param _mintAccounting   The mint accounting contract.
     */
    function setMintAccounting(MintAccounting _mintAccounting) external onlyGovernance {
        require(address(_mintAccounting) != address(0), ERR_MINT_ACCOUNTING_ZERO);
        emit MintAccountingUpdated(mintAccounting, _mintAccounting);
        mintAccounting = _mintAccounting;
    }

    /**
     * @notice Transfer minted balance out to the world that need to distribute rewards, etc.
     * @param _receiver     The address of the recipient to get funds. Should be a rewarding contract.
     * @param _amountTWei   The amount to send.
     * @dev Since we do not want to attribute transfer to a type of rewarder getting
     *   these funds (we don't know who is requesting what here), 
     *   it is up to the caller to make the correct accounting
     *   entries prior to this call, so that the accounting system balances. It will ruin
     *   your day if you do not take care to do that.
     */
    function transferTo(address _receiver, uint256 _amountTWei) external onlyMinters mustBalance nonReentrant {
        lastBalance = address(this).balance.sub(_amountTWei);
        /* solhint-disable avoid-low-level-calls */
        (bool success, ) = (payable(_receiver)).call{value: _amountTWei}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, ERR_TRANSFER_FAILED);
        emit Transferred(_amountTWei);
    }

    /**
     * @notice The meat of this contract. Poll all registered contracts, calling the keep() method of each,
     *   in the order in which registered.
     * @return  _toMintTWei     Return the amount to mint back to the validator. The asked for balance will show
     *                          up in the next block (it is actually added right before this block's state transition,
     *                          but well after this method call will see it.)
     * @dev This method watches for balances being added to this contract and handles appropriately - legit
     *   mint requests as made to the accounting system, and also self-destruct sending to this contract, should
     *   it happen for some reason.
     */
    function trigger() public mintAccountingSet returns (uint256 _toMintTWei) {
        require(block.number > systemLastTriggeredAt, ERR_BLOCK_NUMBER_SMALL);
        systemLastTriggeredAt = block.number;

        uint256 currentBalance = address(this).balance;

        // Did the validator or a self-destructor conjure some FLR?
        if (currentBalance > lastBalance) {
            uint256 balanceExpected = lastBalance.add(nextMintRequest);
            // Did we get at least what was last asked for?
            if (currentBalance <= balanceExpected) {
                // Yes, so assume it all came from the validator, but was not all minted for some reason.
                uint256 minted = currentBalance.sub(lastBalance);
                mintAccounting.receiveMinting(minted);
                emit MintingReceived(minted);
            } else {
                // No, so assume we got a minting request (perhaps zero...does not matter)
                // and some self-destruct proceeds (unlikely but can happen).
                mintAccounting.receiveMinting(nextMintRequest);
                emit MintingReceived(nextMintRequest);
                mintAccounting.receiveSelfDestructProceeds(currentBalance.sub(lastBalance).sub(nextMintRequest));
            }
        }

        nextMintRequest = 0;
        lastBalance = currentBalance;

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
        _toMintTWei = mintAccounting.getMintingRequested();
        if (_toMintTWei > 0) {
            nextMintRequest = _toMintTWei;
            emit MintingRequested(_toMintTWei);
        }

        // Reset current balance after kept contracts were processed.
        currentBalance = address(this).balance;

        // We should now be in balance to the accounting system - don't revert, just report?
        uint256 flareKeeperAccountingBalance = mintAccounting.getKeeperBalance();
        if (flareKeeperAccountingBalance != currentBalance) {
            KeptError[] storage keptErrors = errorsByBlock[block.number];
            keptErrors.push(KeptError({contractInError: address(this), message: ERR_OUT_OF_BALANCE}));            
            emit ContractKeepErrored(address(this), block.number, ERR_OUT_OF_BALANCE);
        }
    }
}
