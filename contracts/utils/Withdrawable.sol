pragma solidity 0.7.6;

import "./oz/IERC20.sol";
import "./oz/Ownable.sol";


contract Withdrawable is Ownable {

    event RescureWithdraw (address indexed to, uint256 amount);

    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.transfer(to, amount);
        emit RescueWithdraw(to, ammount);
    }
}