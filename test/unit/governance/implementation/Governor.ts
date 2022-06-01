import {
  WNatInstance,
  GovernanceVotePowerInstance,
  PollingRejectInstance,
  ExecuteMockInstance,
  FtsoManagerInstance,
  MockContractInstance,
  CleanupBlockNumberManagerInstance,
  FtsoInstance,
  PriceSubmitterInstance,
  MockContractContract,
  VoterWhitelisterInstance,
  VoterWhitelisterContract,
  PollingAcceptInstance
} from "../../../../typechain-truffle";
import { toBN } from "../../../utils/test-helpers";
import { time, expectEvent, expectRevert, constants } from '@openzeppelin/test-helpers';
import { defaultPriceEpochCyclicBufferSize } from "../../../utils/constants";
import { encodeContractNames } from '../../../utils/test-helpers';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import { expect } from "hardhat";
import { createMockSupplyContract } from "../../../utils/FTSO-test-utils";
import {
  setDefaultGovernanceParameters
} from "../../../utils/FtsoManager-test-utils";
import { Bytes } from "ethers";

const getTestFile = require('../../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;


const WNat = artifacts.require("WNat");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const PollingReject = artifacts.require("PollingReject");
const MockFtso = artifacts.require("MockContract");
const ExecuteMock = artifacts.require("ExecuteMock");
const FtsoManager = artifacts.require("FtsoManager");
const MockContract = artifacts.require("MockContract");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const Ftso = artifacts.require("Ftso");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const MockRegistry = artifacts.require("MockContract") as MockContractContract;
const VoterWhitelister = artifacts.require("VoterWhitelister") as VoterWhitelisterContract;
const PollingAccept = artifacts.require("PollingAccept");

const ONLY_GOVERNANCE_MSG = "only governance";
const PROPOSALTHRESHOLDSET_EVENT = 'ProposalThresholdSet'
const WRAPPINGTHRESHOLDSET_EVENT = 'WrappingThresholdSet'
const ABSOLUTETHRESHOLDSET_EVENT = 'AbsoluteThresholdSet'
const RELATIVETHRESHOLDSET_EVENT = 'RelativeThresholdSet'
const VOTINGDELAYSET_EVENT = 'VotingDelaySet'
const VOTINGPERIODSET_EVENT = 'VotingPeriodSet'
const EXECUTIONDELAYSET_EVENT = 'ExecutionDelaySet'
const EXECUTIONPERIODSET_EVENT = 'ExecutionPeriodSet'
const VPBLOCKPERIODSECONDSSET_EVENT = 'VpBlockPeriodSecondsSet'
const VOTEPOWERLIFETIMEDAYSSET_EVENT = 'VotePowerLifeTimeDaysSet'
const PROPOSERSCHANGED_EVENT = 'ProposersChanged'

const PRICE_EPOCH_DURATION_S = 120; // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

async function increaseTimeTo(current: BN, increase: number) {
  try {
    await time.increaseTo(current.addn(increase));
  } catch (e: any) {
    if (!(e.message.includes('Cannot increase current time') && e.message.includes('to a moment in the past'))) {
      throw e
    }
  }
}

async function mockFtsoSymbol(symbol: string, mockContract: MockContractInstance, dummyInterface: FtsoInstance) {
  const encodedMethod = dummyInterface.contract.methods.symbol().encodeABI();
  const symbolReturn = web3.eth.abi.encodeParameter('string', symbol);
  await mockContract.givenMethodReturn(encodedMethod, symbolReturn);
}

contract(`PollingReject.sol; ${getTestFile(__filename)}; GovernanceVotePower unit tests`, async accounts => {
  let wNat: WNatInstance;
  let governanceVotePower: GovernanceVotePowerInstance;
  let pollingReject: PollingRejectInstance;
  let executeMock: ExecuteMockInstance;
  let ftsoManager: FtsoManagerInstance;
  let mockPriceSubmitter: MockContractInstance;
  let startTs: BN;
  let mockRewardManager: MockContractInstance;
  let mockVoterWhitelister: MockContractInstance;
  let cleanupBlockNumberManager: CleanupBlockNumberManagerInstance;
  let mockSupply: MockContractInstance;
  let mockFtso: MockContractInstance;
  let ftsoInterface: FtsoInstance;
  let priceSubmitter: PriceSubmitterInstance;
  let mockFtsoRegistry: MockContractInstance;
  let voterWhitelister: VoterWhitelisterInstance;
  let pollingAccept: PollingAcceptInstance;

  const GOVERNANCE_ADDRESS = accounts[0];
  const ADDRESS_UPDATER = accounts[16];

  beforeEach(async () => {
    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    governanceVotePower = await GovernanceVotePower.new(wNat.address);
    await wNat.setGovernanceVotePower(governanceVotePower.address);

    mockPriceSubmitter = await MockContract.new();
    mockRewardManager = await MockContract.new();
    mockVoterWhitelister = await MockContract.new();
    cleanupBlockNumberManager = await CleanupBlockNumberManager.new(accounts[0], ADDRESS_UPDATER, "FtsoManager");
    mockSupply = await createMockSupplyContract(accounts[0], 10000);

    priceSubmitter = await PriceSubmitter.new();
    await priceSubmitter.initialiseFixedAddress();
    await priceSubmitter.setAddressUpdater(ADDRESS_UPDATER, { from: GOVERNANCE_GENESIS_ADDRESS});

    voterWhitelister = await VoterWhitelister.new(GOVERNANCE_GENESIS_ADDRESS, ADDRESS_UPDATER, priceSubmitter.address, 10);

    mockFtsoRegistry = await MockRegistry.new();

    // Force a block in order to get most up to date time
    await time.advanceBlock();

    // Get the timestamp for the just mined block
    startTs = await time.latest();

    ftsoManager = await FtsoManager.new(
      accounts[0],
      accounts[0],
      ADDRESS_UPDATER,
      priceSubmitter.address,
      constants.ZERO_ADDRESS,
      startTs,
      PRICE_EPOCH_DURATION_S,
      REVEAL_EPOCH_DURATION_S,
      startTs.addn(REVEAL_EPOCH_DURATION_S),
      REWARD_EPOCH_DURATION_S,
      VOTE_POWER_BOUNDARY_FRACTION
    );

    await ftsoManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REWARD_MANAGER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.SUPPLY, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER]),
      [ADDRESS_UPDATER, mockRewardManager.address, mockFtsoRegistry.address, mockVoterWhitelister.address, mockSupply.address, cleanupBlockNumberManager.address], { from: ADDRESS_UPDATER });

    await priceSubmitter.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_REGISTRY, Contracts.VOTER_WHITELISTER, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, mockFtsoRegistry.address, voterWhitelister.address, ftsoManager.address], {from: ADDRESS_UPDATER});

    mockFtso = await MockFtso.new();
    ftsoInterface = await Ftso.new(
      "NAT",
      5,
      constants.ZERO_ADDRESS as any,
      constants.ZERO_ADDRESS as any,
      constants.ZERO_ADDRESS as any,
      0,
      120,
      60,
      0,
      1e10,
      defaultPriceEpochCyclicBufferSize
    );

    await mockFtsoSymbol("ATOK", mockFtso, ftsoInterface);

    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
      ['address[]', 'uint256[]', 'uint256'],
      [[], [], '0']);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);

    await setDefaultGovernanceParameters(ftsoManager);

    await ftsoManager.addFtso(mockFtso.address);

    // deposit
    await wNat.deposit({ from: accounts[2], value: toBN(1000) });
    await wNat.deposit({ from: accounts[3], value: toBN(1000) });
    await wNat.deposit({ from: accounts[4], value: toBN(2000) });
    await wNat.deposit({ from: accounts[5], value: toBN(3000) });
    await wNat.deposit({ from: accounts[6], value: toBN(100) });

    // mock contract for proposals executable on chain 
    executeMock = await ExecuteMock.new();

    // activate ftso manager
    await ftsoManager.activate();

    // initalize first reward epoch
    await increaseTimeTo(startTs, REVEAL_EPOCH_DURATION_S);
    await ftsoManager.daemonize();
  });

  describe("Polling reject", async () => {

    beforeEach(async () => {
      pollingReject = await PollingReject.new(
        [1000, 3600, 7200, 1500, 2000, 30, 259200, 4000, 7500, 5000],
        accounts[0],
        priceSubmitter.address,
        ADDRESS_UPDATER,
        [
          accounts[2],
          accounts[3],
          accounts[6]
        ]
      );

    await pollingReject.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, ftsoManager.address, governanceVotePower.address, mockSupply.address], { from: ADDRESS_UPDATER });
    });

    it("Should check deployment parameters", async () => {
      expect((await pollingReject.proposalThreshold()).toNumber()).to.equals(1000);
      expect((await pollingReject.votingDelay()).toNumber()).to.equals(3600);
      expect((await pollingReject.votingPeriod()).toNumber()).to.equals(7200);
      expect((await pollingReject.executionDelay()).toNumber()).to.equals(1500);
      expect((await pollingReject.executionPeriod()).toNumber()).to.equals(2000);
      expect((await pollingReject.getVotePowerLifeTimeDays()).toNumber()).to.equals(30);
      expect((await pollingReject.getVpBlockPeriodSeconds()).toNumber()).to.equals(259200);
      expect((await pollingReject.wrappingThreshold()).toNumber()).to.equals(4000);
      expect((await pollingReject.absoluteThreshold()).toNumber()).to.equals(7500);
      expect((await pollingReject.relativeThreshold()).toNumber()).to.equals(5000);

      expect(await pollingReject.isProposer(accounts[3])).to.equals(true);
      expect(await pollingReject.isProposer(accounts[4])).to.equals(false);
    });

    it("Should have chainId set", async () => {
      let chainId = await web3.eth.getChainId();
      expect((await pollingReject.chainId()).toNumber()).to.equals(chainId);
    });

    it("Should choose voter power block even though vp block period is not long enough", async () => {
      for (let i = 1; i <= 172800 / 1200; i++) {
        // Time travel to trigger a price epoch change
        await time.increase(1200);

        // Mine at least a block
        await time.advanceBlock();
        await ftsoManager.daemonize();
      }

      await ftsoManager.daemonize();

      await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] });
    })

    describe("Proposing and executing", async () => {

      beforeEach(async () => {
        // initialize three reward epochs
        for (let i = 1; i <= 3 * (172800 / 1200); i++) {
          // Time travel to trigger a price epoch change
          await time.increase(1200);

          // Mine at least a block
          await time.advanceBlock();
          await ftsoManager.daemonize();
        }

        for (let i = 0; i <= 4; i++) {
          await time.advanceBlock();
          await ftsoManager.daemonize();
        }
      });

      it("...", async () => {
        // let proposal1Id = await pollingReject.contract.methods["propose(string)"].call("First proposal", { from: accounts[2] });
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("First proposal", { from: accounts[2] }) as any;
        // console.log(proposal1Id.proposa);
        let proposal1Id = tx.logs[0].args.proposalId.toString();
        // console.log("pr. ID", proposal1Id);

        // advance one hour to the voting period
        await time.increase(3600);

        let state = await pollingReject.contract.methods.state(proposal1Id).call();
        await pollingReject.state(proposal1Id);
        // console.log(state);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[2] });
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[3] });
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);
        let state1 = await pollingReject.contract.methods.state(proposal1Id).call();
        await pollingReject.state(proposal1Id);
        // console.log("state", state1);

        let info = await pollingReject.contract.methods.getProposalInfo(proposal1Id).call();
        await pollingReject.getProposalInfo(proposal1Id);
        expect(info[6]).to.equal(false);

        let execute = await pollingReject.methods["execute(string)"].sendTransaction("First proposal", { from: accounts[2] }) as any;
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });
        let info1 = await pollingReject.getProposalInfo(proposal1Id);
        expect(info1[6]).to.equal(true);

      });

      it("Should revert because address is not allowed to submit a proposal", async () => {
        let tx = pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[5] }) as any;
        await expectRevert(tx, "submitter is not eligible to submit a proposal");
      });


      it("Should revert because address does not have enough vote power required to submit a proposal", async () => {
        let tx = pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[6] }) as any;
        await expectRevert(tx, "submitter is not eligible to submit a proposal");
      });

      it("Should revert because not enough tokens are wrapped", async () => {
        const getCirculatingSupplyAt = web3.utils.sha3("getCirculatingSupplyAt(uint256)")!.slice(0, 10); // first 4 bytes is function selector
        await mockSupply.givenMethodReturnUint(getCirculatingSupplyAt, 10000000);
        let tx = pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[6] }) as any;
        await expectRevert(tx, "wrapped supply too low");
      });

      it("Should not be rejected if turnout is too low", async () => {
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[2] });

        // advance to the end of the voting period
        await time.increase(7200);

        let state1 = await pollingReject.state(proposal1Id);
        expect(state1.toString()).to.equals("4");
      });

      it("Should be rejected because enough vote power was against", async () => {
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[3] });
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[5] });

        // advance to the end of the voting period
        await time.increase(7200);

        let state1 = await pollingReject.state(proposal1Id);
        expect(state1.toString()).to.equals("2");
      });

      it("Should not be rejected if enough vote power voted for", async () => {
        await pollingReject.setAbsoluteThreshold(3000);
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[3] });
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[5] });

        // advance to the end of the voting period
        await time.increase(7200);

        let state1 = await pollingReject.state(proposal1Id);
        expect(state1.toString()).to.equals("4");
      });

      it("Should be rejected because enough vote power voted against", async () => {
        let lastBlock = await time.latestBlock();
        await time.advanceBlockTo((lastBlock).toNumber() + 5);

        // delegating
        await governanceVotePower.delegate(accounts[3], { from: accounts[4] });
        await governanceVotePower.delegate(accounts[3], { from: accounts[5] });

        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        // accounts[3]'s delegated vote power (almost surely) won't count yet, 
        // because vote power block is chosen from the past
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[3] });

        let proposalVP = await pollingReject.getProposalVP(proposal1Id);
        expect(proposalVP[0].toString()).to.equals("7100");
        expect(proposalVP[1].toString()).to.equals("0");
        expect(proposalVP[2].toString()).to.equals("1000");
        expect(proposalVP[3].toString()).to.equals("0");

        // advance to the end of the voting period
        await time.increase(7200);

        // proposal is not rejected if turnout is too low
        let state1 = await pollingReject.state(proposal1Id);
        expect(state1.toString()).to.equals("4");

        // let execute = pollingReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] });
        // await expectRevert(execute, "proposal not in execution state");

        // time travel two reward epochs forward
        for (let i = 0; i <= 2 * (172800 / 1200); i++) {
          await time.increase(1200);
          await time.advanceBlock();
          await ftsoManager.daemonize();
        }
        await ftsoManager.daemonize();

        // second proposal
        let tx2 = await pollingReject.methods["propose(string)"].sendTransaction("Proposal 2", { from: accounts[2] }) as any;
        let proposal2Id = tx2.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal2Id, 0, { from: accounts[3] });

        let proposal2VP = await pollingReject.getProposalVP(proposal2Id);
        expect(proposal2VP[0].toString()).to.equals("7100");
        expect(proposal2VP[1].toString()).to.equals("0");
        expect(proposal2VP[2].toString()).to.equals("6000");
        expect(proposal2VP[3].toString()).to.equals("0");

        // advance to the end of the voting period
        await time.increase(7200);

        // proposal is rejected, because enough vote power was aginst
        let state2 = await pollingReject.state(proposal2Id);
        expect(state2.toString()).to.equals("2");
      });

      it("Should not allow voting twice", async () => {
        let propose = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        await pollingReject.castVote(proposal1Id, 0, { from: accounts[3] });
        let castVote = pollingReject.castVote(proposal1Id, 0, { from: accounts[3] });
        await expectRevert(castVote, "vote already cast");
      });

      it("Should propose and execute", async () => {
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();  

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[2] });
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[3] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        let proposalVP = await pollingReject.getProposalVP(proposal1Id);
        expect(proposalVP[0].toString()).to.equals("7100");
        expect(proposalVP[1].toString()).to.equals("2000");
        expect(proposalVP[2].toString()).to.equals("0");
        expect(proposalVP[3].toString()).to.equals("5000");
        // advance to end of the voting period
        await time.increase(7200);

        // should not be yet executed
        let info = await pollingReject.getProposalInfo(proposal1Id);
        expect(info[6]).to.equal(false);

        // mark proposal as executed
        let execute = await pollingReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

        let info1 = await pollingReject.getProposalInfo(proposal1Id);
        expect(info1[6]).to.equal(true);
      });

      it("Should propose and execute proposal which is executable on chain", async () => {
        // propose
        let propose = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // check state
        expect((await pollingReject.state(proposal1Id)).toString()).to.equals("3");

        // advance to the executing period
        await time.increase(1500);

        // check state
        expect((await pollingReject.state(proposal1Id)).toString()).to.equals("4");

        // initial parameter value
        expect((await executeMock.getNum()).toString()).to.equals("0");

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        expect((await pollingReject.getProposalId([executeMock.address], [0],  [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash)).toString()).to.equals(proposal1Id);

        let execute = await pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

        // parameter should be change to 3
        expect((await executeMock.getNum()).toString()).to.equals("3");

        // check state
        expect((await pollingReject.state(proposal1Id)).toString()).to.equals("6");
      });

      it("Should revert because proposal (executable on chain) expired", async () => {
        // propose
        let propose = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the execution peropd
        await time.increase(7200 + 1500 + 2000);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        let execute = pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

        // state should be "expired" and execution should revert
        expect((await pollingReject.state(proposal1Id)).toString()).to.equals("5");
        await expectRevert(execute, "proposal not in execution state");
      });

      it("Should revert because propose and execute parameters does not match", async () => {
        // propose
        let propose = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // advance to the executing period
        await time.increase(1500);

        // initial parameter value
        expect((await executeMock.getNum()).toString()).to.equals("0");

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        let execute = pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(4).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

        await expectRevert(execute, "proposal can only be executed by its proposer");
      });

      it("Should check if voter has already cast a vote", async () => {
        await governanceVotePower.delegate(accounts[5], { from: accounts[6] });
        let blockAfterDelegation = await time.latestBlock();

        for (let i = 0; i <= 172800 / 1200; i++) {
          await time.increase(1200);
          await time.advanceBlock();
          await ftsoManager.daemonize();
        }

        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();
        let info = await pollingReject.getProposalInfo(proposal1Id);
        let vpBlock = info[1];

        if (vpBlock >= blockAfterDelegation) {
          expect((await pollingReject.getVotes(accounts[5], vpBlock)).toString()).to.equals("3100");
          expect((await pollingReject.getVotes(accounts[6], vpBlock)).toString()).to.equals("0");
        }
        else {
          expect((await pollingReject.getVotes(accounts[5], vpBlock)).toString()).to.equals("3000");
          expect((await pollingReject.getVotes(accounts[6], vpBlock)).toString()).to.equals("100");
        }

        expect((await pollingReject.quorum(vpBlock)).toString()).to.equals((7100 * 0.75).toString())

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVoteWithReason(proposal1Id, 0, "I don't like this proposal", { from: accounts[2] });
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[3] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        expect(await pollingReject.hasVoted(proposal1Id, accounts[2])).to.equals(true);
        expect(await pollingReject.hasVoted(proposal1Id, accounts[3])).to.equals(true);
        expect(await pollingReject.hasVoted(proposal1Id, accounts[4])).to.equals(false);
        expect(await pollingReject.hasVoted(proposal1Id, accounts[5])).to.equals(true);
      });

      it("Should check if proposal is pending", async () => {
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        expect((await pollingReject.state(proposal1Id)).toString()).to.equals("0");
      });

      it("Should revert if voter casts invalid vote", async () => {
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        await time.increase(3600);

        let vote = pollingReject.castVote(proposal1Id, 4, { from: accounts[2] });

        await expectRevert(vote, "invalid value for enum VoteType");
      });

      it("Should move execution start time of second proposal", async () => {
        // It should move execution start time of second proposal if it is before execution end time of first proposal

        // First proposal
        let propose1 = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal 1", { from: accounts[2] }) as any;

        let block1 = await time.latestBlock();
        let blockTs1 = (await web3.eth.getBlock(block1)).timestamp as number;

        let proposalId1 = propose1.logs[0].args.proposalId.toString();
        let info1 = await pollingReject.getProposalInfo(proposalId1);

        let voteStart1 = blockTs1 + 3600;
        let voteEnd1 = voteStart1 + 7200;
        let executeStart1 = voteEnd1 + 1500;
        let executeEnd1 = executeStart1 + 2000;

        expect(info1[2].toNumber()).to.equals(voteStart1);
        expect(info1[3].toNumber()).to.equals(voteEnd1);
        expect(info1[4].toNumber()).to.equals(executeStart1);
        expect(info1[5].toNumber()).to.equals(executeEnd1);

        await time.increase(100);


        // Second proposal
        let propose2 = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(90).encodeABI()], "Proposal 2", { from: accounts[2] }) as any;

        let block2 = await time.latestBlock();
        let blockTs2 = (await web3.eth.getBlock(block2)).timestamp as number;

        let proposalId2 = propose2.logs[0].args.proposalId.toString();
        let info2 = await pollingReject.getProposalInfo(proposalId2);

        let voteStart2 = blockTs2 + 3600;
        let voteEnd2 = voteStart2 + 7200;
        let executeStart2 = executeEnd1;
        let executeEnd2 = executeStart2 + 2000;

        expect(info2[2].toNumber()).to.equals(voteStart2);
        expect(info2[3].toNumber()).to.equals(voteEnd2);
        expect(info2[4].toNumber()).to.equals(executeStart2);
        expect(info2[5].toNumber()).to.equals(executeEnd2);
      })

      it("Should revert if voter votes outside of the voting period", async () => {
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        let vote = pollingReject.castVote(proposal1Id, 0);
        await expectRevert(vote, "proposal not active")
      });

      it("Should revert if trying to execute the same proposal twice", async () => {
        // propose
        let propose = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // check state
        expect((await pollingReject.state(proposal1Id)).toString()).to.equals("3");

        // advance to the executing period
        await time.increase(1500);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        let execute = await pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

        // parameter should be change to 3
        expect((await executeMock.getNum()).toString()).to.equals("3");

        // try to execute again
        let execute2 = pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

        await expectRevert(execute2, "proposal already executed");
      });

      it("Should revert if proposal already exist", async () => {
        // propose
        await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;

        let propose2 = pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[3] }) as any;
        await expectRevert(propose2, "proposal already exists");
      });

      it("Should revert if length of target addresses is different than length of values", async () => {
        let propose = pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0, 1], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        await expectRevert(propose, "invalid proposal length");
      });

      it("Should revert if length of target addresses is different than length of calldatas", async () => {
        let propose = pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI(), executeMock.contract.methods.setNum(8).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        await expectRevert(propose, "invalid proposal length");
      });

      it("Should revert without message if execution on chain is not successful", async () => {
        // propose
        let propose = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum1(5).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // advance to the executing period
        await time.increase(1500);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        let execute = pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum1(5).encodeABI()], descriptionHash, { from: accounts[2] }) as any;
        await expectRevert(execute, "call reverted without message");
      });

      it("Should revert with message if execution on chain is not successful", async () => {
        // propose
        let propose = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum2(5).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // advance to the executing period
        await time.increase(1500);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        let execute = pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum2(5).encodeABI()], descriptionHash, { from: accounts[2] }) as any;
        await expectRevert(execute, "wrong number");
      });


      it("Should cast vote by signature", async () => {
        // create a proposal
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // calculate hashTypedDataV4
        let ballotTypehash = web3.utils.keccak256("Ballot(uint256 proposalId,uint8 support)");
        let abi = web3.eth.abi.encodeParameters(['bytes32', 'uint256', 'uint8'],
          [ballotTypehash, proposal1Id, 0]);
        let structHash = web3.utils.keccak256(abi);
        // let hash = web3.utils.soliditySha3(abi) as string;

        let typeHash = web3.utils.soliditySha3("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        let hashedName = web3.utils.soliditySha3("PollingReject");
        let versionHex = web3.utils.utf8ToHex("1")
        let hashedVersion = web3.utils.soliditySha3(versionHex);
        let chainId = await web3.eth.getChainId();
        let thisAddress = pollingReject.address;

        let encodedDomainSeparator = web3.eth.abi.encodeParameters(["bytes32", "bytes32", "bytes32", "uint256", "address"], [typeHash, hashedName, hashedVersion, chainId, thisAddress])
        let domainSeparator = web3.utils.soliditySha3(encodedDomainSeparator) as string;
        let abiEncodePacked = "0x1901" + domainSeparator.slice(2) + structHash.slice(2);
        let hashTypedDataV4 = web3.utils.soliditySha3(abiEncodePacked) as string;

        // sign with private key of accounts[2]
        let signature1 = web3.eth.accounts.sign(hashTypedDataV4, "0x23c601ae397441f3ef6f1075dcb0031ff17fb079837beadaf3c84d96c6f3e569");

        // advance to the voting period
        await time.increase(3600);

        let tx1 = await pollingReject.castVoteBySig(proposal1Id, 0, signature1.v, signature1.r, signature1.s) as any;

        // signer's address and recovered address should match
        expect(tx1.logs[0].args.voter).to.equals(accounts[2]);

        let info = await pollingReject.getProposalVP(proposal1Id);
        expect(info[1].toString()).to.equals("0");
        expect(info[2].toString()).to.equals("1000");
        expect(info[3].toString()).to.equals("0");

        // accounts[2] tries to vote again
        let voteAgain = pollingReject.castVote(proposal1Id, 0, { from: accounts[2] });
        await expectRevert(voteAgain, "vote already cast");
      });

      it("Should revert if vote power block and end of voting period are too far apart", async () => {
        const twentyEightDays = 28 * 24 * 60 * 60;
        // change voting period length to 28 days
        await pollingReject.setVotingPeriod(twentyEightDays);

        // propose
        let propose = pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        await expectRevert(propose, "vote power block is too far in the past");
      });

      it("Should not change absolute or relative threshold for active proposal", async () => {
        let tx = await pollingReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // event ProposalCreated
        expect(tx.logs[0].args.proposalId.toString()).to.equals(proposal1Id);
        expect(tx.logs[0].args.wrappingThreshold.toString()).to.equals("4000");
        expect(tx.logs[0].args.absoluteThreshold.toString()).to.equals("7500");
        expect(tx.logs[0].args.relativeThreshold.toString()).to.equals("5000");

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 0, { from: accounts[5] });

        let proposalVP = await pollingReject.getProposalVP(proposal1Id);
        expect(proposalVP[0].toString()).to.equals("7100");
        expect(proposalVP[1].toString()).to.equals("0");
        expect(proposalVP[2].toString()).to.equals("5000");
        expect(proposalVP[3].toString()).to.equals("0");

        // advance to end of the voting period
        await time.increase(7200);

        // change thresholds
        expect((await pollingReject.absoluteThreshold()).toString()).to.equals("7500");
        await pollingReject.setAbsoluteThreshold("6500");
        expect((await pollingReject.absoluteThreshold()).toString()).to.equals("6500");
        expect((await pollingReject.relativeThreshold()).toString()).to.equals("5000");
        await pollingReject.setRelativeThreshold("5500");
        expect((await pollingReject.relativeThreshold()).toString()).to.equals("5500");

        // execute (flag as executed) 
        let execute = await pollingReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });
        let info1 = await pollingReject.getProposalInfo(proposal1Id);
        expect(info1[6]).to.equal(true);


        // create another proposal
        let tx2 = await pollingReject.methods["propose(string)"].sendTransaction("Proposal2", { from: accounts[2] }) as any;
        let proposal2Id = tx2.logs[0].args.proposalId.toString();

        expect(tx2.logs[0].args.proposalId.toString()).to.equals(proposal2Id);
        expect(tx2.logs[0].args.wrappingThreshold.toString()).to.equals("4000");
        expect(tx2.logs[0].args.absoluteThreshold.toString()).to.equals("6500");
        expect(tx2.logs[0].args.relativeThreshold.toString()).to.equals("5500");

        // advance one hour to the voting period
        await time.increase(3600);

        // cast the same votes
        await pollingReject.castVote(proposal2Id, 0, { from: accounts[4] });
        await pollingReject.castVote(proposal2Id, 0, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // proposal should be rejected (defeated), beacuse rejection threshold lowered
        let state = await pollingReject.state(proposal2Id);
        expect(state.toString()).to.equals("2");

        // should not be able to execute
        let execute2 = pollingReject.methods["execute(string)"].sendTransaction("Proposal2", { from: accounts[2] }) as any;
        await expectRevert(execute2, "proposal not in execution state");
      });

      it("Should revert if proposal with some proposal id doesn't exists", async() => {
        let tx = pollingReject.state(123);
        await expectRevert(tx, "unknown proposal id")
      });

      it("Should revert on-chain proposal if msg.value does not equal msg.value", async () => {
        // propose
        let propose = await pollingReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [10], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await pollingReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await pollingReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // advance to the executing period
        await time.increase(1500);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        expect((await pollingReject.getProposalId([executeMock.address], [10],  [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash)).toString()).to.equals(proposal1Id);

        let execute = pollingReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [10], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2], value: "5" }) as any;

        await expectRevert(execute, "sum of _values does not equals msg.value");
      });

    });

    describe("Settings change", async () => {

      it("Should set the proposalThreshold and emit ProposalThresholdSet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setProposalThreshold(77, { from: accounts[0] });
        expect((await pollingReject.proposalThreshold()).toNumber()).to.equals(77);
        expectEvent(tx, PROPOSALTHRESHOLDSET_EVENT);

        // revert if not governance
        const promise = pollingReject.setProposalThreshold(77, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the votingDelaySeconds and emit VotingDelaySet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setVotingDelay(1800, { from: accounts[0] });
        expect((await pollingReject.votingDelay()).toNumber()).to.equals(1800);
        expectEvent(tx, VOTINGDELAYSET_EVENT);

        // revert if not governance
        const promise = pollingReject.setVotingDelay(1800, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the votingPeriodSeconds and emit VotingPeriodSet, and revert if change is not made from governance or setting it to 0", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setVotingPeriod(3600, { from: accounts[0] });
        expect((await pollingReject.votingPeriod()).toNumber()).to.equals(3600);
        expectEvent(tx, VOTINGPERIODSET_EVENT);

        // revert if not governance
        const setNotgov = pollingReject.setVotingPeriod(3600, { from: accounts[100] });
        await expectRevert(setNotgov, ONLY_GOVERNANCE_MSG);
        
        // revert if set to 0
        const setTooLow = pollingReject.setVotingPeriod(0, { from: accounts[0] });
        await expectRevert(setTooLow, "voting period too low");
      });

      it("Should set the executionDelaySeconds and emit ExecutionDelaySet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setExecutionDelay(750, { from: accounts[0] });
        expect((await pollingReject.executionDelay()).toNumber()).to.equals(750);
        expectEvent(tx, EXECUTIONDELAYSET_EVENT);

        // revert if not governance
        const promise = pollingReject.setExecutionDelay(750, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the executionPeriodSeconds and emit ExecutionPeriodSet, and revert if change is not made from governance or set to 0", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setExecutionPeriod(1000, { from: accounts[0] });
        expect((await pollingReject.executionPeriod()).toNumber()).to.equals(1000);
        expectEvent(tx, EXECUTIONPERIODSET_EVENT);

        // revert if not governance
        const setNotGov = pollingReject.setExecutionPeriod(1000, { from: accounts[100] });
        await expectRevert(setNotGov, ONLY_GOVERNANCE_MSG);
        
        // revert if set too low
        const setTooLow = pollingReject.setExecutionPeriod(0, { from: accounts[0] });
        await expectRevert(setTooLow, "execution period too low");
      });

      it("Should set the wrapping threshold and emit WrappingThresholdSet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setWrappingThreshold(2500, { from: accounts[0] });
        expect((await pollingReject.wrappingThreshold()).toNumber()).to.equals(2500);
        expectEvent(tx, WRAPPINGTHRESHOLDSET_EVENT);

        // revert if not governance
        const promise = pollingReject.setWrappingThreshold(2500, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the absolute threshold and emit AbsoluteThresholdSet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setAbsoluteThreshold(2500, { from: accounts[0] });
        expect((await pollingReject.absoluteThreshold()).toNumber()).to.equals(2500);
        expectEvent(tx, ABSOLUTETHRESHOLDSET_EVENT);

        // revert if not governance
        const promise = pollingReject.setAbsoluteThreshold(2500, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the relative threshold and emit RelativeThresholdSet, and revert if change is not made from governance or if below 50%", async () => {
        // set property by governance and emit event
        const tx = await pollingReject.setRelativeThreshold(5500, { from: accounts[0] });
        expect((await pollingReject.relativeThreshold()).toNumber()).to.equals(5500);
        expectEvent(tx, RELATIVETHRESHOLDSET_EVENT);

        // revert if too low
        const promise1 = pollingReject.setRelativeThreshold(2500, { from: accounts[0] });
        await expectRevert(promise1, "invalid _relativeThresholdBIPS");

        // revert if not governance
        const promise2 = pollingReject.setRelativeThreshold(5500, { from: accounts[100] });
        await expectRevert(promise2, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the vote power life time days and emit VotePowerLifeTimeDaysSet, and revert if change is not made from governance", async () => {
        const tx = await pollingReject.setVotePowerLifeTimeDays(30, { from: accounts[0] });
        expect((await pollingReject.getVotePowerLifeTimeDays()).toNumber()).to.equals(30);
        expectEvent(tx, VOTEPOWERLIFETIMEDAYSSET_EVENT);

        let promise = pollingReject.setVotePowerLifeTimeDays(30, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the vp block period seconds and emit VpBlockPeriodSecondsSet, and revert if change is not made from governance", async () => {
        const tx = await pollingReject.setVpBlockPeriodSeconds(2592000, { from: accounts[0] });
        expect((await pollingReject.getVpBlockPeriodSeconds()).toNumber()).to.equals(2592000);
        expectEvent(tx, VPBLOCKPERIODSECONDSSET_EVENT);

        let promise = pollingReject.setVpBlockPeriodSeconds(30, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should change proposers and emit ProposersChanged, and revert if change is not made from governance", async () => {
        const tx = await pollingReject.changeProposers([accounts[4], accounts[5]], [accounts[2], accounts[3]], { from: accounts[0] });

        expect(await pollingReject.isProposer(accounts[2])).to.equals(false);
        expect(await pollingReject.isProposer(accounts[3])).to.equals(false);
        expect(await pollingReject.isProposer(accounts[4])).to.equals(true);
        expect(await pollingReject.isProposer(accounts[5])).to.equals(true);
        expect(await pollingReject.isProposer(accounts[6])).to.equals(true);
        expect(await pollingReject.isProposer(accounts[19])).to.equals(false);
        expectEvent(tx, PROPOSERSCHANGED_EVENT);

        let promise = pollingReject.changeProposers([accounts[4], accounts[5]], [accounts[2], accounts[3]], { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

    });

  });

  describe("Governor accept", async () => {

    beforeEach(async () => {
      pollingAccept = await PollingAccept.new(
        [2000, 3600, 7200, 1500, 2000, 30, 259200, 4000, 5000, 6000],
        accounts[0],
        priceSubmitter.address,
        ADDRESS_UPDATER
      );

      await pollingAccept.updateContractAddresses(
          encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.SUPPLY]),
          [ADDRESS_UPDATER, ftsoManager.address, governanceVotePower.address, mockSupply.address], { from: ADDRESS_UPDATER }
      );
    });

    it("Should check deployment parameters", async () => {
      expect((await pollingAccept.proposalThreshold()).toNumber()).to.equals(2000);
      expect((await pollingAccept.votingDelay()).toNumber()).to.equals(3600);
      expect((await pollingAccept.votingPeriod()).toNumber()).to.equals(7200);
      expect((await pollingAccept.executionDelay()).toNumber()).to.equals(1500);
      expect((await pollingAccept.executionPeriod()).toNumber()).to.equals(2000);
      expect((await pollingAccept.getVotePowerLifeTimeDays()).toNumber()).to.equals(30);
      expect((await pollingAccept.getVpBlockPeriodSeconds()).toNumber()).to.equals(259200);
      expect((await pollingAccept.wrappingThreshold()).toNumber()).to.equals(4000);
      expect((await pollingAccept.absoluteThreshold()).toNumber()).to.equals(5000);
      expect((await pollingAccept.relativeThreshold()).toNumber()).to.equals(6000);
    });

    it("Should propose and execute", async () => {
      let tx = await pollingAccept.methods["propose(string)"].sendTransaction("Proposal accept", { from: accounts[5] }) as any;
      let proposal1Id = tx.logs[0].args.proposalId.toString();

      // advance one hour to the voting period
      await time.increase(3600);

      // voting
      await pollingAccept.castVote(proposal1Id, 1, { from: accounts[2] });
      await pollingAccept.castVote(proposal1Id, 1, { from: accounts[3] });
      await pollingAccept.castVote(proposal1Id, 2, { from: accounts[4] });
      await pollingAccept.castVote(proposal1Id, 1, { from: accounts[5] });

      let proposalVP = await pollingAccept.getProposalVP(proposal1Id);
      expect(proposalVP[0].toString()).to.equals("7100");
      expect(proposalVP[1].toString()).to.equals("5000");
      expect(proposalVP[2].toString()).to.equals("0");
      expect(proposalVP[3].toString()).to.equals("2000");

      expectEvent(tx, "ProposalCreated", { proposalId: proposal1Id, wrappingThreshold: toBN(4000), absoluteThreshold: toBN(5000), relativeThreshold: toBN(6000) }); 

      // advance to end of the voting period
      await time.increase(7200);

      // should not be yet executed
      let info = await pollingAccept.getProposalInfo(proposal1Id);
      expect(info[6]).to.equal(false);

      // mark proposal as executed
      let execute = await pollingAccept.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[5] }) as any;
      
      expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

      let info1 = await pollingAccept.getProposalInfo(proposal1Id);
      expect(info1[6]).to.equal(true);
    });

    it("Should reject proposal if not enough vote power votes for", async() => {
      await pollingAccept.setAbsoluteThreshold(3000);
      let tx = await pollingAccept.methods["propose(string)"].sendTransaction("Proposal accept", { from: accounts[5] }) as any;
      let proposal1Id = tx.logs[0].args.proposalId.toString();

      await time.increase(3600);

      await pollingAccept.castVote(proposal1Id, 2, { from: accounts[2] });
      await pollingAccept.castVote(proposal1Id, 1, { from: accounts[3] });
      await pollingAccept.castVote(proposal1Id, 1, { from: accounts[4] });
      await pollingAccept.castVote(proposal1Id, 0, { from: accounts[5] });

      await time.increase(7200);

      // proposal rejected
      let state1 = await pollingAccept.state(proposal1Id);
      expect(state1.toString()).to.equals("2");

      let execute = pollingAccept.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[5] }) as any;
      
      await expectRevert(execute, "proposal not in execution state");
    });

    it("Should reject proposal if quorum is not achieved", async() => {
      let tx = await pollingAccept.methods["propose(string)"].sendTransaction("Proposal accept", { from: accounts[5] }) as any;
      let proposal1Id = tx.logs[0].args.proposalId.toString();

      await time.increase(3600);

      await pollingAccept.castVote(proposal1Id, 1, { from: accounts[2] });

      await time.increase(7200);

      // proposal rejected
      let state1 = await pollingAccept.state(proposal1Id);
      expect(state1.toString()).to.equals("2");

      let execute = pollingAccept.methods["execute(string)"].sendTransaction("Proposal accept", { from: accounts[5] }) as any;
      
      await expectRevert(execute, "proposal not in execution state");
    });

  });


});