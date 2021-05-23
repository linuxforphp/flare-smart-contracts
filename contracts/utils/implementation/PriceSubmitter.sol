// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IPriceSubmitter.sol";

/**
 * @title Price submitter
 * @notice A contract used to submit/reveal prices to multiple Flare Time Series Oracles in one transaction
 */
contract PriceSubmitter is IPriceSubmitter {

    string internal constant ERR_ARRAY_LENGTHS = "Array lengths do not match";

    /**
     * @notice Submits price hashes for current epoch
     * @param _ftsos                List of ftsos
     * @param _hashes               List of hashed price and random number
     * @notice Emits PricesSubmitted event
     */
    function submitPrices(
        IIFtso[] memory _ftsos,
        bytes32[] memory _hashes
    ) external override {
        uint256 len  = _ftsos.length;
        require(len == _hashes.length, ERR_ARRAY_LENGTHS);

        bool[] memory success = new bool[](len);
        uint256 epochId;
        for (uint256 i = 0; i < len; i++) {
            try _ftsos[i].submitPriceSubmitter(msg.sender, _hashes[i]) returns (uint256 _epochId) {
                success[i] = true;
                // they should all be the same (one price provider contract for all ftsos managed by one ftso manager)
                epochId = _epochId;
            } catch {}
        }
        emit PricesSubmitted(msg.sender, epochId, _ftsos, _hashes, success, block.timestamp);
    }

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
    ) external override {
        uint256 len  = _ftsos.length;
        require(len == _prices.length, ERR_ARRAY_LENGTHS);
        require(len == _randoms.length, ERR_ARRAY_LENGTHS);

        bool[] memory success = new bool[](len);
        for (uint256 i = 0; i < len; i++) {
            try _ftsos[i].revealPriceSubmitter(msg.sender, _epochId, _prices[i], _randoms[i]) {
                success[i] = true;
            } catch {}
        }
        emit PricesRevealed(msg.sender, _epochId, _ftsos, _prices, _randoms, success, block.timestamp);
    }
}