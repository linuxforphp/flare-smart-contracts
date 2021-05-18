// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../internal/IIFtso.sol";

interface IPriceSubmitter {
    // events
    event PricesSubmitted(
        address indexed submitter,
        uint256 indexed epochId,
        IIFtso[] ftsos,
        bytes32[] hashes,
        bool[] success,
        uint256 timestamp
    );

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
     * @param _ftsos                List of ftsos
     * @param _hashes               List of hashed price and random number
     * @notice Emits PricesSubmitted event
     */
    function submitPrices(
        IIFtso[] memory _ftsos,
        bytes32[] memory _hashes
    ) external;

    /**
     * @notice Reveals submitted prices during epoch reveal period
     * @param _epochId              Id of the epoch in which the price hashes was submitted
     * @param _ftsos                List of ftsos
     * @param _prices               List of submitted prices in USD
     * @param _randoms              List of submitted random numbers
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PricesRevealed event
     */
    function revealPrices(
        uint256 _epochId,
        IIFtso[] memory _ftsos,
        uint256[] memory _prices,
        uint256[] memory _randoms
    ) external;

}
