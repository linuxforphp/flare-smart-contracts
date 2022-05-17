import { Contracts } from "../scripts/Contracts";
import {
  GovernedBaseContract,
} from "../../typechain-truffle";

/**
 * This test assumes a chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`transfer-governance.ts system tests`, async accounts => {
  let contracts: Contracts;
  let parameters: any;
  let GovernedBase: GovernedBaseContract;
  const SHOULD_HAVE_TRANSERED_GOVERNANCE = "Should have transfered governance";

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
    parameters = require("hardhat").getChainConfigParameters(process.env.CHAIN_CONFIG);
    GovernedBase = artifacts.require("GovernedBase");
  });

  async function checkGovernance(contractName: string) {
    // Assemble
    const governedBase = await GovernedBase.at(contracts.getContractAddress(contractName));
    // Act
    const governance = await governedBase.governance();
    // Assert
    assert.equal(governance.toLowerCase(), parameters.governancePublicKey.toLowerCase());
  }

  describe(Contracts.ADDRESS_UPDATER, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.ADDRESS_UPDATER);
    });
  });
  
  describe(Contracts.INFLATION_ALLOCATION, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.INFLATION_ALLOCATION);
    });
  });

  describe(Contracts.FTSO_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FTSO_MANAGER);
    });
  });

  describe(Contracts.FLARE_DAEMON, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FLARE_DAEMON);
    });
  });

  describe(Contracts.INFLATION, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.INFLATION);
    });
  });

  describe(Contracts.FTSO_REWARD_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FTSO_REWARD_MANAGER);
    });
  });    

  describe(Contracts.PRICE_SUBMITTER, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.PRICE_SUBMITTER);
    });
  });      

  describe(Contracts.SUPPLY, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.SUPPLY);
    });
  });      

  describe(Contracts.VOTER_WHITELISTER, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.VOTER_WHITELISTER);
    });
  });

  describe(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER);
    });
  });

  describe(Contracts.DISTRIBUTION_TREASURY, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.DISTRIBUTION_TREASURY);
    });
  });

  describe(Contracts.DISTRIBUTION, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async function() {
      if (!parameters.deployDistributionContract) return this.skip();
      await checkGovernance(Contracts.DISTRIBUTION);
    });
    it("Should not have deployed", async function () {
      if (parameters.deployDistributionContract) return this.skip();
      try {
        await checkGovernance(Contracts.DISTRIBUTION);
        assert.fail('The expected Error was not thrown.');
      } catch (err: any) {
        assert.include(err.message, `${Contracts.DISTRIBUTION} not found`);
      }
    });
  });

  describe(Contracts.FTSO_REGISTRY, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.FTSO_REGISTRY);
    });
  });

  describe(Contracts.WNAT, async () => {
    it(SHOULD_HAVE_TRANSERED_GOVERNANCE, async () => {
      await checkGovernance(Contracts.WNAT);
    });
  });
});
