// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IIFtso.sol";
import "../../userInterfaces/IPriceSubmitter.sol";

// In seperate library as using abicoder v2 decreases the maximum number of arguments

/**
 * @title A contract implementing Flare Time Series Oracle
 */
contract MockNpmFtso is IIFtso {


    // number of decimal places in Asset USD price
    // note that the actual USD price is the integer value divided by 10^ASSET_PRICE_USD_DECIMALS
    uint256 public constant ASSET_PRICE_USD_DECIMALS = 5;

    // errors
    string internal constant ERR_NO_ACCESS = "Access denied";
    string internal constant ERR_PRICE_TOO_HIGH = "Price too high";
    string internal constant ERR_PRICE_REVEAL_FAILURE = "Reveal period not active";
    string internal constant ERR_PRICE_INVALID = "Price already revealed or not valid";
    string internal constant ERR_WRONG_EPOCH_ID = "Wrong epoch id";
    string internal constant ERR_DUPLICATE_SUBMIT_IN_EPOCH = "Duplicate submit in epoch";

    string internal constant UNAVAILABLE = "Unavailable for testing";

    // storage
    bool public override active;                // activation status of FTSO
    string public override symbol;              // asset symbol that identifies FTSO
    uint256 internal assetPriceUSD;            // current Asset USD price
    uint256 internal assetPriceTimestamp;      // time when price was updated    

    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;
    uint256 internal lastRevealEpochId;

    // external contracts
    IPriceSubmitter public priceSubmitter;       // Price submitter contract
    IIVPToken[] public assets;                   // array of assets
    IIFtso[] public assetFtsos;                  // FTSOs for assets (for a multi-asset FTSO)

    // Info normally stored in epoch
    uint256 internal firstEpochStartTime;
    uint256 internal submitPeriod;
    uint256 internal revealPeriod;

    mapping(uint256 => uint256) internal random;
    mapping(uint256 => mapping (address => uint256)) internal revealedPrices;

    modifier onlyPriceSubmitter {
        if (msg.sender != address(priceSubmitter)) {
            revertNoAccess();
        }
        _;
    }

    constructor(
        string memory _symbol,
        IPriceSubmitter _priceSubmitter,
        uint256 _firstEpochStartTime,
        uint256 _submitPeriod,
        uint256 _revealPeriod)
    {
        symbol = _symbol;
        assetPriceTimestamp = block.timestamp;
        active = true;
        priceSubmitter = _priceSubmitter;
        firstEpochStartTime = _firstEpochStartTime;
        submitPeriod = _submitPeriod;
        revealPeriod = _revealPeriod;
    }

    // This methods should only be used by price submitter
    /**
     * @notice Submits price hash for current epoch
     * @param _sender               Sender address
     * @param _epochId              Target epoch id to which hashes are submitted
     * @param _hash                 Hashed price and random number
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHashSubmitter(
        address _sender,
        uint256 _epochId,
        bytes32 _hash
    ) 
        external override onlyPriceSubmitter 
    {
        require(_epochId == _getCurrentEpochId(), ERR_WRONG_EPOCH_ID);
        require(epochVoterHash[_epochId][_sender] == 0, ERR_DUPLICATE_SUBMIT_IN_EPOCH);
        epochVoterHash[_epochId][_sender] = _hash;
        emit PriceHashSubmitted(_sender, _epochId, _hash, block.timestamp);
    }

    /**
     * @notice Reveals submitted price during epoch reveal period
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPriceSubmitter(
        address _voter,
        uint256 _epochId,
        uint256 _price,
        uint256 _random,
        uint256 /*_wNatVP*/     // just an optimization, to read native token vp only once
    )
        external override onlyPriceSubmitter 
    {
        require(_price < 2**128, ERR_PRICE_TOO_HIGH);
        // Check if reveal is in progress
        uint256 revealStartTime = firstEpochStartTime + (_epochId + 1) * submitPeriod; 
        require(revealStartTime <= block.timestamp && block.timestamp < revealStartTime + revealPeriod, 
                ERR_PRICE_REVEAL_FAILURE);
        require(epochVoterHash[_epochId][_voter] == keccak256(abi.encode(_price, _random, _voter)), 
                ERR_PRICE_INVALID);

        // TODO: What about random

        // prevent price submission from being revealed twice
        delete epochVoterHash[_epochId][_voter];
        revealedPrices[_epochId][_voter] = _price;
        // inform about price reveal result
        emit PriceRevealed(_voter, _epochId, _price, _random, block.timestamp, 0, 0);
    }

    function wNatVotePowerCached(address _owner, uint256 _epochId) external override returns (uint256 _wNatVP) {
        // TODO
    }

    /**
     * @notice Returns current Asset price
     * @return _price               Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     * @return _timestamp           Time when price was updated for the last time
     */
    function getCurrentPrice() external view override returns (uint256 _price, uint256 _timestamp) {
        // TODO
    }

    /**
     * @notice Returns current random number
     */
    function getCurrentRandom() external pure override returns (uint256) {
        return 0;
    }

    /**
     * @notice Returns current epoch data
     * @return _epochId                 Current epoch id
     * @return _epochSubmitEndTime      End time of the current epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime      End time of the current epoch price reveal as seconds from unix epoch
     * @return _votePowerBlock          Not calculated in mocks, always 0
     * @return _fallbackMode            Not calculated in mocks, always 0
     * @dev half-closed intervals - end time not included
     */
    function getPriceEpochData() external view override 
        returns (
            uint256 _epochId,
            uint256 _epochSubmitEndTime,
            uint256 _epochRevealEndTime,
            uint256 _votePowerBlock,
            bool _fallbackMode
        )
    {
        _epochId = _getCurrentEpochId();
        _epochSubmitEndTime = firstEpochStartTime + (_epochId + 1) * submitPeriod;
        _epochRevealEndTime = _epochSubmitEndTime + revealPeriod;

        _votePowerBlock = 0;
        _fallbackMode = false;
    }

    /**
     * @notice Returns current epoch data
     * @return _firstEpochStartTime         First epoch start time
     * @return _submitPeriod                Submit period in seconds
     * @return _revealPeriod                Reveal period in seconds
     */
    function getPriceEpochConfiguration() external view override 
        returns (
            uint256 _firstEpochStartTime,
            uint256 _submitPeriod,
            uint256 _revealPeriod
        )
    {
        return (
            firstEpochStartTime, 
            submitPeriod,
            revealPeriod
        );
    }

    /**
     * @notice Returns Asset price submitted by voter in specific epoch
     * @param _epochId              Id of the epoch
     * @param _voter                Address of the voter
     * @return Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     */
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external view override returns (uint256) {
        return revealedPrices[_epochId][_voter];
    }

    /**
     * @notice Returns current epoch id
     * @dev Should never revert
     */
    function _getCurrentEpochId() internal view returns (uint256) {
        return _getEpochId(block.timestamp);
    }

    /**
     * @notice Returns id of the epoch which was opened for price submission at the specified timestamp
     * @param _timestamp            Timestamp as seconds from unix epoch
     * @dev Should never revert
     */
    function _getEpochId(uint256 _timestamp) internal view returns (uint256) {
        if (_timestamp < firstEpochStartTime) {
            return 0;
        } else {
            return (_timestamp - firstEpochStartTime) / submitPeriod;
        }

    }

    // Methods only used for IIFtso implementation
    // Will always fail

    function finalizePriceEpoch(uint256, bool) external pure override 
        returns(
            address[] memory,
            uint256[] memory,
            uint256
        )
    {
        require(false, UNAVAILABLE);
        return (new address[](0), new uint256[](0), 0);
    }

    function averageFinalizePriceEpoch(uint256) external pure override {
        require(false, UNAVAILABLE);
    }

    function forceFinalizePriceEpoch(uint256) external pure override {
        require(false, UNAVAILABLE);
    }

    // activateFtso will be called by ftso manager once ftso is added 
    // before this is done, FTSO can't run
    function activateFtso(
        address,
        uint256,
        uint256,
        uint256) 
        external pure override
    {
        require(false, UNAVAILABLE);
    }

    function deactivateFtso() external pure override {
        require(false, UNAVAILABLE);
    }

    // update initial price and timestamp - only if not active
    function updateInitialPrice(uint256, uint256) external pure override {
        require(false, UNAVAILABLE);
    }

    function configureEpochs(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        address[] memory
    )
        external pure override
    {
        require(false, UNAVAILABLE);
    }

    function setAsset(IIVPToken) external pure override {
        require(false, UNAVAILABLE);
    }

    function setAssetFtsos(IIFtso[] memory) external pure override {
        require(false, UNAVAILABLE);
    }

    // current vote power block will update per reward epoch. 
    // the FTSO doesn't have notion of reward epochs.
    // reward manager only can set this data. 
    function setVotePowerBlock(uint256) external pure override {
        require(false, UNAVAILABLE);
    }

    function initializeCurrentEpochStateForReveal(bool) external pure override {
        require(false, UNAVAILABLE);
    }
  
    /**
     * @notice Returns the FTSO asset
     * @dev asset is null in case of multi-asset FTSO
     */
    function getAsset() external pure override returns (IIVPToken) {
        require(false, UNAVAILABLE);
        return IIVPToken(address(0));
    }

    /**
     * @notice Returns the Asset FTSOs
     * @dev AssetFtsos is not null only in case of multi-asset FTSO
     */
    function getAssetFtsos() external pure override returns (IIFtso[] memory) {
        require(false, UNAVAILABLE);
        return new IIFtso[](0);
    }

    function epochsConfiguration() external pure override 
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            address[] memory
        )
    {
        require(false, UNAVAILABLE);
        return (0, 0, 0, 0, 0, 0, new address[](0));
    }

    function getCurrentEpochId() external pure override returns (uint256) {
        require(false, UNAVAILABLE);
        return 0;
    }

    function getEpochId(uint256) external pure override returns (uint256) {
        require(false, UNAVAILABLE);
        return 0;
    }

    function getRandom(uint256) external pure override returns (uint256) {
        require(false, UNAVAILABLE);
        return 0;
    }

    function getEpochPrice(uint256) external pure override returns (uint256) {
        require(false, UNAVAILABLE);
        return 0;
    }

    function getVoteWeightingParameters() external pure override 
        returns (
            IIVPToken[] memory,
            uint256[] memory,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        require(false, UNAVAILABLE);
        return (new IIVPToken[](0), new uint256[](0), 0, 0, 0, 0);
    }

    function wNat() external pure override returns (IIVPToken) {
        require(false, UNAVAILABLE);
        return IIVPToken(address(0));
    }

    function revertNoAccess() internal pure {
        revert(ERR_NO_ACCESS);
    } 
}
