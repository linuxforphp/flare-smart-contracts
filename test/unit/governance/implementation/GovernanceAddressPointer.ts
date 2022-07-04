import { expectRevert } from "@openzeppelin/test-helpers";
import { GovernanceAddressPointerInstance, GovernedWithTimelockMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { compareArrays, findRequiredEvent } from "../../../utils/test-helpers";

const GovernanceAddressPointer = artifacts.require("GovernanceAddressPointer"); 
const GovernedWithTimelockMock = artifacts.require("GovernedWithTimelockMock");

contract(`GovernanceAddressPointer.sol; ${getTestFile(__filename)}; GovernanceAddressPointer unit tests`, async accounts => {
    const initialGovernance = accounts[10];
    const governance = accounts[11];
    const executor = accounts[12];
    
    let governanceAddressPointer: GovernanceAddressPointerInstance;
    let mock: GovernedWithTimelockMockInstance;
    
    beforeEach(async () => {
        governanceAddressPointer = await GovernanceAddressPointer.new(governance, 3600, [governance, executor]);
        mock = await GovernedWithTimelockMock.new(initialGovernance);
        await mock.switchToProductionMode(governanceAddressPointer.address, { from: initialGovernance });
    });
    
    it("can change executors", async () => {
        const origExecutors = [governance, executor];
        const newExecutors = [accounts[13], accounts[14], accounts[15]];
        const isExecutorOld = [false, true, true, false, false, false];
        const isExecutorNew = [false, false, false, true, true, true];
        // compare old
        compareArrays(await governanceAddressPointer.getExecutors(), origExecutors);
        for (let i = 10; i < 15; i++) {
            assert.equal(await governanceAddressPointer.isExecutor(accounts[i]), isExecutorOld[i - 10]);
        }
        // change
        const res = await governanceAddressPointer.setExecutors(newExecutors, { from: governance });
        const event = findRequiredEvent(res, "GovernanceExecutorsUpdated");
        compareArrays(event.args.oldExecutors, origExecutors);
        compareArrays(event.args.newExecutors, newExecutors);
        // compare new
        compareArrays(await governanceAddressPointer.getExecutors(), newExecutors);
        for (let i = 10; i < 15; i++) {
            assert.equal(await governanceAddressPointer.isExecutor(accounts[i]), isExecutorNew[i - 10]);
        }
    });

    it("only governance can set executors", async () => {
        await expectRevert(governanceAddressPointer.setExecutors([accounts[15]]),
            "only governance");
    });
    
    it("changing governance address should fail silently (only effective by fork)", async () => {
        await governanceAddressPointer.setGovernanceAddress(accounts[15], { from: governance });
        // should remain as before
        assert.equal(await governanceAddressPointer.getGovernanceAddress(), accounts[11]);
    });

    it("changing timelock should fail silently", async () => {
        await governanceAddressPointer.setTimelock(1000, { from: governance });
        // should remain as before
        assert.equal(Number(await governanceAddressPointer.getTimelock()), 3600);
    });

    it("changing governance should check that it's different", async () => {
        await expectRevert(governanceAddressPointer.setGovernanceAddress(governance),
            "governanceAddress == _newGovernance");
    });
    
    it("changing timelock should check that it's different", async () => {
        await expectRevert(governanceAddressPointer.setTimelock(3600),
            "timelock == _newTimelock");
    });
    
    it("changing timelock should check size", async () => {
        await expectRevert(governanceAddressPointer.setTimelock("1000000000000000"),
            "timelock too large");
    });
});
