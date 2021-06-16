# Parameters

## Addresses 

- `flareKeeperAddress` - Flare keeper contract address. It is deployed in the genesis block with the fixed address "0x1000000000000000000000000000000000000002".
- `priceSubmitterAddress` - Price submiter contract address. It is deployed to the genesis block with the fixed address  "0x1000000000000000000000000000000000000003".

## Private keys
- `deployerPrivateKey` - deployer private key. Overriden if provided in `.env` file as `DEPLOYER_PRIVATE_KEY`
- `genesisGovernancePrivateKey` - genesis governance private key. Overriden if set in `.env` file as `GENESIS_GOVERNANCE_PRIVATE_KEY`. // TODO HOW TO OBTAIN IT.
- `governancePrivateKey` - governance private key. Overriden if provided in `.env` file as `GOVERNANCE_PRIVATE_KEY`. The key to which governance is transfered after deploy.

## Inflation settings

- `ftsoInflationAuthorizationRequestFrequencySec` - 14400,   // TOOD
- `ftsoRewardMintingFaucetFundWithdrawTimeLockSec` - 225,    // TODO
- `ftsoRewardMintingFundRequestIntervalSec` - 20,            // TODO
- `totalFlrSupply` - total supply of FLR. The value of this parameter is usually 100000000000.
- `inflationPercentageBips` - 1000                          // TODO

## FTSO system settings 

- `rewardEpochDurationSec` - reward epoch duration. Usuall it is 2-3 days, for test purposes we recommend 7 mins, hence 420s.
- `revealEpochDurationSec` - reveal epoch duration. Default is 90s. Usually should be at most half of `priceEpochDurationSec`.
- `priceEpochDurationSec` - price epoch duration. Default is 180s.
- `rewardEpochsStartDelayInHours` - ofset of the start of reward epochs according to the time of deploy in hours. Could be decimal number in hours. Default is 0.17 which is about 10 mins.
- `votePowerBoundaryFraction` - defines interval from which vote power block is randomly selected for a new reward epoch at reward epoch finalization. Say the value is 7 (which is default). Then the interval of block numbers from the start block of last reward epoch to the current block number is taken, divided in 7 equal subintervals and the vote power block for the next reward epoch is chosen from this interval. In case the `rewardEpochDurationSec` is 7 days, this would imply the choice of vote power block from the last day of the reward epoch that is being finalized.
- `minVotePowerFlrThreshold` - 10000000000,  // TODO
- `minVotePowerAssetThreshold` - 10000000000 // TODO
- `maxVotePowerFlrThreshold` - 10 // TODO
- `maxVotePowerAssetThreshold` - 10 // TODO
- `lowAssetUSDThreshold` -  200000000 // TODO
- `highAssetUSDThreshold` - 3000000000 // TODO
- `highAssetTurnoutBIPSThreshold` - 100 // TODO
- `lowFlrTurnoutBIPSThreshold` -  300,
- `rewardFeePercentageUpdateOffset` - 3, // TODO
- `defaultRewardFeePercentage` - 0 // TODO
- `rewardExpiryOffset` -  100 // TODO
- `trustedAddresses`- // TODO
- `initialWflrPrice` - initial price of FLR currency on deploy. Usually 0.   

## Currency settings

Each currency definition is under it symbol's key. For example we have
```
  "XRP": {
      "fAssetName": "Flare Asset XRP",
      "fAssetSymbol": "FXRP",
      "fAssetDecimals": 6,
      "dummyFAssetMinterMax": 7000000000,
      "initialPrice": 0
  },
```

- `fAssetName` - FAsset name
- `fAssetSymbol` - Fasset symbol
- `fAssetDecimals` - number of decimals 
- `dummyFAssetMinterMax` - maximal amount that can be minted (integer numbers including decimals. Eg. if `fAssetDecimals` equals 3, then for 3 currency units we write `1000`)
- `initialPrice` - price in dollars. The convention is that prices are posted with 5 decimals, so 1$ = 100000 // TODO

# Comments on parameters

XRP: 1 drop = 0.000001 XRP
LTC: 1 litoshi = 0.00000001 LTC
XDG: 1 shibe = 0.00000001 XDG (smallest unit name is uncertain; 10^-8 seems correct )

Mint max is roughly set to $10,000 per coin
These parameters derived from: https://docs.google.com/document/d/1r2e2i9WkfHDZuesDWPoXGNFnOQEwxOBdyZUtLZk7tWA/edit#
