// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { BokkyPooBahsDateTimeLibrary } from "../../utils/implementation/DateTimeLibrary.sol";
import { Governed } from "../../governance/implementation/Governed.sol";
import { IFlareKeep } from "../../utils/interfaces/IFlareKeep.sol";
import { IIAccountingClose } from "../interface/IIAccountingClose.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

//import "hardhat/console.sol";

/**
 * @title CloseManager contract
 * @notice Coordinate an automated accounting system close to syncronize sub-ledger balances posting
 *   to the general ledger on a less than real-time basis.
 **/
contract CloseManager is Governed, IFlareKeep {
    using SafeMath for uint256;

    struct AccountingClosePeriod {
        uint256 blockNumber;
        uint256 timestamp;
    }

    struct CloseError {
        IIAccountingClose contractInError;
        string message;
    }

    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_CONTRACT_NOT_FOUND = "contract not found";
    string internal constant ERR_NO_CLOSING_PERIODS = "no periods";
    string internal constant ERR_BEFORE_FIRST_CLOSE = "before first close";

    AccountingClosePeriod[] public closingPeriods;
    IIAccountingClose[] public closeables;
    mapping(uint256 => CloseError[]) public errorsByBlock;

    uint256 internal constant MAX_CLOSEABLES = 20;
    uint256 internal lastHour;
    bool internal firstPeriod;

    event RegistrationUpdated (IIAccountingClose closable, bool add);
    event NewClosingPeriodRecognized(uint256 index, uint256 blockNumber, uint256 timestamp);
    event ClosableClosed(IIAccountingClose closeable, uint256 blockNumber, uint256 timestamp);
    event ClosableClosedInError(IIAccountingClose closeable, uint256 atBlock, string theMessage);

    constructor(address _governance) Governed(_governance) {
        // At constructor time, there are no closing periods.
        firstPeriod = true;
        // Prime last hour with now.
        lastHour = BokkyPooBahsDateTimeLibrary.getHour(block.timestamp);
    }

    /**
     * @notice Get the greatest closing period less than or equal to _timestamp.
     * @param   _timestamp The timestamp of the period to fetch.
     * @return  _blockNumber The block number of the _timestamp that met the criteria.
     * @return  _timestampClosed The closing timestamp of the _timestamp that met the criteria.
     * @dev Note that current close calculation picks a block that rolls over from
     *   GMT hour 23 to GMT hour 00 - a daily close. But note that if you send in
     *   a _timestamp with hh:mm:ss of 00:00:00, you will not catch the period
     *   containing the prior day's close. The prior day's close will actually hit
     *   around GMT 00:00:05, or so. Also note that the accounting system at the genesis
     *   block contains a zero opening balance across all accounts. Therefore, there is no
     *   close period until the first day rolls over. This method will revert if you
     *   give it a _closePeriod prior to the first close.
     */
    function getClosingPeriodAsOf(uint256 _timestamp)
        external view 
        returns(uint256 _blockNumber, uint256 _timestampClosed)
    {
        require(closingPeriods.length > 0, ERR_NO_CLOSING_PERIODS);
        require(closingPeriods[0].timestamp <= _timestamp, ERR_BEFORE_FIRST_CLOSE);
        uint256 index = _indexOfClosingPeriodLessThan(_timestamp);
        _blockNumber = closingPeriods[index].blockNumber;
        _timestampClosed = closingPeriods[index].timestamp;
    }

    /**
     * @notice Called by the FlareKeeper to pump closing of accounting
     *  system should it be time to close.
     */
    function keep() external override returns(bool) {
        // Determine if the current block is a closing period
        if (shouldCloseOnCurrentBlock()) {
            // Yes, so create a new closing period to store
            uint256 closingPeriodIndex = newClosingPeriod();
            // Spin through registered closeables and close
            uint256 count = closeables.length;
            for (uint256 i = 0; i < count; i++) {
                // Catch reverts...
                try closeables[i].close() {
                    // Tell the world we closed
                    emit ClosableClosed(
                        closeables[i], 
                        closingPeriods[closingPeriodIndex].blockNumber, 
                        closingPeriods[closingPeriodIndex].timestamp);
                } catch Error(string memory message) {
                    // And log them...
                    // If this is happening, something is not in balance, and is a bug.
                    CloseError[] storage closeErrors = errorsByBlock[closingPeriods[closingPeriodIndex].blockNumber];
                    closeErrors.push(CloseError({contractInError: closeables[i], message: message}));
                    // Tell the world there was a close error
                    emit ClosableClosedInError(closeables[i], closingPeriods[closingPeriodIndex].blockNumber, message);
                }
            }
        }
        return true;
    }

    /**
     * @notice Register a conract that requires closing of sub-ledger balances to
     *   the accounting sytem.
     * @param _closeable The contract to register.
     * @dev Only callable by governance.
     */
    function registerToClose(IIAccountingClose _closeable) external onlyGovernance {
        uint256 count = closeables.length;
        require(count + 1 < MAX_CLOSEABLES, ERR_TOO_MANY);

        // Check to see if contract already registered
        for (uint256 i = 0; i < count; i++) {
            if (_closeable == closeables[i]) {
                return; // already registered
            }
        }

        // Add to end of array
        closeables.push(_closeable);
        // Tell the world
        emit RegistrationUpdated (_closeable, true);
    }

    /**
     * @notice Unregister a conract that had been registerd to be closed by the accounting system.
     * @param _closeable The contract to unregister.
     * @dev Only callable by governance.
     */
    function unregisterToClose(IIAccountingClose _closeable) external onlyGovernance {
        uint256 count = closeables.length;

        for (uint256 i = 0; i < count; i++) {
            // If we find selected closeable in the array
            if (_closeable == closeables[i]) {
                // Move end closeable to currently found position
                closeables[i] = closeables[count - 1];
                // Pop the end off the array
                closeables.pop();
                // Tell the world
                emit RegistrationUpdated (_closeable, false);
                // Done
                return;
            }
        }
        // If here, contract was not found. Complain.
        revert(ERR_CONTRACT_NOT_FOUND);
    }

    /**
     * @notice Get the last index entry of the closingPeriods array.
     * @return The index.
     */
    function getLastClosingPeriodIndex() public view returns(uint256) {
        return closingPeriods.length.sub(1);
    }

    /**
     * @notice Helper function to create a new closing period entry.
     * @return addedAt The index of the newly added entry.
     */
    function newClosingPeriod() internal returns(uint256 addedAt) {
        // Create a new closing period
        AccountingClosePeriod memory accountingClosingPeriod = AccountingClosePeriod({
            blockNumber: block.number,
            timestamp: block.timestamp});
        // Add to array
        closingPeriods.push(accountingClosingPeriod);
        // Get the index added
        addedAt = getLastClosingPeriodIndex();
        // Tell what we did
        emit NewClosingPeriodRecognized(addedAt, block.number, block.timestamp);
        // Return index added
        // Sanity check...our new closing period better be later than our last closing period.
        assert(
            firstPeriod || 
            (!firstPeriod && closingPeriods[addedAt.sub(1)].timestamp < closingPeriods[addedAt].timestamp));
        firstPeriod = false;
        return addedAt;
    }

    /**
     * @notice Determines whether contracts keeping local sub-ledgers should report
     *   their balance to the general ledger (performing a close). The current algo
     *   is doing this at the first block past midnight GMT, every day.
     * @return _shouldClose True if time to close. False otherwise.
     */
    function shouldCloseOnCurrentBlock() internal returns(bool _shouldClose) {
        // TODO: Make this plugable for ease of maintenance?
        // Let's assume we will close the accounting system every day.
        // So let's do it when the GMT clock strikes midnight - 00:00:00.
        _shouldClose = false;
        uint256 currentHour = BokkyPooBahsDateTimeLibrary.getHour(block.timestamp);
        // As there should be ever increasing hours, when they
        // roll over, then it is time to close.
        if (currentHour < lastHour) {
            _shouldClose = true;
        }
        lastHour = currentHour;
    }

    /**
     * @notice Binary search of closingPeriods array.
     * @param _timestamp The timestamp search for.
     * @dev We assume that the closingPeriods array contains ever increasing timestamps.
     */
    function _indexOfClosingPeriodLessThan(uint256 _timestamp) private view returns (uint256 index) {
        // Binary search of the value by given _timestamp in the array
        uint256 min = 0;
        uint256 max = getLastClosingPeriodIndex();
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (closingPeriods[mid].timestamp <= _timestamp) {
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }
}
