# Native token supply contract

## Background
The Supply Contract has two major roles:
- Track inflatable supply
- Track circulating supply

To accomplish this, the contract has to collect data from other contracts.

## Definitions

### Inflatable supply:
The total supply of native tokens that is used to compute recognized inflation for an annum. Inflatable supply will be initialized with the genesis amount of 100 billion native tokens (Flare) or 15 billion (Songbird). Inflatable supply will then be defined as:

genesis amount of native token + total inflation authorized

### Reward Pool:
An amount of on-chain native tokens set aside (foundation allocated funds) added to an amount of authorized inflation (total inflation authorized) for rewarding services.The undistributed reward pool supply for a service is defined as:

foundation allocated funds + total inflation authorized - distributed total for a service

### Foundation supply updates:
The foundation supply is an amount of native tokens with vesting requirements that is not part of a reward pool. The undistributed foundation supply is defined as:

total foundation unvested (undistributed) supply - total foundation vested (distributed) supply

### Circulating supply
The total amount of native tokens in general circulation. Circulating supply is defined as:

inflatable supply - total undistributed supply for all reward pool services - total foundation unvested supply - burned native tokens

## APIs 
- Register reward pool contracts
- Report foundation tokens added to supply (example: vested tokens)
- Daily update trigger
- Change burn address.

## Init
- set governance address
- set burn address
- set inflation address
- set a single number for initial genesis amount (100 or 15 billion)
- set total foundation supply
- set known reward pools

## Register reward pools
The supply contract contains a method called addRewardPool that identifies a rewarding contract. This contract must implement the function getRewardPoolSupplyData() (returns foundation allocated funds, total inflation authorized and total distributed amount) through the interface IIRewardPool.

## Report foundation tokens added to supply
If the foundation ever adds any tokens to supply - like releasing vested tokens not through a contract (not through a pool). Report with this API: dcreaseFoundationSupply().

## Daily checkup (called from inflation contract)
- Call all relevant contracts.
- Update total inflation authorized.
- Add to the circulating supply.
- Read burned tokens from the burn address and update values.

## Change burn address
If the burn address ever needs to be changed, get the last data from the current address and then update values from the new address.

## Governance updates
- Register a new reward pool. Reward pool is deployed and the balance is updated. Done through API call: addRewardPool()
    - Set reward pool address
    - Set the balance to be reduced from foundation supply.
- Foundation reports some tokens were unlocked (team members tokens were released, for example). Done through the API call: decreaseFoundationSupply()
- Change burn address. Done through the API call: changeBurnAddress()
