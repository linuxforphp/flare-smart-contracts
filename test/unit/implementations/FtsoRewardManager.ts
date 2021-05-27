import { compareArrays, compareNumberArrays, toBN } from "../../utils/test-helpers";
import { FtsoManagerContract, FtsoManagerInstance, FtsoManagerMockContract, FtsoManagerMockInstance, FtsoRewardManagerAccountingInstance, MockContractInstance, FtsoRewardManagerContract, FtsoRewardManagerInstance, WFlrContract, WFlrInstance, FlareKeeperInstance } from "../../../typechain-truffle";

const { constants, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const getTestFile = require('../../utils/constants').getTestFile;

const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const FtsoRewardManagerAccounting = artifacts.require("FtsoRewardManagerAccounting");
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const WFLR = artifacts.require("WFlr") as WFlrContract;
const MockContract = artifacts.require("MockContract");
const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

const ERR_CLOSE_MANAGER_ONLY = "close manager only";    

// contains a fresh contract for each test
let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let wFlr: WFlrInstance;
let mockFtsoRewardManagerAccounting: MockContractInstance;
let ftsoRewardManagerAccountingInterface: FtsoRewardManagerAccountingInstance;
let ftsoInflationAuthorizer: MockContractInstance;
let mockSupplyAccounting: MockContractInstance;
let mockCloseManager: MockContractInstance;

const getRewardManagerBalance = web3.utils.sha3("getRewardManagerBalance()")!.slice(0,10); // first 4 bytes is function selector
const getUndistributedFtsoInflationBalance = web3.utils.sha3("getUndistributedFtsoInflationBalance()")!.slice(0,10); // first 4 bytes is function selector

async function distributeRewards(accounts: Truffle.Accounts, currentRewardEpoch: number = 0, sendFlrs: boolean = true) {
    let votePowerBlock = await web3.eth.getBlockNumber();
    // Assemble
    // Stub accounting system to make it balance with RM contract
    await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);

    // Stub accounting system to return the undistributed balance to reward manager
    await mockSupplyAccounting.givenMethodReturnUint(getUndistributedFtsoInflationBalance, 1000000);
    if (sendFlrs) {
        // give reward manager some flr to distribute
        await web3.eth.sendTransaction({ from: accounts[0], to: ftsoRewardManager.address, value: 1000000 });
    }
    
    // Let's assume the number of price epochs remaining is 720 (a days worth at 2 minute price epochs)
    // Trigger price epoch finalization
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        0,
        accounts[6],
        720,
        currentRewardEpoch
    );

    // Have accounting system simulate having been updated with the amount just awarded (1/720 of 1000000)
    await mockSupplyAccounting.givenMethodReturnUint(getUndistributedFtsoInflationBalance, 998611);

    // Let's do another price epoch
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        10,
        accounts[6],
        719,
        currentRewardEpoch
    );

    const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(currentRewardEpoch).encodeABI();
    const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
    await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
}

async function travelToAndSetNewRewardEpoch(newRewardEpoch: number) {
    // Travel to new reward epoch
    await time.increaseTo(startTs.addn(newRewardEpoch * REWARD_EPOCH_DURATION_S));
    // Fake Trigger reward epoch finalization
    const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
    const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter( 'uint256', newRewardEpoch);
    await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
}

contract(`FtsoRewardManager.sol; ${ getTestFile(__filename) }; Ftso reward manager unit tests`, async accounts => {

    let fakeFlareKeeperAddress = accounts[0];

    beforeEach(async () => {
        mockFtsoManager = await MockFtsoManager.new();
        mockFtsoRewardManagerAccounting = await MockContract.new();
        mockSupplyAccounting = await MockContract.new();
        mockCloseManager = await MockContract.new();
        ftsoRewardManagerAccountingInterface = await FtsoRewardManagerAccounting.new(
          accounts[0], 
          (await MockContract.new()).address)

        // Force a block in order to get most up to date time
        await time.advanceBlock();
        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoRewardManager = await FtsoRewardManager.new(
            accounts[0],
            mockFtsoRewardManagerAccounting.address,
            mockSupplyAccounting.address,
            3,
            0,
            100,
            accounts[0] // This should be closeManager address...just plug so we can fake close.
        );

        ftsoInflationAuthorizer = await MockContract.new();

        ftsoManagerInterface = await FtsoManager.new(
            accounts[0],
            ftsoRewardManager.address,
            accounts[7],
            ftsoInflationAuthorizer.address,
            PRICE_EPOCH_DURATION_S,
            startTs,
            REVEAL_EPOCH_DURATION_S,
            REWARD_EPOCH_DURATION_S,
            startTs,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        wFlr = await WFLR.new();

        await ftsoRewardManager.setFTSOManager(mockFtsoManager.address);
        await ftsoRewardManager.setWFLR(wFlr.address);
        await ftsoRewardManager.setFlareKeeper(fakeFlareKeeperAddress);
        // await inflation.setRewardManager(rewardManager.address);

        await mockFtsoManager.setRewardManager(ftsoRewardManager.address);
        await ftsoRewardManager.activate();
    });

    describe("basic", async () => {
        it("Should revert calling activate if ftso manger is not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                mockFtsoRewardManagerAccounting.address,
                mockSupplyAccounting.address,
                3,
                0,
                100,
                mockCloseManager.address
            );

            await expectRevert(ftsoRewardManager.activate(), "no ftso manager");
        });

        it("Should revert calling activate if wflr is not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                mockFtsoRewardManagerAccounting.address,
                mockSupplyAccounting.address,
                3,
                0,
                100,
                mockCloseManager.address
            );

            await ftsoRewardManager.setFTSOManager(mockFtsoManager.address);

            await expectRevert(ftsoRewardManager.activate(), "no wflr");
        });

        it("Should revert calling activate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.activate({ from: accounts[1]}), "only governance");
        });

        it("Should deactivate and disable claiming rewards", async () => {
            await ftsoRewardManager.deactivate();

            expectRevert(ftsoRewardManager.claimReward(accounts[2], [0]), "reward manager deactivated");
            expectRevert(ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]]), "reward manager deactivated");
        });

        it("Should revert calling deactivate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.deactivate({ from: accounts[1]}), "only governance");
        });

        it("Should revert calling setFtsoManager if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setFTSOManager(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setFtsoManager if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.setFTSOManager(constants.ZERO_ADDRESS), "no ftso manager");
        });

        it("Should revert calling setWFLR if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setWFLR(accounts[2], { from: accounts[1]}), "only governance");
        });

        it("Should revert calling setWFLR if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.setWFLR(constants.ZERO_ADDRESS), "no wflr");
        });

        it("Should update close manager", async () => {
            expect(await ftsoRewardManager.closeManager()).to.equals(accounts[0]);
            await ftsoRewardManager.setCloseManager(accounts[8]);
            expect(await ftsoRewardManager.closeManager()).to.equals(accounts[8]);
        });

        it("Should not close if not from close manager", async() => {
            // Assemble
            // Act
            const closePromise = ftsoRewardManager.close({from: accounts[1]});
            // Assert
            await expectRevert(closePromise, ERR_CLOSE_MANAGER_ONLY)
        });

        it("Should get epoch to expire next", async () => {
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(100);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(101);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(1);
        });

        it("Should get unreported claimed rewards amount", async () => {
            expect((await ftsoRewardManager.getUnreportedClaimedRewardsAmount()).toNumber()).to.equals(0);
        });
    });

    describe("Price epochs, finalization", async () => {
        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            // Stub accounting system to make it balance with RM contract
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);
            // Stub accounting system to return the undistributed balance to reward manager
            await mockSupplyAccounting.givenMethodReturnUint(getUndistributedFtsoInflationBalance, 1000000);
            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: fakeFlareKeeperAddress, to: ftsoRewardManager.address, value: 1000000 });

            // Give 3 price epochs remaining, and so it should distribute 1/3 of the amount.
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                3,
                0
            );

            // Assert
            // 1000000 / 3 = 333333.3 repeating. Decimal will get truncated.
            // a1 should be (1000000 / 3) * 0.25 = 83333.3 repeating
            // a2 should be = (1000000 / 3) * 0.75 = 250000
            // There is a remainder of 0.3 repeating. A double declining balance should net
            // this out as tranches are allocated (not tested here).
            let a1UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[2]);
            assert.equal(a1UnclaimedReward.toNumber(), 83334);
            assert.equal(a2UnclaimedReward.toNumber(), 249999);
        });

        it("Should finalize price epoch and distribute unclaimed rewards - should distribute all if 0 remaining price epochs", async () => {
            // Stub accounting system to make it balance with RM contract
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);
            // Stub accounting system to return the undistributed balance to reward manager
            await mockSupplyAccounting.givenMethodReturnUint(getUndistributedFtsoInflationBalance, 1000000);
            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: fakeFlareKeeperAddress, to: ftsoRewardManager.address, value: 1000000 });

            // Give 3 price epochs remaining, and so it should distribute whole of the amount.
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                0,
                0
            );

            // Assert
            // a1 should be 1000000 * 0.25 = 250000
            // a2 should be = 1000000 * 0.75 = 750000
            let a1UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.unclaimedRewardsPerRewardEpoch(0, accounts[2]);
            assert.equal(a1UnclaimedReward.toNumber(), 250000);
            assert.equal(a2UnclaimedReward.toNumber(), 750000);
        });

        it("Should only be called from ftso manager", async () => {
            // Stub accounting system to make it balance with RM contract
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);
            // Stub accounting system to return the undistributed balance to reward manager
            await mockSupplyAccounting.givenMethodReturnUint(getUndistributedFtsoInflationBalance, 1000000);
            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: accounts[0], to: ftsoRewardManager.address, value: 1000000 });

            // Give 3 price epochs remaining, and so it should distribute 1/3 of the amount.
            await expectRevert(ftsoRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                3,
                0
            ), "ftso manager only");
        });
    });

    describe("getters and setters", async () => {
        it("Should set and update data provider fee percentage", async () => {
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(1);
            await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);
            
            await travelToAndSetNewRewardEpoch(2);
            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[2] });
            await ftsoRewardManager.setDataProviderFeePercentage(15, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);
            
            await travelToAndSetNewRewardEpoch(3);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(5);
                        
            await travelToAndSetNewRewardEpoch(4);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(10);
                                    
            await travelToAndSetNewRewardEpoch(5);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(15);
        });

        it("Should get scheduled fee percentage", async () => {
            let data;
            
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);

            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5]);
            compareNumberArrays(data[1], [3]);
            compareArrays(data[2], [false]);

            await travelToAndSetNewRewardEpoch(1);
            expectEvent(await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[1] }),"FeePercentageChanged", 
                {dataProvider: accounts[1], value: toBN(10), validFromEpoch: toBN(4)});
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10]);
            compareNumberArrays(data[1], [3, 4]);
            compareArrays(data[2], [true, false]);
            
            await travelToAndSetNewRewardEpoch(2);
            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10, 8]);
            compareNumberArrays(data[1], [3, 4, 5]);
            compareArrays(data[2], [true, true, false]);
            await ftsoRewardManager.setDataProviderFeePercentage(15, { from: accounts[1] });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10, 15]);
            compareNumberArrays(data[1], [3, 4, 5]);
            compareArrays(data[2], [true, true, false]);
            
            await travelToAndSetNewRewardEpoch(3);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [10, 15]);
            compareNumberArrays(data[1], [4, 5]);
            compareArrays(data[2], [true, true]);

            await travelToAndSetNewRewardEpoch(4);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [15]);
            compareNumberArrays(data[1], [5]);
            compareArrays(data[2], [true]);

            await travelToAndSetNewRewardEpoch(5);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
        });

        it("Should revert if fee percentage > max bips", async () => {
            await expectRevert(ftsoRewardManager.setDataProviderFeePercentage(15000, { from: accounts[1] }), "invalid fee percentage value");
        });

        it("Should get state of rewards", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [694]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards - delegator only", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegate(accounts[1], 5000, { from: accounts[4] });
            
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[4], [0], { from: accounts[4]});

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards - delegator and provider - percentage", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[2], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegate(accounts[1], 5000, { from: accounts[2] });
            
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1]}), "RewardClaimed",
                {dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(347)});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            let tx = await ftsoRewardManager.claimReward(accounts[2], [0], { from: accounts[2]});
            expect(tx.logs[0].event).to.equals("RewardClaimed");
            expect(tx.logs[1].event).to.equals("RewardClaimed");

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [true, true]);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [2082, 347]);
            compareArrays(data[2], [true, true]);
            expect(data[3]).to.equals(false);
        });

        it("Should revert at get state of rewards if delegated explicitly", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[2], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await expectRevert(ftsoRewardManager.getStateOfRewards(accounts[2], 0), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should get state of rewards - delegator and provider - explicit", async () => {
            let data;
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[2], value: "200" });
            
            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
            
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1]}), "RewardClaimed",
                {dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(347)});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]], { from: accounts[2]}), "RewardClaimed",
                {dataProvider: accounts[1], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(347)});

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[2]], { from: accounts[2]}), "RewardClaimed",
                {dataProvider: accounts[2], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(2082)});

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [347]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 0]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [347, 2082]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(false);
        });

        it("Should get state of rewards - no reward", async () => {
            let data;
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards from data providers - no reward", async () => {
            let data;
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            await ftsoRewardManager.claimRewardFromDataProviders(accounts[1], [0], [accounts[1], accounts[2]], { from: accounts[1]});
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(true);

            await travelToAndSetNewRewardEpoch(101);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(false);
        });

    });

    describe("reward claiming", async () => {
        it("Should accept FLR", async () => {
            // Assemble
            // Stub accounting system to make it balance with RM contract
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);
            // Act
            await web3.eth.sendTransaction({ from: accounts[0], to: ftsoRewardManager.address, value: 1000000 });
            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(ftsoRewardManager.address));
            assert.equal(balance.toNumber(), 1000000);
        });

        // accounting changed
        it("Should enable rewards to be claimed once reward epoch finalized - percentage", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);

            // Let's do a fakey close and see if RM reports claims-to-date to accounting.
            // I'd rather do another test, but am too lazy to re-do all this pre-amble just to do the below assert.
            await ftsoRewardManager.close();
            const rewardsClaimed = ftsoRewardManagerAccountingInterface.contract.methods.rewardsClaimed(694).encodeABI();
            const invocationCount = await mockFtsoRewardManagerAccounting.invocationCountForCalldata.call(rewardsClaimed);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - percentage", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - should not claim twice", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            let flrClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance1.sub(flrOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let flrClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance3.sub(flrOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - get 0 if not rewarded ftso", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewards(accounts[4], 0, { from: accounts[4] });
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - percentage", async () => { 

            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await time.increaseTo(startTs.addn(3 * REWARD_EPOCH_DURATION_S));

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts, 3);
            await travelToAndSetNewRewardEpoch(4);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 0.95 (fee) = 329
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 329);
            
            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 1.05 (fee) = 364
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 364);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - percentage", async () => { 

            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await time.increaseTo(startTs.addn(3 * REWARD_EPOCH_DURATION_S));

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "1000" });
            await wFlr.deposit({ from: accounts[4], value: "1" });

            // delegate some wflrs
            await wFlr.delegate(accounts[1], 10000, { from: accounts[4] });
            
            await distributeRewards(accounts, 3);
            await travelToAndSetNewRewardEpoch(4);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 0
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) = 693
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 693);
        });

        it("Should enable rewards to be claimed once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);

            // Let's do a fakey close and see if RM reports claims-to-date to accounting.
            // I'd rather do another test, but am too lazy to re-do all this pre-amble just to do the below assert.
            await ftsoRewardManager.close();
            const rewardsClaimed = ftsoRewardManagerAccountingInterface.contract.methods.rewardsClaimed(694).encodeABI();
            const invocationCount = await mockFtsoRewardManagerAccounting.invocationCountForCalldata.call(rewardsClaimed);
            assert.equal(invocationCount.toNumber(), 1);
        });

        it("Should revert at claiming rewards (not using claimRewardFromDataProviders) once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[2], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[2] });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            await expectRevert(ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[2] }), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 694);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - should not claim twice", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            let flrClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance1.sub(flrOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 347);

            // if claiming again, get 0
            let flrOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 347
            let flrClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance3.sub(flrOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - get 0 if not rewarded ftso", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[4], 0, [accounts[1]], { from: accounts[4] });
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - explicit", async () => { 

            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await time.increaseTo(startTs.addn(3 * REWARD_EPOCH_DURATION_S));

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            await wFlr.deposit({ from: accounts[4], value: "100" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            
            await distributeRewards(accounts, 3);
            await travelToAndSetNewRewardEpoch(4);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 0.95 (fee) = 329
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 329);
            
            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 1.05 (fee) = 364
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 364);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - explicit", async () => { 

            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await time.increaseTo(startTs.addn(3 * REWARD_EPOCH_DURATION_S));

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "1000" });
            await wFlr.deposit({ from: accounts[4], value: "1" });

            // delegate some wflrs
            await wFlr.delegateExplicit(accounts[1], 1, { from: accounts[4] });
            
            await distributeRewards(accounts, 3);
            await travelToAndSetNewRewardEpoch(4);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (1000000 / 720) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 0
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });
            // a1 -> a5 claimed should be (1000000 / 720) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) = 693
            let flrClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(flrClosingBalance2.sub(flrOpeningBalance2).toNumber(), 693);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized", async () => {
            await wFlr.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);
            await distributeRewards(accounts, 1, false);
            await travelToAndSetNewRewardEpoch(2);
            await distributeRewards(accounts, 2, false);

            // can claim 2 * 694 = 1388
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0, 1, 2, 3], { from: accounts[1] });

            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 1388);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized - explicit", async () => {
            await wFlr.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts);
            await travelToAndSetNewRewardEpoch(1);
            await distributeRewards(accounts, 1, false);
            await travelToAndSetNewRewardEpoch(2);
            await distributeRewards(accounts, 2, false);

            // can claim 2 * 694 = 1388
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0, 1, 2, 3], [accounts[1], accounts[2]], { from: accounts[1] });

            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), 1388);
        });

    });

    describe("close expired reward epochs", async () => {
        it("Should send not claimed rewards back to accounting", async () => {
            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts);

            await travelToAndSetNewRewardEpoch(1);
            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            await travelToAndSetNewRewardEpoch(100);
            await mockFtsoManager.closeExpiredRewardEpochsCall();

            const rewardsExpired = ftsoRewardManagerAccountingInterface.contract.methods.rewardsExpired(2082).encodeABI();
            const invocationCount = await mockFtsoRewardManagerAccounting.invocationCountForCalldata.call(rewardsExpired);
            assert.equal(invocationCount.toNumber(), 0);

            await travelToAndSetNewRewardEpoch(101);
            await mockFtsoManager.closeExpiredRewardEpochsCall();
            const invocationCount2 = await mockFtsoRewardManagerAccounting.invocationCountForCalldata.call(rewardsExpired);
            assert.equal(invocationCount2.toNumber(), 1);
        });

        it("Should only be called from ftso manager", async () => {
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpochs(), "ftso manager only");
        });
    });
});
