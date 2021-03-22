// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IRewardManager.sol";
import "../interfaces/IFlareKeep.sol";
import "../IFtso.sol";
import "./Governed.sol";

import "hardhat/console.sol";

    /* 
    Reward manager (better name?) in charge of a few operations:

    - keep track of all FTSO contracts. 
    - define reward epochs (~2-7 days)
    - per reward epoch choose a single block that represents vote power of this eopch.
    - per price epoch (~2 minutes) :
        - randomly choose one FTSO for rewarding.
        - trigger finalize price reveal epoch
        - distribute rewards
    */
contract RewardManager is IRewardContract, IFlareKeep, Governed {

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
    }

    struct PriceEpochData {
        IFtso chosenFtso;
        uint32 rewardEpochId;
    }

    bool internal active;

    RewardEpochData[] public rewardEpochs;
    PriceEpochData[] public priceEpochs;

    // reward
    // TODO: consider splitting into data providers rewards and delegators rewards
    mapping(uint256 => mapping(address => uint256)) public rewardsPerRewardEpoch;
    uint256 public dailyRewardAmountTwei;
    uint256 public distributedSoFarTwei;

    // TODO: consider enabling duration updates
    // reward Epoch data
    uint256 public currentRewardEpoch;
    uint256 immutable public rewardEpochDurationSec;
    uint256 internal currentRewardEpochEnds;

    // price epoch data
    uint256 immutable public firstPriceEpochStartTs;
    uint256 immutable public priceEpochDurationSec;
    uint256 public currentPriceEpoch;
    uint256 internal currentPriceEpochEnds;

    /// addresses
    // list of ftsos eligible for reward
    IFtso[] public ftsos;
    address public inflationContract;

    constructor(
        address _governance,
        address _inflation,
        uint256 _rewardEpochDurationSec,
        uint256 _priceEpochDruationSec,
        uint256 _firstEpochStartTs,
        uint256 _currentRewardEpochStartTs
    ) Governed(_governance) 
    {
        require(_rewardEpochDurationSec > 0, "reward duration 0");
        require(_priceEpochDruationSec > 0, "price duration 0");
        require(_firstEpochStartTs > 0, "first epoch ts 0");
        require(_inflation != address(0), "inflation 0");

        firstPriceEpochStartTs = _firstEpochStartTs;
        rewardEpochDurationSec = _rewardEpochDurationSec;
        priceEpochDurationSec = _priceEpochDruationSec;
        inflationContract = _inflation;

        currentRewardEpoch = 0;
        currentRewardEpochEnds = _currentRewardEpochStartTs + _rewardEpochDurationSec;
        currentPriceEpochEnds  += _firstEpochStartTs + _priceEpochDruationSec;
    }

    // function claimReward for claiming reward by data providers
    function claimReward(address payable to, uint256 rewardEpoch) external override returns(uint256 rewardAmount) {
        require(rewardEpoch > currentRewardEpoch, "Epoch not finalised");
        require (rewardsPerRewardEpoch[rewardEpoch][msg.sender] > 0, "no rewards");

        rewardAmount = rewardsPerRewardEpoch[rewardEpoch][msg.sender];
        rewardsPerRewardEpoch[rewardEpoch][msg.sender] = 0;

        to.call{value: rewardAmount}("");
        distributedSoFarTwei += rewardAmount;

        emit RewardClaimed ({
            whoClaimed: msg.sender,
            sentTo: to,
            rewardEpoch: rewardEpoch,
            amount: rewardAmount
        });
    }

    function activate() external onlyGovernance {
      active = true;
    }

    function dactivate() external onlyGovernance {
      active = false;
    }

    function keep() external override {
        // flare keeper trigger. once every block
        if (!active) return;

        if (currentRewardEpochEnds < block.timestamp) {
            finalizeRewardEpoch();
        }

        if (currentPriceEpochEnds < block.timestamp) {
            finalizePriceEpoch();
        }
    }

    function setDailyRewardAmount(uint256 rewardAmountTwei) external override {
        require(msg.sender == inflationContract, "only inflation");

        dailyRewardAmountTwei = rewardAmountTwei;
        // TODO: add event
    }

    function addFtso(IFtso ftso) external onlyGovernance {

        uint256 len = ftsos.length;

        for (uint256 i = 0; i < len; i++) {
            if (ftso == ftsos[i]) {
                return; // already registered
            }
        }

        ftso.initPriceEpochData(firstPriceEpochStartTs, priceEpochDurationMs, rewardEpochDurationMs);

        ftsos.push(ftso);
        emit FtsoAdded(ftso, true);
    }

    function removeFtso(IFtso ftso) external onlyGovernance {
        uint256 len = ftsos.length;

        for (uint256 i = 0; i < len; ++i) {
            if (ftso == ftsos[i]) {
                ftsos[i] = ftsos[len -1];
                ftsos.pop();
                emit FtsoAdded (ftso, false);
                return;
            }
        }

        revert("not found");
    }

    function setDataProviderSharingPercentage(uint256 percentageBPS) external override{
        // ALEN: added while merging. Was missing implementation.
    }  

    function getCurrentRewardEpoch() public view returns (uint256) {
        return currentRewardEpoch;
    }

    function finalizeRewardEpoch() internal {

        uint256 lastRandom = uint256(keccak256(abi.encode(
            block.timestamp,
            ftsos[0].getFreshRandom()
        )));

        // @dev when considering block boundary for vote power block:
        // - if far from now, it doesn't reflect last vote power changes
        // - if too small, possible loan attacks.
        uint256 votepowerBlockBoundary = 
            (block.number - rewardEpochs[getCurrentRewardEpoch()].startBlock) / 7;

        RewardEpochData memory epochData = RewardEpochData({
            votepowerBlock: block.number - (votepowerBlockBoundary % lastRandom), 
            startBlock: block.number
        });

        rewardEpochs.push(epochData);
        currentRewardEpoch = rewardEpochs.length - 1;

        currentRewardEpochEnds = block.timestamp + rewardEpochDurationMs;

        uint numFtsos = ftsos.length;

        for (uint i; i < numFtsos; ++i) {
            ftsos[i].setCurrentVotepowerBlock(epochData.votepowerBlock);
        }
        // TODO: Add event
    }

    function finalizePriceEpoch() internal {

        uint numFtsos = ftsos.length;

        // choose winning ftso
        uint256 rewardedFtsoId = 
            uint256(keccak256(abi.encode(
                priceEpochs[currentPriceEpoch].chosenFtso.getFreshRandom()
            ))) % numFtsos;

        bool wasDistributed = distributeRewards(ftsos[rewardedFtsoId]);

        for (uint i; i < numFtsos; ++i) {
            if (i == rewardedFtsoId) continue;

            if (wasDistributed) {
                ftsos[i].finalizePriceEpoch(currentPriceEpoch, false);
            } else {
                wasDistributed = distributeRewards(ftsos[i]);
                rewardedFtsoId = i;
            }
        }

        priceEpochs[currentRewardEpoch] = PriceEpochData (
            ftsos[rewardedFtsoId],
            uint32(currentRewardEpoch)
        );

        currentPriceEpoch++;
        currentPriceEpochEnds  += priceEpochDurationMs;

        //TODO: add event
    }

    function distributeRewards(IFtso ftso) internal returns (bool wasDistirubted) {

        address[] memory addresses;
        uint64[] memory weights;
        uint256 totalWeight; 

        uint256 totalPriceEpochRewardTwei = dailyRewardAmountTwei * priceEpochDurationMs / 1 days;
        uint256 distributedSoFar = 0;

        (addresses, weights, totalWeight) = ftso.finalizePriceEpoch(currentPriceEpoch, true);

        if (addresses.length == 0) return false;

        for (uint i = addresses.length - 1; i > 0; i--) {
            uint256 rewardAmount = totalPriceEpochRewardTwei * weights[i] / totalWeight;
            distributedSoFar += rewardAmount;
            rewardsPerRewardEpoch[currentRewardEpoch][addresses[i]] +=
                rewardAmount;
        }

        // give remaining amount to last address.
        rewardsPerRewardEpoch[currentRewardEpoch][addresses[0]] += 
            totalPriceEpochRewardTwei - distributedSoFar;

        // TODO: Add event.
        return true; 
    }

}
