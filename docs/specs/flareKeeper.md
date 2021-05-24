
# Flare Keeper


#### A Block chain system trigger

## Background

The Flare Keeper is a novel system added to the Flare network block chain. It serves as a special system trigger that can be used by a limited set of registered contracts. Some computations on Flare dedicated smart contracts are either too pricey (gas) to compute or have very specific time constraints. Any of these contracts can be registered to the Flare Keeper by a governance address, and be triggered per block. The Trigger will have very high gas limits and will enable computation intensive code to be executed on “system expense”.

## Validator side

The [Flare Keeper] contract will be loaded to the chain in the Genesis block and will have a fixed constant address set by the validator - same as done with pre-compiled contracts. Per state transition, the validator will trigger a defined function on the keeper contract. This call will have a high gas allocation; the number will be fine tuned later on.


## Smart contract side

Each contract that needs a keeper trigger will implement the [Keep Interface]. Per call from the validator, the keeper contract will iterate all registered contracts and trigger each of them. If any of these contracts revert, the keeper will save revert data and continue to the next kept contract.

[Flare Keeper]: ../../contracts/utils/implementation/FlareKeeper.sol "Flare Keeper"
[Keep Interface]: ../../contracts/utils/interfaces/IFlareKeep.sol "Keep interface"
