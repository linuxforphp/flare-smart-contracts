
// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


interface IFtsoGenesis {
    
    /**
     * @notice Submits price hash for current epoch - only price submitter
     * @param _sender               Sender address
     * @param _hash                 Hashed price and random number
     * @return _epochId             Returns current epoch id
     * @notice Emits PriceHashSubmitted event
     */
    function submitPriceHashSubmitter(address _sender, bytes32 _hash) external returns (uint256 _epochId);

    /**
     * @notice Reveals submitted price during epoch reveal period - only price submitter
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @param _random               Submitted random number
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPriceSubmitter(
        address _voter,
        uint256 _epochId,
        uint256 _price,
        uint256 _random,
        uint256 _wNatVP
    ) external;

    /**
     * @notice Get (and cache) wNat vote power for specified voter and given epoch id
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @return wNat vote power
     */
    function wNatVotePowerCached(address _voter, uint256 _epochId) external returns (uint256);
}
