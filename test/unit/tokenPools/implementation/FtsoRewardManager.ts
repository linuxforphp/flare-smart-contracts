import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import BN from "bn.js";
import { Contracts } from '../../../../deployment/scripts/Contracts';
import {
    FtsoManagerContract,
    FtsoManagerInstance,
    FtsoManagerMockContract,
    FtsoManagerMockInstance,
    FtsoRewardManagerContract,
    FtsoRewardManagerInstance,
    InflationMockInstance,
    MockContractInstance,
    SuicidalMockInstance, WNatContract,
    WNatInstance
} from "../../../../typechain-truffle";
import { compareArrays, compareNumberArrays, encodeContractNames, getAddressWithZeroBalance, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;

const FtsoRewardManager = artifacts.require("FtsoRewardManager") as FtsoRewardManagerContract;
const FtsoManager = artifacts.require("FtsoManager") as FtsoManagerContract;
const MockFtsoManager = artifacts.require("FtsoManagerMock") as FtsoManagerMockContract;
const WNAT = artifacts.require("WNat") as WNatContract;
const InflationMock = artifacts.require("InflationMock");
const SuicidalMock = artifacts.require("SuicidalMock");
const MockContract = artifacts.require("MockContract");
const GasConsumer = artifacts.require("GasConsumer2");

const PRICE_EPOCH_DURATION_S = 120;   // 2 minutes
const REVEAL_EPOCH_DURATION_S = 30;
const REWARD_EPOCH_DURATION_S = 2 * 24 * 60 * 60; // 2 days
const VOTE_POWER_BOUNDARY_FRACTION = 7;

// contains a fresh contract for each test
let ftsoRewardManager: FtsoRewardManagerInstance;
let ftsoManagerInterface: FtsoManagerInstance;
let startTs: BN;
let mockFtsoManager: FtsoManagerMockInstance;
let wNat: WNatInstance;
let mockInflation: InflationMockInstance;
let mockSupply: MockContractInstance;
let ADDRESS_UPDATER: string;


export async function distributeRewards(
    accounts: Truffle.Accounts,
    startTs: BN,
    currentRewardEpoch: number = 0,
    sendNats: boolean = true
) {
    let votePowerBlock = await web3.eth.getBlockNumber();
    // Assemble
    if (sendNats) {
        // give reward manager some nat to distribute...proxied through mock inflation
        await mockInflation.receiveInflation({ value: "2000000" });
    }

    // Price epochs remaining is 5040 (7 days worth at 2 minute price epochs)

    // Trigger price epoch finalization
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        0,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + PRICE_EPOCH_DURATION_S - 1),
        votePowerBlock
    );

    await time.increaseTo((await time.latest()).addn(PRICE_EPOCH_DURATION_S));

    // Let's do another price epoch
    await mockFtsoManager.distributeRewardsCall(
        [accounts[1], accounts[2]],
        [25, 75],
        100,
        1,
        accounts[6],
        PRICE_EPOCH_DURATION_S,
        currentRewardEpoch,
        startTs.addn((currentRewardEpoch * REWARD_EPOCH_DURATION_S) + (PRICE_EPOCH_DURATION_S * 2) - 1),
        votePowerBlock
    );

    const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(currentRewardEpoch).encodeABI();
    const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
    await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
}

export async function expireRewardEpoch(rewardEpoch: number, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string) {
    let currentFtsoManagerAddress = await ftsoRewardManager.ftsoManager();
    await ftsoRewardManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, mockInflation.address, deployer, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
    await ftsoRewardManager.closeExpiredRewardEpoch(rewardEpoch);
    await ftsoRewardManager.updateContractAddresses(
        encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
        [ADDRESS_UPDATER, mockInflation.address, currentFtsoManagerAddress, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
}

export async function travelToAndSetNewRewardEpoch(newRewardEpoch: number, startTs: BN, ftsoRewardManager: FtsoRewardManagerInstance, deployer: string, closeAsYouGo = false) {
    // What reward epoch are we on based on current block time, given our startTs?
    const currentRewardEpoch = (await time.latest()).sub(startTs).div(toBN(REWARD_EPOCH_DURATION_S)).toNumber();
    for (let rewardEpoch = currentRewardEpoch; rewardEpoch < newRewardEpoch; rewardEpoch++) {
        // Time travel through each daily cycle as we work our way through to the next
        // reward epoch.
        for (let dailyCycle = 0; dailyCycle < (REWARD_EPOCH_DURATION_S / 86400); dailyCycle++) {
            try {
                await time.increaseTo(startTs.addn((rewardEpoch * REWARD_EPOCH_DURATION_S) + (dailyCycle * 86400)));
                await mockInflation.setDailyAuthorizedInflation(2000000);
            } catch (e) {
                if (e instanceof Error && e.message.includes("to a moment in the past")) {
                    // Assume that if this is being done in the past, then it does not need to be done again.
                    // So just skip.          
                } else {
                    throw e;
                }
            }
        }
        // Travel to reach next reward epoch
        await time.increaseTo(startTs.addn((rewardEpoch + 1) * REWARD_EPOCH_DURATION_S + 1));
        // workaround for modifiers due to mock
        if (closeAsYouGo) {
            await expireRewardEpoch(rewardEpoch, ftsoRewardManager, deployer);            
        }
        await mockInflation.setDailyAuthorizedInflation(2000000);
    }
    // Fake Trigger reward epoch finalization
    const getCurrentRewardEpoch = ftsoManagerInterface.contract.methods.getCurrentRewardEpoch().encodeABI();
    const getCurrentRewardEpochReturn = web3.eth.abi.encodeParameter('uint256', newRewardEpoch);
    await mockFtsoManager.givenMethodReturn(getCurrentRewardEpoch, getCurrentRewardEpochReturn);
}


contract(`FtsoRewardManager.sol; ${getTestFile(__filename)}; Ftso reward manager unit tests`, async accounts => {

    let mockSuicidal: SuicidalMockInstance;
    
    ADDRESS_UPDATER = accounts[16];

    beforeEach(async () => {
        mockFtsoManager = await MockFtsoManager.new();
        mockInflation = await InflationMock.new();
        mockSupply = await MockContract.new();

        ftsoRewardManager = await FtsoRewardManager.new(
            accounts[0],
            ADDRESS_UPDATER,
            constants.ZERO_ADDRESS,
            3,
            0
        );

        await mockInflation.setInflationReceiver(ftsoRewardManager.address);

        // Get the timestamp for the just mined block
        startTs = await time.latest();

        ftsoManagerInterface = await FtsoManager.new(
            accounts[0],
            accounts[0],
            ADDRESS_UPDATER,
            accounts[7],
            constants.ZERO_ADDRESS,
            startTs,
            PRICE_EPOCH_DURATION_S,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(REVEAL_EPOCH_DURATION_S),
            REWARD_EPOCH_DURATION_S,
            VOTE_POWER_BOUNDARY_FRACTION
        );

        wNat = await WNAT.new(accounts[0], "Wrapped NAT", "WNAT");
        await setDefaultVPContract(wNat, accounts[0]);

        await ftsoRewardManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
            [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
        await ftsoRewardManager.enableClaims();
        
        // set the daily authorized inflation...this proxies call to ftso reward manager
        await mockInflation.setDailyAuthorizedInflation(2000000);
        
        mockSuicidal = await SuicidalMock.new(ftsoRewardManager.address);

        await mockFtsoManager.setRewardManager(ftsoRewardManager.address);

        await ftsoRewardManager.activate();
    });

    describe("basic", async () => {
        it("Should revert calling activate if contracts are not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS,
                3,
                0
            );

            await expectRevert(ftsoRewardManager.activate(), "contract addresses not set");
        });

        it("Should revert calling activate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.activate({ from: accounts[1] }), "only governance");
        });

        it("Should revert calling enableClaims if not from governance", async () => {
            await expectRevert(ftsoRewardManager.enableClaims({ from: accounts[1] }), "only governance");
        });

        it("Should revert calling enableClaims twice", async () => {
            await expectRevert(ftsoRewardManager.enableClaims(), "already enabled");
        });

        it("Should deactivate and disable claiming rewards", async () => {
            await ftsoRewardManager.deactivate();

            await expectRevert(ftsoRewardManager.claimReward(accounts[2], [0]), "reward manager deactivated");
            await expectRevert(ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]]), "reward manager deactivated");
        });

        it("Should revert calling deactivate if not from governance", async () => {
            await expectRevert(ftsoRewardManager.deactivate({ from: accounts[1] }), "only governance");
        });
        
        it("Should revert calling updateContractAddresses if not from address updater", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: accounts[1]}), "only address updater");
        });

        it("Should update ftso manager", async () => {
            expect(await ftsoRewardManager.ftsoManager()).to.equals(mockFtsoManager.address);
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, accounts[8], wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
            expect(await ftsoRewardManager.ftsoManager()).to.equals(accounts[8]);
        });

        it("Should revert updating ftso manager if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, constants.ZERO_ADDRESS, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER}), "address zero");
        });

        it("Should update WNAT", async () => {
            expect(await ftsoRewardManager.wNat()).to.equals(wNat.address);
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, accounts[8], mockSupply.address], {from: ADDRESS_UPDATER});
            expect(await ftsoRewardManager.wNat()).to.equals(accounts[8]);
        });

        it("Should revert updating wNAt if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, constants.ZERO_ADDRESS, mockSupply.address], {from: ADDRESS_UPDATER}), "address zero");
        });

        it("Should update inflation", async () => {
            expect(await ftsoRewardManager.getInflationAddress()).to.equals(mockInflation.address);
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, accounts[8], mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
            expect(await ftsoRewardManager.getInflationAddress()).to.equals(accounts[8]);
        });

        it("Should issue event when daily authorized inflation is set", async () => {
            const txReceipt = await mockInflation.setDailyAuthorizedInflation(2000000);
            await expectEvent.inTransaction(
                txReceipt.tx,
                ftsoRewardManager,
                "DailyAuthorizedInflationSet", {authorizedAmountWei: toBN(2000000)}
            );
        });

        it("Should revert updating inflation if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, constants.ZERO_ADDRESS, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER}), "address zero");
        });

        it("Should update supply", async () => {
            expect(await ftsoRewardManager.supply()).to.equals(mockSupply.address);
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, accounts[8]], {from: ADDRESS_UPDATER});
            expect(await ftsoRewardManager.supply()).to.equals(accounts[8]);
        });

        it("Should revert updating supply if setting to address(0)", async () => {
            await expectRevert(ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, constants.ZERO_ADDRESS], {from: ADDRESS_UPDATER}), "address zero");
        });

        it("Should get epoch to expire next", async () => {
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(0);
            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(1);
        });

        it("Should set initial reward data", async () => {
            let oldFtsoRewardManager = await MockContract.new();
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                oldFtsoRewardManager.address,
                3,
                0
            );
            
            const getRewardEpochToExpireNext = web3.utils.sha3("getRewardEpochToExpireNext()")!.slice(0, 10); // first 4 bytes is function selector
            const getCurrentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
            await mockFtsoManager.givenMethodReturnUint(getRewardEpochToExpireNext, 5);
            await mockFtsoManager.givenMethodReturnUint(getCurrentRewardEpoch, 20);
            
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
            await ftsoRewardManager.enableClaims();

            expect((await ftsoRewardManager.getInitialRewardEpoch()).toNumber()).to.equals(0);

            const firstClaimableRewardEpoch = ftsoRewardManager.contract.methods.firstClaimableRewardEpoch().encodeABI();
            await oldFtsoRewardManager.givenMethodReturnUint(firstClaimableRewardEpoch, 2);

            await ftsoRewardManager.setInitialRewardData();

            expect((await ftsoRewardManager.getRewardEpochToExpireNext()).toNumber()).to.equals(5);
            expect((await ftsoRewardManager.getInitialRewardEpoch()).toNumber()).to.equals(20);
            expect((await ftsoRewardManager.firstClaimableRewardEpoch()).toNumber()).to.equals(2);
        });

        it("Should revert calling setInitialRewardData twice", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                (await MockContract.new()).address,
                3,
                0
            );

            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
            await ftsoRewardManager.enableClaims();

            await ftsoRewardManager.setInitialRewardData();

            await expectRevert(ftsoRewardManager.setInitialRewardData(), "not initial state");
        });

        it("Should revert calling setInitialRewardData if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setInitialRewardData({ from: accounts[1] }), "only governance");
        });

        it("Should revert calling setInitialRewardData if already activated", async () => {
            await expectRevert(ftsoRewardManager.setInitialRewardData(), "not initial state");
        });

        it("Should revert calling setInitialRewardData if old ftso reward manager is not set", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS,
                3,
                0
            );
            await expectRevert(ftsoRewardManager.setInitialRewardData(), "not initial state");
        });

        it("Should set new ftso reward manager", async () => {
            expect(await ftsoRewardManager.newFtsoRewardManager()).to.equals(constants.ZERO_ADDRESS);
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);
            expect(await ftsoRewardManager.newFtsoRewardManager()).to.equals(accounts[2]);
        });

        it("Should revert calling setNewFtsoRewardManager if not from governance", async () => {
            await expectRevert(ftsoRewardManager.setNewFtsoRewardManager(accounts[2], { from: accounts[1] }), "only governance");
        });

        it("Should revert calling setNewFtsoRewardManager twice", async () => {
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);
            await expectRevert(ftsoRewardManager.setNewFtsoRewardManager(accounts[2]), "new ftso reward manager already set");
        });

        it("Should return contract name", async () => {
            expect(await ftsoRewardManager.getContractName()).to.equals(Contracts.FTSO_REWARD_MANAGER);
        });
    });

    describe("Price epochs, finalization", async () => {
        it("Should finalize price epoch and distribute unclaimed rewards", async () => {
            await mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                PRICE_EPOCH_DURATION_S,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                0
            );

            // Assert
            // 2 minute price epochs yield 720 price epochs per day, 5040 per week
            // 2000000 / 5040 = 396.8, rewards to award. Decimal will get truncated.
            // a1 should be (2000000 / 5040) * 0.25 = 99.2 
            // a2 should be = (2000000 / 5040) * 0.75 = 297.6
            // Price epoch awarding should be accumulated and used in double declining balance
            // allocation such that rounding at the end of a daily cycle is not an issue.
            // Not tested here, but decimal truncation for this particular test is valid.
            let a1UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[2]);
            assert.equal(a1UnclaimedReward[0].toNumber(), 99);
            assert.equal(a2UnclaimedReward[0].toNumber(), 297);

            let a1RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);
            let a2RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[2]);
            assert.equal(a1RewardInfo[0].toNumber(), 99);
            assert.equal(a2RewardInfo[0].toNumber(), 297);
        });

        it("Should finalize price epoch and distribute all authorized rewards for 7 daily cycle, revert later", async () => {
            const dailyStartTs = await time.latest();

            // Time travel to the end of the 7 daily cycle, distributing rewards along the way.
            // Make longer price epochs here so this test does not take as long to run.
            const MY_LONGER_PRICE_EPOCH_SEC = 3600;
            for (let i = 1; i <= (7 * 86400 / MY_LONGER_PRICE_EPOCH_SEC); i++) {
                await mockFtsoManager.distributeRewardsCall(
                    [accounts[1], accounts[2]],
                    [25, 75],
                    100,
                    0,
                    accounts[6],
                    MY_LONGER_PRICE_EPOCH_SEC,
                    0,
                    startTs.addn(MY_LONGER_PRICE_EPOCH_SEC * i - 1),
                    0
                );
                await time.increaseTo(dailyStartTs.addn(MY_LONGER_PRICE_EPOCH_SEC * i));
            }

            // Assert
            let a1UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[1]);
            let a2UnclaimedReward = await ftsoRewardManager.getUnclaimedReward(0, accounts[2]);
            assert.equal(a1UnclaimedReward[0].toNumber() + a2UnclaimedReward[0].toNumber(), 2000000);

            let a1RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);
            let a2RewardInfo = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[2]);
            assert.equal(a1RewardInfo[0].toNumber() + a2RewardInfo[0].toNumber(), 2000000);

            const promise = mockFtsoManager.distributeRewardsCall(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                MY_LONGER_PRICE_EPOCH_SEC,
                0,
                dailyStartTs.addn(7 * 86400 - 1),
                0
            );
            await expectRevert.unspecified(promise);
        });

        it("Should only be called from ftso manager", async () => {
            await expectRevert(ftsoRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75],
                100,
                0,
                accounts[6],
                REVEAL_EPOCH_DURATION_S,
                0,
                startTs.addn(PRICE_EPOCH_DURATION_S - 1),
                0
            ), "ftso manager only");
        });
    });

    describe("Price epochs, finalization in fallback", async() => {
      it("Should only be called from ftso manager", async () => {
        await expectRevert(ftsoRewardManager.accrueUnearnedRewards(
            0,
            REVEAL_EPOCH_DURATION_S,
            startTs.addn(PRICE_EPOCH_DURATION_S - 1)
        ), "ftso manager only");
      });

      it("Should accrue unearned rewards", async() => {
        // Act
        await mockFtsoManager.accrueUnearnedRewardsCall(
          0,
          PRICE_EPOCH_DURATION_S,
          startTs.addn(PRICE_EPOCH_DURATION_S - 1)
        );
        // Assert
        // 2 minute price epochs yield 720 price epochs per day, 5040 per week
        // 2000000 / 5040 = 396.8, unearned rewards to burn. Decimal will get truncated.
        const totalUnearnedWei = await ftsoRewardManager.totalUnearnedWei();
        assert.equal(totalUnearnedWei.toNumber(), 396);
      });

      it("Should evenly distribute rewards once unearned rewards have accrued", async() => {
        // Assemble
        // Simulate ftso in fallback by accruing unearned rewards for first price epoch
        await mockFtsoManager.accrueUnearnedRewardsCall(
          0,
          PRICE_EPOCH_DURATION_S,
          startTs.addn(PRICE_EPOCH_DURATION_S - 1)
        );

        // Act
        // Total awardable should now be 2000000 - 396
        // Distribute rewards for next price epoch 
        await mockFtsoManager.distributeRewardsCall(
          [accounts[1]],
          [100],
          100,
          0,
          accounts[6],
          PRICE_EPOCH_DURATION_S,
          0,
          startTs.addn((PRICE_EPOCH_DURATION_S * 2) - 1),
          0
        );

        // Assert
        // 2 minute price epochs yield 720 price epochs per day, 5040 per week
        // (2000000 - 396 unearned) / (5040 - 1) = 396.8, rewards awarded. Decimal will get truncated.
        // Total "awarded" should now be 396 for actual rewards distributed.
        const totalAwardedWei = await ftsoRewardManager.totalAwardedWei();
        const totalUnearnedWei = await ftsoRewardManager.totalUnearnedWei();
        assert.equal(totalAwardedWei.toNumber(), 396);
        assert.equal(totalUnearnedWei.toNumber(), 396);
      });

      it("Should burn unearned rewards when inflation received", async() => {
        // Assemble
        const burnAddress = await getAddressWithZeroBalance();
        const burnAddressCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'burnAddress', inputs: [] }, []);
        await mockSupply.givenMethodReturnAddress(burnAddressCall, burnAddress);
        // Simulate ftso in fallback by accruing unearned rewards for first price epoch
        await mockFtsoManager.accrueUnearnedRewardsCall(
          0,
          PRICE_EPOCH_DURATION_S,
          startTs.addn(PRICE_EPOCH_DURATION_S - 1)
        );

        // Act
        // Receive inflation. 
        // Inflation must call ftso reward manager during funding, and this proxy does it.
        const txReceipt = await mockInflation.receiveInflation({ value: "2000000" });

        // Assert
        let ftsoRewardManagerBalance = web3.utils.toBN(await web3.eth.getBalance(ftsoRewardManager.address));
        assert.equal(ftsoRewardManagerBalance.toNumber(), 1999604);
        // Since supply is stubbed out, the burn address will default to 0x0.
        let burnAddressBalance = web3.utils.toBN(await web3.eth.getBalance(burnAddress));
        assert.equal(burnAddressBalance.toNumber(), 396);
        // Check total unearned accural
        let totalUnearnedWei = await ftsoRewardManager.totalUnearnedWei();
        assert.equal(totalUnearnedWei.toNumber(), 396);
      });

      it("Should limit the unearned rewards burned on any given receive inflation event", async() => {
        // Assemble
        const burnAddress = await getAddressWithZeroBalance();
        const burnAddressCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'burnAddress', inputs: [] }, []);
        await mockSupply.givenMethodReturnAddress(burnAddressCall, burnAddress);

        // Simulate ftso in fallback by accruing unearned rewards for many price epochs
        // Should be 396 * 1100 = 435600
        for(var p = 1; p < 1100; p++) {
          await mockFtsoManager.accrueUnearnedRewardsCall(
            0,
            PRICE_EPOCH_DURATION_S,
            startTs.addn((PRICE_EPOCH_DURATION_S * p) - 1)
          );  
        }

        // Act
        // Receive inflation. 
        // Inflation must call ftso reward manager during funding, and this proxy does it.
        const txReceipt = await mockInflation.receiveInflation({ value: "2000000" });

        // Amount burned should be limited to 20% of received inflation;
        let burnAddressBalance = web3.utils.toBN(await web3.eth.getBalance(burnAddress));
        assert.equal(burnAddressBalance.toNumber(), 400000, "Burn address does not contain correct balance");
        // Check totalBurnedWei()
        let totalBurnedWei = await ftsoRewardManager.totalBurnedWei();
        assert.equal(totalBurnedWei.toNumber(), 400000, "FtsoRewardManager.totalBurnedWei does not contain correct balance");
      });
    });

    describe("getters and setters", async () => {
        it("Should get token pool supply data", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            let data = await ftsoRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(0);

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0], false);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            data = await ftsoRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(6000000);
            expect(data[2].toNumber()).to.equals(198);
        });

        it("Should set and update data provider fee percentage", async () => {
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[2] });
            await ftsoRewardManager.setDataProviderFeePercentage(15, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(0);

            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(5);

            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(10);

            await travelToAndSetNewRewardEpoch(5, startTs, ftsoRewardManager, accounts[0]);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[1])).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderCurrentFeePercentage(accounts[2])).toNumber()).to.equals(15);
        });

        it("Should get data provider fee percentage", async () => {
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(5);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4), "invalid reward epoch");

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(5);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4)).toNumber()).to.equals(10);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 5), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 5), "invalid reward epoch");

            await ftsoRewardManager.setDataProviderFeePercentage(8, { from: accounts[2] });
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(5);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4)).toNumber()).to.equals(8);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 5), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 5), "invalid reward epoch");
        });

        it("Should not get data provider fee percentage from old ftso reward manager", async () => {
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                (await MockContract.new()).address,
                3,
                0
            );

            const getRewardEpochToExpireNext = web3.utils.sha3("getRewardEpochToExpireNext()")!.slice(0, 10); // first 4 bytes is function selector
            const getCurrentRewardEpoch = web3.utils.sha3("getCurrentRewardEpoch()")!.slice(0, 10); // first 4 bytes is function selector
            await mockFtsoManager.givenMethodReturnUint(getRewardEpochToExpireNext, 0);
            await mockFtsoManager.givenMethodReturnUint(getCurrentRewardEpoch, 2);

            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
            await ftsoRewardManager.enableClaims();

            await ftsoRewardManager.setInitialRewardData();
            await ftsoRewardManager.setDataProviderFeePercentage(5, { from: accounts[2] });
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 0), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 0), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 1), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 1), "invalid reward epoch");
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 2)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 3)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 4)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 5)).toNumber()).to.equals(0);
            expect((await ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 5)).toNumber()).to.equals(5);
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[1], 6), "invalid reward epoch");
            await expectRevert(ftsoRewardManager.getDataProviderFeePercentage(accounts[2], 6), "invalid reward epoch");
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

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            expectEvent(await ftsoRewardManager.setDataProviderFeePercentage(10, { from: accounts[1] }), "FeePercentageChanged",
                { dataProvider: accounts[1], value: toBN(10), validFromEpoch: toBN(4) });
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [5, 10]);
            compareNumberArrays(data[1], [3, 4]);
            compareArrays(data[2], [true, false]);

            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
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

            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [10, 15]);
            compareNumberArrays(data[1], [4, 5]);
            compareArrays(data[2], [true, true]);

            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            compareNumberArrays(data[0], [15]);
            compareNumberArrays(data[1], [5]);
            compareArrays(data[2], [true]);

            await travelToAndSetNewRewardEpoch(5, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getDataProviderScheduledFeePercentageChanges(accounts[1]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
        });

        it("Should get epoch reward and claimed reward info", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            let data = await ftsoRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(0);

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0], false);

            // Assert
            // 2 minute price epochs yield 720 price epochs per day, 5040 per week
            // 2000000 / 5040 = 396.8, rewards to award. Decimal will get truncated.
            // a1 should be (2000000 / 5040) * 0.25 = 99.2 repeating
            // a2 should be = (2000000 / 5040) * 0.75 = 297.6 repeating
            // in distributeRewards this is done 2x
            let rewardEpochBeforeClaim = await ftsoRewardManager.getEpochReward(0);
            assert.equal(rewardEpochBeforeClaim[0].toNumber(), 396 * 2);
            assert.equal(rewardEpochBeforeClaim[1].toNumber(), 0);

            let claimedRewardBeforeClaim = await ftsoRewardManager.getClaimedReward(0, accounts[1], accounts[1]);
            assert.equal(claimedRewardBeforeClaim[0], false);
            assert.equal(claimedRewardBeforeClaim[1].toNumber(), 0);

            let claimedRewardBeforeClaim2 = await ftsoRewardManager.getClaimedReward(0, accounts[1], accounts[2]);
            assert.equal(claimedRewardBeforeClaim2[0], false);
            assert.equal(claimedRewardBeforeClaim2[1].toNumber(), 0);

            let consumer = await GasConsumer.new(3);
            let tx = ftsoRewardManager.claimReward(consumer.address, [0], { from: accounts[1] });
            await expectRevert(tx, "claim failed");
            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            await ftsoRewardManager.claimAndWrapReward(accounts[1], [0], { from: accounts[99] });

            let rewardEpochAfterClaim = await ftsoRewardManager.getEpochReward(0);
            assert.equal(rewardEpochAfterClaim[0].toNumber(), 396 * 2);
            assert.equal(rewardEpochAfterClaim[1].toNumber(), 99 * 2);

            let claimedRewardAfterClaim = await ftsoRewardManager.getClaimedReward(0, accounts[1], accounts[1]);
            assert.equal(claimedRewardAfterClaim[0], true);
            assert.equal(claimedRewardAfterClaim[1].toNumber(), 99 * 2);
          });

        it("Should revert if fee percentage > max bips", async () => {
            await expectRevert(ftsoRewardManager.setDataProviderFeePercentage(15000, { from: accounts[1] }), "invalid fee percentage value");
        });

        it("Should get state of rewards", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            // get some rewards
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [198]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0], false);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [198]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [198]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0], false);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);
        });

        it("Should get state of rewards - delegator only", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "200" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 5000, { from: accounts[4] });

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
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            let a1RewardInfoBeforeClaim = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            let a1RewardInfoAfterClaim = await ftsoRewardManager.getDataProviderPerformanceInfo(0, accounts[1]);

            expect(a1RewardInfoBeforeClaim[0].toNumber()).to.equals(99 + 99);
            expect(a1RewardInfoBeforeClaim[1].toNumber()).to.equals(200);
            expect(a1RewardInfoBeforeClaim[0].toNumber()).to.equals(a1RewardInfoAfterClaim[0].toNumber());
            expect(a1RewardInfoBeforeClaim[1].toNumber()).to.equals(a1RewardInfoAfterClaim[1].toNumber());

            await ftsoRewardManager.claimReward(accounts[4], [0], { from: accounts[4] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[4], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
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
        });

        it("Should get state of rewards - delegator and provider - percentage", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "200" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 5000, { from: accounts[2] });

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
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [594, 99]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [594, 99]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] }), "RewardClaimed",
                { dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(99) });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [594, 99]);
            compareArrays(data[2], [false, false]);
            expect(data[3]).to.equals(true);

            let tx = await ftsoRewardManager.claimReward(accounts[2], [0], { from: accounts[2] });
            expect(tx.logs[0].event).to.equals("RewardClaimed");
            expect(tx.logs[1].event).to.equals("RewardClaimed");

            data = await ftsoRewardManager.getStateOfRewards(accounts[2], 0);
            compareArrays(data[0], [accounts[2], accounts[1]]);
            compareNumberArrays(data[1], [594, 99]);
            compareArrays(data[2], [true, true]);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
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
        });

        it("Should revert at get state of rewards if delegated explicitly", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "200" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await expectRevert(ftsoRewardManager.getStateOfRewards(accounts[2], 0), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should get state of rewards - delegator and provider - explicit", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[2], value: "200" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[2] });

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
            await distributeRewards(accounts, startTs);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 594]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [false]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 594]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] }), "RewardClaimed",
                { dataProvider: accounts[1], whoClaimed: accounts[1], sentTo: accounts[5], rewardEpoch: toBN(0), amount: toBN(99) });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            compareArrays(data[0], [accounts[1]]);
            compareNumberArrays(data[1], [99]);
            compareArrays(data[2], [true]);
            expect(data[3]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 0]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(true);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 594]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[1]], { from: accounts[2] }), "RewardClaimed",
                { dataProvider: accounts[1], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(99) });

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 594]);
            compareArrays(data[1], [true, false]);
            expect(data[2]).to.equals(true);

            expectEvent(await ftsoRewardManager.claimRewardFromDataProviders(accounts[2], [0], [accounts[2]], { from: accounts[2] }), "RewardClaimed",
                { dataProvider: accounts[2], whoClaimed: accounts[2], sentTo: accounts[2], rewardEpoch: toBN(0), amount: toBN(594) });

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [99, 594]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2]).to.equals(false);

            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[2], 0, [accounts[1], accounts[2]]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2]).to.equals(false);
        });

        it("Should get state of rewards - no reward", async () => {
            let data;
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(false);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewards(accounts[1], 0);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2].length).to.equals(0);
            expect(data[3]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1                         
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
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

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [false, false]);
            expect(data[2]).to.equals(true);

            await ftsoRewardManager.claimRewardFromDataProviders(accounts[1], [0], [accounts[1], accounts[2]], { from: accounts[1] });
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            compareNumberArrays(data[0], [0, 0]);
            compareArrays(data[1], [true, true]);
            expect(data[2]).to.equals(true);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            data = await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[1], 0, [accounts[1], accounts[2]]);
            expect(data[0].length).to.equals(0);
            expect(data[1].length).to.equals(0);
            expect(data[2]).to.equals(false);
        });

        it("Should get epochs with claimable / unclaimed rewards", async () => {
            let data;
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[3], value: "300" });
            await wNat.deposit({ from: accounts[4], value: "200" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 5000, { from: accounts[3] });
            await wNat.delegate(accounts[1], 5000, { from: accounts[4] });
            
            await expectRevert(ftsoRewardManager.getEpochsWithClaimableRewards(), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]), "no epoch with claimable rewards");

            // get some rewards
            await distributeRewards(accounts, startTs);

            await expectRevert(ftsoRewardManager.getEpochsWithClaimableRewards(), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]), "no epoch with claimable rewards");
            await expectRevert(ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]), "no epoch with claimable rewards");

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            
            data = await ftsoRewardManager.getEpochsWithClaimableRewards();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(0);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, [0]);

            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });
            
            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, [0]);

            await ftsoRewardManager.claimReward(accounts[4], [0], { from: accounts[4] });

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, [0]);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, []);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            
            data = await ftsoRewardManager.getEpochsWithClaimableRewards();
            expect(data[0].toNumber()).to.equals(1);
            expect(data[1].toNumber()).to.equals(1);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[1]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[2]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[3]);
            compareNumberArrays(data, []);

            data = await ftsoRewardManager.getEpochsWithUnclaimedRewards(accounts[4]);
            compareNumberArrays(data, []);
        });
        
    });

    describe("reward claiming", async () => {
        it("Should accept NAT", async () => {
            // Assemble
            // Act
            // Inflation must call ftso reward manager during funding, and this proxy does it.
            const txReceipt = await mockInflation.receiveInflation({ value: "2000000" });
            await expectEvent.inTransaction( txReceipt.tx,
                ftsoRewardManager,
                "InflationReceived", {amountReceivedWei: toBN(2000000)}
            );

            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(ftsoRewardManager.address));
            assert.equal(balance.toNumber(), 2000000);
        });

        it("Should gracefully receive self-destruct proceeds", async () => {
            // Assemble
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "1");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "2");
            const selfDestructReceived = await ftsoRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructReceived.toNumber(), 1);
        });

        it("Should gracefully receive self-destruct proceeds - initial balance > 0", async () => {
            // Add some initial balance (inflation)
            await mockInflation.receiveInflation({ value: "1" });
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "1");
            // Assemble
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "2");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            assert.equal(await web3.eth.getBalance(ftsoRewardManager.address), "3");
            const selfDestructReceived = await ftsoRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructReceived.toNumber(), 1);
        });

        it("Should not accept NAT unless from inflation", async () => {
            // Assemble
            // Act
            const receivePromise = ftsoRewardManager.receiveInflation({ value: "2000000" });
            // Assert
            await expectRevert(receivePromise, "inflation only");
        });

        it("Should enable rewards to be claimed once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 198);
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 198);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 99);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 99);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - with self-destruct proceeds", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 99);
            let selfDestructProceeds = await ftsoRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructProceeds.toNumber(), 1);

            // Create another suicidal
            const anotherMockSuicidal = await SuicidalMock.new(ftsoRewardManager.address);
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: anotherMockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await anotherMockSuicidal.die();

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 99);
            selfDestructProceeds = await ftsoRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructProceeds.toNumber(), 2);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - should not claim twice", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 99);

            // if claiming again, get 0
            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance1.sub(natOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 99);

            // if claiming again, get 0
            let natOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let natClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance3.sub(natOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - percentage - get 0 if not rewarded ftso", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewards(accounts[4], 0, { from: accounts[4] });
            await ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[4] });
            // Assert
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - percentage", async () => {
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 0.95 (fee) + 1 (dust) = 660
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 660);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 1.05 (fee) = 730
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 730);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - percentage", async () => {

            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "1000" });
            await wNat.deposit({ from: accounts[4], value: "1" });

            // delegate some wnats
            await wNat.delegate(accounts[1], 10000, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [3], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 1
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) = 1389
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 1389);
        });

        it("Should enable rewards to be claimed once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 198);
        });

        it("Should revert at claiming rewards (not using claimRewardFromDataProviders) once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[2], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[2] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            await expectRevert(ftsoRewardManager.claimReward(accounts[3], [0], { from: accounts[2] }), "delegatesOf does not work in AMOUNT delegation mode");
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 198);
        });

        it("Should enable rewards to be claimed by delegator once reward epoch finalized - with self-destruct proceeds", async () => {
            // Assemble
            // deposit some wnats
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into ftso reward manager
            await mockSuicidal.die();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 198);
            const selfDestructProceeds = await ftsoRewardManager.totalSelfDestructReceivedWei();
            assert.equal(selfDestructProceeds.toNumber(), 1);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 99);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 99);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - should not claim twice", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            // a4 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 99);

            // if claiming again, get 0
            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance1.sub(natOpeningBalance1).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 99);

            // if claiming again, get 0
            let natOpeningBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            // a1 -> a5 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) = 99
            let natClosingBalance3 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance3.sub(natOpeningBalance3).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider once reward epoch finalized - explicit - get 0 if not rewarded ftso", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });
            let votePowerBlock = await web3.eth.getBlockNumber();
            const getRewardEpochVotePowerBlock = ftsoManagerInterface.contract.methods.getRewardEpochVotePowerBlock(0).encodeABI();
            const getRewardEpochVotePowerBlockReturn = web3.eth.abi.encodeParameter('uint256', votePowerBlock);
            await mockFtsoManager.givenMethodReturn(getRewardEpochVotePowerBlock, getRewardEpochVotePowerBlockReturn);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.getStateOfRewardsFromDataProviders(accounts[4], 0, [accounts[1]], { from: accounts[4] });
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[4] });
            // Assert
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 0);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.getStateOfRewards(accounts[1], 0, { from: accounts[1] });
            await ftsoRewardManager.claimReward(accounts[5], [0], { from: accounts[1] });
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 0);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized - explicit", async () => {
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });
            await wNat.deposit({ from: accounts[4], value: "100" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 100, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid having to calc gas fees
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 0.95 (fee) + 1 (dust) = 660
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 660);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs / 2 (half vote pover was delegated) * 1.05 (fee) = 730
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 730);
        });

        it("Should enable rewards to be claimed by delegator and data provider (fee 5%) once reward epoch finalized 2 - explicit", async () => {
            // Assemble
            // set delegator fee
            await ftsoRewardManager.setDataProviderFeePercentage(500, { from: accounts[1] });
            // travel 3 reward epochs
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "1000" });
            await wNat.deposit({ from: accounts[4], value: "1" });

            // delegate some wnats
            await wNat.delegateExplicit(accounts[1], 1, { from: accounts[4] });

            await distributeRewards(accounts, startTs, 3);
            await travelToAndSetNewRewardEpoch(4, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [3], [accounts[1]], { from: accounts[4] });

            // Assert
            // Note: 3 reward epochs passed (starting epoch 0), no rewards allocated, then 1 more daily allocation.
            // So, 14000000 rewards to distribute starting in epoch 3 (two dailies in a reward epoch).
            // a4 -> a3 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs * (1 / 1001) * 0.95 (fee) = 1
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 1);

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await ftsoRewardManager.claimReward(accounts[5], [3], { from: accounts[1] });

            // Assert
            // a1 -> a5 claimed should be (14000000 / 5040) * 0.25 * 2 price epochs * (1000/1001 + 1/1001 * 0.05) (fee) = 1389
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 1389);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized", async () => {
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 1, false);
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 2, false);

            // can claim Math.ceil(2000000 / 5040) + Math.ceil((2000000 - 397) / (5040 - 1)) = 794
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimReward(accounts[3], [0, 1, 2, 3], { from: accounts[1] });

            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 794);
        });

        it("Should claim from multiple reward epochs - get nothing for reward epochs not finalized - explicit", async () => {
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 1, false);
            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            await distributeRewards(accounts, startTs, 2, false);

            // can claim Math.ceil(2000000 / 5040) + Math.ceil((2000000 - 396) / (5040 - 1)) = 794
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimRewardFromDataProviders(accounts[3], [0, 1, 2, 3], [accounts[1], accounts[2]], { from: accounts[1] });

            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 794);
        });

        it("Should enable rewards to be claimed and wrapped once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[3]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimAndWrapReward(accounts[3], [0], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let wNatClosingBalance = await wNat.votePowerOf(accounts[3]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 198);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Should enable rewards to be claimed and wrapped (by executor) once reward epoch finalized - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await ftsoRewardManager.addClaimExecutor(accounts[5], { from: accounts[1] });
            
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claimAndWrapRewardToOwner(accounts[1], [0], { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 198);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Executor must be allowed to be able to claim for the reward owner - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Assert
            await expectRevert(ftsoRewardManager.claimAndWrapRewardToOwner(accounts[1], [0], { from: accounts[5] }),
                "claim executor only");
        });
        
        it("Executor must not be removed to be able to claim for the reward owner - percentage", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await ftsoRewardManager.addClaimExecutor(accounts[5], { from: accounts[1] });
            await ftsoRewardManager.removeClaimExecutor(accounts[5], { from: accounts[1] });
            
            // Assert
            await expectRevert(ftsoRewardManager.claimAndWrapRewardToOwner(accounts[1], [0], { from: accounts[5] }),
                "claim executor only");
        });

        it("Should enable rewards to be claimed and wrapped once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[3]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await ftsoRewardManager.claimAndWrapRewardFromDataProviders(accounts[3], [0], [accounts[1]], { from: accounts[1] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / (86400 / 120)) * 0.25 * 2 price epochs = 198
            let wNatClosingBalance = await wNat.votePowerOf(accounts[3]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 198);
            assert(natOpeningBalance.eq(natClosingBalance));
        });
        
        it("Should enable rewards to be claimed and wrapped (by executor) once reward epoch finalized - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            await ftsoRewardManager.addClaimExecutor(accounts[5], { from: accounts[1] });

            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await ftsoRewardManager.claimAndWrapRewardFromDataProvidersToOwner(accounts[1], [0], [accounts[1]], { from: accounts[5] });
            // Assert
            // a1 -> a3 claimed should be (2000000 / 5040) * 0.25 * 2 price epochs = 198
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 198);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Executor must be allowed to be able to claim for the reward owner - explicit", async () => {

            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);
            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);

            // Act
            // Assert
            await expectRevert(ftsoRewardManager.claimAndWrapRewardFromDataProvidersToOwner(accounts[1], [0], [accounts[1]], { from: accounts[5] }),
                "claim executor only");
        });
    });

    describe("close expired reward epochs", async () => {
        it("Should update expired rewards", async () => {
            // deposit some wnats
            await wNat.deposit({ from: accounts[1], value: "100" });

            await distributeRewards(accounts, startTs);

            await travelToAndSetNewRewardEpoch(1, startTs, ftsoRewardManager, accounts[0]);
            await ftsoRewardManager.claimReward(accounts[1], [0], { from: accounts[1] });

            await travelToAndSetNewRewardEpoch(2, startTs, ftsoRewardManager, accounts[0]);
            let rewardExpired = await ftsoRewardManager.totalExpiredWei();
            assert.equal(rewardExpired.toNumber(), 0);

            // expire reward epoch 0
            await expireRewardEpoch(0, ftsoRewardManager, accounts[0]);            
            // advance, but not expire epoch 1            
            await travelToAndSetNewRewardEpoch(3, startTs, ftsoRewardManager, accounts[0]);
            rewardExpired = await ftsoRewardManager.totalExpiredWei();
            assert.equal(rewardExpired.toNumber(), 594);
        });

        it("Should only be called from ftso manager or new ftso reward manager", async () => {
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(0), "only ftso manager or new ftso reward manager");
        });

        it("Should only expire correct reward epoch and proceed - ftso manager", async () => {
            // update ftso manager to accounts[0] to be able to call closeExpiredRewardEpoch
            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, accounts[0], wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
            
            await ftsoRewardManager.closeExpiredRewardEpoch(0); // should work
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(0), "wrong reward epoch id");
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(2), "wrong reward epoch id");
            await ftsoRewardManager.closeExpiredRewardEpoch(1); // should work
        });

        it("Should only expire correct reward epoch and proceed - new ftso reward manager", async () => {
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);
            
            await ftsoRewardManager.closeExpiredRewardEpoch(0, { from: accounts[2] }); // should work
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(0, { from: accounts[2] }), "wrong reward epoch id");
            await expectRevert(ftsoRewardManager.closeExpiredRewardEpoch(2, { from: accounts[2] }), "wrong reward epoch id");
            await ftsoRewardManager.closeExpiredRewardEpoch(1, { from: accounts[2] }); // should work
        });

        it("Should forward closeExpiredRewardEpoch to old ftso reward manager", async () => {
            let oldFtsoRewardManager = await MockContract.new();
            ftsoRewardManager = await FtsoRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                oldFtsoRewardManager.address,
                3,
                0
            );

            await ftsoRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.FTSO_MANAGER, Contracts.WNAT, Contracts.SUPPLY]),
                [ADDRESS_UPDATER, mockInflation.address, mockFtsoManager.address, wNat.address, mockSupply.address], {from: ADDRESS_UPDATER});
            await ftsoRewardManager.enableClaims();

            await ftsoRewardManager.setInitialRewardData();
            await ftsoRewardManager.setNewFtsoRewardManager(accounts[2]);

            await ftsoRewardManager.closeExpiredRewardEpoch(0, { from: accounts[2] }); // should work
            await ftsoRewardManager.closeExpiredRewardEpoch(1, { from: accounts[2] }); // should work

            const closeExpiredRewardEpoch = ftsoRewardManager.contract.methods.closeExpiredRewardEpoch(0).encodeABI();

            const invocationCountForCalldata = await oldFtsoRewardManager.invocationCountForCalldata.call(closeExpiredRewardEpoch);
            assert.equal(invocationCountForCalldata.toNumber(), 1);

            const invocationCountForMethod = await oldFtsoRewardManager.invocationCountForMethod.call(closeExpiredRewardEpoch);
            assert.equal(invocationCountForMethod.toNumber(), 1);
        });
    });
});
