pragma solidity 0.7.6;

import "./utils/IERC20.sol";


interface IFasset is IERC20 {

    struct DelegationData {
        address to;
        uint256 howMuch;
    }

    /// @notice delegate percentage of vote power. up to x addresses. 
    /// any undelegated vote power is seen as delegated to self.
    /// howMuch units are percentage. i.e. max total delegation is 100.
    /// @dev to remove delegation set howMuch to 0
    function delegate(DelegationData[] calldata delegationData) external;

    /// @notice delegate explicit amount of voting power (in token units)
    /// @notice with delegateExplicit, must un delegate tokens before transferring out
    /// @dev un delegate by setting delegation to address with 0.
    function delegateExplicit(DelegationData[] calldata delegationData) external;

    /// @notice. for any cotracts wishing to share rewards with depositers, this
    ///     function enable to check how much of the contracts vote power came 
    ///     from this delegator.
    function votePowerDelegatedFromHimToMeAtBlock(address me, address him, uint256 blockNumber) 
        external view returns (uint256 votePower);

    function votePowerOfAt (address who, uint256 blockNumber) external view 
        returns (uint256 votePower);

    function getDelegationsAt (uint256 who, uint256 blockNumber) external view
        returns(DelegationData delegations);

    /// @notice An event thats emitted when an account changes its delegation data
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);

    /// @notice An event thats emitted when a delegate account's vote balance changes
    event DelegateVotePowerChanged(address indexed delegate, uint previousVotePower, uint newVotePower);
}
