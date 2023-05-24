// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/TokenPoolBase.sol";
import "../interface/IIIncentivePoolReceiver.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


abstract contract IncentivePoolReceiver is TokenPoolBase, IIIncentivePoolReceiver, AddressUpdatable {
    using SafeMath for uint256;

    // totals
    uint256 internal totalIncentiveAuthorizedWei;
    uint256 internal totalIncentiveReceivedWei;
    uint256 internal lastIncentiveAuthorizationReceivedTs;
    uint256 internal dailyAuthorizedIncentive;

    // addresses
    address internal incentivePool;

    event DailyAuthorizedIncentiveSet(uint256 authorizedAmountWei);
    event IncentiveReceived(uint256 amountReceivedWei);

    /**
     * @dev This modifier ensures that method can only be called by incentive pool.
     */
    modifier onlyIncentivePool {
        _checkOnlyIncentivePool();
        _;
    }

    constructor(address _addressUpdater) AddressUpdatable(_addressUpdater) {}

    /**
     * @notice Notify the receiver that it is entitled to receive `_toAuthorizeWei` incentive amount.
     * @param _toAuthorizeWei the amount of incentive that can be awarded in the coming day
     */
    function setDailyAuthorizedIncentive(uint256 _toAuthorizeWei) external override onlyIncentivePool {
        dailyAuthorizedIncentive = _toAuthorizeWei;
        totalIncentiveAuthorizedWei = totalIncentiveAuthorizedWei.add(_toAuthorizeWei);
        lastIncentiveAuthorizationReceivedTs = block.timestamp;

        _setDailyAuthorizedIncentive(_toAuthorizeWei);

        emit DailyAuthorizedIncentiveSet(_toAuthorizeWei);
    }

    /**
     * @notice Receive native tokens from incentive pool.
     */
    function receiveIncentive() external payable override mustBalance onlyIncentivePool {
        totalIncentiveReceivedWei = totalIncentiveReceivedWei.add(msg.value);

        _receiveIncentive();

        emit IncentiveReceived(msg.value);
    }

    /**
     * @notice Incentive pool receivers have a reference to the incentive pool contract.
     */
    function getIncentivePoolAddress() external view override returns(address) {
        return incentivePool;
    }

    /**
     * @notice Return expected balance of reward manager ignoring sent self-destruct funds
     */
    function getExpectedBalance() external view override returns(uint256) {
        return _getExpectedBalance();
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     * @dev It can be overridden if other contracts are needed.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal virtual override
    {
        incentivePool = _getContractAddress(_contractNameHashes, _contractAddresses, "IncentivePool");
    }

    /**
     * @dev Method that is called when new daily incentive is authorized.
     */
    function _setDailyAuthorizedIncentive(uint256 _toAuthorizeWei) internal virtual {}

    /**
     * @dev Method that is called when new incentive is received.
     */
    function _receiveIncentive() internal virtual {}

    /**
     * @dev Method that is used in `mustBalance` modifier. It should return expected balance after
     *      triggered function completes (claiming, burning, receiving incentive,...).
     */
    function _getExpectedBalance() internal virtual override view returns(uint256 _balanceExpectedWei) {
        return totalIncentiveReceivedWei;
    }

    function _checkOnlyIncentivePool() private view {
        require(msg.sender == incentivePool, "incentive pool only");
    }
}
