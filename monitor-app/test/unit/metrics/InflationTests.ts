import { expect } from "chai";
import { Gauge, register } from "prom-client";
import { 
  makeLastAuthorizationTsGauge, 
  makeRewardEpochStartTsGauge,
  makeCurrentAnnumEndTimeStampGauge } from "../../../src/metrics";
import { ethers } from "hardhat";
import { 
  Inflation, 
  Inflation__factory, 
  MockContract, 
  MockContract__factory } from "../../../typechain";

let mockContract: MockContract;
let mockInflationContract: Inflation;

beforeEach(async() => {
  // Deploy mock contract
  const signers = await ethers.getSigners();
  const mockContractFactory = new MockContract__factory(signers[0]);
  mockContract = await mockContractFactory.deploy();
  await mockContract.deployed();
  // Start with fresh metrics register
  register.clear();
  const inflationFactory = new Inflation__factory(signers[0]);
  // Make our mock Inflation
  mockInflationContract = inflationFactory.attach(mockContract.address);
});

describe("InflationTests.ts -> LastAuthorizationTsGauge.ts", () => {
  let gauge: Gauge<string>;
  let lastAuthorizationTs: string;

  before(async() => {
    lastAuthorizationTs = Inflation__factory.createInterface().getSighash("lastAuthorizationTs()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked Inlfation
    gauge = makeLastAuthorizationTsGauge(mockInflationContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(lastAuthorizationTs, 0);
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record the last authorization timestamp when collected", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(lastAuthorizationTs, 1);

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(1);
  });
});

describe("InflationTests.ts -> RewardEpochStartTsGauge.ts", () => {
  let gauge: Gauge<string>;
  let rewardEpochStartTs: string;

  before(async() => {
    rewardEpochStartTs = Inflation__factory.createInterface().getSighash("rewardEpochStartTs()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked Inlfation
    gauge = makeRewardEpochStartTsGauge(mockInflationContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(rewardEpochStartTs, 0);
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record the reward epoch start when collected", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(rewardEpochStartTs, 1);

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(1);
  });
});

/*
// TODO: It is a real bear to encode the return of getCurrentAnnum.
// Test this gauge in a system test maybe?
describe("InflationTests.ts -> CurrentAnnumEndTimeStampGauge.ts", () => {
  let gauge: Gauge<string>;
  let getCurrentAnnum: string;

  before(async() => {
    getCurrentAnnum = Inflation__factory.createInterface().getSighash("getCurrentAnnum()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked Inlfation
    gauge = makeCurrentAnnumEndTimeStampGauge(mockInflationContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    const response = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint16", "uint256", "uint256", []], 
      [0, 0, 0, 0]);
    await mockContract.givenMethodReturn(getCurrentAnnum, response);
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record the reward epoch start when collected", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(rewardEpochStartTs, 1);

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(1);
  });
});
*/