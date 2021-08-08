// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./Governed.sol";
import "../../inflation/implementation/Inflation.sol";
import "../../inflation/interface/IIInflationReceiver.sol";
import "../../inflation/interface/IIInflationPercentageProvider.sol";
import "../../inflation/interface/IIInflationSharingPercentageProvider.sol";

/**
 * @title Inflation allocation contract
 * @notice This contract implements Inflation settings agreed upon by Flare Foundation governance.
 **/
contract InflationAllocation is Governed, IIInflationPercentageProvider, IIInflationSharingPercentageProvider {

    struct InflationReceiver {
        IIInflationReceiver receiverContract;
        uint32 percentageBips; // limited to BIPS100
    }

    // constants
    string internal constant ERR_LENGTH_MISMATCH = "length mismatch";
    string internal constant ERR_HIGH_SHARING_PERCENTAGE = "high sharing percentage";
    string internal constant ERR_SUM_SHARING_PERCENTAGE = "sum sharing percentage not 100%";
    string internal constant ERR_IS_ZERO = "address is 0"; 
    string internal constant ANNUAL_INFLATION_OUT_OF_BOUNDS = "annual inflation out of bounds";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_ONLY_INFLATION = "only inflation";

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points
    uint256 internal constant MAX_SCHEDULE_COUNT = 10;
    uint256 internal constant MAX_INFLATION_RECEIVERS = 10;

    InflationReceiver[] public inflationReceivers;
    Inflation public inflation;
    uint256 public lastAnnualInflationPercentageBips;
    uint256[] public annualInflationPercentagesBips;

    event InflationSet(address oldAddress, address newAddress);
    event AnnualInflationPercentageYielded(uint256 percentageBips);
    event AnnualInflationPercentageScheduleSet(uint256[] annualInflationPercentagesBips);
    event InflationSharingPercentagesSet(
        IIInflationReceiver[] inflationRecievers, 
        uint256[] percentagePerReceiverBips
    );

    modifier notZero(address _address) {
        require(_address != address(0), ERR_IS_ZERO);
        _;
    }

    modifier onlyInflation {
        require(msg.sender == address(inflation), ERR_ONLY_INFLATION);
        _;
    }

    /**
     * @dev _inflation contract need not be set here, but must be set at the point that
     *   annual inflation percentages are to be retrieved from the schedule.
     */
    constructor(
        address _governance,
        Inflation _inflation,
        uint256 _annualInflationBips
    ) 
        Governed(_governance)
    {
        require(
            _annualInflationBips > 0,
            ANNUAL_INFLATION_OUT_OF_BOUNDS);
        lastAnnualInflationPercentageBips = _annualInflationBips;
        inflation = _inflation;
    }

    /**
     * @notice Sets the inflation contract.
     * @param _inflation   The inflation contract.
     */
    function setInflation(Inflation _inflation) external onlyGovernance notZero(address(_inflation)) {
        emit InflationSet(address(inflation), address(_inflation));
        inflation = _inflation;
    }

    /**
     * @notice Set the sharing percentages between inflation receiver contracts. Percentages must sum
     *   to 100%.
     * @param _inflationRecievers   An array of contracts to receive inflation rewards for distribution.
     * @param _percentagePerReceiverBips    An array of sharing percentages in bips.
     */
    function setSharingPercentages (
        IIInflationReceiver[] memory _inflationRecievers, 
        uint256[] memory _percentagePerReceiverBips
    )
        external
        onlyGovernance 
    {
        require(_inflationRecievers.length == _percentagePerReceiverBips.length, ERR_LENGTH_MISMATCH);
        require (_inflationRecievers.length <= MAX_INFLATION_RECEIVERS, ERR_TOO_MANY);

        uint256 sumSharingPercentage;

        uint256 len = inflationReceivers.length;
        for (uint256 i = 0; i < len; i++) {
            inflationReceivers.pop();
        }

        for (uint256 i = 0; i < _inflationRecievers.length; i++) {
            require (_percentagePerReceiverBips[i] <= BIPS100, ERR_HIGH_SHARING_PERCENTAGE);
            require (_inflationRecievers[i] != IIInflationReceiver(0), ERR_IS_ZERO);

            sumSharingPercentage += _percentagePerReceiverBips[i];

            inflationReceivers.push( InflationReceiver({
                receiverContract: _inflationRecievers[i],
                percentageBips: uint32(_percentagePerReceiverBips[i])
            }));
        }

        require (sumSharingPercentage == BIPS100, ERR_SUM_SHARING_PERCENTAGE);
        emit InflationSharingPercentagesSet(_inflationRecievers, _percentagePerReceiverBips);
    }

    /**
     * @notice Set the annual inflation percentage schedule. This schedule is meant to be set for recognition
     *   a per-annum basis.
     * @param _annualInflationScheduleBips  An array of inflation percentages in bips.
     * @dev The schedule must be a decaying schedule. Once the schedule has been used up, the last percentage
     *   yielded will be the percentage that will continue to be yielded.
     */
    function setAnnualInflation (uint256[] calldata _annualInflationScheduleBips) external onlyGovernance {
        require(_annualInflationScheduleBips.length <= MAX_SCHEDULE_COUNT, ERR_TOO_MANY);
        // Validate the schedule...percentages must be the same or decay, and cannot be greater than last given.
        uint256 len = _annualInflationScheduleBips.length;
        uint256 lastOne = lastAnnualInflationPercentageBips;
        for(uint256 i = 0; i < len; i++) {
            require(
                _annualInflationScheduleBips[i] <= lastOne && 
                _annualInflationScheduleBips[i] > 0, 
                ANNUAL_INFLATION_OUT_OF_BOUNDS);
                lastOne = _annualInflationScheduleBips[i];
        }

        // Clear the existing schedule
        uint256 lenExistingSchedule = annualInflationPercentagesBips.length;
        for(uint256 i = 0; i < lenExistingSchedule; i++) {
            annualInflationPercentagesBips.pop();
        }

        // Push in the new schedule
        for(uint256 i = 0; i < len; i++) {
            annualInflationPercentagesBips.push(_annualInflationScheduleBips[i]);
        }
        emit AnnualInflationPercentageScheduleSet(_annualInflationScheduleBips);
    }

    /**
     * @notice Get the next annual inflation percentage from the schedule and pop it off the schedule.
     *   If there are no percentages remaining within the schedule, yield the last percentage known.
     * @return The annual inflation percentage.
     * @dev Note that it is up to the caller to call this function at the appropriate annum interval.
     */
    function getAnnualPercentageBips() external override notZero(address(inflation)) onlyInflation returns(uint256) {
        // If there is not a schedule of percentages, return the last one given (or set).
        if (annualInflationPercentagesBips.length > 0) {
            // Since there is a schedule, get the next percentage.
            lastAnnualInflationPercentageBips = annualInflationPercentagesBips[0];
            // Iterate over the schedule, shifting each down an index
            uint256 len = annualInflationPercentagesBips.length;
            if (len > 1) {
                for (uint256 i = 0; i < len - 1; i++) {
                    annualInflationPercentagesBips[i] = annualInflationPercentagesBips[i+1];
                }
            }
            annualInflationPercentagesBips.pop();
        }
        emit AnnualInflationPercentageYielded(lastAnnualInflationPercentageBips);
        return lastAnnualInflationPercentageBips;
    }

    /**
     * @notice Get the inflation reciever contracts and the current sharing percentages.
     * @return _sharingPercentages An array of SharingPercentage.
     */
    function getSharingPercentages() external view override returns(SharingPercentage[] memory _sharingPercentages) {
        uint256 len = inflationReceivers.length;

        _sharingPercentages = new SharingPercentage[](len);

        for (uint i = 0; i < len; i++) {
            _sharingPercentages[i].percentBips = inflationReceivers[i].percentageBips;
            _sharingPercentages[i].inflationReceiver = inflationReceivers[i].receiverContract;
        }
    }
}
