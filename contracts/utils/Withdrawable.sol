// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";


contract Withdrawable is Ownable {

    event RescueWithdraw (address indexed to, uint256 amount);

    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.transfer(to, amount);
        emit RescueWithdraw(to, amount);
    }
}