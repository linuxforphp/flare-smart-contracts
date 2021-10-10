import { expect } from "chai";
import { Gauge, register } from "prom-client";
import { 
  makeMintingOutstandingNatGauge, 
  makeSystemLastTriggeredAtGauge,
  makeBlockHoldoffsRemainingGauge, 
  makeTotalDaemonizedErrorsGauge,
  makeSystemLastTriggeredAtTsGauge} from "../../../src/metrics";
import { ethers } from "hardhat";
import { 
  FlareDaemon, 
  FlareDaemon__factory, 
  MockContract, 
  MockContract__factory } from "../../../typechain";

const time = require('@openzeppelin/test-helpers').time;

let mockContract: MockContract;
let mockFlareDaemonContract: FlareDaemon;

beforeEach(async() => {
  // Deploy mock contract
  const signers = await ethers.getSigners();
  const mockContractFactory = new MockContract__factory(signers[0]);
  mockContract = await mockContractFactory.deploy();
  await mockContract.deployed();
  // Start with fresh metrics register
  register.clear();
  const flareDaemonFactory = new FlareDaemon__factory(signers[0]);
  // Make our mock FlareDaemon
  mockFlareDaemonContract = flareDaemonFactory.attach(mockContract.address);
});

describe("FlareDaemonTests.ts -> SystemLastTriggeredAtGauge.ts", () => {
  let gauge: Gauge<string>;
  let systemLastTriggeredAt: string;

  before(async() => {
    systemLastTriggeredAt = FlareDaemon__factory.createInterface().getSighash("systemLastTriggeredAt()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked FlareDaemon
    gauge = makeSystemLastTriggeredAtGauge(mockFlareDaemonContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(systemLastTriggeredAt, 0);
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record the system last triggered at when collected", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(systemLastTriggeredAt, 1);

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(1);
  });
});

describe("FlareDaemonTests.ts -> SystemLastTriggeredAtTsGauge.ts", () => {
  let gauge: Gauge<string>;
  let systemLastTriggeredAt: string;

  before(async() => {
    systemLastTriggeredAt = FlareDaemon__factory.createInterface().getSighash("systemLastTriggeredAt()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked FlareDaemon
    gauge = makeSystemLastTriggeredAtTsGauge(mockFlareDaemonContract);
  });

  it("Should record the timestamp system last triggered at when collected", async () => {
    // Assemble
    // Force hardhat to mine a block
    await time.advanceBlock();
    // Get the timestamp of the latest mined block
    const latestTs = await time.latest();
    // Get the latest mined block number
    const latestBlock = await time.latestBlock();
    // Shim up the flareDaemon to return the latest mined block number
    await mockContract.givenMethodReturnUint(systemLastTriggeredAt, latestBlock.toNumber());

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(latestTs.toNumber());
  });
});

describe("FlareDaemonTests.ts -> MintingOutstandingGauge.ts", () => {
  let gauge: Gauge<string>;
  let totalMintingRequestedWei: string;
  let totalMintingReceivedWei: string;

  before(async() => {
    const flareDaemonInterface = FlareDaemon__factory.createInterface();
    totalMintingRequestedWei = flareDaemonInterface.getSighash("totalMintingRequestedWei()");
    totalMintingReceivedWei = flareDaemonInterface.getSighash("totalMintingReceivedWei()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked FlareDaemon
    gauge = makeMintingOutstandingNatGauge(mockFlareDaemonContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(totalMintingRequestedWei, 0);
    await mockContract.givenMethodReturnUint(totalMintingReceivedWei, 0);
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record minting outstanding when collected", async () => {
    // Assemble
    await mockContract.givenMethodReturnUint(totalMintingRequestedWei, ethers.utils.parseEther("100"));
    await mockContract.givenMethodReturnUint(totalMintingReceivedWei, ethers.utils.parseEther("10"));

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(90);
  });  
});

describe("FlareDaemonTests.ts -> BlockHoldoffsRemainingGauge.ts", () => {
  let gauge: Gauge<string>;

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked FlareDaemon
    gauge = makeBlockHoldoffsRemainingGauge(mockFlareDaemonContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    const flareDaemonInterface = FlareDaemon__factory.createInterface();
    const daemonizedContractsData = flareDaemonInterface.getSighash("getDaemonizedContractsData()");
    // Solidity returns the following for this call:
    //  returns(
    //    IFlareDaemonize[] memory _daemonizeContracts,
    //    uint256[] memory _gasLimits,
    //    uint256[] memory _blockHoldoffsRemaining
    //  )
    const daemonizedConractsDataReturn = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'uint256[]'], 
      [[ethers.constants.AddressZero], [0], [0]]
    );
    await mockContract.givenCalldataReturn(daemonizedContractsData, daemonizedConractsDataReturn)
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record block holdoffs remaining when collected", async () => {
    // Assemble
    const flareDaemonInterface = FlareDaemon__factory.createInterface();
    const daemonizedContractsData = flareDaemonInterface.getSighash("getDaemonizedContractsData()");
    // Solidity returns the following for this call:
    //  returns(
    //    IFlareDaemonize[] memory _daemonizeContracts,
    //    uint256[] memory _gasLimits,
    //    uint256[] memory _blockHoldoffsRemaining
    //  )
    const daemonizedConractsDataReturn = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'uint256[]'], 
      [[ethers.constants.AddressZero], [0], [1]] // <-- Block hold off should return 1
    );
    await mockContract.givenCalldataReturn(daemonizedContractsData, daemonizedConractsDataReturn)

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(1);
  });
});

describe("FlareDaemonTests.ts -> TotalDaemonizedErrorsGauge.ts", () => {
  let gauge: Gauge<string>;
  let showLastDaemonizedError: string;

  before(async() => {
    const flareDaemonInterface = FlareDaemon__factory.createInterface();
    showLastDaemonizedError = flareDaemonInterface.getSighash("showLastDaemonizedError()");
  });

  beforeEach(async() => {
    // Factory up a gauge under test with our mocked FlareDaemon
    gauge = makeTotalDaemonizedErrorsGauge(mockFlareDaemonContract);
  });

  it("Should make gauge", async () => {
    // Assemble
    const response = ethers.utils.defaultAbiCoder.encode(
      ["uint256[]", "uint256[]", "string[]", "address[]", "uint256"], 
      [[], [], [], [], 0]);
    await mockContract.givenMethodReturn(showLastDaemonizedError, response);
    // Act
    // Assert
    expect(await register.getMetricsAsJSON()).to.have.length(1);
  });

  it("Should record total daemonized errors when collected", async () => {
    // Assemble
    const response = ethers.utils.defaultAbiCoder.encode(
      ["uint256[]", "uint256[]", "string[]", "address[]", "uint256"], 
      [[], [], [], [], 1]);
    await mockContract.givenMethodReturn(showLastDaemonizedError, response);

    // Act
    const result = await (gauge as any).get();

    // Assert
    expect(result.values[0].value).to.equal(1);
  });  
});
