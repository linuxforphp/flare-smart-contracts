import { network } from "hardhat";
import { GovernedBaseInstance } from "../../typechain-truffle";
import { findRequiredEvent, increaseTimeTo } from "./test-helpers";

const SuicidalMock = artifacts.require("SuicidalMock");
const GovernanceAddressPointer = artifacts.require("GovernanceAddressPointer");

export async function transferWithSuicide(amount: BN, from: string, to: string) {
    if (amount.lten(0)) throw new Error("Amount must be positive");
    const suicidalMock = await SuicidalMock.new(to);
    await web3.eth.sendTransaction({ from: from, to: suicidalMock.address, value: amount });
    await suicidalMock.die();
}

export async function impersonateContract(contractAddress: string, gasBalance: BN, gasSource: string) {
    // allow us to impersonate calls from contract address
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [contractAddress] });
    // provide some balance for gas
    await transferWithSuicide(gasBalance, gasSource, contractAddress);
}

export async function executeTimelockedGovernanceCall(contract: Truffle.ContractInstance, methodCall: (governance: string) => Promise<Truffle.TransactionResponse<any>>) {
    const contractGoverned = contract as GovernedBaseInstance;
    const governanceAddressPointer = await GovernanceAddressPointer.at(await contractGoverned.governanceAddressPointer());
    const governance = await governanceAddressPointer.getGovernanceAddress();
    const executor = (await governanceAddressPointer.getExecutors())[0];
    const response = await methodCall(governance);
    const timelockArgs = findRequiredEvent(response, "GovernanceCallTimelocked").args;
    await increaseTimeTo(timelockArgs.allowedAfterTimestamp.toNumber() + 1, 'web3');
    await contractGoverned.executeGovernanceCall(timelockArgs.selector, { from: executor });
}
