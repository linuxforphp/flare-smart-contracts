
# Introduction

**FTSO manager** is a smart contract that manages the following aspects of FTSO system.

- Maintains the list of rewarded FTSOs.
- Is beeing triggered by Keeper contract.
- Accepts calls from governance contract to add or remove rewarded FTSOs,
- Accepts calls from governance contract to change FTSO governance parameters,
- Sets FTSO governance parameters to FTSOs at appropriate time;
- Sets vote power blocks to FTSOs at appropriate times;
- Manages the definition and lifecycle of reward epochs, including initialization, finalizations and the definitions of vote power blocks.
- Manages the definition and lifecycle of price epochs, which include initialization, FTSO finalizations,  determination of rewards, triggering their distribution by Reward manager, and initializations of price reveal epochs immediately after the corresponding price epoch ends.

**Reward manager** is a smart contract that manages the following aspects of FTSO system.

- Maintains the reward balances of data providers.
- Enables data providers to be able to claim the rewards (transfer them to their accounts).
- Currently is not time triggered (by Keeper contract),

**Reward period** is an interval on block numbers defined by *start block number* and ending just before the start block of the next reward period. Each reward period is initialized by defining its start block number and the randomly chosen *vote power block* from previous reward period. Records of the sequence of pairs `(startBlock, votePowerBlock)` are maintained in the list on FTSO manager contract. The first reward period is initialized separately and typically `startBlock == votePowerBlock`. Duration of reward period is defined by a parameter `rewardEpochDurationSec` on FTSO manager contract. First epoch starts at `rewardEpochsStartTs`. Immediately after reward period expires, keeper contract triggers reward epoch finalization on FTSO contract, which initializes next reward epoch (`currentRewardEpoch`) and defines a `votePowerBlock` from the just expired reward epoch. Vote power block is used in finalization of price epoch to determine weights for weighted median calculation. Reward epochs are finalized based on times in `block.timestamp` but are defined in block numbers.

**Price period** is an interval on blocks in which prices to oracles are submitted as hashs of price and random number. Duration of price period is defined by parameter `priceEpochDurationSec` on FTSO manager contract. Count of price periods starts at timestamp `firstPriceEpochStartTs`. Each price period has unique id, which is its position in sequence of price periods starting from `firstPriceEpochStartTs`, where id of the first price period is 0. At the start of the next price period, the last one is finalized and the new epoch is started. The finalization of price period is triggered on all rewarded FTSO contracts by FTSO manager (which in turn is triggered by Keeper contract). Finalization calculates weighted median prices of all rewarded FTSOs. In addition FTSO manager randomly chooses the single rewarded FTSO for the finalized price epoch and obtains rewarded data provider addresses (and weights). Those are passed to Reward manager contract through `distributeRewards` to actually trigger distribution of the rewards. Results of a price period for each FTSO are stored on corresponding FTSO contracts. Each particular price epoch instance object holds a result of price epoch finalization for the corresponding price epoch id. The price epoch instance for an epoch is initialized at the beginning of the price epoch, that is during finalization of the previous price epoch. The duration of the price periods is usually much shorter than the duration of reward periods. 

**Reveal period** is an interval on blocks that starts immediately after the corresponding price period, hence at the same time as the next price period. Reveal period has its own id which matches to the just expired price period's id. In the reveal period the prices are revealed matching the hashes of prices commited in the corresponding (just expired) price period. Each price reveal by a data provider is added to the linked list of price votes. On reveal, vote power of a data provider in regard to the vote power block of the current reward epoch is calculated and stored into the Vote structure. Vote structures are maintained in the linked list, while pointers to the first and last Vote are maintaind in price epoch instance object. The duration of the reveal period is usually much shorter that the duration of the price period. Reveal periods are contained in price periods, where the start of a reveal period matches the start of the next price period.

# Initialization sequence

- `Keeper`, `Inflation` and `Governance` contracts are usually already deployed on the blockchain.
- First, `RewardManager` is deployed, initialized by `Inflation` contract.
- Then `FtsoManager` contract is deployed, initialized by the address fo the `RewardManager` contract in constructor.
- Then API `setFTSOManager(ftsoManagerAddress)` is called to fully link `FTSOManager` contract with `RewardManager` contract.
- Then reward manager is activated.
- Then, before adding any FTSO, governance must at least once initialize governance parameters for FTSOs by calling API `setGovernanceParameters(...)`.
- Typically then FTSO contracts are deployed and FAsset can be added to single asset FTSO by calling `setFtsoFAsset(fAsset)` or a list of FTSOs can be added to multi asset FTSO by calling `setFtsoFAssetFtsos(fAssetFtsos)`.
- Then FTSO contracts are added to `FTSOManager` contract by calling API `addFtso(ftso)`.
- Then everything is ready to activate `FTSOManager` contract by calling API `activate()`. This starts applying triggering to `FTSOManager` contract by `Keeper` contract.
- Later new FTSO contracts can be deployed and added to `FTSOManager` contract. Some can be also removed by calling API `removeFtso(ftso)`)

# Operations

`FTSOManager` contract can be deactivated by calling API `deactivate()`. This stops periodic reward epochs finalizations, price epoch finalizations and initializations of price epoch instance objects. WARNING: the mechanism of how the system behaves after that is not yet fully defined.

`RewardManager` contract can also be deactivated, which basically means that claiming awards is blocked. It is again possible, when the contract is activate (`activate()`). Deactivated `RewardManager` contract still accepts calls to `distributeRewards(...)` API and distributes the rewards. 






