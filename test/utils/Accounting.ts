import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";

export module FlareNetworkChartOfAccounts {
  export const GENESIS = keccak256(toUtf8Bytes("Genesis"));                                       // Asset account representing the Genesis supply; this later may (should) be broken into its constituent parts
  export const BURNED = keccak256(toUtf8Bytes("Burned"));                                         // Asset contra-account of amount of FLR that has been burned
  export const MINTING_AUTHORIZED = keccak256(toUtf8Bytes("MintingAuthorized"));                  // Asset account representing FLR authorized to be minted by Flare Foundation constitution
  export const MINTING_REQUESTED = keccak256(toUtf8Bytes("MintingRequested"));                    // Asset account representing FLR requested to be minted by validators
  export const MINTED = keccak256(toUtf8Bytes("Minted"));                                         // Asset account of FLR minted by validators
  export const MINTING_WITHDRAWN = keccak256(toUtf8Bytes("MintingWithdrawn"));                    // Asset contra-account of FLR withdrawn by minting faucets
  export const FTSO_REWARD_MANAGER_SUPPLY = keccak256(toUtf8Bytes("FtsoRewardManagerSupply"));    // Asset account representing supply of rewardable inflation
  export const FTSO_REWARD_MANAGER_EARNED = keccak256(toUtf8Bytes("FtsoRewardManagerEarned"));    // Asset account of earned rewards not yet claimed
  export const FTSO_REWARD_MANAGER_CLAIMED = keccak256(toUtf8Bytes("FtsoRewardManagerClaimed"));  // Asset account of all claimed rewards
  export const FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS = 
    keccak256(toUtf8Bytes("FlareKeeperSelfDestructProceeds"));
  export const FTSO_REWARD_MANAGER_SELF_DESTRUCT_PROCEEDS = 
    keccak256(toUtf8Bytes("FtsoRewardManagerSelfDestructProceeds"));
  export const FTSO_REWARD_INFLATION_EXPECTED = 
    keccak256(toUtf8Bytes("FtsoRewardInflationExpected"));
  export const FTSO_REWARD_MINTING_UNAUTHORIZED = 
    keccak256(toUtf8Bytes("FtsoRewardMintingUnauthorized"));
  export const FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE = 
    keccak256(toUtf8Bytes("FtsoRewardInflationValidatorPayable"));                                // Liability account representing FLR owed to the network by the validators to fulfill Ftso reward inflation
  export const GENESIS_TOKEN = keccak256(toUtf8Bytes("GenesisToken"));                            // Equity account of flare tokens created at genesis
  export const FTSO_REWARD_INFLATION_TOKEN = keccak256(toUtf8Bytes("FtsoRewardInflationToken"));  // Equity account of flare tokens minted for Ftso inflation rewards
  export const BURNED_TOKEN = keccak256(toUtf8Bytes("BurnedToken"));                              // Equity contra-account of burned flare tokens
}

export module AccountType {
  export const ASSET = 0;
  export const LIABILITY = 1;
  export const EQUITY = 2;
  export const BOGUS = 3;  
}
