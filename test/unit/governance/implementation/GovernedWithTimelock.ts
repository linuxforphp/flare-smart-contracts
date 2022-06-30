import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { GovernedWithTimelockMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { assertNumberEqual } from "../../../utils/test-helpers";

const GovernanceAddressPointer = artifacts.require("GovernanceAddressPointer"); 
const GovernedWithTimelockMock = artifacts.require("GovernedWithTimelockMock");

contract(`GovernedWithTimelock.sol; ${getTestFile(__filename)}; GovernedWithTimelock unit tests`, async accounts => {
    const initialGovernance = accounts[10];
    const governance = accounts[11];
    const executor = accounts[12];
    
    function findRequiredEvent<E extends Truffle.AnyEvent, N extends E['name']>(res: Truffle.TransactionResponse<E>, name: N): Truffle.TransactionLog<Extract<E, { name: N }>> {
        const event = res.logs.find(e => e.event === name) as any;
        assert.isTrue(event != null);
        return event;
    }

    let mock: GovernedWithTimelockMockInstance;
    
    beforeEach(async () => {
        mock = await GovernedWithTimelockMock.new(initialGovernance);
        const governanceAddressPointer = await GovernanceAddressPointer.new(governance);
        await mock.switchToProductionMode(governanceAddressPointer.address, 3600, { from: initialGovernance });
        await mock.setGovernanceExecutor(executor, { from: governance });
    });

    it("allow direct changes in deployment phase", async () => {
        const mockDeployment = await GovernedWithTimelockMock.new(initialGovernance);
        await mockDeployment.changeA(15, { from: initialGovernance });
        assertNumberEqual(await mockDeployment.a(), 15);
    });
    
    it("no effect immediately", async () => {
        await mock.changeA(15, { from: governance });
        assertNumberEqual(await mock.a(), 0);
    });

    it("can execute after time", async () => {
        const res = await mock.changeA(15, { from: governance });
        const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
        await time.increase(3600);
        const execRes = await mock.executeGovernanceCall(selector, { from: executor });
        expectEvent(execRes, "TimelockedGovernanceCallExecuted", { selector: selector });
        assertNumberEqual(await mock.a(), 15);
    });

    it("cannot execute before time", async () => {
        const res = await mock.changeA(15, { from: governance });
        const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
        await time.increase(3000);  // should be 3600
        await expectRevert(mock.executeGovernanceCall(selector, { from: executor }),
            "timelock: not allowed yet");
        assertNumberEqual(await mock.a(), 0);
    });

    it("passes reverts correctly", async () => {
        const res = await mock.changeWithRevert(15, { from: governance });
        const { selector } = findRequiredEvent(res, 'GovernanceCallTimelocked').args;
        await time.increase(3600);
        await expectRevert(mock.executeGovernanceCall(selector, { from: executor }),
            "this is revert");
        assertNumberEqual(await mock.a(), 0);
    });

    it("require governance - deployment phase", async () => {
        const mockDeployment = await GovernedWithTimelockMock.new(initialGovernance);
        await expectRevert(mockDeployment.changeA(20), "only governance");
    });

    it("require governance - timelocked", async () => {
        await expectRevert(mock.changeA(20), "only governance");
    });

    it("require governance - immediate", async () => {
        await expectRevert(mock.changeB(20), "only governance");
    });

});
