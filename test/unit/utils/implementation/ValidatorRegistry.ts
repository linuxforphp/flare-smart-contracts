import { constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { MockContractInstance, PriceSubmitterInstance, ValidatorRegistryInstance } from "../../../../typechain-truffle";
import { getTestFile, PRICE_SUBMITTER_ADDRESS } from "../../../utils/constants";
import { encodeContractNames, encodeString } from "../../../utils/test-helpers";

const hardhat: HardhatRuntimeEnvironment = require('hardhat');

const ValidatorRegistry = artifacts.require("ValidatorRegistry");
const PriceSubmitter = artifacts.require("PriceSubmitter");
const MockContract = artifacts.require("MockContract");


contract(`ValidatorRegistry.sol; ${getTestFile(__filename)}; Validator registry unit tests`, async accounts => {
    let mockPriceSubmitter: MockContractInstance;
    const dataProviders = [accounts[1], accounts[2], accounts[3]];
    const nodeIds = ["NodeID-1", "NodeID-2", "NodeID-3"];
    const pChainPublicKeys = ["X-flare1", "X-flare2", "X-flare3"]
    let priceSubmitterInterface: PriceSubmitterInstance;
    let validatorRegistry: ValidatorRegistryInstance;

    before(async () => {
        priceSubmitterInterface = await PriceSubmitter.new()
        // test only - fake deploy at genesis address
        const tempPriceSubmitter = await MockContract.new();
        const priceSubmitterCode = await web3.eth.getCode(tempPriceSubmitter.address);   // get deployed code
        await hardhat.network.provider.send("hardhat_setCode", [PRICE_SUBMITTER_ADDRESS, priceSubmitterCode]);
        mockPriceSubmitter = await MockContract.at(PRICE_SUBMITTER_ADDRESS);

        for (let i = 0; i < dataProviders.length; i++) {
            const voterWhitelistBitmap = priceSubmitterInterface.contract.methods.voterWhitelistBitmap(dataProviders[i]).encodeABI()
            await mockPriceSubmitter.givenCalldataReturnUint(voterWhitelistBitmap, 100);
        }
    });

    beforeEach(async () => {
        validatorRegistry = await ValidatorRegistry.new();
    });

    it("should register and get correct data back", async () => {
        const tx = await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: dataProviders[0] });
        expectEvent(tx, "DataProviderRegistered", {dataProvider: dataProviders[0], nodeId: nodeIds[0], pChainPublicKey: pChainPublicKeys[0]});
        let data = await validatorRegistry.getDataProviderInfo(dataProviders[0]);
        expect(data[0]).to.be.equal(nodeIds[0]);
        expect(data[1]).to.be.equal(pChainPublicKeys[0]);
        expect(await validatorRegistry.getDataProviderForNodeId(encodeString(nodeIds[0]))).to.be.equal(dataProviders[0]);
        expect(await validatorRegistry.getDataProviderForPChainPublicKey(encodeString(pChainPublicKeys[0]))).to.be.equal(dataProviders[0]);
    });

    it("should revert at registration if not whitelisted", async () => {
        const voterWhitelistBitmap = priceSubmitterInterface.contract.methods.voterWhitelistBitmap(accounts[10]).encodeABI()
        await mockPriceSubmitter.givenCalldataReturnUint(voterWhitelistBitmap, 0);
        const registerPromise = validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: accounts[10] });
        await expectRevert(registerPromise, "not whitelisted");
    });

    it("should unregister", async () => {
        await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: dataProviders[0] });
        const tx = await validatorRegistry.unregisterDataProvider({ from: dataProviders[0] });
        expectEvent(tx, "DataProviderUnregistered");
        let data = await validatorRegistry.getDataProviderInfo(dataProviders[0]);
        expect(data[0]).to.be.equal("");
        expect(data[1]).to.be.equal("");
        expect(await validatorRegistry.getDataProviderForNodeId(encodeString(nodeIds[0]))).to.be.equal(constants.ZERO_ADDRESS);
        expect(await validatorRegistry.getDataProviderForPChainPublicKey(encodeString(pChainPublicKeys[0]))).to.be.equal(constants.ZERO_ADDRESS);
    });

    it("should update data", async () => {
        await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: dataProviders[0] });
        const tx = await validatorRegistry.registerDataProvider(nodeIds[1], pChainPublicKeys[1], { from: dataProviders[0] });
        expectEvent(tx, "DataProviderRegistered", {dataProvider: dataProviders[0], nodeId: nodeIds[1], pChainPublicKey: pChainPublicKeys[1]});
        let data = await validatorRegistry.getDataProviderInfo(dataProviders[0]);
        expect(data[0]).to.be.equal(nodeIds[1]);
        expect(data[1]).to.be.equal(pChainPublicKeys[1]);
        expect(await validatorRegistry.getDataProviderForNodeId(encodeString(nodeIds[0]))).to.be.equal(constants.ZERO_ADDRESS);
        expect(await validatorRegistry.getDataProviderForPChainPublicKey(encodeString(pChainPublicKeys[0]))).to.be.equal(constants.ZERO_ADDRESS);
        expect(await validatorRegistry.getDataProviderForNodeId(encodeString(nodeIds[1]))).to.be.equal(dataProviders[0]);
        expect(await validatorRegistry.getDataProviderForPChainPublicKey(encodeString(pChainPublicKeys[1]))).to.be.equal(dataProviders[0]);
    });

    it("should update nodeId only", async () => {
        await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: dataProviders[0] });
        await validatorRegistry.registerDataProvider(nodeIds[1], pChainPublicKeys[0], { from: dataProviders[0] });
        let data = await validatorRegistry.getDataProviderInfo(dataProviders[0]);
        expect(data[0]).to.be.equal(nodeIds[1]);
        expect(data[1]).to.be.equal(pChainPublicKeys[0]);
        expect(await validatorRegistry.getDataProviderForNodeId(encodeString(nodeIds[0]))).to.be.equal(constants.ZERO_ADDRESS);
        expect(await validatorRegistry.getDataProviderForNodeId(encodeString(nodeIds[1]))).to.be.equal(dataProviders[0]);
        expect(await validatorRegistry.getDataProviderForPChainPublicKey(encodeString(pChainPublicKeys[0]))).to.be.equal(dataProviders[0]);
    });

    it("should update pChainPublicKeys only", async () => {
        await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: dataProviders[0] });
        await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[1], { from: dataProviders[0] });
        let data = await validatorRegistry.getDataProviderInfo(dataProviders[0]);
        expect(data[0]).to.be.equal(nodeIds[0]);
        expect(data[1]).to.be.equal(pChainPublicKeys[1]);
        expect(await validatorRegistry.getDataProviderForPChainPublicKey(encodeString(pChainPublicKeys[0]))).to.be.equal(constants.ZERO_ADDRESS);
        expect(await validatorRegistry.getDataProviderForNodeId(encodeString(nodeIds[0]))).to.be.equal(dataProviders[0]);
        expect(await validatorRegistry.getDataProviderForPChainPublicKey(encodeString(pChainPublicKeys[1]))).to.be.equal(dataProviders[0]);
    });

    it("should revert at update if nodeId already in use", async () => {
        await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: dataProviders[0] });
        await validatorRegistry.registerDataProvider(nodeIds[1], pChainPublicKeys[1], { from: dataProviders[1] });
        const registerPromise = validatorRegistry.registerDataProvider(nodeIds[1], pChainPublicKeys[2], { from: dataProviders[0] });
        await expectRevert(registerPromise, "nodeId already in use");
    });

    it("should revert at update if pChainPublicKey already in use", async () => {
        await validatorRegistry.registerDataProvider(nodeIds[0], pChainPublicKeys[0], { from: dataProviders[0] });
        await validatorRegistry.registerDataProvider(nodeIds[1], pChainPublicKeys[1], { from: dataProviders[1] });
        const registerPromise = validatorRegistry.registerDataProvider(nodeIds[2], pChainPublicKeys[1], { from: dataProviders[0] });
        await expectRevert(registerPromise, "pChainPublicKey already in use");
    });
});
