import { FtsoInstance, FtsoManagerInstance, InflationMockInstance, MockContractInstance, MockFtsoContract, MockFtsoInstance, MockVPTokenContract, MockVPTokenInstance, RewardManagerInstance } from "../../typechain-truffle";
import { submitPriceHash, toBN } from "./test-helpers";

const { constants } = require('@openzeppelin/test-helpers');

export interface RewardEpochData {
    votepowerBlock: BN | number,
    startBlock: BN | number
}

export function toNumberify(rewardEpochData: RewardEpochData): RewardEpochData {
    return {
        votepowerBlock: (rewardEpochData.votepowerBlock as BN).toNumber(),
        startBlock: (rewardEpochData.startBlock as BN).toNumber()
    }
}

/**
 * - Sets mock finalizePriceEpoch returning `[[accounts[1], accounts[2]], [25, 75], 100]`
 * - adds it to FTSOManager
 * - fills 1e6 wei to reward manager
 * - activates ftsoManager
 * @param accounts 
 * @param ftsoInterface 
 * @param mockFtso 
 * @param inflation 
 * @param ftsoManager 
 * @param rewardManager 
 */
export async function settingWithOneFTSO_1(accounts: Truffle.Accounts, ftsoInterface: FtsoInstance, mockFtso: MockContractInstance, ftsoManager: FtsoManagerInstance) {
    const getCurrentRandom = ftsoInterface.contract.methods.getCurrentRandom().encodeABI();
    await mockFtso.givenMethodReturnUint(getCurrentRandom, 0);
    // stub ftso finalizer
    const finalizePriceEpoch = ftsoInterface.contract.methods.finalizePriceEpoch(0, true).encodeABI();
    const finalizePriceEpochReturn = web3.eth.abi.encodeParameters(
        ['address[]', 'uint256[]', 'uint256'],
        [[accounts[1], accounts[2]], [25, 75], 100]);
    await mockFtso.givenMethodReturn(finalizePriceEpoch, finalizePriceEpochReturn);
    // give reward manager some flr to distribute
    // await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
    // await inflation.setRewardManagerDailyRewardAmount(1000000);

    await setDefaultGovernanceParameters(ftsoManager);
    // add fakey ftso
    await ftsoManager.addFtso(mockFtso.address, { from: accounts[0] });
    // activte ftso manager
    await ftsoManager.activate();
}

export async function settingWithTwoFTSOs(accounts: Truffle.Accounts, ftsoManager: FtsoManagerInstance) {

    const Ftso = artifacts.require("MockFtso") as MockFtsoContract;
    const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;

    let flrToken = await MockVPToken.new(accounts.slice(0, 10), []) as MockVPTokenInstance;
    let fasset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;
    let fasset2Token = await MockVPToken.new(accounts.slice(0, 10), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]) as MockVPTokenInstance;
    
    let ftso1 = await Ftso.new(
        "FA1", flrToken.address, ftsoManager.address,  // _symbol, address _wFlr, address _ftsoManager,
        0, // uint256 _startTimestamp // do not init/activate
        0, 0, //uint256 _epochPeriod, uint256 _revealPeriod // do not init/activate
        0 //uint256 _initialPrice
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoFAsset(ftso1.address, fasset1Token.address);

    let ftso2 = await Ftso.new(
        "FA2", flrToken.address, ftsoManager.address,  // _symbol, address _wFlr, address _ftsoManager,
        0, // uint256 _startTimestamp // do not init/activate
        0, 0, //uint256 _epochPeriod, uint256 _revealPeriod // do not init/activate
        0 //uint256 _initialPrice
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoFAsset(ftso2.address, fasset2Token.address);

    // await web3.eth.sendTransaction({ from: accounts[0], to: rewardManager.address, value: 1000000 });
    // await inflation.setRewardManagerDailyRewardAmount(1000000);

    // activte ftso manager
    // await ftsoManager.activate();    
    return [ftso1, ftso2];
}

export async function settingWithFourFTSOs(accounts: Truffle.Accounts, ftsoManager: FtsoManagerInstance, flrContract=false) {

    const Ftso = artifacts.require("MockFtso") as MockFtsoContract;
    const MockVPToken = artifacts.require("MockVPToken") as MockVPTokenContract;

    let flrToken = await MockVPToken.new(accounts.slice(0, 10), []) as MockVPTokenInstance;
    let fasset1Token = await MockVPToken.new(accounts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) as MockVPTokenInstance;
    let fasset2Token = await MockVPToken.new(accounts.slice(0, 10), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]) as MockVPTokenInstance;
    let fasset3Token = await MockVPToken.new(accounts.slice(0, 10), [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]) as MockVPTokenInstance;
    let fasset4Token = await MockVPToken.new(accounts.slice(0, 10), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]) as MockVPTokenInstance;
    
    let ftso1 = await Ftso.new(
        flrContract ? "FLR" : "FA1", flrToken.address, ftsoManager.address,  // _symbol, address _wFlr, address _ftsoManager,
        0, // uint256 _startTimestamp // do not init/activate
        0, 0, //uint256 _epochPeriod, uint256 _revealPeriod // do not init/activate
        0 //uint256 _initialPrice
    ) as MockFtsoInstance;
    if (!flrContract) {
        await ftsoManager.setFtsoFAsset(ftso1.address, fasset1Token.address);
    }

    let ftso2 = await Ftso.new(
        "FA2", flrToken.address, ftsoManager.address,  // _symbol, address _wFlr, address _ftsoManager,
        0, // uint256 _startTimestamp // do not init/activate
        0, 0, //uint256 _epochPeriod, uint256 _revealPeriod // do not init/activate
        0 //uint256 _initialPrice
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoFAsset(ftso2.address, fasset2Token.address);

    let ftso3 = await Ftso.new(
        "FA3", flrToken.address, ftsoManager.address,  // _symbol, address _wFlr, address _ftsoManager,
        0, // uint256 _startTimestamp // do not init/activate
        0, 0, //uint256 _epochPeriod, uint256 _revealPeriod // do not init/activate
        0 //uint256 _initialPrice
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoFAsset(ftso3.address, fasset3Token.address);

    let ftso4 = await Ftso.new(
        "FA4", flrToken.address, ftsoManager.address,  // _symbol, address _wFlr, address _ftsoManager,
        0, // uint256 _startTimestamp // do not init/activate
        0, 0, //uint256 _epochPeriod, uint256 _revealPeriod // do not init/activate
        0 //uint256 _initialPrice
    ) as MockFtsoInstance;
    await ftsoManager.setFtsoFAsset(ftso4.address, fasset4Token.address);

    // await web3.eth.sendTransaction({ from: accounts[0], to: rewardManagerAddress, value: 1000000 });
    // await inflation.setRewardManagerDailyRewardAmount(1000000);

    // activte ftso manager
    // await ftsoManager.activate();    
    return [ftso1, ftso2, ftso3, ftso4];
}


export async function setDefaultGovernanceParameters(ftsoManager: FtsoManagerInstance) {
    let paramList = [1e10, 1e10, 1, 1, 1000, 10000, 50, 1500];
    let paramListBN = paramList.map(x => toBN(x));
    await (ftsoManager.setGovernanceParameters as any)(...paramListBN, []);   
    return paramListBN 
}

export async function submitSomePrices(ftso: MockFtsoInstance, n: number, accounts: Truffle.Accounts) {
    let epoch!: BN;;
    for(let i = 0; i < n; i++) {        
        let hash = submitPriceHash(i, i);
        let res = await ftso.submitPrice(hash, {from: accounts[i]});
        epoch = res.logs[0].args![1] as BN
    }
    return epoch;
}

export async function revealSomePrices(ftso: MockFtsoInstance, n: number, epoch: number, accounts: Truffle.Accounts) {
    for(let i = 0; i < n; i++) {     
        await ftso.revealPrice(epoch, i, i, {from: accounts[i]});
    }
}