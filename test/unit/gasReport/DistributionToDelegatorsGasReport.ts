import { time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import { ClaimSetupManagerInstance, DistributionToDelegatorsInstance, DistributionTreasuryInstance, MockContractInstance, WNatInstance } from "../../../typechain-truffle";
import { encodeContractNames, toBN } from "../../utils/test-helpers";

const getTestFile = require('../../utils/constants').getTestFile;

const BN = web3.utils.toBN;

const ClaimSetupManager = artifacts.require("ClaimSetupManager");
const DelegationAccount = artifacts.require("DelegationAccount");
const DistributionTreasury = artifacts.require("DistributionTreasury");
const DistributionToDelegators = artifacts.require("DistributionToDelegators");
const MockContract = artifacts.require("MockContract");
const WNat = artifacts.require("WNat");


let priceSubmitterMock: MockContractInstance;
let claimSetupManager: ClaimSetupManagerInstance;
let wNat: WNatInstance;
let distributionTreasury: DistributionTreasuryInstance;
let distribution: DistributionToDelegatorsInstance;
let FLARE_DAEMON: string;
let ADDRESS_UPDATER: string;

contract(`DistributionToDelegators.sol; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const GOVERNANCE_ADDRESS = accounts[10];
  FLARE_DAEMON = accounts[1];
  ADDRESS_UPDATER = accounts[2];
  const totalEntitlementWei = toBN(1000000);
  let latestStart: BN;

  async function distributionToDelegatorsGasBenchmarking(
    noOfOptOutAccounts: number,
    noOfCheckpoints: number,
    noOfMonths: number,
  ) {
    const claimers = accounts.slice(10, 100);
    const optOutAccounts = accounts.slice(100, 100 + noOfOptOutAccounts);
    for (let i = 10; i < 100 + noOfOptOutAccounts; i++) {
      await wNat.deposit({value: toBN(100), from: accounts[i]});
    }
    for (let i = 100; i < 100 + noOfOptOutAccounts; i++) {
      await distribution.optOutOfAirdrop({from: accounts[i]});
    }
    await distribution.confirmOptOutOfAirdrop(optOutAccounts, {from: GOVERNANCE_ADDRESS});

    const startTs = (await time.latest()).addn(10);
    await distribution.setEntitlementStart(startTs, {from: GOVERNANCE_ADDRESS});
    const monthSec = 30 * 24 * 60 * 60;
    const increaseTimeSec = monthSec / (noOfCheckpoints + 1);
    for (let month = 1; month <= noOfMonths; month++) {
      for (let checkPoint = 1; checkPoint <= noOfCheckpoints; checkPoint++) {
        let tx = await distribution.daemonize({from: FLARE_DAEMON});
        console.log(tx.receipt.gasUsed)
        await time.increaseTo(startTs.addn(checkPoint * increaseTimeSec + (month - 1) * monthSec));
        for (let i = 10; i < 100 + noOfOptOutAccounts; i++) {
          await wNat.deposit({value: toBN(5), from: accounts[i]});
        }
      }
      if ((await time.latest()).lt(startTs.addn(month * monthSec))) {
        await time.increaseTo(startTs.addn(month * monthSec));
      }
      let tx = await distribution.daemonize({from: FLARE_DAEMON});
      console.log(`finalize month: ${month}, gas usage: ${tx.receipt.gasUsed}`);
    }
  }


  beforeEach(async () => {
    wNat = await WNat.new(GOVERNANCE_ADDRESS, "Wrapped NAT", "WNAT");
    priceSubmitterMock = await MockContract.new();
    claimSetupManager = await ClaimSetupManager.new(GOVERNANCE_ADDRESS, ADDRESS_UPDATER, 3, 0, 100, 1000);
    const delegationAccount = await DelegationAccount.new()
    const ftsoManagerMock = await MockContract.new();
    await claimSetupManager.setLibraryAddress(delegationAccount.address, { from: GOVERNANCE_ADDRESS });
    distributionTreasury = await DistributionTreasury.new(GOVERNANCE_ADDRESS);
    await web3.eth.sendTransaction({value: totalEntitlementWei, from: GOVERNANCE_ADDRESS, to: distributionTreasury.address});
    latestStart = (await time.latest()).addn(10 * 24 * 60 * 60); // in 10 days
    distribution = await DistributionToDelegators.new(GOVERNANCE_ADDRESS, FLARE_DAEMON, ADDRESS_UPDATER, distributionTreasury.address, totalEntitlementWei, latestStart);
    // set distribution contract
    await distributionTreasury.setDistributionContract( distribution.address, {from: GOVERNANCE_ADDRESS});

    await distribution.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.CLAIM_SETUP_MANAGER, Contracts.PRICE_SUBMITTER, Contracts.COMBINED_NAT]),
      [ADDRESS_UPDATER, wNat.address, claimSetupManager.address, priceSubmitterMock.address, wNat.address], {from: ADDRESS_UPDATER});

    await claimSetupManager.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.WNAT, Contracts.FTSO_MANAGER]),
      [ADDRESS_UPDATER, wNat.address, ftsoManagerMock.address], {from: ADDRESS_UPDATER});

  });

  it.skip("DistributionToDelegators daemonize calls for 150 opt-out accounts with 20 transfers per month - 3 months", async () => {
    await distributionToDelegatorsGasBenchmarking(150, 20, 3);
  });

  it("DistributionToDelegators daemonize calls for 150 opt-out accounts with 50 transfers per month - 3 months", async () => {
    await distributionToDelegatorsGasBenchmarking(150, 50, 3);
  });

  it.skip("DistributionToDelegators daemonize calls for 200 opt-out accounts with 50 transfers per month - 5 months", async () => {
    await distributionToDelegatorsGasBenchmarking(200, 50, 5);
  });

});
