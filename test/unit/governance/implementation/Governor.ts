import {
  WNatInstance,
  GovernanceVotePowerInstance,
  FtsoRegistryInstance,
  GovernorRejectInstance,
  ExecuteMockInstance,
  FtsoManagerInstance,
  MockContractInstance,
  CleanupBlockNumberManagerInstance,
  FtsoInstance,
  PriceSubmitterInstance,
  MockContractContract,
  VoterWhitelisterInstance,
  VoterWhitelisterContract
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

const getTestFile = require('../../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;


const WNat = artifacts.require("WNat");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const FtsoRegistry = artifacts.require("FtsoRegistry");
const GovernorReject = artifacts.require("GovernorReject");
const MockFtso = artifacts.require("MockContract");
const ExecuteMock = artifacts.require("ExecuteMock");
const FtsoManager = artifacts.require("FtsoManager");
const MockContract = artifacts.require("MockContract");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
const Ftso = artifacts.require("Ftso");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const MockRegistry = artifacts.require("MockContract") as MockContractContract;
const VoterWhitelister = artifacts.require("VoterWhitelister") as VoterWhitelisterContract;


let MOCK_FTSO_MANAGER_ADDRESS: string;

const ONLY_GOVERNANCE_MSG = "only governance";
const PROPOSALTHRESHOLDSET_EVENT = 'ProposalThresholdSet'
const QUORUMTHRESHOLDSET_EVENT = 'QuorumThresholdSet'
const VOTINGDELAYSET_EVENT = 'VotingDelaySet'
const VOTINGPERIODSET_EVENT = 'VotingPeriodSet'
const EXECUTIONDELAYSET_EVENT = 'ExecutionDelaySet'
const EXECUTIONPERIODSET_EVENT = 'ExecutionPeriodSet'
const VPBLOCKPERIODSECONDSSET_EVENT = "VpBlockPeriodSecondsSet"
const VOTEPOWERLIFETIMEDAYSSET_EVENT = 'VotePowerLifeTimeDaysSet'

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

contract(`GovernorReject.sol; ${getTestFile(__filename)}; GovernanceVotePower unit tests`, async accounts => {
  let wNat: WNatInstance;
  let governanceVotePower: GovernanceVotePowerInstance;
  let governorReject: GovernorRejectInstance;
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

  const GOVERNANCE_ADDRESS = accounts[0];
  const ADDRESS_UPDATER = accounts[16];
  MOCK_FTSO_MANAGER_ADDRESS = accounts[123];

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

  describe("Governor reject", async () => {

    beforeEach(async () => {
      governorReject = await GovernorReject.new(
        [1000, 3600, 7200, 1500, 2000, 5000, 30, 259200],
        accounts[0],
        priceSubmitter.address,
        ADDRESS_UPDATER,
        7500,
        [
          accounts[2],
          accounts[3],
          accounts[6]
        ]
      );

    await governorReject.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.FTSO_MANAGER, Contracts.GOVERNANCE_VOTE_POWER]),
        [ADDRESS_UPDATER, ftsoManager.address, governanceVotePower.address], { from: ADDRESS_UPDATER });
    });

    it("Should check deployment parameters", async () => {
      expect((await governorReject.proposalThreshold()).toNumber()).to.equals(1000);
      expect((await governorReject.votingDelay()).toNumber()).to.equals(3600);
      expect((await governorReject.votingPeriod()).toNumber()).to.equals(7200);
      expect((await governorReject.executionDelay()).toNumber()).to.equals(1500);
      expect((await governorReject.executionPeriod()).toNumber()).to.equals(2000);
      expect((await governorReject.quorumThreshold()).toNumber()).to.equals(5000);
      expect((await governorReject.getVotePowerLifeTimeDays()).toNumber()).to.equals(30);
      expect((await governorReject.getVpBlockPeriodSeconds()).toNumber()).to.equals(259200);

      expect((await governorReject.rejectionThreshold()).toNumber()).to.equals(7500);
      expect(await governorReject.isProposer(accounts[3])).to.equals(true);
      expect(await governorReject.isProposer(accounts[4])).to.equals(false);
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

      await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] });
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
        // let proposal1Id = await governorReject.contract.methods["propose(string)"].call("First proposal", { from: accounts[2] });
        let tx = await governorReject.methods["propose(string)"].sendTransaction("First proposal", { from: accounts[2] }) as any;
        // console.log(proposal1Id.proposa);
        let proposal1Id = tx.logs[0].args.proposalId.toString();
        // console.log("pr. ID", proposal1Id);

        // advance one hour to the voting period
        await time.increase(3600);

        let state = await governorReject.contract.methods.state(proposal1Id).call();
        await governorReject.state(proposal1Id);
        // console.log(state);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[2] });
        await governorReject.castVote(proposal1Id, 1, { from: accounts[3] });
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 1, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);
        let state1 = await governorReject.contract.methods.state(proposal1Id).call();
        await governorReject.state(proposal1Id);
        // console.log("state", state1);

        let info = await governorReject.contract.methods.getProposalInfo(proposal1Id).call();
        await governorReject.getProposalInfo(proposal1Id);
        expect(info[6]).to.equal(false);

        let execute = await governorReject.methods["execute(string)"].sendTransaction("First proposal", { from: accounts[2] }) as any;
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });
        let info1 = await governorReject.getProposalInfo(proposal1Id);
        expect(info1[6]).to.equal(true);

      });

      it("Should revert because address is not allowed to submit a proposal", async () => {
        let tx = governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[5] }) as any;
        await expectRevert(tx, "submitter is not eligible to submit a proposal");
      });


      it("Should revert because address does not have enough vote power required to submit a proposal", async () => {
        let tx = governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[6] }) as any;
        await expectRevert(tx, "submitter is not eligible to submit a proposal");
      });

      it("Should be rejected because turnout is too low", async () => {
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[2] });

        // advance to the end of the voting period
        await time.increase(7200);

        let state1 = await governorReject.state(proposal1Id);
        expect(state1.toString()).to.equals("2");
      });

      it("Should be rejected because enough vote power was against", async () => {
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 0, { from: accounts[3] });
        await governorReject.castVote(proposal1Id, 0, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 0, { from: accounts[5] });

        // advance to the end of the voting period
        await time.increase(7200);

        let state1 = await governorReject.state(proposal1Id);
        expect(state1.toString()).to.equals("2");
      });

      it("Should be rejected because enough vote power voted against or because turnout was too low ", async () => {
        let lastBlock = await time.latestBlock();
        await time.advanceBlockTo((lastBlock).toNumber() + 5);

        // delegating
        await governanceVotePower.delegate(accounts[3], { from: accounts[4] });
        await governanceVotePower.delegate(accounts[3], { from: accounts[5] });

        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        // accounts[3]'s delegated vote power (almost surely) won't count yet, 
        // because vote power block is chosen from the past
        await governorReject.castVote(proposal1Id, 0, { from: accounts[3] });

        let proposalVP = await governorReject.getProposalVP(proposal1Id);
        expect(proposalVP[0].toString()).to.equals("7100");
        expect(proposalVP[1].toString()).to.equals("0");
        expect(proposalVP[2].toString()).to.equals("1000");
        expect(proposalVP[3].toString()).to.equals("0");

        // advance to the end of the voting period
        await time.increase(7200);

        // proposal is rejected because turnout is too low
        let state1 = await governorReject.state(proposal1Id);
        expect(state1.toString()).to.equals("2");

        // let execute = governorReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] });
        // await expectRevert(execute, "proposal not in execution state");

        // time travel two reward epochs forward
        for (let i = 0; i <= 2 * (172800 / 1200); i++) {
          await time.increase(1200);
          await time.advanceBlock();
          await ftsoManager.daemonize();
        }
        await ftsoManager.daemonize();

        // second proposal
        let tx2 = await governorReject.methods["propose(string)"].sendTransaction("Proposal 2", { from: accounts[2] }) as any;
        let proposal2Id = tx2.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal2Id, 0, { from: accounts[3] });

        let proposal2VP = await governorReject.getProposalVP(proposal2Id);
        expect(proposal2VP[0].toString()).to.equals("7100");
        expect(proposal2VP[1].toString()).to.equals("0");
        expect(proposal2VP[2].toString()).to.equals("6000");
        expect(proposal2VP[3].toString()).to.equals("0");

        // advance to the end of the voting period
        await time.increase(7200);

        // proposal is rejected, because enough vote power was gainst
        let state2 = await governorReject.state(proposal2Id);
        expect(state2.toString()).to.equals("2");
      });

      it("Should not allow voting twice", async () => {
        let propose = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        await governorReject.castVote(proposal1Id, 0, { from: accounts[3] });
        let castVote = governorReject.castVote(proposal1Id, 0, { from: accounts[3] });
        await expectRevert(castVote, "vote already cast");
      });

      it("Should propose and execute", async () => {
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[2] });
        await governorReject.castVote(proposal1Id, 1, { from: accounts[3] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        let proposalVP = await governorReject.getProposalVP(proposal1Id);
        expect(proposalVP[0].toString()).to.equals("7100");
        expect(proposalVP[1].toString()).to.equals("2000");
        expect(proposalVP[2].toString()).to.equals("0");
        expect(proposalVP[3].toString()).to.equals("5000");
        // advance to end of the voting period
        await time.increase(7200);

        // should not be yet executed
        let info = await governorReject.getProposalInfo(proposal1Id);
        expect(info[6]).to.equal(false);

        // mark proposal as executed
        let execute = await governorReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

        let info1 = await governorReject.getProposalInfo(proposal1Id);
        expect(info1[6]).to.equal(true);
      });

      it("Should propose and execute proposal which is executable on chain", async () => {
        // propose
        let propose = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // check state
        expect((await governorReject.state(proposal1Id)).toString()).to.equals("3");

        // advance to the executing period
        await time.increase(1500);

        // check state
        expect((await governorReject.state(proposal1Id)).toString()).to.equals("4");

        // initial parameter value
        expect((await executeMock.getNum()).toString()).to.equals("0");

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        let execute = await governorReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });

        // parameter should be change to 3
        expect((await executeMock.getNum()).toString()).to.equals("3");

        // check state
        expect((await governorReject.state(proposal1Id)).toString()).to.equals("6");
      });

      it("Should revert because proposal (executable on chain) expired", async () => {
        // propose
        let propose = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the execution peropd
        await time.increase(7200 + 1500 + 2000);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        let execute = governorReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

        // state should be "expired" and execution should revert
        expect((await governorReject.state(proposal1Id)).toString()).to.equals("5");
        await expectRevert(execute, "proposal not in execution state");
      });

      it("Should choose vote power block, propose and execute or revert", async () => {
        await governanceVotePower.delegate(accounts[6], { from: accounts[4] });
        await governanceVotePower.delegate(accounts[6], { from: accounts[5] });
        let blockAfterDelegation = await web3.eth.getBlockNumber();

        for (let i = 0; i <= 172800 / 1200; i++) {
          await time.increase(1200);
          await time.advanceBlock();
          await ftsoManager.daemonize();
        }

        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // advance one hour to the voting period
        await time.increase(3600);

        let info = await governorReject.getProposalInfo(proposal1Id);
        let vpBlock = info[1].toNumber();

        // vote
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 1, { from: accounts[5] });

        // advance to the end of the voting period
        await time.increase(7200);

        // try to execute
        if (vpBlock <= blockAfterDelegation) {
          await governorReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
          let info1 = await governorReject.contract.methods.getProposalInfo(proposal1Id).call();
          await governorReject.getProposalInfo(proposal1Id);
          expect(info1[6]).to.equal(true);
        }
        else {
          expect((await governorReject.state(proposal1Id)).toString()).to.equals("2");
          let execute = governorReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
          await expectRevert(execute, "proposal not in execution state");
        }
      });

      it("Should revert because propose and execute parameters does not match", async () => {
        // propose
        let propose = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // advance to the executing period
        await time.increase(1500);

        // initial parameter value
        expect((await executeMock.getNum()).toString()).to.equals("0");

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        let execute = governorReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(4).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

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

        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();
        let info = await governorReject.getProposalInfo(proposal1Id);
        let vpBlock = info[1];

        if (vpBlock >= blockAfterDelegation) {
          expect((await governorReject.getVotes(accounts[5], vpBlock)).toString()).to.equals("3100");
          expect((await governorReject.getVotes(accounts[6], vpBlock)).toString()).to.equals("0");
        }
        else {
          expect((await governorReject.getVotes(accounts[5], vpBlock)).toString()).to.equals("3000");
          expect((await governorReject.getVotes(accounts[6], vpBlock)).toString()).to.equals("100");
        }

        expect((await governorReject.quorum(vpBlock)).toString()).to.equals((7100 * 0.5).toString())

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVoteWithReason(proposal1Id, 0, "I don't like this proposal", { from: accounts[2] });
        await governorReject.castVote(proposal1Id, 1, { from: accounts[3] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        expect(await governorReject.hasVoted(proposal1Id, accounts[2])).to.equals(true);
        expect(await governorReject.hasVoted(proposal1Id, accounts[3])).to.equals(true);
        expect(await governorReject.hasVoted(proposal1Id, accounts[4])).to.equals(false);
        expect(await governorReject.hasVoted(proposal1Id, accounts[5])).to.equals(true);
      });

      it("Should check if proposal is pending", async () => {
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        expect((await governorReject.state(proposal1Id)).toString()).to.equals("0");
      });

      it("Should revert if voter casts invalid vote", async () => {
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        await time.increase(3600);

        let vote = governorReject.castVote(proposal1Id, 4, { from: accounts[2] });

        await expectRevert(vote, "invalid value for enum VoteType");
      });

      it("Should move execution start time of second proposal", async () => {
        // It should move execution start time of second proposal if it is before execution end time of first proposal

        // First proposal
        let propose1 = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal 1", { from: accounts[2] }) as any;

        let block1 = await time.latestBlock();
        let blockTs1 = (await web3.eth.getBlock(block1)).timestamp as number;

        let proposalId1 = propose1.logs[0].args.proposalId.toString();
        let info1 = await governorReject.getProposalInfo(proposalId1);

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
        let propose2 = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(90).encodeABI()], "Proposal 2", { from: accounts[2] }) as any;

        let block2 = await time.latestBlock();
        let blockTs2 = (await web3.eth.getBlock(block2)).timestamp as number;

        let proposalId2 = propose2.logs[0].args.proposalId.toString();
        let info2 = await governorReject.getProposalInfo(proposalId2);

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
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        let vote = governorReject.castVote(proposal1Id, 0);
        await expectRevert(vote, "proposal not active")
      });

      it("Should revert if trying to execute the same proposal twice", async () => {
        // propose
        let propose = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // check state
        expect((await governorReject.state(proposal1Id)).toString()).to.equals("3");

        // advance to the executing period
        await time.increase(1500);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        let execute = await governorReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

        // parameter should be change to 3
        expect((await executeMock.getNum()).toString()).to.equals("3");

        // try to execute again
        let execute2 = governorReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI()], descriptionHash, { from: accounts[2] }) as any;

        await expectRevert(execute2, "proposal already executed");
      });

      it("Should revert if proposal already exist", async () => {
        // propose
        await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;

        let propose2 = governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[3] }) as any;
        await expectRevert(propose2, "proposal already exists");
      });

      it("Should revert if length of target addresses is different than length of values", async () => {
        let propose = governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0, 1], [executeMock.contract.methods.setNum(3).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        await expectRevert(propose, "invalid proposal length");
      });

      it("Should revert if length of target addresses is different than length of calldatas", async () => {
        let propose = governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum(3).encodeABI(), executeMock.contract.methods.setNum(8).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        await expectRevert(propose, "invalid proposal length");
      });

      it("Should revert without message if execution on chain is not successful", async () => {
        // propose
        let propose = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum1(5).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // advance to the executing period
        await time.increase(1500);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        let execute = governorReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum1(5).encodeABI()], descriptionHash, { from: accounts[2] }) as any;
        await expectRevert(execute, "call reverted without message");
      });

      it("Should revert with message if execution on chain is not successful", async () => {
        // propose
        let propose = await governorReject.methods["propose(address[],uint256[],bytes[],string)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum2(5).encodeABI()], "Proposal", { from: accounts[2] }) as any;

        let proposal1Id = propose.logs[0].args.proposalId.toString();

        // advance to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 1, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 2, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // advance to the executing period
        await time.increase(1500);

        // execute
        let descriptionHash = web3.utils.soliditySha3("Proposal") as string;
        //web3.utils.soliditySha3(web3.utils.toHex("Proposal"));
        let execute = governorReject.methods["execute(address[],uint256[],bytes[],bytes32)"].sendTransaction([executeMock.address], [0], [executeMock.contract.methods.setNum2(5).encodeABI()], descriptionHash, { from: accounts[2] }) as any;
        await expectRevert(execute, "wrong number");
      });


      it("Should cast vote by signature", async () => {
        // create a proposal
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // calculate hashTypedDataV4
        let ballotTypehash = web3.utils.keccak256("Ballot(uint256 proposalId,uint8 support)");
        let abi = web3.eth.abi.encodeParameters(['bytes32', 'uint256', 'uint8'],
          [ballotTypehash, proposal1Id, 0]);
        let structHash = web3.utils.keccak256(abi);
        // let hash = web3.utils.soliditySha3(abi) as string;

        let typeHash = web3.utils.soliditySha3("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        let hashedName = web3.utils.soliditySha3("GovernorReject");
        let versionHex = web3.utils.utf8ToHex("1")
        let hashedVersion = web3.utils.soliditySha3(versionHex);
        let chainId = await web3.eth.getChainId();
        let thisAddress = governorReject.address;

        let encodedDomainSeparator = web3.eth.abi.encodeParameters(["bytes32", "bytes32", "bytes32", "uint256", "address"], [typeHash, hashedName, hashedVersion, chainId, thisAddress])
        let domainSeparator = web3.utils.soliditySha3(encodedDomainSeparator) as string;
        let abiEncodePacked = "0x1901" + domainSeparator.slice(2) + structHash.slice(2);
        let hashTypedDataV4 = web3.utils.soliditySha3(abiEncodePacked) as string;

        // sign with private key of accounts[2]
        let signature1 = web3.eth.accounts.sign(hashTypedDataV4, "0x23c601ae397441f3ef6f1075dcb0031ff17fb079837beadaf3c84d96c6f3e569");

        // advance to the voting period
        await time.increase(3600);

        let tx1 = await governorReject.castVoteBySig(proposal1Id, 0, signature1.v, signature1.r, signature1.s) as any;

        // signer's address and recovered address should match
        expect(tx1.logs[0].args.voter).to.equals(accounts[2]);

        let info = await governorReject.getProposalVP(proposal1Id);
        expect(info[1].toString()).to.equals("0");
        expect(info[2].toString()).to.equals("1000");
        expect(info[3].toString()).to.equals("0");

        // accounts[2] tries to vote again
        let voteAgain = governorReject.castVote(proposal1Id, 0, { from: accounts[2] });
        await expectRevert(voteAgain, "vote already cast");
      });

      it("Should revert if vote power block and end of voting period are too far apart", async () => {
        const twentyEightDays = 28 * 24 * 60 * 60;
        // change voting period length to 28 days
        await governorReject.setVotingPeriod(twentyEightDays);

        // propose
        let propose = governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        await expectRevert(propose, "vote power block is too far in the past");
      });

      it("Should not change rejection threshold for active proposal", async () => {
        let tx = await governorReject.methods["propose(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        let proposal1Id = tx.logs[0].args.proposalId.toString();

        // event ProposalSettingsReject
        expect(tx.logs[0].args.proposalId.toString()).to.equals(proposal1Id);
        expect(tx.logs[0].args.quorumThreshold.toString()).to.equals("5000");
        expect(tx.logs[0].args.rejectionThreshold.toString()).to.equals("7500");

        // advance one hour to the voting period
        await time.increase(3600);

        // voting
        await governorReject.castVote(proposal1Id, 0, { from: accounts[4] });
        await governorReject.castVote(proposal1Id, 0, { from: accounts[5] });

        let proposalVP = await governorReject.getProposalVP(proposal1Id);
        expect(proposalVP[0].toString()).to.equals("7100");
        expect(proposalVP[1].toString()).to.equals("0");
        expect(proposalVP[2].toString()).to.equals("5000");
        expect(proposalVP[3].toString()).to.equals("0");

        // advance to end of the voting period
        await time.increase(7200);

        // change rejection threshold
        expect((await governorReject.rejectionThreshold()).toString()).to.equals("7500");
        await governorReject.setRejectionThreshold("6500");
        expect((await governorReject.rejectionThreshold()).toString()).to.equals("6500");

        // execute (flag as executed) 
        let execute = await governorReject.methods["execute(string)"].sendTransaction("Proposal", { from: accounts[2] }) as any;
        expectEvent(execute, "ProposalExecuted", { proposalId: proposal1Id });
        let info1 = await governorReject.getProposalInfo(proposal1Id);
        expect(info1[6]).to.equal(true);


        // create another proposal
        let tx2 = await governorReject.methods["propose(string)"].sendTransaction("Proposal2", { from: accounts[2] }) as any;
        let proposal2Id = tx2.logs[0].args.proposalId.toString();

        expect(tx2.logs[0].args.proposalId.toString()).to.equals(proposal2Id);
        expect(tx2.logs[0].args.quorumThreshold.toString()).to.equals("5000");
        expect(tx2.logs[0].args.rejectionThreshold.toString()).to.equals("6500");

        // advance one hour to the voting period
        await time.increase(3600);

        // cast the same votes
        await governorReject.castVote(proposal2Id, 0, { from: accounts[4] });
        await governorReject.castVote(proposal2Id, 0, { from: accounts[5] });

        // advance to end of the voting period
        await time.increase(7200);

        // proposal should be rejected (defeated), beacuse rejection threshold lowered
        let state = await governorReject.state(proposal2Id);
        expect(state.toString()).to.equals("2");

        // should not be able to execute
        let execute2 = governorReject.methods["execute(string)"].sendTransaction("Proposal2", { from: accounts[2] }) as any;
        await expectRevert(execute2, "proposal not in execution state");
      });

      it("Should revert if proposal with some proposal id doesn't exists", async() => {
        let tx = governorReject.state(123);
        await expectRevert(tx, "unknown proposal id")
      });

    });

    describe("Settings change", async () => {

      it("Should set the proposalThreshold and emit ProposalThresholdSet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await governorReject.setProposalThreshold(77, { from: accounts[0] });
        expect((await governorReject.proposalThreshold()).toNumber()).to.equals(77);
        expectEvent(tx, PROPOSALTHRESHOLDSET_EVENT);

        // revert if not governance
        const promise = governorReject.setProposalThreshold(77, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the votingDelaySeconds and emit VotingDelaySet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await governorReject.setVotingDelay(1800, { from: accounts[0] });
        expect((await governorReject.votingDelay()).toNumber()).to.equals(1800);
        expectEvent(tx, VOTINGDELAYSET_EVENT);

        // revert if not governance
        const promise = governorReject.setVotingDelay(1800, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the votingPeriodSeconds and emit VotingPeriodSet, and revert if change is not made from governance or setting it to 0", async () => {
        // set property by governance and emit event
        const tx = await governorReject.setVotingPeriod(3600, { from: accounts[0] });
        expect((await governorReject.votingPeriod()).toNumber()).to.equals(3600);
        expectEvent(tx, VOTINGPERIODSET_EVENT);

        // revert if not governance
        const setNotgov = governorReject.setVotingPeriod(3600, { from: accounts[100] });
        await expectRevert(setNotgov, ONLY_GOVERNANCE_MSG);
        
        // revert if set to 0
        const setTooLow = governorReject.setVotingPeriod(0, { from: accounts[0] });
        await expectRevert(setTooLow, "voting period too low");
      });

      it("Should set the executionDelaySeconds and emit ExecutionDelaySet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await governorReject.setExecutionDelay(750, { from: accounts[0] });
        expect((await governorReject.executionDelay()).toNumber()).to.equals(750);
        expectEvent(tx, EXECUTIONDELAYSET_EVENT);

        // revert if not governance
        const promise = governorReject.setExecutionDelay(750, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the executionPeriodSeconds and emit ExecutionPeriodSet, and revert if change is not made from governance or set to 0", async () => {
        // set property by governance and emit event
        const tx = await governorReject.setExecutionPeriod(1000, { from: accounts[0] });
        expect((await governorReject.executionPeriod()).toNumber()).to.equals(1000);
        expectEvent(tx, EXECUTIONPERIODSET_EVENT);

        // revert if not governance
        const setNotGov = governorReject.setExecutionPeriod(1000, { from: accounts[100] });
        await expectRevert(setNotGov, ONLY_GOVERNANCE_MSG);
        
        // revert if set too low
        const setTooLow = governorReject.setExecutionPeriod(0, { from: accounts[0] });
        await expectRevert(setTooLow, "execution period too low");
      });

      it("Should set the quorum threshold and emit QuorumThresholdSet, and revert if change is not made from governance", async () => {
        // set property by governance and emit event
        const tx = await governorReject.setQuorumThreshold(2500, { from: accounts[0] });
        expect((await governorReject.quorumThreshold()).toNumber()).to.equals(2500);
        expectEvent(tx, QUORUMTHRESHOLDSET_EVENT);

        // revert if not governance
        const promise = governorReject.setQuorumThreshold(2500, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the vote power life time days and emit VotePowerLifeTimeDaysSet, and revert if change is not made from governance", async () => {
        const tx = await governorReject.setVotePowerLifeTimeDays(30, { from: accounts[0] });
        expect((await governorReject.getVotePowerLifeTimeDays()).toNumber()).to.equals(30);
        expectEvent(tx, VOTEPOWERLIFETIMEDAYSSET_EVENT);

        let promise = governorReject.setVotePowerLifeTimeDays(30, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the vp block period seconds and emit VpBlockPeriodSecondsSet, and revert if change is not made from governance", async () => {
        const tx = await governorReject.setVpBlockPeriodSeconds(2592000, { from: accounts[0] });
        expect((await governorReject.getVpBlockPeriodSeconds()).toNumber()).to.equals(2592000);
        expectEvent(tx, VPBLOCKPERIODSECONDSSET_EVENT);

        let promise = governorReject.setVpBlockPeriodSeconds(30, { from: accounts[100] });
        await expectRevert(promise, ONLY_GOVERNANCE_MSG);
      });

      it("Should set the rejection threshold and revert if change is not made from governance", async () => {
        await governorReject.setRejectionThreshold(9000, { from: accounts[0] });
        expect((await governorReject.rejectionThreshold()).toString()).to.equals("9000");

        let set = governorReject.setRejectionThreshold(9000, { from: accounts[100] });
        await expectRevert(set, "only governance");
      });

      it("Should change proposers", async () => {
        await governorReject.changeProposers([accounts[4], accounts[5]], [accounts[2], accounts[3]]);

        expect(await governorReject.isProposer(accounts[2])).to.equals(false);
        expect(await governorReject.isProposer(accounts[3])).to.equals(false);
        expect(await governorReject.isProposer(accounts[4])).to.equals(true);
        expect(await governorReject.isProposer(accounts[5])).to.equals(true);
        expect(await governorReject.isProposer(accounts[6])).to.equals(true);
        expect(await governorReject.isProposer(accounts[19])).to.equals(false);
      });
    });

  });

});