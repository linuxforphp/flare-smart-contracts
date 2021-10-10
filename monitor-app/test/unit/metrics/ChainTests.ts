import { expect } from "chai";
import { ethers } from "hardhat";
import { Gauge, register } from "prom-client";
import { BaseProvider } from "@ethersproject/providers";
import { makeBlockNumberGauge, makeCurrentBalanceNatGauge } from "../../../src/metrics";
// @ts-ignore
import { time } from '@openzeppelin/test-helpers';
import { 
  MockContract, 
  MockContract__factory } from "../../../typechain";

describe("ChainTests.ts -> BlockNumberGauge.ts", () => {
  let provider: BaseProvider;
  let gauge: Gauge<string>;

  before(async() => {
    // Get the hardhat ethers provider
    provider = ethers.provider;
  });

  beforeEach(async() => {
    // Start fresh
    register.clear();
    // Factory up a gauge under test
    gauge = makeBlockNumberGauge(provider);
  });

  it("Should make gauge", async () => {
    // Assemble    
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record the current block number when collected", async () => {
    // Assemble
    // Advance block so first block is not zero
    await time.advanceBlock();
    // Get the current block number
    const blockNumber = await provider.getBlockNumber();
    
    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(blockNumber).to.not.equal(0);
    expect(result.values[0].value).to.equal(blockNumber);
  });  
});

describe("ChainTests.ts -> CurrentBalanceNatGauge.ts", () => {
  let mockContract: MockContract;
  let gauge: Gauge<string>;

  beforeEach(async() => {
    // Deploy mock contract
    const signers = await ethers.getSigners();
    const mockContractFactory = new MockContract__factory(signers[0]);
    mockContract = await mockContractFactory.deploy();
    await mockContract.deployed();
    // Start with fresh metrics register
    register.clear();
    // Factory up a gauge under test with our mocked FlareDaemon
    gauge = makeCurrentBalanceNatGauge(mockContract, "mock");
  });
  
  it("Should make gauge", async () => {
    // Assemble    
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record the current balance when collected", async () => {
    // Assemble
    const signers = await ethers.getSigners();
    const params = { to: mockContract.address, value: ethers.utils.parseUnits("1", "ether").toHexString()};
    const txHash = await signers[0].sendTransaction(params);
    await txHash.wait();
    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(1);
  });  
});