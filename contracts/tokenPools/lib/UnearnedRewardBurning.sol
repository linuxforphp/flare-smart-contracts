// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/UnearnedRewardBurner.sol";


/**
 * @notice This library works around an issue in the validator that will not accept transfers
 *         to the burn address. Instead, it transfers to a temp contract that then self-destructs to that address.
 */
library UnearnedRewardBurning {
    function burnAmount(address payable _burnAddress, uint256 _toBurnWei) external {
        UnearnedRewardBurner unearnedRewardBurner = new UnearnedRewardBurner(_burnAddress);
        //slither-disable-next-line arbitrary-send
        address(unearnedRewardBurner).transfer(_toBurnWei);
        unearnedRewardBurner.die();
    }
}
