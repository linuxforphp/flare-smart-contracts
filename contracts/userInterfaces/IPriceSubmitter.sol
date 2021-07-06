// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../ftso/interface/IIFtso.sol";
import "../genesis/interface/IIFtsoRegistry.sol";

interface IPriceSubmitter {
    // events
    event PriceHashesSubmitted(
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


    function setFtsoManager(IIFtsoManager _ftsoManager) external;
    function setFtsoRegistry(IIFtsoRegistry _ftsoRegistryToSet) external;

    function requestFtsoFullVoterWhitelisting(address _voter) external;
    function requestFtsoWhiteListingFassetHolder(address _voter, uint256 _ftsoIndex) external;
    function requestFtsoWhiteListingWflrHolder(address _voter) external;


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

    function addFtso(IIFtso _ftso, uint256 _ftsoIndex) external;
    function removeFtso(IIFtso _ftso) external;

    // Hardcoded FTSO indices for automatically deployed 

    /* solhint-disable func-name-mixedcase */
    function FLR_FTSO_INDEX  () external pure returns (uint256);
    function FXRP_FTSO_INDEX  () external pure returns (uint256);
    function FLTC_FTSO_INDEX  () external pure returns (uint256);
    function FXDG_FTSO_INDEX  () external pure returns (uint256);
    function FADA_FTSO_INDEX  () external pure returns (uint256);
    function FALGO_FTSO_INDEX () external pure returns (uint256);
    function FBCH_FTSO_INDEX  () external pure returns (uint256);
    function FDGB_FTSO_INDEX  () external pure returns (uint256);
    function FXLM_FTSO_INDEX  () external pure returns (uint256);
    function FBTC_FTSO_INDEX  () external pure returns (uint256);
    /* solhint-enable func-name-mixedcase */
 
}
