// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { AccountDefinition, AccountType } from "./AccountingStructs.sol";

library FlareNetworkChartOfAccounts {
    // Accounts
    /* solhint-disable max-line-length */
    bytes32 internal constant GENESIS = keccak256("Genesis");                                       // Asset account representing the Genesis supply; this later may (should) be broken into its constituent parts
    bytes32 internal constant BURNED = keccak256("Burned");                                         // Asset contra-account of amount of FLR that has been burned
    bytes32 internal constant MINTING_AUTHORIZED = keccak256("MintingAuthorized");                  // Asset account representing FLR authorized to be minted by Flare Foundation constitution
    bytes32 internal constant MINTING_REQUESTED = keccak256("MintingRequested");                    // Asset account representing FLR requested to be minted by validators
    bytes32 internal constant MINTED = keccak256("Minted");                                         // Asset account of FLR minted by validators
    bytes32 internal constant MINTING_WITHDRAWN = keccak256("MintingWithdrawn");                    // Asset contra-account of FLR withdrawn by minting faucets
    bytes32 internal constant FTSO_REWARD_MANAGER_SUPPLY = keccak256("FtsoRewardManagerSupply");    // Asset account representing supply of rewardable inflation
    bytes32 internal constant FTSO_REWARD_MANAGER_EARNED = keccak256("FtsoRewardManagerEarned");    // Asset account of earned rewards not yet claimed
    bytes32 internal constant FTSO_REWARD_MANAGER_CLAIMED = keccak256("FtsoRewardManagerClaimed");  // Asset account of all claimed rewards
    bytes32 internal constant FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS = 
        keccak256("FlareKeeperSelfDestructProceeds");                                               // Asset account to receive proceeds if keeper is self-destruct recipient
    bytes32 internal constant FTSO_REWARD_MANAGER_SELF_DESTRUCT_PROCEEDS = 
        keccak256("FtsoRewardManagerSelfDestructProceeds");                                         // Asset account to receive proceeds if Ftso reward manager is self-destruct recipient
    bytes32 internal constant FTSO_REWARD_INFLATION_EXPECTED =                                      // Asset account to hold suspense of ftso reward annual inflation approved at annum begin by governance. 
        keccak256("FtsoRewardInflationExpected");
    bytes32 internal constant FTSO_REWARD_MINTING_UNAUTHORIZED = 
        keccak256("FtsoRewardMintingUnauthorized");                                                 // Asset contra-account to net against ftso inflation expected. These two accounts should always net to zero.
    bytes32 internal constant FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE =
        keccak256("FtsoRewardInflationValidatorPayable");                                           // Liability account representing FLR owed to the network by the validators to fulfill Ftso reward inflation
    bytes32 internal constant GENESIS_TOKEN = keccak256("GenesisToken");                            // Equity account of flare tokens created at genesis
    bytes32 internal constant FTSO_REWARD_INFLATION_TOKEN = keccak256("FtsoRewardInflationToken");  // Equity account of flare tokens minted for Ftso inflation rewards
    bytes32 internal constant BURNED_TOKEN = keccak256("BurnedToken");                              // Equity contra-account of burned flare tokens
    /* solhint-enable max-line-length */

    // Formulae
    // inflatable supply = 
    //     GenesisToken + FtsoRewardInflationToken + FtsoRewardInflationValidatorPayable + BurnedToken(contra)
    // ftso reward manager balance = 
    //     FtsoRewardManagerSupply + FtsoRewardManagerEarned + FtsoRewardManagerSelfDestructProceeds
    // earned but unclaimed ftso rewards = FtsoRewardManagerEarned
    // on-chain supply = GenesisToken + FtsoRewardInflationToken + BurnedToken(contra)
    // annum inflation remaining to be rewarded =
    //     FtsoRewardInflationExpected - FtsoRewardManagerEarned - FtsoRewardManagerClaimed
    // keeper contract balance = FtsoMinted + FtsoMintingWithdrawn(contra) + FlareKeeperSelfDestructProceeds

    function getAccountDefinitions() internal pure returns (AccountDefinition[] memory _accountDefinitions) {
        _accountDefinitions = new AccountDefinition[](17);
        _accountDefinitions[0] = AccountDefinition({ name: GENESIS, accountType: AccountType.ASSET });
        _accountDefinitions[1] = AccountDefinition({ name: BURNED, accountType: AccountType.ASSET });
        _accountDefinitions[2] = AccountDefinition({ name: MINTING_AUTHORIZED, accountType: AccountType.ASSET });
        _accountDefinitions[3] = AccountDefinition({ name: MINTING_REQUESTED, accountType: AccountType.ASSET });
        _accountDefinitions[4] = AccountDefinition({ name: MINTED, accountType: AccountType.ASSET });
        _accountDefinitions[5] = AccountDefinition({ name: MINTING_WITHDRAWN, accountType: AccountType.ASSET });
        _accountDefinitions[6] = AccountDefinition({ 
            name: FTSO_REWARD_MANAGER_SUPPLY, 
            accountType: AccountType.ASSET });
        _accountDefinitions[7] = AccountDefinition({ 
            name: FTSO_REWARD_MANAGER_EARNED, 
            accountType: AccountType.ASSET });
        _accountDefinitions[8] = AccountDefinition({ 
            name: FTSO_REWARD_MANAGER_CLAIMED, 
            accountType: AccountType.ASSET });
        _accountDefinitions[9] = AccountDefinition({
            name: FTSO_REWARD_INFLATION_EXPECTED,
            accountType: AccountType.ASSET });
        _accountDefinitions[10] = AccountDefinition({
            name: FTSO_REWARD_MINTING_UNAUTHORIZED,
            accountType: AccountType.ASSET });
        _accountDefinitions[11] = AccountDefinition({ 
            name: FTSO_REWARD_INFLATION_VALIDATOR_PAYABLE, 
            accountType: AccountType.LIABILITY });
        _accountDefinitions[12] = AccountDefinition({ name: GENESIS_TOKEN, accountType: AccountType.EQUITY });
        _accountDefinitions[13] = AccountDefinition({ 
            name: FTSO_REWARD_INFLATION_TOKEN, 
            accountType: AccountType.EQUITY });
        _accountDefinitions[14] = AccountDefinition({ name: BURNED_TOKEN, accountType: AccountType.EQUITY });
        _accountDefinitions[15] = AccountDefinition({ 
            name: FLARE_KEEPER_SELF_DESTRUCT_PROCEEDS, 
            accountType: AccountType.ASSET });
        _accountDefinitions[16] = AccountDefinition({ 
            name: FTSO_REWARD_MANAGER_SELF_DESTRUCT_PROCEEDS, 
            accountType: AccountType.ASSET });
    }
}
