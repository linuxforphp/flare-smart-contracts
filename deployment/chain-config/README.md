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
- `minVotePowerFlrThreshold` - low threshold factor for FLR vote power when revealing a price vote. Price can be revealed by user whose vote power is at least total vote power divided by minVotePowerFlrThreshold. To make this limitation insignificant, a large number, e.g. 10000000000, can be used.
- `minVotePowerAssetThreshold` - low threshold factor for asset vote power when revealing a price vote. Price can be revealed by user whose vote power is at least total vote power divided by minVotePowerAssetThreshold. To make this limitation insignificant, a large number, e.g. 10000000000, can be used.
- `maxVotePowerFlrThreshold` - high threshold for FLR vote power when revealing a price vote. Price revealed by user with vote power higher than the total vote power divided by maxVotePowerFlrThreshold is trimmed to this value. To make this limitation insignificant, a small number, e.g. 10, can be used.
- `maxVotePowerAssetThreshold` - high threshold for asset vote power when revealing a price vote. Price revealed by user with vote power higher than the total vote power divided by maxVotePowerAssetThreshold is trimmed to this value. To make this limitation insignificant, a small number, e.g. 10, can be used.
- `lowAssetUSDThreshold` - threshold for low asset vote power (in scaled USD). This parameter determines the base weight ratio between FLR and asset vote power. For test purposes we recommend 200000000.
- `highAssetUSDThreshold` - threshold for high asset vote power (in scaled USD). This parameter determines the base weight ratio between FLR and asset vote power. For test purposes we recommend 3000000000.
- `highAssetTurnoutBIPSThreshold` - threshold for high asset turnout (in BIPS). This parameter determines the weight ratio between FLR and asset vote power. For test purposes we recommend 100.
- `lowFlrTurnoutBIPSThreshold` - threshold for low FLR turnout (in BIPS). If the turnout is smaller than this parameter, trusted addresses are used to determine the price. For test purposes we recommend 300.
- `trustedAddresses`- a list of addresses. If `lowFlrTurnoutBIPSThreshold` is not reached, the prices revealed by the addresses from this list are used.
- `rewardFeePercentageUpdateOffset` - reward fee percentage update timelock measured in reward epochs. The parameter determines in how many reward epochs the new fee percentage submitted by a data provider becomes effective. For test purposes we recommend 3.
- `defaultRewardFeePercentage` - default value for fee percentage. If a data provider does not change the fee percentage, this is the default percentage used for fee deduction. When set to 0, this means there is no fee.
- `rewardExpiryOffset` - in number of epochs. For test purposes we recommend 100. so if current reward epoch is 120, reward epochs 20 and below will expire. 
- `rewardExpiryOffsetDays` - After how many days reward epoch funds expire and can not be claimed any more. if expiry value is 90 days and reward epoch length is 10 days. any reward epoch that was opened more then 90 days ago will expire. 

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
