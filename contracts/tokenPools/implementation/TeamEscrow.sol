// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/Governed.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "../../utils/implementation/SafePct.sol";
import "../interface/IITokenPool.sol";

contract TeamEscrow is Governed, IITokenPool  {
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SafePct for uint256;

    struct LockedAmount {
        uint256 totalLockedAmountWei;
        uint256 totalClaimedAmountWei;
    }

    uint256 public claimStartTs;
    bool public governanceChangedClaimTs = false;
    // Time based constants
    uint256 internal constant MONTH = 30;
    // 2.37% every 30 days (so total distribution takes 36 * 30 days =~ 3 years)
    uint256 internal constant MONTHLY_CLAIMABLE_BIPS = 237;

    uint256 public constant DIRECT_CLAIM_BIPS = 1500;
    uint256 public constant LOCKED_CLAIM_BIPS = 8500;
    uint256 public constant FULL_CLAIM_BIPS = DIRECT_CLAIM_BIPS + LOCKED_CLAIM_BIPS;

    // sum(lockedAmounts.totalLockedAmountWei)
    uint256 public totalLockedAmountWei = 0;
    // sum(lockedAmounts.totalClaimedAmountWei)
    uint256 public totalClaimedAmountWei = 0;

    mapping(address => LockedAmount) public lockedAmounts;

    constructor(address _governance, uint256 _claimStartTs) Governed(_governance) {
        claimStartTs = _claimStartTs;
    }

    function lock() external payable {
        _lockTo(msg.sender);
    }

    function claimTo(address _target) external {
        _claimTo(_target);
    }

    function claim() external {
        _claimTo(msg.sender);
    }


    /**
     * @notice Return token pool supply data
     * @return _lockedFundsWei                  Funds that are intentionally locked in the token pool 
     * and not part of circulating supply
     * @return _totalInflationAuthorizedWei     Total inflation authorized amount (wei)
     * @return _totalClaimedWei                 Total claimed amount (wei)
     */
    function getTokenPoolSupplyData() external view override returns (
        uint256 _lockedFundsWei,
        uint256 _totalInflationAuthorizedWei,
        uint256 _totalClaimedWei
    ){
        _lockedFundsWei = totalLockedAmountWei;
        _totalInflationAuthorizedWei = 0; // New funds are never created here
        _totalClaimedWei = totalClaimedAmountWei;
    }

    function setClaimingStartTs(uint256 _claimStartTs) public onlyGovernance {
        require(governanceChangedClaimTs == false, "Already set");
        governanceChangedClaimTs = true;
        claimStartTs = _claimStartTs;
    }

    /**
     * @notice Get the claimable percent for the current timestamp
     * @return percentBips maximal claimable bips at current timestamp
     */
    function getCurrentClaimablePercentBips(uint256 _timestamp) public view 
        returns(uint256 percentBips)
    {
        require(claimStartTs <= _timestamp && claimStartTs != 0, "Claiming not started");
        uint256 diffDays = _timestamp.sub(claimStartTs).div(1 days);
        percentBips = Math.min(diffDays.div(MONTH).mul(MONTHLY_CLAIMABLE_BIPS), LOCKED_CLAIM_BIPS);
    }

    /**
     * @notice Get current claimable amount for users account
     * @dev Every 30 days from initial day 2.37% of the reward is released
     */
    function getCurrentClaimableWei(address _owner) public view 
        returns(uint256 _claimableWei)
    {
        // Attempt to get the account in question
        LockedAmount memory lockedAmount = lockedAmounts[_owner];
        uint256 currentlyClaimableBips = getCurrentClaimablePercentBips(block.timestamp);

        uint256 availableClaimWei = lockedAmount.totalLockedAmountWei.mulDiv(
            currentlyClaimableBips, LOCKED_CLAIM_BIPS
        );
        // Can never claim more that we are initially entiteled to
        availableClaimWei = Math.min(availableClaimWei, lockedAmount.totalLockedAmountWei);
        // Substract already claimed
        _claimableWei = availableClaimWei - lockedAmount.totalClaimedAmountWei; 
    }

    function _claimTo(address _target) internal {
        address source = msg.sender;
        uint256 claimableWei = getCurrentClaimableWei(source);
        
        require(claimableWei > 0, "No claimable funds");

        lockedAmounts[source].totalClaimedAmountWei += claimableWei;
        totalClaimedAmountWei += claimableWei;
        /* solhint-disable avoid-low-level-calls */
        // slither-disable-next-line arbitrary-send
        (bool success, ) = _target.call{value: claimableWei}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, "Failed to call claiming contract");
    }

    function _lockTo(address _target) internal {
        require(lockedAmounts[_target].totalLockedAmountWei == 0, "Already locked");
        totalLockedAmountWei += msg.value;
        lockedAmounts[_target].totalLockedAmountWei = msg.value;
    }

}
