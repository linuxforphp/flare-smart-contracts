import { expectRevert, time } from "@openzeppelin/test-helpers";
import { GovernedWithTimelockMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { assertNumberEqual } from "../../../utils/test-helpers";

const GovernedWithTimelockMock = artifacts.require("GovernedWithTimelockMock");

contract(`GovernedWithTimelock.sol; ${getTestFile(__filename)}; GovernedWithTimelock unit tests`, async accounts => {
    const governance = accounts[10];
    const executor = accounts[11];
    
    function findRequiredEvent<E extends Truffle.AnyEvent, N extends E['name']>(res: Truffle.TransactionResponse<E>, name: N): Truffle.TransactionLog<Extract<E, { name: N }>> {
        const event = res.logs.find(e => e.event === name) as any;
        assert.isTrue(event != null);
        return event;
    }

    let mock: GovernedWithTimelockMockInstance;
    
    beforeEach(async () => {
        mock = await GovernedWithTimelockMock.new(governance, 3600);
        await mock.transferGovernance(governance, { from: governance });  // end deployment phase
        await mock.setGovernanceExecutors([executor], { from: governance });
    });

    it("allow direct changes in deployment phase", async () => {
        const mockDeployment = await GovernedWithTimelockMock.new(governance, 3600);
        await mockDeployment.changeA(15, { from: governance });
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
        await mock.executeGovernanceCall(selector, { from: executor });
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
        const mockDeployment = await GovernedWithTimelockMock.new(governance, 3600);
        await expectRevert(mockDeployment.changeA(20), "only governance");
    });

    it("require governance - timelocked", async () => {
        await expectRevert(mock.changeA(20), "only governance");
    });

    it("require governance - immediate", async () => {
        await expectRevert(mock.changeB(20), "only governance");
    });

});
