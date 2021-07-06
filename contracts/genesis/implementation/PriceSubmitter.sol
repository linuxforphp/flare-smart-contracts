// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IPriceSubmitter.sol";
import "../../governance/implementation/GovernedAtGenesis.sol";
import "../interface/IIFtsoRegistry.sol";


/**
 * @title Price submitter
 * @notice A contract used to submit/reveal prices to multiple Flare Time Series Oracles in one transaction
 */
contract PriceSubmitter is IPriceSubmitter, GovernedAtGenesis {

    string internal constant ERR_INSUFFICIENT_LISTED_VOTE_POWER = "Insufficient listed vote power";
    string internal constant ERR_ARRAY_LENGTHS = "Array lengths do not match";
    string internal constant ERR_TOO_MANY_REVERTS = "Too many reverts";
    string internal constant ERR_INVALID_INDEX = "Invalid index";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSOManager only";

    uint256 internal constant MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS = 2;
    uint256 internal constant MAX_ALLOWED_NUMBER_OF_REVEAL_REVERTS = 2;

    uint256 internal constant WFLR_BITMASK = 1 << WFLR_INDEX; 

    // Currency indices
    uint256 internal constant WFLR_INDEX = 255;

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

    // Bit at index `i` corresponds to being whitelisted for vote on ftso at index `i`
    // WFLR_INDEX (the index of the last bit) is special and does not correspond to any 
    // existing ftsos but to WFLR vote power which allows voter to vote on any ftso.
    mapping(address => uint256) private whiteListedFtsoBitMap; 

    mapping(bytes32 => uint256) private currencyBitmask;

    modifier onlyFtsoManager {
        require(msg.sender == address(ftsoManager), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructor is called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) {
        /* empty block */
    }

    function setFtsoManager(IIFtsoManager _ftsoManager) external override onlyGovernance {
        ftsoManager = _ftsoManager;
    }

    function setFtsoRegistry(IIFtsoRegistry _ftsoRegistryToSet) external override onlyGovernance {
        ftsoRegistry = _ftsoRegistryToSet;
    }

    function removeFtso(IIFtso _ftso) external override onlyFtsoManager {
        // Set the bitmask to zero => Any submission will fail
        bytes32 symbolHash = hashSymbol(_ftso.symbol());
        delete currencyBitmask[symbolHash];
    }

    function addFtso(IIFtso _ftso, uint256 _ftsoIndex) external override onlyFtsoManager {
        bytes32 symbolHash = hashSymbol(_ftso.symbol());
        require(currencyBitmask[symbolHash] == 0, "Already added");
        currencyBitmask[symbolHash] = _ftsoIndex;
    }   
    /**
     * @notice Recalculates whitelisted bitmask for provided address and just 
     * for specified ftso index.
     * Whitelisting information for other assets and WFlr is not updated 
     */
    function requestFtsoWhiteListingFassetHolder(address _voter, uint256 _ftsoIndex) external override {
        require(_ftsoIndex != WFLR_INDEX, ERR_INVALID_INDEX);
        uint256 currentVotingPower = whiteListedFtsoBitMap[_voter];
        bool hasVotePower;
 
        IIFtso ftso = ftsoRegistry.getFtso(_ftsoIndex);
        hasVotePower = ftso.hasSufficientFassetVotePower(_voter);
        if(hasVotePower){
            currentVotingPower |= (1 << _ftsoIndex);
        }else{
            currentVotingPower &= ~(1 << _ftsoIndex);
        }
        whiteListedFtsoBitMap[_voter] = currentVotingPower;
    }

    /**
     * @notice Recalculates whitelist bitmask for WFLR (Wrapped Flare) for _voter address.
     * Whitelisting information for fAssets is not updated. 
     */
    function requestFtsoWhiteListingWflrHolder(address _voter) external override {
        IIFtso[] memory ftsos = ftsoRegistry.getSupportedFtsos();
        uint256 len = ftsos.length;
        if(len == 0){
            return;
        }
        IIFtso dummyFtso = ftsos[0];

        if(dummyFtso.hasSufficientWflrVotePower(_voter)){
            whiteListedFtsoBitMap[_voter] = whiteListedFtsoBitMap[_voter] | WFLR_BITMASK;
        }else{
            whiteListedFtsoBitMap[_voter] = whiteListedFtsoBitMap[_voter] & ~WFLR_BITMASK;
        }
    }

    /**
     * @notice Recalculates full whitelist bitmask for WFLR (Wrapped Flare) and all fAsset for _voter address. 
     */
    function requestFtsoFullVoterWhitelisting(address _voter) external override {
        
        (uint256[] memory indices, IIFtso[] memory ftsos) = ftsoRegistry.getSupportedIndicesAndFtsos();
        uint256 len = ftsos.length;
        if(len == 0){
            return;
        }
        IIFtso dummyFtso = ftsos[0];
        uint256 voterMask = 0;
        // Check WFLR power
        if(dummyFtso.hasSufficientWflrVotePower(_voter)){
            voterMask = WFLR_BITMASK; // equivalent to voterMask |= WFLR_MASK since voterMask == 0
        }
        // Check vote power for each active ftso
        for(uint256 i = 0; i < len; ++i){
            if(ftsos[i].hasSufficientFassetVotePower(_voter)) {
                voterMask |= indices[i];
            }
        }
        whiteListedFtsoBitMap[_voter] = voterMask;
    }

    /**
     * @notice Submits price hashes for current epoch
     * @param _ftsoIndices          List of ftso indices
     * @param _hashes               List of hashed price and random number
     * @notice Emits PriceHashesSubmitted event
     */
    function submitPriceHashes(uint256[] memory _ftsoIndices, bytes32[] memory _hashes) external override {
        uint256 allowedBitmask = whiteListedFtsoBitMap[msg.sender];
        uint256 bitmask = 0;
        uint256 length = _ftsoIndices.length;
        if(WFLR_BITMASK & allowedBitmask == 0){ 
            // If address does not have the wflr power we check each fasset power

            // Construct bitmask for all ftso indices to vote for
            for(uint256 i = 0; i < length; ++i){
                bitmask |= (1 << _ftsoIndices[i]);
            }

            uint256 result = allowedBitmask & bitmask;
            // 
            if(result != bitmask){
                revert(ERR_INSUFFICIENT_LISTED_VOTE_POWER); 
            } // result == _ftsoBitmask : \forall i. _ftsoBitmask[i] => allowedBitmask[i] 
        
        } // otherwise user has enough wflr power, fasset power is irrelevant
        bool[] memory success = new bool[](length);
        IIFtso[] memory ftsos = new IIFtso[](length);
        uint256 epochId;
        uint256 numberOfReverts;

        for (uint256 i = 0; i < length; i++) {
            uint256 ind = _ftsoIndices[i];
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
        uint256 numberOfReverts;

        for (uint256 i = 0; i < len; i++) {
            uint256 ind = _ftsoIndices[i];
            ftsos[i] = ftsoRegistry.getFtso(ind);
            try ftsos[i].revealPriceSubmitter(msg.sender, _epochId, _prices[i], _randoms[i]) {
                success[i] = true;
            } catch {
                require(++numberOfReverts <= MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS, ERR_TOO_MANY_REVERTS);
            }
        }
        emit PricesRevealed(msg.sender, _epochId, ftsos, _prices, _randoms, success, block.timestamp);
    }

    function hashSymbol(string memory _symbol) private pure returns(bytes32) {
        return keccak256(abi.encode(_symbol));
    }

}
