import { pascalCase } from 'pascal-case';
import {
  FtsoInstance
} from "../../typechain-truffle";
import { Contracts } from "../scripts/Contracts";

const parameters = require(`../chain-config/${process.env.CHAIN_CONFIG}.json`);
const Ftso = artifacts.require("Ftso");

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 */
contract(`deploy-ftso-block-height.ts system tests`, async accounts => {
  let contracts: Contracts;

  before(async () => {
    contracts = new Contracts();
    await contracts.deserialize(process.stdin);
  });

  for (let blockHeight of parameters.blockHeights) {
    describe(pascalCase(`FTSO ${blockHeight.assetSymbol}`), async () => {
      let ftso: FtsoInstance;

      before(async () => {
        ftso = await Ftso.at(contracts.getContractAddress(`Ftso${pascalCase(blockHeight.assetSymbol)}`));
      });

      it("Should be managed", async () => {
        // Assemble
        // Act
        const ftsoManager = await ftso.ftsoManager();
        // Assert 
        assert.equal(ftsoManager, contracts.getContractAddress(Contracts.FTSO_MANAGER));
      });

      it("Should know about PriceSubmitter", async () => {
        // Assemble
        // Act
        const priceSubmitter = await ftso.priceSubmitter();
        // Assert
        assert.equal(priceSubmitter, contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
      });

      it("Should represent ftso decimals correctly", async () => {
        // Assemble
        // Act
        const decimals = await ftso.ASSET_PRICE_USD_DECIMALS();
        // Assert
        assert.equal(decimals.toNumber(), blockHeight.ftsoDecimals);
      });
    });
  }
});
