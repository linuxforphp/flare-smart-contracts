// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/Governed.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "./IncentivePool.sol";
import "../interface/IIIncentivePoolAllocation.sol";

/**
 * @title IncentivePool allocation contract
 * @notice This contract implements IncentivePool settings agreed upon by Flare Foundation governance.
 **/
contract IncentivePoolAllocation is IIIncentivePoolAllocation, Governed, AddressUpdatable {

    struct IncentivePoolReceiver {
        IIIncentivePoolReceiver receiverContract;
        uint32 percentageBips; // limited to BIPS100
    }

    // constants
    string internal constant ERR_LENGTH_MISMATCH = "length mismatch";
    string internal constant ERR_HIGH_SHARING_PERCENTAGE = "high sharing percentage";
    string internal constant ERR_SUM_SHARING_PERCENTAGE = "sum sharing percentage not 100%";
    string internal constant ERR_IS_ZERO = "address is 0";
    string internal constant ERR_TIME_SLOT_INCENTIVE_POOL_OUT_OF_BOUNDS = "time slot incentive pool out of bounds";
    string internal constant ERR_TIME_SLOT_INCENTIVE_POOL_SCHEDULE_EMPTY = "time slot incentive pool schedule empty";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_ONLY_INCENTIVE_POOL = "only incentive pool";

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points
    uint256 internal constant MAX_SCHEDULE_COUNT = 25;
    uint256 internal constant MAX_INCENTIVE_POOL_RECEIVERS = 10;
    uint256 internal constant MAX_INCENTIVE_POOL_PERCENTAGE_BIPS = BIPS100 / 10;  // 10% in basis points

    IncentivePoolReceiver[] public incentivePoolReceivers;
    IncentivePool public incentivePool;
    uint256 public lastTimeSlotIncentivePoolPercentageBips;
    uint256[] public timeSlotIncentivePoolPercentagesBips;

    event IncentivePoolSet(address oldAddress, address newAddress);
    event TimeSlotIncentivePoolPercentageYielded(uint256 percentageBips);
    event TimeSlotIncentivePoolPercentageScheduleSet(uint256[] timeSlotIncentivePoolPercentagesBips);
    event IncentivePoolSharingPercentagesSet(
        IIIncentivePoolReceiver[] incentivePoolReceivers,
        uint256[] percentagePerReceiverBips
    );

    modifier notZero(address _address) {
        require(_address != address(0), ERR_IS_ZERO);
        _;
    }

    modifier onlyIncentivePool {
        require(msg.sender == address(incentivePool), ERR_ONLY_INCENTIVE_POOL);
        _;
    }

    /**
     * @dev IncentivePool contract need not be set here, but must be set at the point that
     *   time slot incentive pool percentages are to be retrieved from the schedule.
     */
    constructor(
        address _governance,
        address _addressUpdater,
        uint256[] memory _timeSlotIncentivePoolScheduleBips
    )
        Governed(_governance) AddressUpdatable(_addressUpdater)
    {
        require(_timeSlotIncentivePoolScheduleBips.length > 0, ERR_TIME_SLOT_INCENTIVE_POOL_SCHEDULE_EMPTY);

        // validity is checked in _setTimeSlotIncentivePoolSchedule
        lastTimeSlotIncentivePoolPercentageBips = _timeSlotIncentivePoolScheduleBips[0];
        _setTimeSlotIncentivePoolSchedule(_timeSlotIncentivePoolScheduleBips);
    }

    /**
     * @notice Set the sharing percentages between incentive pool receiver contracts. Percentages must sum
     *   to 100%.
     * @param _incentivePoolReceivers   An array of contracts to receive incentive pool rewards for distribution.
     * @param _percentagePerReceiverBips    An array of sharing percentages in bips.
     */
    function setSharingPercentages(
        IIIncentivePoolReceiver[] memory _incentivePoolReceivers,
        uint256[] memory _percentagePerReceiverBips
    )
        external
        onlyGovernance
    {
        _setSharingPercentages(_incentivePoolReceivers, _percentagePerReceiverBips);
    }

    /**
     * @notice Set the time slot incentive pool percentage schedule. This schedule is meant to be set for recognition
     *   a per-annum basis.
     * @param _timeSlotIncentivePoolScheduleBips  An array of incentive pool percentages in bips.
     * @dev Once the schedule has been used up, the last percentage
     *   yielded will be the percentage that will continue to be yielded.
     */
    function setTimeSlotIncentivePool(uint256[] memory _timeSlotIncentivePoolScheduleBips) external onlyGovernance {
        // Clear the existing schedule
        uint256 lenExistingSchedule = timeSlotIncentivePoolPercentagesBips.length;
        for (uint256 i = 0; i < lenExistingSchedule; i++) {
            timeSlotIncentivePoolPercentagesBips.pop();
        }

        // Set new schedule
        _setTimeSlotIncentivePoolSchedule(_timeSlotIncentivePoolScheduleBips);

        emit TimeSlotIncentivePoolPercentageScheduleSet(_timeSlotIncentivePoolScheduleBips);
    }

    /**
     * @notice Get the next time slot incentive pool percentage from the schedule and pop it off the schedule.
     *   If there are no percentages remaining within the schedule, yield the last percentage known.
     * @return The time slot incentive pool percentage.
     * @dev Note that it is up to the caller to call this function at the appropriate time slot interval.
     */
    function getTimeSlotPercentageBips()
        external override
        notZero(address(incentivePool))
        onlyIncentivePool
        returns(
            uint256
        )
    {
        // If there is not a schedule of percentages, return the last one given (or set).
        if (timeSlotIncentivePoolPercentagesBips.length > 0) {
            // Since there is a schedule, get the next percentage.
            lastTimeSlotIncentivePoolPercentageBips = timeSlotIncentivePoolPercentagesBips[0];
            // Iterate over the schedule, shifting each down an index
            uint256 len = timeSlotIncentivePoolPercentagesBips.length;
            if (len > 1) {
                for (uint256 i = 0; i < len - 1; i++) {
                    timeSlotIncentivePoolPercentagesBips[i] = timeSlotIncentivePoolPercentagesBips[i+1];
                }
            }
            timeSlotIncentivePoolPercentagesBips.pop();
        }
        emit TimeSlotIncentivePoolPercentageYielded(lastTimeSlotIncentivePoolPercentageBips);
        return lastTimeSlotIncentivePoolPercentageBips;
    }

    /**
     * @notice Get the incentive pool receiver contracts and the current sharing percentages.
     * @return _sharingPercentages An array of SharingPercentage.
     */
    function getSharingPercentages() external view override returns(SharingPercentage[] memory _sharingPercentages) {
        uint256 len = incentivePoolReceivers.length;

        _sharingPercentages = new SharingPercentage[](len);

        for (uint i = 0; i < len; i++) {
            _sharingPercentages[i].percentBips = incentivePoolReceivers[i].percentageBips;
            _sharingPercentages[i].incentivePoolReceiver = incentivePoolReceivers[i].receiverContract;
        }
    }

    /**
     * @notice Set the sharing percentages between incentive pool receiver contracts. Percentages must sum
     *   to 100%.
     * @param _incentivePoolReceivers   An array of contracts to receive incentive pool rewards for distribution.
     * @param _percentagePerReceiverBips    An array of sharing percentages in bips.
     */
    function _setSharingPercentages(
        IIIncentivePoolReceiver[] memory _incentivePoolReceivers,
        uint256[] memory _percentagePerReceiverBips
    )
        internal
    {
        require(_incentivePoolReceivers.length == _percentagePerReceiverBips.length, ERR_LENGTH_MISMATCH);
        require (_incentivePoolReceivers.length <= MAX_INCENTIVE_POOL_RECEIVERS, ERR_TOO_MANY);

        uint256 sumSharingPercentage;

        uint256 len = incentivePoolReceivers.length;
        for (uint256 i = 0; i < len; i++) {
            incentivePoolReceivers.pop();
        }

        for (uint256 i = 0; i < _incentivePoolReceivers.length; i++) {
            require (_percentagePerReceiverBips[i] <= BIPS100, ERR_HIGH_SHARING_PERCENTAGE);
            require (_incentivePoolReceivers[i] != IIIncentivePoolReceiver(0), ERR_IS_ZERO);

            sumSharingPercentage += _percentagePerReceiverBips[i];

            incentivePoolReceivers.push( IncentivePoolReceiver({
                receiverContract: _incentivePoolReceivers[i],
                percentageBips: uint32(_percentagePerReceiverBips[i])
            }));
        }

        require (sumSharingPercentage == BIPS100, ERR_SUM_SHARING_PERCENTAGE);
        emit IncentivePoolSharingPercentagesSet(_incentivePoolReceivers, _percentagePerReceiverBips);
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method - updates IncentivePool
     * and incentive pool receivers contracts.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        IncentivePool _incentivePool = IncentivePool(
            // Since IncentivePool is payable, we have to explicitly convert the address to a payable address.
            payable(_getContractAddress(_contractNameHashes, _contractAddresses, "IncentivePool")));
        emit IncentivePoolSet(address(incentivePool), address(_incentivePool));
        incentivePool = _incentivePool;

        uint256 len = incentivePoolReceivers.length;
        if (len == 0) {
            return;
        }

        IIIncentivePoolReceiver[] memory receivers = new IIIncentivePoolReceiver[](len);
        uint256[] memory percentages = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            IncentivePoolReceiver memory incentivePoolReceiver = incentivePoolReceivers[i];
            receivers[i] = IIIncentivePoolReceiver(
                _getContractAddress(_contractNameHashes, _contractAddresses,
                incentivePoolReceiver.receiverContract.getContractName()));
            percentages[i] = incentivePoolReceiver.percentageBips;
        }

        _setSharingPercentages(receivers, percentages);
    }

     /**
     * @notice Set the time slot incentive pool percentage schedule. This schedule is meant to be set for recognition
     *   a per-annum basis.
     * @param _timeSlotIncentivePoolScheduleBips  An array of incentive pool percentages in bips.
     * @dev Once the schedule has been used up, the last percentage
     *   yielded will be the percentage that will continue to be yielded.
     */
    function _setTimeSlotIncentivePoolSchedule(uint256[] memory _timeSlotIncentivePoolScheduleBips) internal {
        require(_timeSlotIncentivePoolScheduleBips.length <= MAX_SCHEDULE_COUNT, ERR_TOO_MANY);
        uint256 len = _timeSlotIncentivePoolScheduleBips.length;

        for (uint256 i = 0; i < len; i++) {
            // Validate the schedule...
            require(
                _timeSlotIncentivePoolScheduleBips[i] <= MAX_INCENTIVE_POOL_PERCENTAGE_BIPS,
                ERR_TIME_SLOT_INCENTIVE_POOL_OUT_OF_BOUNDS);

            // Push in the new schedule
            timeSlotIncentivePoolPercentagesBips.push(_timeSlotIncentivePoolScheduleBips[i]);
        }
    }
}
