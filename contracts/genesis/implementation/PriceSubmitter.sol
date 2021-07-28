// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/GovernedAtGenesis.sol";
import "../interface/IIFtsoRegistry.sol";
import "../interface/IIPriceSubmitter.sol";
import "../interface/IIVoterWhitelister.sol";


/**
 * @title Price submitter
 * @notice A contract used to submit/reveal prices to multiple Flare Time Series Oracles in one transaction
 */
contract PriceSubmitter is IIPriceSubmitter, GovernedAtGenesis {

    string internal constant ERR_ARRAY_LENGTHS = "Array lengths do not match";
    string internal constant ERR_TOO_MANY_REVERTS = "Too many reverts";
    string internal constant ERR_INVALID_INDEX = "Invalid index";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSOManager only";
    string internal constant ERR_WHITELISTER_ONLY = "Voter whitelister only";
    string internal constant ERR_ALREADY_ADDED = "Already added";

    uint256 internal constant MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS = 2;
    uint256 internal constant MAX_ALLOWED_NUMBER_OF_REVEAL_REVERTS = 2;

    // Currency indices
    // Most common used ftso indices, order is the same as in `specs/PriceProvider.md`
    uint256 public constant override FLR_FTSO_INDEX  = 0;
    uint256 public constant override FXRP_FTSO_INDEX  = 1;
    uint256 public constant override FLTC_FTSO_INDEX  = 2;
    uint256 public constant override FXLM_FTSO_INDEX  = 3;
    uint256 public constant override FXDG_FTSO_INDEX  = 4;
    uint256 public constant override FADA_FTSO_INDEX  = 5;
    uint256 public constant override FALGO_FTSO_INDEX = 6;
    uint256 public constant override FBCH_FTSO_INDEX  = 7;
    uint256 public constant override FDGB_FTSO_INDEX  = 8;
    uint256 public constant override FBTC_FTSO_INDEX  = 9;

    IIFtsoRegistry internal ftsoRegistry; 
    IIFtsoManager internal ftsoManager;
    
    IIVoterWhitelister public voterWhitelister;

    // Bit at index `i` corresponds to being whitelisted for vote on ftso at index `i`
    mapping(address => uint256) private whitelistedFtsoBitmap; 

    mapping(bytes32 => uint256) private currencyBitmask;

    modifier onlyFtsoManager {
        require(msg.sender == address(ftsoManager), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    modifier onlyWhitelister {
        require(msg.sender == address(voterWhitelister), ERR_WHITELISTER_ONLY);
        _;
    }

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructor is called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) {
        /* empty block */
    }

    /**
     * Sets ftso manager that will be allowed to manipulate ftsos.
     * Only governance can call this method.
     */
    function setFtsoManager(IIFtsoManager _ftsoManager) external override onlyGovernance {
        ftsoManager = _ftsoManager;
    }

    /**
     * Sets ftso registry.
     * Only governance can call this method.
     */
    function setFtsoRegistry(IIFtsoRegistry _ftsoRegistryToSet) external override onlyGovernance {
        ftsoRegistry = _ftsoRegistryToSet;
        // price submitter sets ftso registry on whitelister
        if (address(voterWhitelister) != address(0)) {
            voterWhitelister.setFtsoRegistry(ftsoRegistry);
        }
    }
    
    /**
     * Sets voter whitelist contract.
     * Only governance can call this method.
     * If replacing the whitelist and the old one is not empty, make sure to replicate the state, otherwise
     * internal whitelist bitmaps won't match.
     */
    function setVoterWhitelister(IIVoterWhitelister _voterWhitelister) external override onlyGovernance {
        voterWhitelister = _voterWhitelister;
        // price submitter sets ftso registry on whitelister
        _voterWhitelister.setFtsoRegistry(ftsoRegistry);
    }

    /**
     * Remove ftso and disallow price submissions.
     * Only ftso manager can call this method.
     * `_ftso` must already be in ftso registry and `_ftsoIndex` must match that in the registry.
     */
    function removeFtso(IIFtso _ftso, uint256 _ftsoIndex) external override onlyFtsoManager {
        voterWhitelister.removeFtso(_ftsoIndex);
        // Set the bitmask to zero => Any submission will fail
        bytes32 symbolHash = _hashSymbol(_ftso.symbol());
        delete currencyBitmask[symbolHash];
    }
    
    /**
     * Called from whitelister when new voter has been whitelisted.
     */
    function voterWhitelisted(
        address _voter, 
        uint256 _ftsoIndex
    ) external override onlyWhitelister {
        whitelistedFtsoBitmap[_voter] |= 1 << _ftsoIndex;
    }
    
    /**
     * Called from whitelister when one or more voters have been removed.
     */
    function votersRemovedFromWhitelist(
        address[] memory _removedVoters, 
        uint256 _ftsoIndex
    ) external override onlyWhitelister {
        for (uint256 i = 0; i < _removedVoters.length; i++) {
            whitelistedFtsoBitmap[_removedVoters[i]]  &= ~(1 << _ftsoIndex);
        }
    }

    /**
     * Add ftso to allow price submissions.
     * Only ftso manager can call this method.
     * `_ftso` must already be in ftso registry and `_ftsoIndex` must match that in the registry.
     */
    function addFtso(IIFtso _ftso, uint256 _ftsoIndex) external override onlyFtsoManager {
        bytes32 symbolHash = _hashSymbol(_ftso.symbol());
        require(currencyBitmask[symbolHash] == 0, ERR_ALREADY_ADDED);
        currencyBitmask[symbolHash] = _ftsoIndex;
        voterWhitelister.addFtso(_ftsoIndex);
    }
    
    /**
     * @notice Submits price hashes for current epoch
     * @param _ftsoIndices          List of ftso indices
     * @param _hashes               List of hashed price and random number
     * @notice Emits PriceHashesSubmitted event
     */
    function submitPriceHashes(uint256[] memory _ftsoIndices, bytes32[] memory _hashes) external override {
        // Submit the prices
        uint256 length = _ftsoIndices.length;
        bool[] memory success = new bool[](length);
        IIFtso[] memory ftsos = new IIFtso[](length);
        uint256 epochId;
        uint256 numberOfReverts = 0;
        uint256 allowedBitmask = whitelistedFtsoBitmap[msg.sender];

        for (uint256 i = 0; i < length; i++) {
            uint256 ind = _ftsoIndices[i];
            if (allowedBitmask & (1 << ind) == 0) {
                require(++numberOfReverts <= MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS, ERR_TOO_MANY_REVERTS);
                continue;
            }
            ftsos[i] = ftsoRegistry.getFtso(ind);
            try ftsos[i].submitPriceHashSubmitter(msg.sender, _hashes[i]) returns (uint256 _epochId) {
                success[i] = true;
                // they should all be the same (one price provider contract for all ftsos managed by one ftso manager)
                epochId = _epochId;
            } catch {
                require(++numberOfReverts <= MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS, ERR_TOO_MANY_REVERTS);
            }
        }
        emit PriceHashesSubmitted(msg.sender, epochId, ftsos, _hashes, success, block.timestamp);
    }

    /**
     * @notice Reveals submitted prices during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hashes was submitted
     * @param _ftsoIndices          List of ftso indices
     * @param _prices               List of submitted prices in USD
     * @param _randoms              List of submitted random numbers
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PricesRevealed event
     */
    function revealPrices(
        uint256 _epochId,
        uint256[] memory _ftsoIndices,
        uint256[] memory _prices,
        uint256[] memory _randoms
    ) external override {
        uint256 len  = _ftsoIndices.length;
        require(len == _prices.length, ERR_ARRAY_LENGTHS);
        require(len == _randoms.length, ERR_ARRAY_LENGTHS);

        IIFtso[] memory ftsos = new IIFtso[](len);
        bool[] memory success = new bool[](len);
        uint256 numberOfReverts = 0;
        uint256 allowedBitmask = whitelistedFtsoBitmap[msg.sender];

        uint256 flrVP = uint256(-1);
        
        for (uint256 i = 0; i < len; i++) {
            uint256 ind = _ftsoIndices[i];
            if (allowedBitmask & (1 << ind) == 0) {
                require(++numberOfReverts <= MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS, ERR_TOO_MANY_REVERTS);
                continue;
            }
            IIFtso ftso = ftsoRegistry.getFtso(ind);
            ftsos[i] = ftso;
            // read flare VP only once
            if (flrVP == uint256(-1)) {
                flrVP = ftso.flrVotePowerCached(msg.sender);
            }
            // call reveal price on ftso
            try ftso.revealPriceSubmitter(msg.sender, _epochId, _prices[i], _randoms[i], flrVP) {
                success[i] = true;
            } catch {
                require(++numberOfReverts <= MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS, ERR_TOO_MANY_REVERTS);
            }
        }
        emit PricesRevealed(msg.sender, _epochId, ftsos, _prices, _randoms, success, block.timestamp);
    }
    
    /**
     * Returns bitmap of all ftso's for which `_voter` is allowed to submit prices/hashes.
     * If voter is allowed to vote for ftso at index (see *_FTSO_INDEX), the corrsponding
     * bit in the result will be 1.
     */    
    function voterWhitelistBitmap(address _voter) external view override returns (uint256) {
        return whitelistedFtsoBitmap[_voter];
    }
    
    function _hashSymbol(string memory _symbol) private pure returns(bytes32) {
        return keccak256(abi.encode(_symbol));
    }

}
