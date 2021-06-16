import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { VPContract, VPToken } from "../../typechain";
import { newContract } from "./test-helpers";

const VPContractContract = artifacts.require("VPContract");

interface IISetVpContract {
    address: string;
    setVpContract(_vpContract: string, txDetails?: Truffle.TransactionDetails): Promise<any>;
}

export async function setDefaultVPContract(token: IISetVpContract, governance: string) {
    const vpContract = await VPContractContract.new(token.address);
    await token.setVpContract(vpContract.address, { from: governance });
}

export async function setDefaultVPContract_ethers(token: VPToken, signer: SignerWithAddress, governance: string = signer.address) {
    const vpContract = await newContract<VPContract>("VPContract", signer, token.address);
    await token.setVpContract(vpContract.address, { from: governance });
}
