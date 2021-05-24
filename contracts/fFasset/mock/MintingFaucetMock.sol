// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { FlareKeeper } from "../../utils/implementation/FlareKeeper.sol";
import { Governed } from "../../governance/implementation/Governed.sol";
import { IFlareKeep } from "../../utils/interfaces/IFlareKeep.sol";
import { IIWithdrawAmountProvider } from "../../inflation/interface/IIWithdrawAmountProvider.sol";
import { MintAccounting } from "../../accounting/implementation/MintAccounting.sol";
import { MintingFaucet } from "../../inflation/implementation/MintingFaucet.sol";

/**
 * @title Minting Faucet Mock
 * @notice Make a concrete MintingFaucet for unit testing purposes.
 **/

contract MintingFaucetMock is MintingFaucet {
    constructor(
        address _governance,
        IIWithdrawAmountProvider _withdrawAmountProvider, 
        address _rewardManager, 
        FlareKeeper _flareKeeper, 
        uint256 _fundWithdrawTimeLockSec,
        uint256 _fundRequestIntervalSec,
        MintAccounting _mintAccounting) 
        MintingFaucet (
            _governance,
            _withdrawAmountProvider,
            _rewardManager,
            _flareKeeper,
            _fundWithdrawTimeLockSec,
            _fundRequestIntervalSec,
            _mintAccounting
        ) {}
}
