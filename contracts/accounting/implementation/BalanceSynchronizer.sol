// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../utils/interfaces/IFlareKeep.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import "./FtsoRewardManagerAccounting.sol";
import "../../ftso/interface/IIFtsoRewardManager.sol";

// import "hardhat/console.sol";

/**
 * @title Synchronizer of the accounting balancesheet
 * @notice This contract implements function calls that help syncing general ledger balance up-to-date.
 **/
contract BalanceSynchronizer is IFlareKeep, AccessControl {
    bytes32 public constant BALANCER_ROLE = keccak256("POSTER_ROLE");

    FtsoRewardManagerAccounting private ftsoRewardManagerAccounting;
    IIFtsoRewardManager private rewardManager;
    uint256 public syncTimestamp;

    modifier onlyBalancers () {
        require (hasRole(BALANCER_ROLE, msg.sender), "not balancer");
        _;
    }

    constructor(address _governance) {
        require(_governance != address(0), "governance zero");
        _setupRole(DEFAULT_ADMIN_ROLE, _governance);
    }

    function setFtsoRewardManagerAccounting(FtsoRewardManagerAccounting _ftsoRewardManagerAccounting) external {
        ftsoRewardManagerAccounting = _ftsoRewardManagerAccounting;
    }

    function setRewardManager(IIFtsoRewardManager _rewardManager) external {
        rewardManager = _rewardManager;
    }

    function balanceRewardManagerClaims() external onlyBalancers {
        _balanceRewardManagerClaims();
    }

    function setSyncTime(uint256 timestamp) external onlyBalancers {
        syncTimestamp = timestamp;
    }

    function keep() external override returns (bool) {
        if(block.timestamp >= syncTimestamp) {
            _balanceRewardManagerClaims();
        }
        return true;
    }

    function _balanceRewardManagerClaims() internal {
        uint256 claims = rewardManager.getUnreportedClaimsAndFlush();
        ftsoRewardManagerAccounting.rewardsClaimed(claims);
    }

}
