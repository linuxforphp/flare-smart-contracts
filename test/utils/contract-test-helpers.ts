import { network } from "hardhat";
import { GovernedBaseInstance } from "../../typechain-truffle";
import { findRequiredEvent, increaseTimeTo, toBN } from "./test-helpers";

const SuicidalMock = artifacts.require("SuicidalMock");
const IGovernanceSettings = artifacts.require("IGovernanceSettings");

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

export async function stopImpersonatingContract(contractAddress: string) {
    await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [contractAddress] });
}

export async function emptyAddressBalance(address: string, toAccount: string) {
    const gasPrice = toBN(100_000_000_000);
    const gasAmount = 21000;
    await impersonateContract(address, gasPrice.muln(gasAmount), toAccount);
    const addressBalance = toBN(await web3.eth.getBalance(address));
    const amount = addressBalance.sub(gasPrice.muln(gasAmount));
    await web3.eth.sendTransaction({ from: address, to: toAccount, value: amount, gas: gasAmount, gasPrice: gasPrice });
    await stopImpersonatingContract(address);
}

export async function executeTimelockedGovernanceCall(contract: Truffle.ContractInstance, methodCall: (governance: string) => Promise<Truffle.TransactionResponse<any>>) {
    const contractGoverned = contract as GovernedBaseInstance;
    const governanceSettings = await IGovernanceSettings.at(await contractGoverned.governanceSettings());
    const governance = await governanceSettings.getGovernanceAddress();
    const executor = (await governanceSettings.getExecutors())[0];
    const response = await methodCall(governance);
    const timelockArgs = findRequiredEvent(response, "GovernanceCallTimelocked").args;
    await increaseTimeTo(timelockArgs.allowedAfterTimestamp.toNumber() + 1, 'web3');
    await contractGoverned.executeGovernanceCall(timelockArgs.selector, { from: executor });
}