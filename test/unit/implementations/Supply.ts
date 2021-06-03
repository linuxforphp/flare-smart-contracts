import { MockContract } from "../../../typechain";
import { FtsoContract, FtsoInstance, FtsoRewardManagerInstance, IIRewardPoolInstance, MockContractContract, MockContractInstance, RewardPoolMockInstance, SupplyInstance, VPTokenContract, VPTokenInstance, WFlrContract, WFlrInstance } from "../../../typechain-truffle";
import { IIRewardPoolInterface } from "../../../typechain/IIRewardPool";
import { compareArrays, compareNumberArrays, increaseTimeTo, submitPriceHash, toBN } from "../../utils/test-helpers";
const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;
const Wallet = require('ethereumjs-wallet').default;

const Supply = artifacts.require("Supply");
const FtsoRewardManager = artifacts.require("FtsoRewardManager");
const MockRewardPool = artifacts.require("RewardPoolMock");
const MockRewardManager = artifacts.require("MockContract");

// contains a fresh contract for each test 
let supply: SupplyInstance;
let ftsoRewardManagerInterface: FtsoRewardManagerInstance;
let mockRewardPools: RewardPoolMockInstance[] = [];
let mockRewardManagers: MockContractInstance[];

const initialGenesisAmountWei = 10000;
const totalFoundationSupply   =  7500;
const circulatingSupply      =  initialGenesisAmountWei - totalFoundationSupply;

const totalSupplyMethod = web3.utils.sha3("totalSupplyWei()")!.slice(0,10);
const distributedSupplyMethod = web3.utils.sha3("distributedSupplyWei()")!.slice(0,10);

async function createRewardPools(totalSupplies: number[], distributedSupplies: number[]) {
    assert(totalSupplies.length == distributedSupplies.length, "Array lengths mismatch");
    mockRewardPools = [];
    for (let i = 0; i < totalSupplies.length; i++) {
        mockRewardPools.push(await createRewardPool(totalSupplies[i], distributedSupplies[i]));
    }
}

async function createRewardPool(totalSupply: number, distributedSupply: number): Promise<RewardPoolMockInstance> {
    let rewardPool = await MockRewardPool.new();
    
    await rewardPool.givenMethodReturnUint(totalSupplyMethod, totalSupply);
    await rewardPool.givenMethodReturnUint(distributedSupplyMethod, distributedSupply);
    return rewardPool;
}

async function getAddressWithZeroBalance() {
    let wallet = Wallet.generate();
    while(toBN(await web3.eth.getBalance(wallet.getChecksumAddressString())).gtn(0)) {
        wallet = Wallet.generate();
    }
    return wallet.getChecksumAddressString();
}

contract(`Supply.sol; ${getTestFile(__filename)}; Supply unit tests`, async accounts => {

    const governanceAddress = accounts[10];
    const inflationAddress = accounts[9];

    beforeEach(async() => {
        supply = await Supply.new(governanceAddress, constants.ZERO_ADDRESS, inflationAddress, initialGenesisAmountWei, totalFoundationSupply, []);
        ftsoRewardManagerInterface = await FtsoRewardManager.new(governanceAddress, 2, 0, 100, inflationAddress, supply.address);
    });

    it("Should revert deploying supply - inflation zero", async() => {
        await expectRevert(Supply.new(governanceAddress, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, initialGenesisAmountWei, totalFoundationSupply, []), "inflation zero");
    });

    it("Should revert deploying supply - initial genesis amount zero", async() => {
        await expectRevert(Supply.new(governanceAddress, constants.ZERO_ADDRESS, inflationAddress, 0, totalFoundationSupply, []), "initial genesis amount zero");
    });

    it("Should know about inflation", async() => {
        expect(await supply.inflation()).to.equals(inflationAddress);
    });

    it("Should know about burn address", async() => {
        const burnAddress = await getAddressWithZeroBalance();
        supply = await Supply.new(governanceAddress, burnAddress, inflationAddress, initialGenesisAmountWei, totalFoundationSupply, []);
        expect((await supply.burnAddress())).to.equals(burnAddress);
    });

    it("Should get initial genesis amount", async() => {
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
    });

    it("Should get circulating supply", async() => {
        const currentBlockNumber = await web3.eth.getBlockNumber();
        expect((await supply.getCirculatingSupplyAt(currentBlockNumber + 5)).toNumber()).to.equals(circulatingSupply);
        expect((await supply.getCirculatingSupplyAt(currentBlockNumber)).toNumber()).to.equals(circulatingSupply);
        expect((await supply.getCirculatingSupplyAt(0)).toNumber()).to.equals(0);
    });

    it("Should get circulating supply (cached)", async() => {
        const currentBlockNumber = await web3.eth.getBlockNumber();
        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        let timestamp = await time.latest();
        await increaseTimeTo(timestamp + 10, "web3");

        expect(await supply.contract.methods.getCirculatingSupplyAtCached(currentBlockNumber).call()).to.equals(circulatingSupply.toString());
        expect(await supply.contract.methods.getCirculatingSupplyAtCached(0).call()).to.equals('0');
    });

    it("Should revert getting circulating supply (cached) for future block", async() => {
        const currentBlockNumber = await web3.eth.getBlockNumber();
        await expectRevert.unspecified(supply.contract.methods.getCirculatingSupplyAtCached(currentBlockNumber + 10).call());
    });

    it("Should get inflatable balance", async() => {
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
    });

    it("Should add authorized inflation", async() => {
        await supply.addAuthorizedInflation(100, {from: inflationAddress});
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.totalInflationAuthorizedWei()).toNumber()).to.equals(100);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei + 100);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 100);
    });

    it("Should add authorized inflation and update burn address balance", async() => {
        const burnAddress = await getAddressWithZeroBalance();
        supply = await Supply.new(governanceAddress, burnAddress, inflationAddress, initialGenesisAmountWei, totalFoundationSupply, []);
        await web3.eth.sendTransaction({ to: burnAddress, value: toBN(200), from: accounts[1] });
        await supply.addAuthorizedInflation(100, {from: inflationAddress});
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.totalInflationAuthorizedWei()).toNumber()).to.equals(100);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei + 100);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 100 - 200);
    });

    it("Should revert adding authorized inflation if not from inflation contract", async() => {
        await expectRevert(supply.addAuthorizedInflation(100, {from: accounts[0]}), "Access denied");
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
    });

    it("Should add revard manager", async() => {
        await supply.addRewardManager(accounts[1], {from: governanceAddress});
    });

    it("Should revert adding revard manager if not from governance", async() => {
        await expectRevert(supply.addRewardManager(accounts[1], {from: accounts[0]}), "only governance");
    });

    it("Should update reward manager data", async() => {
        await supply.addRewardManager(accounts[1], {from: governanceAddress});
        await supply.updateRewardManagerData(1000, 100, {from: accounts[1]});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 100);
    });

    it("Should update reward manager data 2", async() => {
        await supply.addRewardManager(accounts[1], {from: governanceAddress});
        await supply.updateRewardManagerData(1000, 100, {from: accounts[1]});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 100);
        // round 2
        await supply.updateRewardManagerData(1200, 200, {from: accounts[1]});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 100 - 200 + 100);
    });

    it("Should revert updating reward manager data if incorrect values are sent", async() => {
        await supply.addRewardManager(accounts[1], {from: governanceAddress});
        await supply.updateRewardManagerData(1000, 100, {from: accounts[1]});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 100);
        // round 2
        await expectRevert.unspecified(supply.updateRewardManagerData(500, 200, {from: accounts[1]}));
        await expectRevert.unspecified(supply.updateRewardManagerData(1100, 50, {from: accounts[1]}));
        await expectRevert.assertion(supply.updateRewardManagerData(1100, 1200, {from: accounts[1]}));
    });

    it("Should revert updating reward manager data if not added", async() => {
        await expectRevert(supply.updateRewardManagerData(1000, 100, {from: accounts[1]}), "Access denied");
    });

    it("Should add reward pool", async() => {
        let rewardPool = await createRewardPool(1000, 0);
        await supply.addRewardPool(rewardPool.address, 1000, {from: governanceAddress});
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 1000);
    });

    it("Should add reward pool 2", async() => {
        let rewardPool = await createRewardPool(1000, 200);
        await supply.addRewardPool(rewardPool.address, 900, {from: governanceAddress});
        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 900 + 200);
    });
    
    it("Should revert adding reward pool twice", async() => {
        let rewardPool = await createRewardPool(1000, 0);
        await supply.addRewardPool(rewardPool.address, 1000, {from: governanceAddress});
        await expectRevert(supply.addRewardPool(rewardPool.address, 1000, {from: governanceAddress}), "Reward pool already added");
    });

    it("Should revert adding reward pool if not from governance", async() => {
        let rewardPool = await createRewardPool(1000, 0);
        await expectRevert(supply.addRewardPool(rewardPool.address, 100, {from: accounts[0]}), "only governance");
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
    });

    it("Should update reward pool distributed value", async() => {
        let rewardPool = await createRewardPool(1000, 0);
        await rewardPool.setSupply(supply.address);
        await supply.addRewardPool(rewardPool.address, 1000, {from: governanceAddress});
        await rewardPool.updateRewardPoolDistributedAmountCall(200);

        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 1000 + 200);
    });

    it("Should update reward pool distributed value 2", async() => {
        let rewardPool = await createRewardPool(1000, 0);
        await rewardPool.setSupply(supply.address);
        await supply.addRewardPool(rewardPool.address, 1000, {from: governanceAddress});
        await rewardPool.updateRewardPoolDistributedAmountCall(200);
        // round 2
        await rewardPool.updateRewardPoolDistributedAmountCall(500);

        expect((await supply.initialGenesisAmountWei()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 1000 + 1000 + 500);
    });

    it("Should revert updating reward pool distributed value if not enough founds", async() => {
        let rewardPool = await createRewardPool(1000, 0);
        await rewardPool.setSupply(supply.address);
        await supply.addRewardPool(rewardPool.address, 1000, {from: governanceAddress});
        await expectRevert.unspecified(rewardPool.updateRewardPoolDistributedAmountCall(1100));
    });

    it("Should revert updating reward pool distributed value if not known reward pool", async() => {
        await expectRevert(supply.updateRewardPoolDistributedAmount(900, {from: accounts[1]}), "Access denied");
    });

    it("Should deploy supply with reward pools", async() => {
        await createRewardPools([500, 1000], [200, 50]);
        supply = await Supply.new(governanceAddress, constants.ZERO_ADDRESS, inflationAddress, initialGenesisAmountWei, totalFoundationSupply, mockRewardPools.map(rp => rp.address));
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 500 - 1000 + 200 + 50);
    });

    it("Should deploy supply with some burn address balance", async() => {
        const burnAddress = await getAddressWithZeroBalance();
        await web3.eth.sendTransaction({ to: burnAddress, value: toBN(100), from: accounts[1] });
        supply = await Supply.new(governanceAddress, burnAddress, inflationAddress, initialGenesisAmountWei, totalFoundationSupply, []);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 100);
    });
    
    it("Should change burn address", async() => {
        const burnAddress = await getAddressWithZeroBalance();
        await supply.changeBurnAddress(burnAddress, {from: governanceAddress});
        expect((await supply.burnAddress())).to.equals(burnAddress);
    });

    it("Should revert changing burn address if not from governance", async() => {
        const burnAddress = await getAddressWithZeroBalance();
        await expectRevert(supply.changeBurnAddress(burnAddress, {from: accounts[0]}), "only governance");
    });

    it("Should change burn address and update circulating balance", async() => {
        const burnAddress = await getAddressWithZeroBalance();
        supply = await Supply.new(governanceAddress, burnAddress, inflationAddress, initialGenesisAmountWei, totalFoundationSupply, []);

        await web3.eth.sendTransaction({ to: burnAddress, value: toBN(100), from: accounts[1] });
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply);
        const newBurnAddress = await getAddressWithZeroBalance();
        await supply.changeBurnAddress(newBurnAddress, {from: governanceAddress});

        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 100);
    });

    it("Should change burn address and update circulating balance 2", async() => {
        const burnAddress = await getAddressWithZeroBalance();
        supply = await Supply.new(governanceAddress, burnAddress, inflationAddress, initialGenesisAmountWei, totalFoundationSupply, []);

        await web3.eth.sendTransaction({ to: burnAddress, value: toBN(100), from: accounts[1] });
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply);
        const newBurnAddress = await getAddressWithZeroBalance();
        await web3.eth.sendTransaction({ to: newBurnAddress, value: toBN(200), from: accounts[1] });
        await supply.changeBurnAddress(newBurnAddress, {from: governanceAddress});

        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply - 100 - 200);
    });

    it("Should decrease foundation supply", async() => {
        await supply.decreaseFoundationSupply(500, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500);
    });

    it("Should decrease foundation supply 2", async() => {
        await supply.decreaseFoundationSupply(500, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500);

        // round 2
        await supply.decreaseFoundationSupply(1000, {from: governanceAddress});
        expect((await supply.getInflatableBalance()).toNumber()).to.equals(initialGenesisAmountWei);
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500 + 1000);
    });

    it("Should revert decreasing foundation supply if not from governance", async() => {
        await expectRevert(supply.decreaseFoundationSupply(500, {from: accounts[0]}), "only governance");
    });

    it("Should revert decreasing foundation supply if not enough founds", async() => {
        await supply.decreaseFoundationSupply(500, {from: governanceAddress});
        expect((await supply.getCirculatingSupplyAt(await web3.eth.getBlockNumber())).toNumber()).to.equals(circulatingSupply + 500);

        await expectRevert.assertion(supply.decreaseFoundationSupply(totalFoundationSupply, {from: governanceAddress}));
    });
});
