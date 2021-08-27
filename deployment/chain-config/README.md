# Parameters

All numeric parameter names have units appended at the end. Most unit names are self explanatory, but some are a bit less obvious:

- `BIPS`: 1/100th of a percent (i.e. `1/10000`) - always used for percentages
- `USDDec5` scaled USD value: USD value multiplied by 10^5
- `Fraction`: actual value is some total value (depends on context), divided by parameter's value
- `Epochs`: always reward epochs

## Addresses 

- `stateConnectorAddress` - 
    State connector contract address. State connector is deployed in the genesis block at fixed address "0x1000000000000000000000000000000000000001".

- `flareDaemonAddress` - 
    Flare daemon contract address. It is deployed in the genesis block with the fixed address "0x1000000000000000000000000000000000000002".

- `priceSubmitterAddress` - 
    Price submiter contract address. It is deployed to the genesis block with the fixed address  "0x1000000000000000000000000000000000000003".

- `burnAddress` - 
    Burn address. Used by Supply contract to track burned Native token. Always "0x0000000000000000000000000000000000000000".

## Private keys
- `deployerPrivateKey` - 
    deployer private key. Overriden if provided in `.env` file as `DEPLOYER_PRIVATE_KEY`

- `genesisGovernancePrivateKey` - 
    genesis governance private key (the key used as governance during deploy). 
    Overriden if set in `.env` file as `GENESIS_GOVERNANCE_PRIVATE_KEY`. 
    // TODO HOW TO OBTAIN IT.

- `governancePrivateKey` - 
    governance private key (the key to which governance is transfered after deploy). 
    Overriden if provided in `.env` file as `GOVERNANCE_PRIVATE_KEY`. The key to which governance is transfered after deploy.

## Daemon settings

- `flareDaemonGasExceededHoldoffBlocks` - 
    The number of blocks a daemon called contract is skipped if it consumes more than its alloted amount of gas.

## Inflation settings

- `inflationPercentageBIPS` - 
    Yearly inflation in BIPS. Usual value is 1000 (10%).

## Supply settings
- `totalFlareSupplyFLR` - 
    Initial total supply of FLR (in whole native units, not Wei). The value of this parameter is usually 100000000000.

- `totalFoundationSupplyFLR` - 
    non circulating supply that the foundation holds.

## FTSO system settings 

- `rewardEpochDurationSeconds` - 
    Reward epoch duration, in seconds. In production it is 2-7 days (172800-604800 seconds), but for test purposes it's much smaller e.g. 3-7 minutes.

- `revealEpochDurationSeconds` - 
    Reveal epoch duration, in seconds. Usually, it should be at most half of `priceEpochDurationSeconds` (90 seconds).

- `priceEpochDurationSeconds` - 
    Price epoch duration, in seconds. Typical production value is 180 seconds (3 minutes).

- `rewardEpochsStartDelayPriceEpochs` - 
    Offset of the start of reward epochs from the time of deploy, in number of price epochs. Typical production value is 3, so first reward epoch starts after `rewardEpochsStartDelayPriceEpochs * priceEpochDurationSeconds + revealEpochDurationSeconds` (10.5 minutes).

- `votePowerIntervalFraction` - 
    Defines interval from which vote power block is randomly selected as a fraction of previous reward epoch. 
    The new vote power block is randomly chosen during finalization block from the last
    `(finalization_block_number - start_epoch_block_number) / votePowerIntervalFraction`
    blocks. Larger value of `votePowerIntervalFraction` means shorter interval, which gives 'fresher' vote power block, but less chance for randomization.
    For example, if `votePowerIntervalFraction=7` and reward epoch duration is 7 days, vote power block is chosen from the last day of the epoch being finalized.

- `defaultVoterWhitelistSize` - 
    Inital size for voter whitelist for price submission. It can later be changed for each FTSO by the governance.

- `maxVotePowerNatThresholdFraction` - 
    Defines high threshold for native token vote power when revealing a price vote. The actual max threshold is calculated as 
    `total_NAT_vote_power / maxVotePowerNatThresholdFraction`. 
    Any provider's native token vote power is capped to this max threshold when revealing a price vote. 

- `maxVotePowerAssetThresholdFraction` - Defines high threshold for asset vote power when revealing a price vote. 
    The actual max threshold is calculated as `total_NAT_vote_power / maxVotePowerNatThresholdFraction`.
    Any provider's asset vote power is capped to this max threshold when revealing a price vote. 

- `lowAssetThresholdUSDDec5` - 
    Low threshold for asset USD value (in scaled USD: 1 USD = 10^5 USDDec5).
    Determines the weight ratio between native token and asset vote power.
    Total asset vote power below *lowAssetThreshold* means that only native token vote power is used.
    For values between *lowAssetThreshold* and *highAssetThreshold*, the asset vote power ratio scales linearly from 5% to 50%.
    For values above *highAssetThreshold* the asset vote power ratio is 50%.
    For test purposes we recommend setting `lowAssetThresholdUSDDec5` to 200000000.

- `highAssetThresholdUSDDec5` - 
    High threshold for asset USD value (in scaled USD: 1 USD = 10^5 USDDec5). See above for explanation.
    For test purposes we recommend setting `highAssetThresholdUSDDec5` to 3000000000.

- `highAssetTurnoutThresholdBIPS` - 
    Threshold for high asset turnout (in BIPS relative to total asset vote power). If the asset vote power turnout
    is below highAssetTurnoutThreshold, the asset weight based on total asset USD value (as calculated above)
    is multiplied by `actual_asset_turnout_BIPS / highAssetTurnoutThresholdBIPS`.
    For test purposes we recommend 100.

- `lowNatTurnoutThresholdBIPS` - 
    Threshold for low native token turnout (in BIPS relative to total native token supply).
    If the turnout is smaller than this parameter, only votes from trusted addresses are used to determine the price.
    For test purposes we recommend 300.

- `trustedAddresses`- 
    The list of addresses used for voting when native token turnout is below *lowNatTurnoutThreshold* or when price deviation is too big.

- `rewardFeePercentageUpdateOffsetEpochs` - 
    Reward fee percentage update timelock measured in reward epochs.
    The parameter determines in how many reward epochs the new fee percentage submitted by a data provider becomes effective. 
    For test purposes we recommend 3.

- `defaultRewardFeePercentageBIPS` - 
    Default value for fee percentage, in BIPS. 
    If a data provider does not change the fee percentage, this is the default percentage used for fee deduction. 
    When set to 0, this means there is no fee.
    
- `ftsoRewardExpiryOffsetDays` -
    Reward expiry time in days. After this many days reward epoch funds expire and can not be claimed any more. 
    If expiry value is 90 days and reward epoch length is 10 days, any reward epoch that was opened more then 90 days ago will expire. 

- `validatorRewardExpiryOffsetEpochs` - 
    The duration after which old reward epochs will expire, as a number of reward epochs.
    For test purposes we recommend 100, so if current reward epoch is 120, reward epochs 20 and below will expire.

- `initialWnatPriceUSD5Dec` -
    The USD price of Native at deploy time (in scaled USD: 1 USD = 10^5 USDDec5). 
    Usually 0, which means that the useful starting price is obtained after first voting.

## Currency settings

Each currency definition is under it symbol's key. For example we have
```
  "XRP": {
      "assetName": "Flare Asset XRP",
      "assetSymbol": "FXRP",
      "assetDecimals": 6,
      "dummyAssetMinterMax": 7000000000,
      "initialPriceUSD5Dec": 0
  },
```

- `assetName` - 
    Full asset name

- `assetSymbol` - 
    Asset symbol

- `assetDecimals` - 
    Number of decimals 

- `dummyAssetMinterMax` - 
    Maximal amount that can be minted (integer numbers including decimals. Eg. if `assetDecimals` equals 3, then for 3 currency units we write `1000`)
    
- `initialPriceUSD5Dec` - 
    Initial price in dollars. The convention is that prices are posted with 5 decimals, so 1$ = 100000 // TODO

# Comments on parameters

XRP: 1 drop = 0.000001 XRP
LTC: 1 litoshi = 0.00000001 LTC
XDG: 1 shibe = 0.00000001 XDG (smallest unit name is uncertain; 10^-8 seems correct )

Mint max is roughly set to $10,000 per coin
These parameters derived from: https://docs.google.com/document/d/1r2e2i9WkfHDZuesDWPoXGNFnOQEwxOBdyZUtLZk7tWA/edit#
