# FLR smart contracts repository

Contracts will cover a few building blocks of the network:

1. F asset, including Wrapped FLR.
3. FTSO - oracle contracts.
4. Claim contracts.

## F Asset contracts 
Includes both wrapped FLR (F-FLR) and any F Asset minted on flare network. Contracts will hold balances, vote power delegations and actual vote power of each address per block. Will support minting of new F assets.

## FTSO 
Will enable users to supply F-Asset price feeds and some extra data. FTSO will get actual vote power of each address from the F asset contracts.

## Claim contracts
Will enable claiming of FFLR from a pre allocated pool for FFLR. Users will be eligible to claim tokens based on:
- F assest holdings.
- Supplying FTSO price feeds.

