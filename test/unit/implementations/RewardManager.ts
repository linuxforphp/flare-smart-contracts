// tools
import { ethers } from "hardhat";
import { expect } from "chai";
const getTestFile = require('../../utils/constants').getTestFile;
import { solidity } from "ethereum-waffle";

// contracts under test
import { Governed } from "../../../typechain";
import { RewardManager } from "../../../typechain";

// wire up tools
chai.use(solidity);

describe(`RewardManager.sol; ${getTestFile(__filename)}; Reward manger unit tests`, () => {
  let rewardManager: RewardManager;
  let governed: Governed;

  beforeEach(async() => {
    const signers = await ethers.getSigners();

    // Wire up governance dependency
    const governedFactory = await ethers.getContractFactory(
      "Governed",
      signers[0]
    );
    governed = (await governedFactory.deploy(signers[0])) as Governed;
    await governed.deployed();
    
    // Now get contract under test ready
    const rewardManagerFactory = await ethers.getContractFactory(
      "RewardManager",
      signers[0]
    );

    // Get the timestamp for the current block
    let now = (await ethers.provider.getBlock(ethers.provider.getBlockNumber())).timestamp;

    // This will need to be parameterized for different timing calc tests
    rewardManager = (await rewardManagerFactory.deploy(
      governed,
      signers[0],
      172800000,                      // Reward epoch 2 days
      120000,                         // Price epoch 2 minutes
      now,
      now
    )) as RewardManager;
    await rewardManager.deployed();
  });

  it("Should keep without an FTSO", async() => {
    await rewardManager.keep();
  });
});
