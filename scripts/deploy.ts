const BN = web3.utils.toBN;
const {time} = require('@openzeppelin/test-helpers');

async function main() {
    // Define accounts in play for the deployment process
    const deployerPrivateKey = "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122";
    const governancePrivateKey = "0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb";
    const deployerAccount = web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
    const governanceAccount = web3.eth.accounts.privateKeyToAccount(governancePrivateKey);

    // Constants
    const FLAREKEEPER_ADDRESS = "0x1000000000000000000000000000000000000002";

    // Wire up the default account that will do the deployment
    web3.eth.defaultAccount = deployerAccount.address;

    // Contract definitions
    const Inflation = artifacts.require("Inflation");
    const RewardManager = artifacts.require("RewardManager");
    const FlareKeeper = artifacts.require("FlareKeeper");
    const WFLR = artifacts.require("WFLR");
    const VPToken = artifacts.require("VPToken");
    const Ftso = artifacts.require("Ftso");

    // Instantiations

    // Inflation contract
    const inflation = await Inflation.new(deployerAccount.address, 10, web3.utils.toWei(BN(100000000000)));
    console.log("Inflation contract: ", inflation.address);

    // RewardManager contract
    // Get the timestamp for the just mined block
    const startTs = await time.latest();
    const rewardManager = await RewardManager.new(
      deployerAccount.address,
      inflation.address,
      172800,                      // Reward epoch 2 days
      120,                         // Price epoch 2 minutes
      startTs,
      startTs
    );
    console.log("RewardManager contract: ", rewardManager.address);

    // Initialize the keeper
    const flareKeeper = await FlareKeeper.at(FLAREKEEPER_ADDRESS);
    await flareKeeper.initialise(deployerAccount.address);

    // Register reward manager to the keeper
    await flareKeeper.registerToKeep(rewardManager.address);

    // Register wrapped FLR
    const wflr = await WFLR.new();
    console.log("WFLR contract: ", wflr.address);

    // Register a fakey FXRP until FAsset is in shape
    const fxrp = await VPToken.new("FXRP", "FXRP");
    console.log("FXRP contract: ", fxrp.address);

    // Register an initial FTSO
    // TODO: what is supposed to be the composition of these for the private beta?
    const ftsoFXRPFLR = await Ftso.new(wflr.address, fxrp.address, rewardManager.address);
    console.log("FTSO FXRP/FLR contract: ", ftsoFXRPFLR.address);

    // Activate the reward manager
    await rewardManager.activate();

    // Turn over governance
    await flareKeeper.proposeGovernance(governanceAccount.address);
    await rewardManager.proposeGovernance(governanceAccount.address);
    await inflation.proposeGovernance(governanceAccount.address);
    console.log("Deploy complete.");
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });