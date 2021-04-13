// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interfaces/IFtsoManager.sol";
import "../interfaces/IRewardManager.sol";
import "../interfaces/IFlareKeep.sol";
import "../IFtso.sol";
import "./Governed.sol";


// import "hardhat/console.sol";

/**
 * RewardManager is in charge of:
 * - distributing rewards according to instructions from FTSO Manager
 * - allowing claims for rewards
 */    
contract RewardManager is IRewardManager, Governed {   

    string internal constant ERR_INFLATION_ZERO = "no inflation";     
    string internal constant ERR_FTSO_MANAGER_ONLY = "ftso manager only";    
    string internal constant ERR_INFLATION_ONLY = "inflation only";    
    string internal constant ERR_FTSO_MANAGER_ZERO = "no ftso manager";     
    string internal constant ERR_REWARD_EPOCH_NOT_FINALIZED = "reward epoch not finalized";     
    string internal constant ERR_NO_REWARDS = "no rewards";   
    string internal constant ERR_REWARD_MANAGER_DEACTIVATED = "reward manager deactivated";  

    // TODO: Note that there are leap seconds (last one was Dec 31, 2016).
    // NOTE: They are not deterministic. IERS notifies the public in advance.
    // In order to be technically correct, the governance contract would need to
    // have a way to flip SECONDS_PER_DAY from 86400 to 86401 at the next June 30
    // or Dec 31 (the only two days in a year when a leap second can be added).
    // This assumes that the underlying operating system follows IERS recommendation,
    // which Unix does not. Instead, it slows the clock down. Is this OS universal? Dunno.
    uint32 constant private SECONDS_PER_DAY = 86400;
    bool internal active;

    /**
     * @dev Provides a mapping of reward epoch ids to an address mapping of unclaimed
     *  rewards.
     * TODO: consider splitting into data providers rewards and delegators rewards
     */
    mapping(uint256 => mapping(address => uint256)) public unclaimedRewardsPerRewardEpoch;
    uint256 public dailyRewardAmountTwei;
    uint256 public distributedSoFarTwei;

    /// addresses
    address public inflationContract;
    IFtsoManager public ftsoManagerContract;

    // flags
    bool private justStarted;

    constructor(
        address _governance,
        address _inflation
    ) Governed(_governance) 
    {
        require(_inflation != address(0), ERR_INFLATION_ZERO);
        
        inflationContract = _inflation;
        justStarted = true;
    }

    receive() external payable {}

    modifier onlyFtsoManager () {
        require (msg.sender == address(ftsoManagerContract), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    modifier onlyInflation () {
        require (msg.sender == inflationContract, ERR_INFLATION_ONLY);
        _;
    }

    modifier ftsoManagerSet () {
        require (address(ftsoManagerContract) != address(0), ERR_FTSO_MANAGER_ZERO);
        _;
    }

    /**
     * @notice Allows reward claiming for data providers
     * @dev TODO: maybe we should allow withdrawals to data provider's address only?
     */
    function claimReward(address payable recipient, uint256 rewardEpoch) 
            external override returns(uint256 rewardAmount) {
        require(rewardEpoch < ftsoManagerContract.getCurrentRewardEpoch(), ERR_REWARD_EPOCH_NOT_FINALIZED);
        require(unclaimedRewardsPerRewardEpoch[rewardEpoch][msg.sender] > 0, ERR_NO_REWARDS);
        require(active, ERR_REWARD_MANAGER_DEACTIVATED);

        rewardAmount = unclaimedRewardsPerRewardEpoch[rewardEpoch][msg.sender];
        unclaimedRewardsPerRewardEpoch[rewardEpoch][msg.sender] = 0;
        distributedSoFarTwei += rewardAmount;
        recipient.transfer(rewardAmount);

        emit RewardClaimed ({
            whoClaimed: msg.sender,
            sentTo: recipient,
            rewardEpoch: rewardEpoch,
            amount: rewardAmount
        });
    }

    /**
     * @notice Activates reward manager (allows claiming rewards)
     */
    function activate() external onlyGovernance {
        active = true;
    }

    /**
     * @notice Deactivates reward manager (prevents claiming rewards)
     */
    function deactivate() external onlyGovernance {
        active = false;
    }

    function setDailyRewardAmount(uint256 rewardAmountTwei) external override onlyInflation {
        // TODO: Accounting of FLR in contract vs. this number needs to be reconciled
        dailyRewardAmountTwei = rewardAmountTwei;
        // TODO: add event
    }
   
    /**
     * @notice sets FTSO manager corresponding to the reward manager
     */
    function setFTSOManager(IFtsoManager _ftsoManager) external override onlyGovernance {
        ftsoManagerContract = _ftsoManager;
    }   

    /**
     * @notice Distributes rewards to data providers accounts, according to input parameters.
     */
    function distributeRewards(
        address[] memory addresses,
        uint256[] memory weights,
        uint256 totalWeight,
        uint256 epochId,
        address ftso,
        uint256 priceEpochDurationSec,
        uint256 currentRewardEpoch
    ) external override ftsoManagerSet onlyFtsoManager returns (bool) {

        // TODO: Due to remainders in division the sum of distributions for whole day will not 
        // sum up into dailyRewardAmountTwei. 
        // (dailyRewardAmountTwei * priceEpochDurationSec) % SECONDS_PER_DAY 
        // will remain undistributed
        uint256 totalPriceEpochRewardTwei = dailyRewardAmountTwei * priceEpochDurationSec / SECONDS_PER_DAY;
        uint256 distributedSoFar = 0;
        

        if (addresses.length == 0) return false;        
        // TODO: we should assure that in case we are here, totalWeight > 0. Please verify.

        uint256[] memory rewards = new uint256[](addresses.length);

        for (uint i = addresses.length - 1; i > 0; i--) {
            uint256 rewardAmount = totalPriceEpochRewardTwei * weights[i] / totalWeight;
            distributedSoFar += rewardAmount;
            rewards[i] = rewardAmount;
            unclaimedRewardsPerRewardEpoch[currentRewardEpoch][addresses[i]] +=
                rewardAmount;
        }

        // give remaining amount to last address.
        unclaimedRewardsPerRewardEpoch[currentRewardEpoch][addresses[0]] += 
            totalPriceEpochRewardTwei - distributedSoFar;

        emit RewardDistributedByFtso(ftso, epochId, addresses, rewards);
        return true; 
    }

    function setDataProviderSharingPercentage(uint256 percentageBPS) external override{
        // TODO: implement it at some point ...
    }  

}
