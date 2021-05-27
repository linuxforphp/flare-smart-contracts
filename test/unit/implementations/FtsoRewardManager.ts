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

contract(`RewardManager.sol; ${ getTestFile(__filename) }; Reward manager unit tests`, async accounts => {
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

    let fakeFlareKeeperAddress = accounts[1];
    let mockCloseManager: MockContractInstance;

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

    describe("Price epochs, finalization", async () => {
        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            // Stub accounting system to make it balance with RM contract
            const getRewardManagerBalance = web3.utils.sha3("getRewardManagerBalance()")!.slice(0,10);
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);
            // Stub accounting system to return the undistributed balance to reward manager
            const getUndistributedFtsoInflationBalance = web3.utils.sha3("getUndistributedFtsoInflationBalance()")!.slice(0,10); // first 4 bytes is function selector
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
    });

    describe("reward claiming", async () => {
        it("Should accept FLR", async () => {
            // Assemble
            // Stub accounting system to make it balance with RM contract
            const getRewardManagerBalance = web3.utils.sha3("getRewardManagerBalance()")!.slice(0,10); // first 4 bytes is function selector
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);
            // Act
            await web3.eth.sendTransaction({ from: fakeFlareKeeperAddress, to: ftsoRewardManager.address, value: 1000000 });
            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(ftsoRewardManager.address));
            assert.equal(balance.toNumber(), 1000000);
        });
        // accounting changed
        it("Should enable rewards to be claimed once reward epoch finalized", async () => { 

            // deposit some wflrs
            await wFlr.deposit({ from: accounts[1], value: "100" });
            let votePowerBlock = await web3.eth.getBlockNumber();
            
            // Assemble
            // Stub accounting system to make it balance with RM contract
            const getRewardManagerBalance = web3.utils.sha3("getRewardManagerBalance()")!.slice(0,10); // first 4 bytes is function selector
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);

            // Stub accounting system to return the undistributed balance to reward manager
            const getUndistributedFtsoInflationBalance = web3.utils.sha3("getUndistributedFtsoInflationBalance()")!.slice(0,10); // first 4 bytes is function selector
            await mockSupplyAccounting.givenMethodReturnUint(getUndistributedFtsoInflationBalance, 1000000);
            // give reward manager some flr to distribute
            await web3.eth.sendTransaction({ from: fakeFlareKeeperAddress, to: ftsoRewardManager.address, value: 1000000 });
            
            // Let's assume the number of price epochs remaining is 720 (a days worth at 2 minute price epochs)
            // Trigger price epoch finalization
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                720,
                0
            );

            // Have accounting system simulate having been updated with the amount just awarded (1/720 of 1000000)
            await mockSupplyAccounting.givenMethodReturnUint(getUndistributedFtsoInflationBalance, 998611);

            // Time travel 2 days
            await time.increaseTo(startTs.addn(172800));

            // Let's do another price epoch
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                10,
                accounts[6],
                719,
                0
            );
            // Fake Trigger reward epoch finalization
            const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
            const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter( 'uint256', 1);
            await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter( 'uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let flrOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            // await rewardManager.claimReward(accounts[3], [ 0 ], { from: accounts[1] });
            await mockFtsoRewardManagerAccounting.givenMethodReturnUint(getRewardManagerBalance, 1000000);
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (1000000 / (86400 / 120)) * 0.25 * 2 price epochs = 694
            let flrClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            let claimsExpected = Math.floor(1000000 / (86400 / 120) * 0.25 * 2);
            assert.equal(flrClosingBalance.sub(flrOpeningBalance).toNumber(), claimsExpected);
            // Let's do a fakey close and see if RM reports claims-to-date to accounting.
            // I'd rather do another test, but am too lazy to re-do all this pre-amble just to do the below assert.
            await ftsoRewardManager.close();
            const rewardsClaimed = ftsoRewardManagerAccountingInterface.contract.methods.rewardsClaimed(claimsExpected).encodeABI();
            const invocationCount = await mockFtsoRewardManagerAccounting.invocationCountForCalldata.call(rewardsClaimed);
            assert.equal(invocationCount.toNumber(), 1);
        });

    });

    describe("accounting close", async () => {
      it("Should not close if not from close manager", async() => {
        // Assemble
        // Act
        const closePromise = ftsoRewardManager.close({from: accounts[1]});
        // Assert
        await expectRevert(closePromise, ERR_CLOSE_MANAGER_ONLY)
      });
    });
});
