import { 
    IFtsoRegistryInstance, 
    IVoterWhitelisterInstance,
    IPriceSubmitterInstance,
} from "../../../../typechain-truffle";
import { increaseTimeTo, submitPriceHash, toBN } from "../../../utils/test-helpers";


const {constants, expectRevert, expectEvent, time} = require('@openzeppelin/test-helpers');

const DummyPriceSubmitter = artifacts.require("DummyPriceSubmitter");
const DummyFtsoRegistry = artifacts.require("DummyFtsoRegistry");
const DummyVoterWhitelister = artifacts.require("DummyVoterWhitelister");

const ERR_TOO_MANY_REVERTS = "Too many reverts";

contract(`DummyPriceSubmitter.sol; DummyPriceSubmitter unit tests`, async accounts => {
      
    let priceSubmitter: IPriceSubmitterInstance;
    let ftsoRegistry: IFtsoRegistryInstance;
    let voterWhitelister: IVoterWhitelisterInstance;

    beforeEach(async() => {
        const DummyPriceSubmitterInstance = await DummyPriceSubmitter.new();
        priceSubmitter = DummyPriceSubmitterInstance;
        ftsoRegistry = await DummyFtsoRegistry.at(await priceSubmitter.getFtsoRegistry());
        voterWhitelister = await DummyVoterWhitelister.at(await priceSubmitter.getVoterWhitelister());
    });
  
    describe("Test usage", async() => {
        it("Should fail on submit without whitelisting", async() => {
            const hash1 = submitPriceHash(500, 123, accounts[10]);
            let tx = priceSubmitter.submitPriceHashes([1, 2, 3], [hash1,], {from: accounts[10]});
            await expectRevert(tx, ERR_TOO_MANY_REVERTS);
        });

        it("Should emit correct event on failure", async() => {
            const hash1 = submitPriceHash(500, 123, accounts[10]);
            let tx = await priceSubmitter.submitPriceHashes([1, 2], [hash1,], {from: accounts[10]});
            await expectEvent(tx, "PriceHashesSubmitted", { ftsos: [constants.ZERO_ADDRESS, constants.ZERO_ADDRESS] });
        });

        it("Should emit correct event on submit and failure", async() => {
            const hash1 = submitPriceHash(500, 123, accounts[10]);            

            let ftso = await ftsoRegistry.getFtso(2);

            await voterWhitelister.requestWhitelistingVoter(accounts[10], 2);
            let tx = await priceSubmitter.submitPriceHashes([1, 2], [hash1, hash1], {from: accounts[10]});

            await expectEvent(tx, "PriceHashesSubmitted", { ftsos: [constants.ZERO_ADDRESS, ftso], success: [false, true], epochId: "1"});
        });

        it("Should submit and reveal", async() => {
            const hash0 = submitPriceHash(500, 123, accounts[10]);            
            const hash1 = submitPriceHash(500, 123, accounts[10]);            
            const hash2 = submitPriceHash(100, 30, accounts[10]);            

            let ftso0 = await ftsoRegistry.getFtso(0);
            let ftso1 = await ftsoRegistry.getFtso(1);
            let ftso2 = await ftsoRegistry.getFtso(2);

            await voterWhitelister.requestFullVoterWhitelisting(accounts[10]);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], [hash0, hash1, hash2], {from: accounts[10]});

            expectEvent(tx, "PriceHashesSubmitted", { ftsos: [ftso0, ftso1, ftso2], success: [true, true, true], 
                                                      epochId: "1", hashes: [hash0, hash1, hash2]});

            

            let timestamp = await time.latest() as BN;
            await increaseTimeTo(timestamp.addn(120).toNumber());
            // Do reveal
            tx = await priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], [123, 123, 30], {from: accounts[10]});

            await expectEvent(tx, "PricesRevealed", { ftsos: [ftso0, ftso1, ftso2], success: [true, true, true], 
                                                      epochId: "1", prices: [toBN(500), toBN(500), toBN(100)]});
            
            // Should fail on double reveal
            let tx1 = priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], [123, 123, 30], {from: accounts[10]});

            await expectRevert(tx1, "Too many reverts");
        });

        it("Should fail if submitted to soon", async() => {
            const hash0 = submitPriceHash(500, 123, accounts[10]);            
            const hash1 = submitPriceHash(500, 123, accounts[10]);            
            const hash2 = submitPriceHash(100, 30, accounts[10]);            

            let ftso0 = await ftsoRegistry.getFtso(0);
            let ftso1 = await ftsoRegistry.getFtso(1);
            let ftso2 = await ftsoRegistry.getFtso(2);

            await voterWhitelister.requestWhitelistingVoter(accounts[10], 2);
            await voterWhitelister.requestWhitelistingVoter(accounts[10], 1);
            await voterWhitelister.requestWhitelistingVoter(accounts[10], 0);
            let tx = await priceSubmitter.submitPriceHashes([0, 1, 2], [hash0, hash1, hash2], {from: accounts[10]});

            expectEvent(tx, "PriceHashesSubmitted", { ftsos: [ftso0, ftso1, ftso2], success: [true, true, true], 
                                                      epochId: "1", hashes: [hash0, hash1, hash2]});

            

            let timestamp = await time.latest() as BN;
            // Not yet in new epoch
            await increaseTimeTo(timestamp.addn(60).toNumber());
            // Do reveal
            let tx1 = priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], [123, 123, 30], {from: accounts[10]});
            await expectRevert(tx1, "Too many reverts");

            await increaseTimeTo(timestamp.addn(120).toNumber());
            tx = await priceSubmitter.revealPrices(1, [0, 1, 2], [500, 500, 100], [123, 123, 30], {from: accounts[10]});

            await expectEvent(tx, "PricesRevealed", { ftsos: [ftso0, ftso1, ftso2], success: [true, true, true], 
                                                      epochId: "1", prices: [toBN(500), toBN(500), toBN(100)]});

        });

    });
  
  });
  