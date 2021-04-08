// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IRewardManager.sol";
import "../interfaces/IFlareKeep.sol";
import "../IFtso.sol";
import "./Governed.sol";

/** 
    Reward manager (better name?) in charge of a few operations:

    - keep track of all FTSO contracts. 
    - define reward epochs (~2-7 days)
    - per reward epoch choose a single block that represents vote power of this eopch.
    - per price epoch (~2 minutes) :
        - randomly choose one FTSO for rewarding.
        - trigger finalize price reveal epoch
        - distribute rewards
*/
contract RewardManager is IRewardManager, IFlareKeep, Governed {

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
    }

    struct PriceEpochData {
        IFtso chosenFtso;
        uint32 rewardEpochId;
    }

    // TODO: Note that there are leap seconds (last one was Dec 31, 2016).
    // NOTE: They are not deterministic. IERS notifies the public in advance.
    // In order to be technically correct, the governance contract would need to
    // have a way to flip SECONDS_PER_DAY from 86400 to 86401 at the next June 30
    // or Dec 31 (the only two days in a year when a leap second can be added).
    // This assumes that the underlying operating system follows IERS recommendation,
    // which Unix does not. Instead, it slows the clock down. Is this OS universal? Dunno.
    uint32 constant private SECONDS_PER_DAY = 86400;
    bool internal active;

    RewardEpochData[] public rewardEpochs;
    PriceEpochData[] public priceEpochs;

    /**
     * @dev Provides a mapping of reward epoch ids to an address mapping of unclaimed
     *  rewards.
     * TODO: consider splitting into data providers rewards and delegators rewards
     */
    mapping(uint256 => mapping(address => uint256)) public unclaimedRewardsPerRewardEpoch;
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

    // flags
    bool private justStarted;

    constructor(
        address _governance,
        address _inflation,
        uint256 _rewardEpochDurationSec,
        uint256 _priceEpochDurationSec,
        uint256 _firstEpochStartTs,
        uint256 _currentRewardEpochStartTs
    ) Governed(_governance) 
    {
        require(_rewardEpochDurationSec > 0, "reward duration 0");
        require(_priceEpochDurationSec > 0, "price duration 0");
        require(_firstEpochStartTs > 0, "first epoch ts 0");
        require(_inflation != address(0), "inflation 0");

        firstPriceEpochStartTs = _firstEpochStartTs;
        rewardEpochDurationSec = _rewardEpochDurationSec;
        priceEpochDurationSec = _priceEpochDurationSec;
        inflationContract = _inflation;

        currentRewardEpoch = 0;
        currentRewardEpochEnds = _currentRewardEpochStartTs + _rewardEpochDurationSec;
        currentPriceEpochEnds  = _firstEpochStartTs + _priceEpochDurationSec;
        justStarted = true;
    }

    receive() external payable {}

    // function claimReward for claiming reward by data providers
    function claimReward(address payable to, uint256 rewardEpoch) external override returns(uint256 rewardAmount) {
        require(rewardEpoch < currentRewardEpoch, "Epoch not finalised");
        require (unclaimedRewardsPerRewardEpoch[rewardEpoch][msg.sender] > 0, "no rewards");

        rewardAmount = unclaimedRewardsPerRewardEpoch[rewardEpoch][msg.sender];
        unclaimedRewardsPerRewardEpoch[rewardEpoch][msg.sender] = 0;
        distributedSoFarTwei += rewardAmount;
        to.transfer(rewardAmount);
//        to.call{value: rewardAmount}("");

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

    function keep() external override returns(bool) {
        // flare keeper trigger. once every block
        if (!active) return false;
        // If RewardManager just started...
        if (justStarted) {
            // And the reward epoch has now started...
            if (block.timestamp >= currentRewardEpochEnds - rewardEpochDurationSec) {
                // Prime the reward epoch array with a new reward epoch
                // TODO: Randomize? What if there are no FTSOs here? Can't use same algo.
                RewardEpochData memory epochData = RewardEpochData({
                    votepowerBlock: block.number - 1, 
                    startBlock: block.number
                });

                rewardEpochs.push(epochData);

                // Set up vote power block for each ftso
                uint256 numFtsos = ftsos.length;
                for (uint i; i < numFtsos; ++i) {
                    ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
                }

                justStarted = false;
            }
        }

        if (currentRewardEpochEnds < block.timestamp) {
            finalizeRewardEpoch();
        }

        if (currentPriceEpochEnds < block.timestamp) {
            finalizePriceEpoch();
        }

        return true;
    }

    function setDailyRewardAmount(uint256 rewardAmountTwei) external override {
        require(msg.sender == inflationContract, "only inflation");

        // TODO: Accounting of FLR in contract vs. this number needs to be reconciled
        dailyRewardAmountTwei = rewardAmountTwei;
        // TODO: add event
    }

    function addFtso(IFtso ftso) external onlyGovernance {

        uint256 len = ftsos.length;

        for (uint256 i = 0; i < len; i++) {
            if (address(ftso) == address(ftsos[i])) {
                return; // already registered
            }
        }

        ftso.initializeEpochs(firstPriceEpochStartTs, priceEpochDurationSec, rewardEpochDurationSec);

        // Set the vote power block
        if (priceEpochs.length > 0) {
            ftso.setVotePowerBlock(rewardEpochs[currentRewardEpoch].votepowerBlock);
        }

        // Add the ftso
        ftsos.push(ftso);
        emit FtsoAdded(ftso, true);
    }

    function removeFtso(IFtso ftso) external onlyGovernance {
        uint256 len = ftsos.length;

        for (uint256 i = 0; i < len; ++i) {
            if (address(ftso) == address(ftsos[i])) {
                ftsos[i] = ftsos[len - 1];
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

    // The point of the finalization is to tell the FTSOs the new vote power block.
    function finalizeRewardEpoch() internal {
        assert(!justStarted);

        uint numFtsos = ftsos.length;

        // Are there any FTSOs to process?
        if (numFtsos > 0) {

            uint256 lastRandom = uint256(keccak256(abi.encode(
                block.timestamp,
                ftsos[0].getCurrentRandom()
            )));

            // @dev when considering block boundary for vote power block:
            // - if far from now, it doesn't reflect last vote power changes
            // - if too small, possible loan attacks.
            uint256 votepowerBlockBoundary = 
                (block.number - rewardEpochs[currentRewardEpoch].startBlock) / 7;

            RewardEpochData memory epochData = RewardEpochData({
                votepowerBlock: block.number - (votepowerBlockBoundary % lastRandom), 
                startBlock: block.number
            });

            rewardEpochs.push(epochData);
            currentRewardEpoch = rewardEpochs.length - 1;

            for (uint i; i < numFtsos; ++i) {
                ftsos[i].setVotePowerBlock(epochData.votepowerBlock);
            }
        }

        // TODO: This line was reordered. Is it important?
        // Also, changed to advance from last end per issue #97
        currentRewardEpochEnds += rewardEpochDurationSec;

        // TODO: Add appropriate event data
        emit RewardEpochFinalized();
    }

    function finalizePriceEpoch() internal {

        uint numFtsos = ftsos.length;

        // Are there any FTSOs to process?
        if(numFtsos > 0) {

            // choose winning ftso
            uint256 rewardedFtsoId;
            if (priceEpochs.length == 0) {
                // Pump not yet primed; start with first ftso?
                rewardedFtsoId = 
                    uint256(keccak256(abi.encode(
                        ftsos[0].getCurrentRandom()
                    ))) % numFtsos;
            } else {
                // TODO: Note that the currentPriceEpoch id does not have an entry until
                // finalized. This feels wrong, but go with it for now.
                rewardedFtsoId = 
                    uint256(keccak256(abi.encode(
                        priceEpochs[currentPriceEpoch-1].chosenFtso.getCurrentRandom()
                    ))) % numFtsos;
            }

            bool wasDistributed = distributeRewards(ftsos[rewardedFtsoId]);

            // On the off chance that the winning FTSO does not have any
            // recipient within the truncated price distribution to
            // receive rewards, find the next FTSO that does have reward
            // recipients and declare it the winner.
            for (uint i; i < numFtsos; ++i) {
                if (i == rewardedFtsoId) continue;

                if (wasDistributed) {
                    ftsos[i].finalizePriceEpoch(currentPriceEpoch, false);
                } else {
                    wasDistributed = distributeRewards(ftsos[i]);
                    rewardedFtsoId = i;
                }
            }

            priceEpochs.push(PriceEpochData({
                chosenFtso: ftsos[rewardedFtsoId],
                rewardEpochId: uint32(currentRewardEpoch)
            }));

            currentPriceEpoch++;
        }

        // Advance to next price epoch
        currentPriceEpochEnds  += priceEpochDurationSec;

        //TODO: Add appropriate event data
        emit PriceEpochFinalized();
    }

    function distributeRewards(IFtso ftso) internal returns (bool wasDistirubted) {

        address[] memory addresses;
        uint256[] memory weights;
        uint256 totalWeight; 

        uint256 totalPriceEpochRewardTwei = dailyRewardAmountTwei * priceEpochDurationSec / SECONDS_PER_DAY;
        uint256 distributedSoFar = 0;

        (addresses, weights, totalWeight) = ftso.finalizePriceEpoch(currentPriceEpoch, true);

        if (addresses.length == 0) return false;

        for (uint i = addresses.length - 1; i > 0; i--) {
            uint256 rewardAmount = totalPriceEpochRewardTwei * weights[i] / totalWeight;
            distributedSoFar += rewardAmount;
            unclaimedRewardsPerRewardEpoch[currentRewardEpoch][addresses[i]] +=
                rewardAmount;
        }

        // give remaining amount to last address.
        unclaimedRewardsPerRewardEpoch[currentRewardEpoch][addresses[0]] += 
            totalPriceEpochRewardTwei - distributedSoFar;

        // TODO: Add event.
        return true; 
    }

}
