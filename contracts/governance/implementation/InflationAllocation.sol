// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import { Governed } from "./Governed.sol";
import { IIInflationReceiver } from "../../inflation/interface/IIInflationReceiver.sol";
import { IIInflationPercentageProvider } from "../../inflation/interface/IIInflationPercentageProvider.sol";
import { 
    IIInflationSharingPercentageProvider, 
    SharingPercentage} from "../../inflation/interface/IIInflationSharingPercentageProvider.sol";

/**
 * @title Inflation allocation contract
 * @notice This contract implements settings agreed upon by Flare Foundation governance.
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

    uint256 internal constant BIPS100 = 1e4;                            // 100% in basis points
    uint256 internal constant MAX_ANNUAL_INFLATION = BIPS100 * 10;      // to have some kind of

    InflationReceiver[] internal inflationReceivers;
    uint256 internal annualInflationPercentageBips;

    modifier notZero(address _address) {
        require(_address != address(0), ERR_IS_ZERO);
        _;
    }
    constructor(
        address _governance,
        uint256 _annualInflationBips
    ) 
        Governed(_governance)
    {
        // due to circular reference between contracts, can't yet set contracts sharing inflation
        setAnnualInflation(_annualInflationBips);
    }

    function setSharingPercentages (
        IIInflationReceiver[] memory _inflationRecievers, 
        uint256[] memory _percentagePerReceiverBips
        ) external onlyGovernance 
    {
        require(_inflationRecievers.length == _percentagePerReceiverBips.length, ERR_LENGTH_MISMATCH);

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
    }

    function setAnnualInflation (uint256 _annualInflationBips) public onlyGovernance {
        require(_annualInflationBips <= MAX_ANNUAL_INFLATION, ANNUAL_INFLATION_OUT_OF_BOUNDS);
        require(_annualInflationBips > 0, ANNUAL_INFLATION_OUT_OF_BOUNDS);
        // TODO: prevent big annual changes. 
        // TODO: prevent 

        annualInflationPercentageBips = _annualInflationBips;
    }

    function getAnnualPercentageBips() external view override returns(uint256) {
        return annualInflationPercentageBips;
    }

    function getSharingPercentages() external view override returns(SharingPercentage[] memory _sharingPercentages) {
        uint256 len = inflationReceivers.length;

        _sharingPercentages = new SharingPercentage[](len);

        for (uint i = 0; i < len; i++) {
            _sharingPercentages[i].percentBips = inflationReceivers[i].percentageBips;
            _sharingPercentages[i].inflationReceiver = inflationReceivers[i].receiverContract;
        }
    }
}
