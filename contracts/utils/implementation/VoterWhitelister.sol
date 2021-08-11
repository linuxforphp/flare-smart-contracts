// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../genesis/interface/IIVoterWhitelister.sol";
import "../../token/interface/IIVPToken.sol";
import "../../governance/implementation/Governed.sol";
import "../../genesis/interface/IIPriceSubmitter.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/implementation/SafePct.sol";


contract VoterWhitelister is IIVoterWhitelister, Governed {
    using SafeMath for uint256;
    using SafePct for uint256;

    uint256 private constant FLR_FTSO_INDEX = 0;
    uint256 internal constant TERA = 10 ** 12;                    // 10^12
    uint256 internal constant BIPS100 = 10 ** 4;                  // 100 * 100%

    uint256 public override defaultMaxVotersForFtso;
        
    /**
     * Maximum number of voters in a single ftso whitelist.
     * Adjustable separately for each ftsoIndex.
     */
    mapping (uint256 => uint256) public override maxVotersForFtso;
    
    // mapping: ftsoIndex => array of whitelisted voters for this ftso
    mapping (uint256 => address[]) internal whitelist;
    
    IIPriceSubmitter internal priceSubmitter;
    
    IFtsoRegistry internal ftsoRegistry;
    
    modifier onlyPriceSubmitter {
        require(msg.sender == address(priceSubmitter), "only price submitter");
        _;
    }
    
    constructor(
        address _governance, 
        IIPriceSubmitter _priceSubmitter, 
        uint256 _defaultMaxVotersForFtso
    )
        Governed(_governance)
    {
        priceSubmitter = _priceSubmitter;
        defaultMaxVotersForFtso = _defaultMaxVotersForFtso;
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
    function requestWhitelistingVoter(address _voter, uint256 _ftsoIndex) public override {
        uint256 maxVoters = maxVotersForFtso[_ftsoIndex];
        require(maxVoters > 0, "max voters not set for ftso");
        
        address[] storage addressesForFtso = whitelist[_ftsoIndex];
        uint256 length = addressesForFtso.length;
        
        // copy to memory and check if it contains _voter
        address[] memory addresses = new address[](length + 1);
        for (uint256 i = 0; i < length; i++) {
            address addr = addressesForFtso[i];
            if (addr == _voter) {
                // _voter is already whitelisted, return
                return;
            }
            addresses[i] = addr;
        }
        addresses[length] = _voter;
        
        // can we just add a new one?
        if (length < maxVoters) {
            addressesForFtso.push(_voter);
            _voterWhitelisted(_voter, _ftsoIndex);
            return;
        }
        
        // find a candidate to kick out
        uint256 minIndex = _minVotePowerIndex(addresses, _ftsoIndex);
        if (minIndex == length) {
            // the new _voter has the minimum vote power, do nothing
            return;
        }
        
        // kick the minIndex out and replace it with _voter
        address[] memory removedVoters = new address[](1);
        removedVoters[0] = addresses[minIndex];
        addressesForFtso[minIndex] = _voter;
        _votersRemovedFromWhitelist(removedVoters, _ftsoIndex);
        _voterWhitelisted(_voter, _ftsoIndex);
    }

    /**
     * Set the maximum number of voters in the whitelist for FTSO at index `_ftsoIndex`.
     * Calling this function might remove several voters with the least votepower from the whitelist.
     */
    function setMaxVotersForFtso(uint256 _ftsoIndex, uint256 _newMaxVoters) external override onlyGovernance {
        maxVotersForFtso[_ftsoIndex] = _newMaxVoters;
        // need to remove any?
        address[] storage addressesForFtso = whitelist[_ftsoIndex];
        if (_newMaxVoters >= addressesForFtso.length) {
            return;
        }
        // remove voters with minimum vote power
        IIFtso ftso = ftsoRegistry.getFtso(_ftsoIndex);
        uint256[] memory votePowers = _getVotePowerWeights(ftso, addressesForFtso);
        uint256 length = votePowers.length;
        uint256 toRemove = length - _newMaxVoters;
        address[] memory removedVoters = new address[](toRemove);
        for (uint256 n = 0; n < toRemove; n++) {
            uint256 minIndex = _findMinimum(votePowers, length);
            removedVoters[n] = addressesForFtso[minIndex];
            if (minIndex < length - 1) {
                addressesForFtso[minIndex] = addressesForFtso[length - 1];
                votePowers[minIndex] = votePowers[length - 1];
            }
            addressesForFtso.pop();
            --length;
        }
        _votersRemovedFromWhitelist(removedVoters, _ftsoIndex);
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
     * Set the maximum number of voters in the whitelist for a new FTSO.
     */
    function setDefaultMaxVotersForFtso(uint256 _defaultMaxVotersForFtso) external override onlyGovernance {
        defaultMaxVotersForFtso = _defaultMaxVotersForFtso;
    }

    /**
     * Changes ftsoRegistry address.
     */
    function setFtsoRegistry(IFtsoRegistry _ftsoRegistry) external override onlyPriceSubmitter {
        ftsoRegistry = _ftsoRegistry;
    }
    
    /**
     * Create whitelist with default size for ftso.
     */
    function addFtso(uint256 _ftsoIndex) external override onlyPriceSubmitter {
        _addFtso(_ftsoIndex);
    }
    
    /**
     * Clear whitelist for ftso at `_ftsoIndex`.
     */
    function removeFtso(uint256 _ftsoIndex) external override onlyPriceSubmitter {
        _removeFtso(_ftsoIndex);
    }
    
    /**
     * Create whitelist with default size for ftso - implementation.
     */
    function _addFtso(uint256 _ftsoIndex) internal {
        require(maxVotersForFtso[_ftsoIndex] == 0, "whitelist already exist");
        maxVotersForFtso[_ftsoIndex] = defaultMaxVotersForFtso;
    }
    
    /**
     * Clear whitelist for ftso at `_ftsoIndex` - implementation.
     */
    function _removeFtso(uint256 _ftsoIndex) internal {
        _votersRemovedFromWhitelist(whitelist[_ftsoIndex], _ftsoIndex);
        delete whitelist[_ftsoIndex];
        delete maxVotersForFtso[_ftsoIndex];
    }
    
    /**
     * Find index of the element with minimum vote power weight.
     * In case of a tie, returns later index.
     */
    function _minVotePowerIndex(address[] memory _addresses, uint256 _ftsoIndex) internal returns (uint256) {
        IIFtso ftso = ftsoRegistry.getFtso(_ftsoIndex);
        uint256[] memory votePowers = _getVotePowerWeights(ftso, _addresses);
        return _findMinimum(votePowers, votePowers.length);
    }
    
    /**
     * Calculate vote power weights like FTSO.
     * Unlike FTSO, it calls VPToken vote power in a batch to limit gas consumption.
     * Another difference with FTSO is that voter turnout is ignored (it makes
     * no sense for whitelist, since it has to be initialized before any voting occurs).
     * Apart from turnout, the results should be equal as for FTSO.
     */
    function _getVotePowerWeights(IIFtso ftso, address[] memory _addresses) internal 
        returns (uint256[] memory _votePowers)
    {
        // get parameters
        IIVPToken[] memory assets;
        uint256[] memory assetMultipliers;
        uint256 totalVotePowerFlr;
        uint256 totalVotePowerAsset;
        uint256 assetWeightRatio;
        uint256 votePowerBlock;
        (assets, assetMultipliers, totalVotePowerFlr, totalVotePowerAsset, assetWeightRatio, votePowerBlock)
            = ftso.getVoteWeightingParameters();
        // flr vote powers
        uint256[] memory wflrVP = 
            _getFlareVotePowerWeights(ftso.wFlr(), totalVotePowerFlr, _addresses, votePowerBlock);
        // asset vote powers
        uint256[] memory combinedAssetVP = 
            _getAssetVotePowerWeights(assets, assetMultipliers, totalVotePowerAsset, _addresses, votePowerBlock);
        // combine asset and wflr
        return _computeWeightedSum(wflrVP, combinedAssetVP, assetWeightRatio);
    }
    
    /**
     * Calculate flare vote power weights like FTSO.
     */
    function _getFlareVotePowerWeights(
        IIVPToken _wflr,
        uint256 _totalVotePowerFlr,
        address[] memory _addresses, 
        uint256 _blockNumber
    )
        internal
        returns (uint256[] memory _wflrVP)
    {
        _wflrVP = _getVotePowers(_wflr, _addresses, _blockNumber);
        if (_totalVotePowerFlr == 0) {
            return _wflrVP;  // if total is 0, all values must be 0, no division needed
        }
        for (uint256 i = 0; i < _addresses.length; i++) {
            _wflrVP[i] = _wflrVP[i].mulDiv(TERA, _totalVotePowerFlr);
        }
    }
    
    /**
     * Calculate asset vote power weights like FTSO.
     */
    function _getAssetVotePowerWeights(
        IIVPToken[] memory _assets,
        uint256[] memory _assetMultipliers,
        uint256 _totalVotePowerAsset,
        address[] memory _addresses, 
        uint256 _blockNumber
    )
        internal 
        returns (uint256[] memory _combinedAssetVP)
    {
        _combinedAssetVP = new uint256[](_addresses.length);
        for (uint256 i = 0; i < _addresses.length; i++) {
            _combinedAssetVP[i] = 0;
        }
        if (_totalVotePowerAsset == 0) {
            return _combinedAssetVP;
        }
        uint256 divisor = _totalVotePowerAsset.mul(1e18);
        for (uint256 n = 0; n < _assets.length; n++) {
            IIVPToken asset = _assets[n];
            if (address(asset) != address(0)) {
                uint256[] memory assetVP = _getVotePowers(asset, _addresses, _blockNumber);
                // add
                for (uint256 i = 0; i < _addresses.length; i++) {
                    uint256 weightedVP = assetVP[i].mulDiv(_assetMultipliers[n], divisor);
                    _combinedAssetVP[i] = _combinedAssetVP[i].add(weightedVP);
                }
            }
        }
    }
    
    /**
     * Get vote powers from VPToken in a batch.
     * This is needed to avoid gas consumption of many cros-contract calls.
     */
    function _getVotePowers(
        IIVPToken _token, 
        address[] memory _addresses, 
        uint256 _blockNumber
    )
        internal 
        returns (uint256[] memory)
    {
        // warm up cache for new voter (in this way everyone pays cache storing price for himself)
        _token.votePowerOfAtCached(_addresses[_addresses.length - 1], _blockNumber);
        // get all vote powers in a batch
        return _token.batchVotePowerOfAt(_addresses, _blockNumber);
    }
    
    /**
     * Calculate sum of all values in an array.
     */
    function _arraySum(uint256[] memory array) private pure returns (uint256) {
        uint256 result = 0;
        for (uint256 i = 0; i < array.length; i++) {
            result = result.add(array[i]);
        }
        return result;
    }
    
    /**
     * Calculate weighted sum of two arrays (like in FTSO):
     *  result[i] = (100% - _assetWeightRatio) * _weightsFlr[i] + _assetWeightRatio * _weightsAsset[i]
     */
    function _computeWeightedSum(
        uint256[] memory _weightsFlr,
        uint256[] memory _weightsAsset,
        uint256 _assetWeightRatio
    )
        private pure 
        returns (uint256[] memory _weights)
    {
        uint256 weightAssetSum = _arraySum(_weightsAsset);
        uint256 weightFlrSum = _arraySum(_weightsFlr);
        uint256 weightAssetShare = weightAssetSum > 0 ? _assetWeightRatio : 0;
        uint256 weightFlrShare = weightFlrSum > 0 ? BIPS100 - weightAssetShare : 0;
        _weights = new uint256[](_weightsFlr.length);
        for (uint256 i = 0; i < _weightsFlr.length; i++) {
            uint256 weightFlr = 0;
            if (weightFlrShare > 0) {
                weightFlr = weightFlrShare.mulDiv(TERA * _weightsFlr[i], weightFlrSum * BIPS100);
            }
            uint256 weightAsset = 0;
            if (weightAssetShare > 0) {
                weightAsset = weightAssetShare.mulDiv(TERA * _weightsAsset[i], weightAssetSum * BIPS100);
            }
            _weights[i] = weightFlr + weightAsset;
        }
    }

    /**
     * Find minimum index of an uint256 array.
     * In case of a tie, returns later index.
     */
    function _findMinimum(uint256[] memory _votePowers, uint256 _length) private pure returns (uint256) {
        uint256 minIndex = 0;
        uint256 minVP = _votePowers[0];
        for (uint256 i = 0; i < _length; i++) {
            uint256 vp = _votePowers[i];
            // using `<=` ensures that later index is used if there is a tie
            // this is useful because in requestWhitelistingVoter, the new voter is last
            // also, when removing, it is cheaper to remove last element
            if (vp <= minVP) {
                minIndex = i;
                minVP = vp;
            }
        }
        return minIndex;
    }
}
