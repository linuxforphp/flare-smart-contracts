// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../ftso/interface/IIFtso.sol";
import "./IVoterWhitelister.sol";
import "./IFtsoManager.sol";

interface IPriceSubmitter {
    /**
     * Event emitted when price hashes were submitted through PriceSubmitter.
     * @param submitter the address of the sender
     * @param epochId current price epoch id
     * @param ftsos array of ftsos the correspond to the indexes in call
     *      NOTE: if price cannot be submitted for a certain FTSO because the sender is not on the whitelist,
     *      the corresponding `ftso[i]` will be `address(0)`; this way sender can detect if the reason fo failure
     *      was insufficient vote power or some error inside `ftso.submitPriceHash`
     * @param hashes the submitted hashes
     * @param success array of booleans, indicating whether the submission of the corresponding hash has succeeded
     *      NOTE: when there are more than MAX_ALLOWED_NUMBER_OF_SUBMIT_REVERTS failures, the whole operation reverts
     * @param timestamp current block timestamp
     */
    event PriceHashesSubmitted(
        address indexed submitter,
        uint256 indexed epochId,
        IIFtso[] ftsos,
        bytes32[] hashes,
        bool[] success,
        uint256 timestamp
    );

    /**
     * Event emitted when prices were revealed through PriceSubmitter.
     * @param voter the address of the sender
     * @param epochId id of the epoch in which the price hash was submitted
     * @param ftsos array of ftsos the correspond to the indexes in the call
     *      NOTE: if price cannot be submitted for a certain FTSO because the sender is not on the whitelist,
     *      the corresponding `ftso[i]` will be `address(0)`; this way sender can detect if the reason fo failure
     *      was insufficient vote power or some error inside `ftso.revealPrice`
     * @param prices the submitted prices
     * @param success array of booleans, indicating whether the submission of the corresponding price has succeeded
     *      NOTE: when there are more than MAX_ALLOWED_NUMBER_OF_REVEAL_REVERTS failures, the whole operation reverts
     * @param timestamp current block timestamp
     */
    event PricesRevealed(
        address indexed voter,
        uint256 indexed epochId,
        IIFtso[] ftsos,
        uint256[] prices,
        uint256[] randoms,
        bool[] success,
        uint256 timestamp
    );
    
    /**
     * @notice Submits price hashes for current epoch
     * @param _ftsoIndices          List of ftso indices
     * @param _hashes               List of hashed price and random number
     * @notice Emits PriceHashesSubmitted event
     */
    function submitPriceHashes(
        uint256[] memory _ftsoIndices,
        bytes32[] memory _hashes
    ) external;

    /**
     * @notice Reveals submitted prices during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hashes was submitted
     * @param _ftsoIndices          List of ftso indices
     * @param _prices               List of submitted prices in USD
     * @param _randoms              List of submitted random numbers
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PricesRevealed event
     */
    function revealPrices(
        uint256 _epochId,
        uint256[] memory _ftsoIndices,
        uint256[] memory _prices,
        uint256[] memory _randoms
    ) external;

    /**
     * Returns bitmap of all ftso's for which `_voter` is allowed to submit prices/hashes.
     * If voter is allowed to vote for ftso at index (see *_FTSO_INDEX), the corrsponding
     * bit in the result will be 1.
     */    
    function voterWhitelistBitmap(address _voter) external view returns (uint256);
    function getVoterWhitelister() external view returns (IVoterWhitelister);
    function getFtsoRegistry() external view returns (IFtsoRegistry);
    function getFtsoManager() external view returns (IFtsoManager);
}
