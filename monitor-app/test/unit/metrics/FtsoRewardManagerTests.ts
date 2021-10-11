import { expect } from "chai";
import { Gauge, register } from "prom-client";
import { 
  makeTotalUnclaimedAwardsOutstandingNatGauge } from "../../../src/metrics";
import { ethers } from "hardhat";
import { 
  FtsoRewardManager, 
  FtsoRewardManager__factory,
  MockContract, 
  MockContract__factory } from "../../../typechain";

let mockContract: MockContract;
let mockFtsoRewardManagerContract: FtsoRewardManager;

beforeEach(async() => {
  // Deploy mock contract
  const signers = await ethers.getSigners();
  const mockContractFactory = new MockContract__factory(signers[0]);
  mockContract = await mockContractFactory.deploy();
  await mockContract.deployed();
  // Start with fresh metrics register
  register.clear();
  const ftsoRewardManagerFactory = new FtsoRewardManager__factory(signers[0]);
  // Make our mock FtsoRewardManager
  mockFtsoRewardManagerContract = ftsoRewardManagerFactory.attach(mockContract.address);
});

describe("InflationTests.ts -> LastAuthorizationTsGauge.ts", () => {
  let gauge: Gauge<string>;
  let totalAwardedWei: string;
  let totalClaimedWei: string;
  let totalExpiredWei: string;

  before(async() => {
    totalAwardedWei = FtsoRewardManager__factory.createInterface().getSighash("totalAwardedWei()");
    totalClaimedWei = FtsoRewardManager__factory.createInterface().getSighash("totalClaimedWei()");
    totalExpiredWei = FtsoRewardManager__factory.createInterface().getSighash("totalExpiredWei()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked Inlfation
    gauge = makeTotalUnclaimedAwardsOutstandingNatGauge(mockFtsoRewardManagerContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(totalAwardedWei, 0);
    await mockContract.givenMethodReturnUint(totalClaimedWei, 0);
    await mockContract.givenMethodReturnUint(totalExpiredWei, 0);
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record unclaimed rewards outstanding when collected", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(totalAwardedWei, ethers.utils.parseEther("100"));
    await mockContract.givenMethodReturnUint(totalClaimedWei, ethers.utils.parseEther("10"));
    await mockContract.givenMethodReturnUint(totalExpiredWei, ethers.utils.parseEther("20"));

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(70);
  });
});
