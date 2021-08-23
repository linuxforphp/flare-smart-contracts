import { FlareDaemonInstance, InflationMockInstance } from "../../typechain-truffle";

const getTestFile = require('../utils/constants').getTestFile;
const BN = web3.utils.toBN;

const parameters = require(`../../deployment/chain-config/${ process.env.CHAIN_CONFIG }.json`)

// inject private keys from .env, if they exist
if (process.env.DEPLOYER_PRIVATE_KEY) {
  parameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
}
if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
  parameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
}
if (process.env.GOVERNANCE_PRIVATE_KEY) {
  parameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
}

/**
 * Test minting interaction between FlareDaemon and validator.
 */
contract(`FlareDaemon.sol; ${getTestFile(__filename)}; Minting system test`, async accounts => {
  // Define accounts in play for the deployment process
  let deployerAccount: any;
  let governanceAccount: any;
  let genesisGovernanceAccount: any;
  let inflationMock: InflationMockInstance;
  let flareDaemon: FlareDaemonInstance;

  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  before(async() => {
    // Back into each account from private key
    try {
      deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
      governanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);
      genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.genesisGovernancePrivateKey);
    } catch (e) {
      throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
    }

    // Wire up the default account that will do the deployment
    web3.eth.defaultAccount = deployerAccount.address;

    // Contract artifact definitions
    const InflationMock = artifacts.require("InflationMock");
    const FlareDaemon = artifacts.require("FlareDaemon");

    inflationMock = await InflationMock.new(deployerAccount.address);

    // Initialize the daemon
    try {
      flareDaemon = await FlareDaemon.at(parameters.flareDaemonAddress);
    } catch (e) {
      console.error("FlareDaemon not in genesis...creating new.")
      flareDaemon = await FlareDaemon.new();
    }
    let currentGovernanceAddress = null;
    try {
      await flareDaemon.initialiseFixedAddress();
      currentGovernanceAddress = genesisGovernanceAccount.address;
    } catch (e) {
      // daemon might be already initialized if redeploy
      // NOTE: unregister must claim governance of flareDaemon!
      currentGovernanceAddress = governanceAccount.address
    }
    await flareDaemon.proposeGovernance(deployerAccount.address, { from: currentGovernanceAddress });
    await flareDaemon.claimGovernance({ from: deployerAccount.address });

    // Set a reference to inflation mock on the daemon
    await flareDaemon.setInflation(inflationMock.address);

    // Set a reference to daemon on inflation mock
    await inflationMock.setFlareDaemon(flareDaemon.address);

    // Allow the inflation mock to receive bigly funds requested
    await inflationMock.setDoNotReceiveNoMoreThan(web3.utils.toWei(BN(100000000000)));
  });
  
  describe("mint", async() => {
    it("Should mint", async() => {
      // Assemble
      const openingBalance = BN(await web3.eth.getBalance(inflationMock.address));
      // Act
      await inflationMock.requestMinting(web3.utils.toWei(BN(50000000)));
      let lastTrigger = await flareDaemon.systemLastTriggeredAt();
      // Wait for the daemon to be triggered again
      while(lastTrigger.eq(await flareDaemon.systemLastTriggeredAt())) {
        // Tickle some state so blocks are finalized and daemon trigger method is called.
        await inflationMock.tick();
        await sleep(1000);
      }
      // Assert
      const closingBalance = BN(await web3.eth.getBalance(inflationMock.address));
      assert(closingBalance.sub(openingBalance).eq(web3.utils.toWei(BN(50000000))));
    });
  });
});
