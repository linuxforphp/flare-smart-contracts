// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIInflationSharingPercentageProvider.sol";


contract SharingPercentageProviderMock is IIInflationSharingPercentageProvider {
    SharingPercentage[] public sharingPercentages;

    constructor(SharingPercentage[] memory _sharingPercentages) {
        // Add to storage
        for (uint256 i; i < _sharingPercentages.length; i++) {
            sharingPercentages.push(_sharingPercentages[i]);            
        }
    }

    function getSharingPercentages() external view override returns(SharingPercentage[] memory) {
        return sharingPercentages;
    }
}
