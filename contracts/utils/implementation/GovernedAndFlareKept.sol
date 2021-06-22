// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import { FlareKeeper } from "../../genesis/implementation/FlareKeeper.sol";
import { Governed } from "../../governance/implementation/Governed.sol";


contract GovernedAndFlareKept is Governed {

    FlareKeeper public flareKeeper;

    modifier onlyFlareKeeper () {
        require (msg.sender == address(flareKeeper), "only flare keeper");
        _;
    }

    constructor(address _governance, FlareKeeper _flareKeeper) Governed(_governance) {
        require(address(_flareKeeper) != address(0), "flare keeper zero");
        flareKeeper = _flareKeeper;
    }
    
    function setFlareKeeper(FlareKeeper _flareKeeper) external onlyGovernance {
        require(address(_flareKeeper) != address(0), "flare keeper zero");
        flareKeeper = _flareKeeper;
    }
}
