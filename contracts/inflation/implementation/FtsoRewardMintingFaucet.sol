// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { FlareKeeper } from "../../utils/implementation/FlareKeeper.sol";
import { MintAccounting } from "../../accounting/implementation/MintAccounting.sol";
import { MintingFaucet } from "./MintingFaucet.sol";
import { FtsoInflationAccounting } from "../../accounting/implementation/FtsoInflationAccounting.sol"; 
import { FtsoRewardManagerAccounting } from "../../accounting/implementation/FtsoRewardManagerAccounting.sol";
import { IIWithdrawAmountProvider } from "../interface/IIWithdrawAmountProvider.sol";


/**
 * @title Ftso Reward Minting Faucet
 * @notice This contract handles the mint requesting and transference to the ftso reward contract
 *   of FLR inflation rewards for claiming supply.
 **/

contract FtsoRewardMintingFaucet is MintingFaucet {
    FtsoInflationAccounting public ftsoInflationAccounting;

    constructor(
        address _governance,
        IIWithdrawAmountProvider _withdrawAmountProvider, 
        address _rewardManager, 
        FlareKeeper _flareKeeper, 
        uint256 _fundWithdrawTimeLockSec,
        uint256 _fundRequestIntervalSec,
        MintAccounting _mintAccounting,
        FtsoInflationAccounting _ftsoInflationAccounting)
        MintingFaucet (
            _governance,
            _withdrawAmountProvider,
            _rewardManager,
            _flareKeeper,
            _fundWithdrawTimeLockSec,
            _fundRequestIntervalSec,
            _mintAccounting
        ) {
        ftsoInflationAccounting = _ftsoInflationAccounting;
    }

    function withdrawRewardFundsCallback(uint _amountTWei) internal override {
        ftsoInflationAccounting.receiveMinting(_amountTWei);
    }
}
