import { VPTokenMockContract, VPTokenMockInstance } from "../../../typechain-truffle";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { coinFlip, linearFallingRandom, loadJson, MAX_BIPS, Nullable, randomChoice, randomInt, randomIntDist, saveJson, weightedRandomChoice } from "./FuzzingUtils";
import { VPTokenChecker } from "./VPTokenChecker";
import { Checkpoint, VPTokenHistory, VPTokenSimulator } from "./VPTokenSimulator";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
const { constants, expectRevert, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock") as VPTokenMockContract;


contract(`VPToken.sol; ${getTestFile(__filename)}; Token fuzzing tests`, availableAccounts => {
    let vpToken: VPTokenMockInstance;
    let history: VPTokenHistory;
    let simulator: VPTokenSimulator;
    
    let env = process.env;

    ///////////////////////////////////////////////////////////////////////////////////////
    // PARAMETERS
    
    // when set and true (ok, not 'false') replays the previous test run (saved in `cache/history.json`)
    let REPLAY = env.REPLAY ? env.REPLAY !== 'false' : false;
    
    // the length of the run (i.e. the number of actions executed)
    let LENGTH = env.LENGTH ? Number(env.LENGTH) : 3000;

    // there are two ways to set checkpoint indices:
    // 1) create a checkpoint at each index in the checkpoint list
    let CHECKPOINT_LIST = env.CHECKPOINT_LIST ? env.CHECKPOINT_LIST.split(',').map(s => Number(s)) : null;

    // 2) create a checkpoint after every CHECKPOINT_EVERY actions
    let CHECKPOINT_EVERY = env.CHECKPOINT_EVERY ? Number(env.CHECKPOINT_EVERY) : 1000;

    // the number of accounts participating in tests (actually, there are 2 more - governance and a user)
    let N_ACCOUNTS = env.N_ACCOUNTS ? Number(env.N_ACCOUNTS) : 50;
    
    // the number of accounts that will always delgate by percent
    let N_PERC_DLG = env.N_PERC_DLG ? Number(env.N_PERC_DLG) : 20;
    
    // the number of accounts that will always delgate explicitly
    let N_AMOUNT_DLG = env.N_AMOUNT_DLG ? Number(env.N_AMOUNT_DLG) : 10;

    // the initial amount of tokens minted to all participating accounts
    let INIT_AMOUNT = env.INIT_AMOUNT ? Number(env.INIT_AMOUNT) : 1_000_000;

    // the block number to replace write vpcontract
    let REPLACE_VPCONTRACT_AT = env.REPLACE_VPCONTRACT_AT ? Number(env.REPLACE_VPCONTRACT_AT) : null;
    
    // the number of blocks to work with differrent read and write vpcontracts
    let SPLIT_VPCONTRACTS_BLOCKS = env.SPLIT_VPCONTRACTS_BLOCKS ? Number(env.SPLIT_VPCONTRACTS_BLOCKS) : 0;

    // END PARAMETERS
    ///////////////////////////////////////////////////////////////////////////////////////

    let governance = availableAccounts[0];
    let plainuser = availableAccounts[1];
    let accounts = availableAccounts.slice(2, N_ACCOUNTS + 2).concat(constants.ZERO_ADDRESS);

    let percentageAccounts = accounts.slice(0, N_PERC_DLG);
    let explicitAccounts = accounts.slice(N_PERC_DLG, N_PERC_DLG + N_AMOUNT_DLG);
    let otherAccounts = accounts.slice(N_PERC_DLG + N_AMOUNT_DLG);

    // VPToken wrappers
    before(async () => {
        vpToken = await VPToken.new(governance, "Test token", "TTOK");
        await setDefaultVPContract(vpToken, governance);
        history = new VPTokenHistory(vpToken);
        simulator = new VPTokenSimulator(history);
    });

    // utility functions
    it("run randomized tests", async () => {
        if (REPLAY) {
            await loadAndReplayHistory();
        } else {
            await runRandomActions();
            saveHistory();
        }

        history.state.save('cache/state.json', 4);
        for (const cp of history.checkpoints.values()) {
            cp.state.save(`cache/state-${cp.id}.json`, 4);
        }

        console.log("Checking...");
        await performChecks(vpToken, history, null);
        for (const checkpoint of history.checkpoints.values()) {
            await performChecks(vpToken, history, checkpoint);
        }
    });

    async function runRandomActions() {
        console.log("Minting...");
        for (const account of accounts) {
            await simulator.mint(governance, account, INIT_AMOUNT);
        }

        const presentActions: Array<[() => Promise<void>, number]> = [
            [testTransfer, 5],
            [testDelegate, 10],
            [testDelegateExplicit, 10],
            [testUndelegateAll, 1],
            [testUndelegateAllExplicit, 1],
        ];
        const historyActions: Array<[() => Promise<void>, number]> = [
            [testRevokeDelegationAt, 5],
            [testVotePowerAtCached, 5],
            [testVotePowerOfAtCached, 5],
        ]
        const allActions = presentActions.concat(historyActions);

        console.log("Running actions...");
        for (let i = 1; i <= LENGTH; i++) {
            if (i % 100 === 0) console.log("   ", i);
            const actions = history.checkpoints.size === 0 ? presentActions : allActions;
            const action = weightedRandomChoice(actions);
            simulator.context = i;
            await action();
            if (REPLACE_VPCONTRACT_AT != null) {
                if (i === REPLACE_VPCONTRACT_AT) {
                    await replaceWriteVpContract();
                }
                if (i === REPLACE_VPCONTRACT_AT + SPLIT_VPCONTRACTS_BLOCKS) {
                    await replaceReadVpContract();
                }
            }
            const isCheckpoint = CHECKPOINT_LIST != null ? CHECKPOINT_LIST.includes(i) : (i < LENGTH && i % CHECKPOINT_EVERY === 0);
            if (isCheckpoint) {
                await history.createCheckpoint('CP' + i);
                // can only enable cleanup before first checkpoint, aince all checkpoints will be read at the end
                if (history.checkpoints.size === 1) {
                    await setCleanupBlock(0);
                }
            }
        }

    }
    
    async function replaceWriteVpContract() {
        await simulator.replaceWriteVpContract(governance);
    }

    async function replaceReadVpContract() {
        await simulator.replaceReadVpContract(governance);
    }

    async function setCleanupBlock(index: number) {
        const cp = history.checkpointList()[index];
        await simulator.setCleanupBlock(governance, cp.id);
    }
    
    async function testTransfer() {
        const from = randomChoice(accounts);
        const to = randomChoice(accounts);
        const balance = history.state.balances.get(from).toNumber();
        const amount = coinFlip(0.9) ? randomInt(balance) : randomInt(INIT_AMOUNT);
        await simulator.transfer(from, to, amount);
    }

    async function testDelegate() {
        const from = randomChoice(coinFlip(0.9) ? percentageAccounts : otherAccounts);
        const to = randomChoice(accounts);
        const bips = randomIntDist(0, MAX_BIPS.toNumber(), linearFallingRandom);
        await simulator.delegate(from, to, bips);
    }

    async function testDelegateExplicit() {
        const from = randomChoice(coinFlip(0.9) ? explicitAccounts : otherAccounts);
        const to = randomChoice(accounts);
        const balance = history.state.balances.get(from).toNumber();
        const amount = randomIntDist(0, balance, linearFallingRandom);
        await simulator.delegateExplicit(from, to, amount);
    }

    async function testRevokeDelegationAt() {
        const checkpoints = history.checkpointList();
        if (checkpoints.length === 0) return;
        const cp = checkpoints[checkpoints.length - 1];
        const from = randomChoice(accounts);
        const fromDelegates = cp.state.delegateesOf(from);
        const to = randomChoice(fromDelegates.length > 0 && coinFlip(0.9) ? fromDelegates : accounts);
        await simulator.revokeDelegationAt(from, to, cp.id);
    }

    async function testUndelegateAll() {
        const from = randomChoice(coinFlip(0.9) ? percentageAccounts : otherAccounts);
        await simulator.undelegateAll(from);
    }

    async function testUndelegateAllExplicit() {
        const from = randomChoice(coinFlip(0.9) ? explicitAccounts : otherAccounts);
        const fromDelegates = Array.from(history.state.amountDelegations.rowMap(from).keys());
        await simulator.undelegateAllExplicit(from, fromDelegates);
    }

    async function testVotePowerAtCached() {
        const checkpoints = history.checkpointList();
        if (checkpoints.length === 0) return;
        const cp = randomChoice(checkpoints);
        await simulator.votePowerAtCached(plainuser, cp.id);
    }

    async function testVotePowerOfAtCached() {
        const checkpoints = history.checkpointList();
        if (checkpoints.length === 0) return;
        const cp = randomChoice(checkpoints);
        const from = randomChoice(accounts);
        await simulator.votePowerOfAtCached(plainuser, from, cp.id);
    }

    async function performChecks(vpToken: VPTokenMockInstance, history: VPTokenHistory, checkpoint: Nullable<Checkpoint>) {
        const checker = checkpoint != null
            ? new VPTokenChecker(vpToken, checkpoint.blockNumber, accounts, checkpoint.state)
            : new VPTokenChecker(vpToken, null, accounts, history.state)

        const cpMsg = checkpoint ? `for checkpoint ${checkpoint.id}` : '';

        console.log("Checking invariants", cpMsg);
        await checker.checkInvariants();

        console.log("Checking state", cpMsg);
        await checker.checkStateMatch();
    }

    function saveHistory() {
        history.save('cache/history.json', 4);
        saveJson('cache/accounts.json', { N_ACCOUNTS, N_PERC_DLG, N_AMOUNT_DLG, governance, plainuser, accounts }, 4);
    }

    async function loadAndReplayHistory() {
        console.log("Replaying...");
        history.load('cache/history.json');
        for (const action of history.history) {
            await history.execute(action);
        }
        ({ N_ACCOUNTS, N_PERC_DLG, N_AMOUNT_DLG, governance, plainuser, accounts } = loadJson('cache/accounts.json'));
        percentageAccounts = accounts.slice(0, N_PERC_DLG);
        explicitAccounts = accounts.slice(N_PERC_DLG, N_PERC_DLG + N_AMOUNT_DLG);
        otherAccounts = accounts.slice(N_PERC_DLG + N_AMOUNT_DLG);
    }
});
