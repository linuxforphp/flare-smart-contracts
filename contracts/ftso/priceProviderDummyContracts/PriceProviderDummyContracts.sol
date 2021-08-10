// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./priceProviderDummyFtso.sol";
import "../../userInterfaces/IPriceSubmitter.sol";
import "../../userInterfaces/IFtsoRegistry.sol";
import "../../userInterfaces/IVoterWhitelister.sol";
import "../../governance/implementation/Governed.sol";


/*
 * This file and ./priceProviderDummyFtso.sol contains core contracts needed for Flare price providers.
 * All the dummy contracts implement the same user interfaces that will be available to price providers in 
 * real network. Governance and administrative methods are mocked, but user facing methods work in a similar 
 * fashion.
 * 
 * PriceProvider works in the same way. It provides access to VoterWhitelister for whitelisting and FtsoRegistry
 * to get asset indices. Both submit and reveal prices are available and work in the same way as real ones. 
 * 
 * FtsoRegistry provides information about ftsos and corresponding assets. 
 * It works in the same way as in the real network.
 *
 * VoterWhitelister work similarly as in real network with few changes:
 *  - At most one voter can be whitelisted at time.
 *  - No vote power calculation is done during whitelisting, previously whitelisted user is always kicked out.
 * 
 * DummyFtso implements only a minimal subset of methods required for submission and reveal. 
 * Notably, no median calculation, vote power calculation or rewarding is done.

*/


/**
 * @title A contract for FTSO registry
 */
contract DummyFtsoRegistry is Governed, IFtsoRegistry{

    // constants
    uint256 internal constant MAX_HISTORY_LENGTH = 5;

    // errors
    string internal constant ERR_TOKEN_NOT_SUPPORTED = "FTSO index not supported";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSO manager only";

    // storage 
    IIFtso[MAX_HISTORY_LENGTH][] private ftsoHistory;

    constructor(address _governance) Governed(_governance) { }

    /**
     * @notice Update current active FTSO contracts mapping
     * @param _ftsoContract new target FTSO contract
     */
    function addFtso(IIFtso _ftsoContract) external onlyGovernance {
        uint256 len = ftsoHistory.length;
        string memory _symbol = _ftsoContract.symbol();
        bytes32 _encodedSymbol = keccak256(abi.encode(_symbol));
        uint256 i = 0;
        // Iterate over supported symbol array
        for ( ; i < len; i++) {
            // Deletion of symbols leaves an empty address "hole", so the address might be zero
            IFtso current = ftsoHistory[i][0];
            if (address(current) == address(0)) {
                continue;
            }
            if (_encodedSymbol == keccak256(abi.encode(current.symbol()))) {
                break;
            }
        }
        // ftso with the same symbol is not yet in history array, add it
        if (i == len) {
            ftsoHistory.push();
        } else {
            // Shift history
            _shiftHistory(i);
        }
        ftsoHistory[i][0] = _ftsoContract;        
    }

    /**
     * Removes the ftso at specified index and keeps part of the history
     * @dev Reverts if the provided index is unsupported
     * @param _ftso ftso to remove
     */
    function removeFtso(IIFtso _ftso) external onlyGovernance {
        bytes32 _encodedSymbol = keccak256(abi.encode(_ftso.symbol()));
        uint256 len = ftsoHistory.length;
        for (uint256 i = 0; i < len; ++i) {
            IFtso current = ftsoHistory[i][0];
            if (address(current) == address(0)) {
                continue;
            }
            // Removal behaves the same as setting null value as current
            if (_encodedSymbol == keccak256(abi.encode(current.symbol()))) {
                _shiftHistory(i);
                ftsoHistory[i][0] = IIFtso(address(0));
                return;
            }

        }

        revert(ERR_TOKEN_NOT_SUPPORTED);
    }

    /**
     * @dev Reverts if unsupported index is passed
     * @return _activeFtso FTSO contract for provided index
     */
    function getFtso(uint256 _assetIndex) external view override 
        returns(IIFtso _activeFtso) 
    {
        return _getFtso(_assetIndex);
    }

    /**
     * @dev Reverts if unsupported symbol is passed
     * @return _activeFtso FTSO contract for provided symbol
     */
    function getFtsoBySymbol(string memory _symbol) external view override 
        returns(IIFtso _activeFtso) 
    {
        return _getFtso(_getFtsoIndex(_symbol));
    }

    /**
     * @notice Public view function to get the price of active FTSO for given asset index
     * @dev Reverts if unsupported index is passed
     * @return _price current price of asset in USD
     * @return _timestamp timestamp for when this price was updated
     */
    function getCurrentPrice(uint256 _assetIndex) external view override 
        returns(uint256 _price, uint256 _timestamp) 
    {
        return _getFtso(_assetIndex).getCurrentPrice();
    }

    function getCurrentPrice(string memory _symbol) external view override 
        returns(uint256 _price, uint256 _timestamp) 
    {
        return _getFtso(_getFtsoIndex(_symbol)).getCurrentPrice();
    }
    

    /**
     * @return _supportedIndices the array of all active FTSO indices in increasing order. 
     * Active FTSOs are ones that currently receive price feeds.
     */
    function getSupportedIndices() external view override 
        returns(uint256[] memory _supportedIndices) 
    {
        return _getSupportedIndices();
    }

    /**
     * @notice Get array of all supported indices and corresponding FTSOs
     * @return _supportedIndices the array of all supported indices
     * @return _ftsos the array of all supported ftsos
     */
    function getSupportedIndicesAndFtsos() external view override
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos)
    {   

        _supportedIndices = _getSupportedIndices();
        uint256 len = _supportedIndices.length;
        _ftsos = new IIFtso[](len);
        while (len > 0) {
            --len;
            _ftsos[len] = ftsoHistory[_supportedIndices[len]][0];
        }
    }

    /**
     * @notice Get array of all supported symbols and corresponding FTSOs
     * @return _supportedSymbols the array of all supported symbols
     * @return _ftsos the array of all supported ftsos
     */
    function getSupportedSymbolsAndFtsos() external view override
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos)
    {   

        uint256[] memory _supportedIndices = _getSupportedIndices();
        uint256 len = _supportedIndices.length;
        _ftsos = new IIFtso[](len);
        _supportedSymbols = new string[](len);
        while (len > 0) {
            --len;
            _ftsos[len] = ftsoHistory[_supportedIndices[len]][0];
            _supportedSymbols[len] = _ftsos[len].symbol();
        }
    }

    /**
     * @notice Get array of all FTSO contracts for all supported asset indices. 
     * The index of FTSO in returned array does not necessarily correspond to _assetIndex
     * Due to deletion, some indices might be unsupported. 
     * @dev See `getSupportedIndicesAndFtsos` for pair of correct indices and `getAllFtsos` 
     * for FTSOs at valid indices but with possible "null" holes.
     * @return _ftsos the array of all supported FTSOs
     */
    function getSupportedFtsos() external view override returns(IIFtso[] memory _ftsos) {
        uint256[] memory supportedIndices = _getSupportedIndices();
        uint256 len = supportedIndices.length;
        _ftsos = new IIFtso[](len);
        while (len > 0) {
            --len;
            _ftsos[len] = ftsoHistory[supportedIndices[len]][0];
        }
    }

    /**
     * @notice Get array of all FTSO contracts for all supported asset indices
     * @return _ftsos the array of all FTSOs
     * @dev Return value might contain uninitialized FTSOS at zero address. 
     */
    function getFtsos() external view returns(IIFtso[] memory _ftsos) {
        uint256 len = ftsoHistory.length;
        IIFtso[] memory ftsos = new IIFtso[](len);
        while (len > 0) {
            --len;
            ftsos[len] = ftsoHistory[len][0];
        }
        return ftsos;
    }

    /**
     * @notice Get the history of FTSOs for given index
     * @dev If there are less then MAX_HISTORY_LENGTH the remaining addresses will be 0 addresses
     * @param _assetIndex asset index
     * @return _ftsoAddressHistory the history of FTSOs contract for provided index
     */
    function getFtsoHistory(uint256 _assetIndex) external view 
        returns(IIFtso[MAX_HISTORY_LENGTH] memory _ftsoAddressHistory) 
    {   
        require(_assetIndex < ftsoHistory.length && 
                address(ftsoHistory[_assetIndex][0]) != address(0), ERR_TOKEN_NOT_SUPPORTED);
        return ftsoHistory[_assetIndex];
    }

    function getFtsoIndex(string memory _symbol) external view override returns (uint256 _assetIndex) {
        return _getFtsoIndex(_symbol);
    }

    /**
     * @notice Shift the FTSOs history by one so the FTSO at index 0 can be overwritten
     * @dev Internal helper function
     */
    function _shiftHistory(uint256 _assetIndex) internal {
        for (uint256 i = MAX_HISTORY_LENGTH-1; i > 0; i--) {
            ftsoHistory[_assetIndex][i] = ftsoHistory[_assetIndex][i-1];
        }
    }

    function _getFtsoIndex(string memory _symbol) private view returns (uint256 _assetIndex) {
        bytes32 _encodedSymbol = keccak256(abi.encode(_symbol));
        uint256 len = ftsoHistory.length;
        for (uint256 i = 0; i < len; ++i) {
            IIFtso current = ftsoHistory[i][0];
            if (address(current) == address(0)) {
                continue;
            }
            if (_encodedSymbol == keccak256(abi.encode(current.symbol()))) {
                return i;
            }
        }

        revert(ERR_TOKEN_NOT_SUPPORTED); 
    }


    /**
     * @notice Get the active FTSO for given index
     * @dev Internal get ftso function so it can be used within other methods
     */
    function _getFtso(uint256 _assetIndex) private view 
        returns(IIFtso _activeFtso) 
    {
        require(_assetIndex < ftsoHistory.length, ERR_TOKEN_NOT_SUPPORTED);

        IIFtso ftso = ftsoHistory[_assetIndex][0];
        if (address(ftso) == address(0)) {
            // Invalid index, revert if address is zero address
            revert(ERR_TOKEN_NOT_SUPPORTED);
        }
        _activeFtso = ftso;
    }

    function _getSupportedIndices() private view 
        returns(uint256[] memory _supportedIndices) 
    {
        uint256 len = ftsoHistory.length;
        uint256[] memory supportedIndices = new uint256[](len);
        address zeroAddress = address(0);
        uint256 taken = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (address(ftsoHistory[i][0]) != zeroAddress) {
                supportedIndices[taken] = i;
                ++taken;
            }
        }
        _supportedIndices = new uint256[](taken);
        while (taken > 0) {
            --taken;
            _supportedIndices[taken] = supportedIndices[taken];
        }
        return _supportedIndices;
    }

}


contract DummyVoterWhitelister is IVoterWhitelister {

    // Unused in mock contract
    uint256 public override defaultMaxVotersForFtso = 0;
    mapping (uint256 => uint256) public override maxVotersForFtso;
    
    // mapping: ftsoIndex => array of whitelisted voters for this ftso
    mapping (uint256 => address) internal whitelist;
    
    DummyPriceSubmitter internal priceSubmitter;
    
    IFtsoRegistry internal ftsoRegistry;
    
    modifier onlyPriceSubmitter {
        require(msg.sender == address(priceSubmitter), "only price submitter");
        _;
    }
    
    constructor(DummyPriceSubmitter _priceSubmitter) {
        priceSubmitter = _priceSubmitter;
    }
    
    /**
     * Try to add voter to all whitelists.
     */
    function requestFullVoterWhitelisting(address _voter) external override {
        uint256[] memory indices = ftsoRegistry.getSupportedIndices();
        for (uint256 i = 0; i < indices.length; i++) {
            requestWhitelistingVoter(_voter, indices[i]);
        }
    }
    
    /**
     * Try adding `_voter` account to the whitelist if it has enough voting power.
     * May be called by any address.
     */
    function requestWhitelistingVoter(
        address _voter, 
        uint256 _ftsoIndex
    )
        public override
    {
        address addr = whitelist[_ftsoIndex];
        if (addr == _voter) {
            // _voter is already whitelisted, return
            return;
        }

        whitelist[_ftsoIndex] = _voter;

        address[] memory removedVoters = new address[](1);
        removedVoters[0] = addr;
        _votersRemovedFromWhitelist(removedVoters, _ftsoIndex);
        _voterWhitelisted(_voter, _ftsoIndex);
    }

    /**
     * Update a voter whitelisting and emit an event.
     */    
    function _voterWhitelisted(address _voter, uint256 _ftsoIndex) private {
        emit VoterWhitelisted(_voter, _ftsoIndex);
        priceSubmitter.voterWhitelisted(_voter, _ftsoIndex);
    }
    
    /**
     * Update when a  voter is removed from the whitelist. And emit an event.
     */    
    function _votersRemovedFromWhitelist(address[] memory _removedVoters, uint256 _ftsoIndex) private {
        for (uint256 i = 0; i < _removedVoters.length; i++) {
            emit VoterRemovedFromWhitelist(_removedVoters[i], _ftsoIndex);
        }
        priceSubmitter.votersRemovedFromWhitelist(_removedVoters, _ftsoIndex);
    }

    /**
     * Changes ftsoRegistry address.
     */
    function setFtsoRegistry(IFtsoRegistry _ftsoRegistry) external onlyPriceSubmitter {
        ftsoRegistry = _ftsoRegistry;
    }
    
    function addFtso(uint256 _ftsoIndex) external onlyPriceSubmitter {
        _addFtso(_ftsoIndex);
    }
    
    function _addFtso(uint256 _ftsoIndex) internal {
    }
}


/**
 * @title Price submitter
 * @notice A contract used to submit/reveal prices to multiple Flare Time Series Oracles in one transaction
 */
contract DummyPriceSubmitter is IPriceSubmitter {

    string internal constant ERR_ARRAY_LENGTHS = "Array lengths do not match";
    string internal constant ERR_TOO_MANY_REVERTS = "Too many reverts";
    string internal constant ERR_INVALID_INDEX = "Invalid index";
    string internal constant ERR_WHITELISTER_ONLY = "Voter whitelister only";
    string internal constant ERR_ALREADY_ADDED = "Already added";

    uint256 internal constant MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS = 2;
    uint256 internal constant MAX_ALLOWED_NUMBER_OF_REVEAL_REVERTS = 2;


    DummyFtsoRegistry internal ftsoRegistry; 
    
    DummyVoterWhitelister internal voterWhitelister;

    // Bit at index `i` corresponds to being whitelisted for vote on ftso at index `i`
    mapping(address => uint256) public whitelistedFtsoBitmap; 

    mapping(bytes32 => uint256) private currencyBitmask;

    modifier onlyWhitelister {
        require(msg.sender == address(voterWhitelister), ERR_WHITELISTER_ONLY);
        _;
    }

    /**
     * Deploy all needed contracts for testing
     */
    constructor() {

        ftsoRegistry = new DummyFtsoRegistry(address(this));
        voterWhitelister = new DummyVoterWhitelister(this);
        voterWhitelister.setFtsoRegistry(ftsoRegistry);
        // Initialize all dummy ftsos for pacakge
        string[10] memory symbols = ["WFLR", "FXRP", "FLTC", "FXLM", "FXDG", "FADA", "FALGO", "FBCH", "FDGB", "FBTC"];
        for (uint256 i = 0; i < symbols.length; ++i) {
            string memory symbol = symbols[i];
            DummyFtso ftso = new DummyFtso(symbol, this, block.timestamp - 120, 120, 30);
            ftsoRegistry.addFtso(ftso);
            uint256 ftsoIndex = ftsoRegistry.getFtsoIndex(symbol);
            
            bytes32 symbolHash = _hashSymbol(ftso.symbol());
            require(currencyBitmask[symbolHash] == 0, ERR_ALREADY_ADDED);
            currencyBitmask[symbolHash] = ftsoIndex;
            voterWhitelister.addFtso(ftsoIndex);

        }
    }

    
    /**
     * Called from whitelister when new voter has been whitelisted.
     */
    function voterWhitelisted(
        address _voter, 
        uint256 _ftsoIndex
    )
        external onlyWhitelister
    {
        whitelistedFtsoBitmap[_voter] |= 1 << _ftsoIndex;
    }
    
    /**
     * Called from whitelister when one or more voters have been removed.
     */
    function votersRemovedFromWhitelist(
        address[] memory _removedVoters, 
        uint256 _ftsoIndex
    )
        external onlyWhitelister
    {
        for (uint256 i = 0; i < _removedVoters.length; i++) {
            whitelistedFtsoBitmap[_removedVoters[i]]  &= ~(1 << _ftsoIndex);
        }
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
    )
        external override
    {
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

    function getVoterWhitelister() public view override returns (IVoterWhitelister) {
        return voterWhitelister;
    }

    function getFtsoRegistry() public view override returns (IFtsoRegistry) {
        return ftsoRegistry;
    }

    function getFtsoManager() public pure override returns (IFtsoManager) {
        revert("Not in dummy contract");
    }
}
