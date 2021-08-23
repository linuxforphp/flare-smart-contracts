import { FormattedTransactionType, RippleAPI } from 'ripple-lib';
import { StateConnectorInstance } from "../../../typechain-truffle";
import { advanceBlock, toBN, waitFinalize3 } from '../../utils/test-helpers';

const StateConnector = artifacts.require("StateConnector");

import { constants, expectRevert, expectEvent, time } from '@openzeppelin/test-helpers';
import { STATE_CONNECTOR_ADDRESS } from '../../utils/constants';
const getTestFile = require('../../utils/constants').getTestFile;

declare type TransactionData = {
    txId: string;
    txIdHash: string;
    type: string;
    result: string;
    ledger: number;
    source: string;
    destination: string;
    destinationTag: number;
    destinationTagHash: string;
    amount: BN;
    amountHash: string;
    currency: string;
    currencyHash: string;
    paymentHash: string;
}

const chainId = 3;
const checkNumberOfTxsPerType = 5;
const checkNumberOfLedgers = 3;
const timeDiffExpected = 120;

let stateConnector: StateConnectorInstance;
let rippleApi: RippleAPI;

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the StateConnector, which should
 * already be loaded in the genesis block.
 */
contract(`StateConnector.sol; ${getTestFile(__filename)}; StateConnector system tests`, async accounts => {
    // Static address of the daemon on a local network

    before(async() => {
        // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go;
        stateConnector = await StateConnector.at(STATE_CONNECTOR_ADDRESS);
        try {
            console.log("initialising chains");
            await stateConnector.initialiseChains();
            // Wait for some blocks to mine...
            for(let i = 0; i < 5; i++) {
                await new Promise(resolve => {
                    setTimeout(resolve, 1000);
                });
                await advanceBlock();  
            }
            console.log("initialiseChains");
        } catch (e) {
            // do nothing, already initialised
            console.log("initialiseChains - already done");
        }

        rippleApi = new RippleAPI({
            server: "wss://xrplcluster.com",
            timeout: 60000
        });

        await rippleApi.connect();
        // console.log("Ripple api connected");
    });

    after(async() => {
        await rippleApi.disconnect();
        // console.log("Ripple api disconnected");
    });

    describe("data availability and payment proofs", async() => {
        let latestIndexData: any;
        let numConfirmations: number;
        let genesisLedger: number;
        let claimPeriodIndex: number;
        let claimPeriodLength: number;
        let timeDiffAverage: number;

        beforeEach(async() => {
            latestIndexData = await stateConnector.getLatestIndex(chainId);
            numConfirmations = (await stateConnector.chains(chainId))[4].toNumber();
            genesisLedger = latestIndexData[0].toNumber();
            claimPeriodIndex = latestIndexData[1].toNumber();
            claimPeriodLength = latestIndexData[2].toNumber();
            timeDiffAverage = latestIndexData[5].toNumber();
        });

        it("Should proveClaimPeriodFinality 5x", async() => {
            for (let i = 0; i < 5; i++) {
                // Assemble
                
                const rewardSchedule1 = await stateConnector.getRewardPeriod();
                const claimPeriodsMined1 = await stateConnector.getClaimPeriodsMined(accounts[0], rewardSchedule1);
                const totalClaimPeriodsMined1 = await stateConnector.getTotalClaimPeriodsMined(rewardSchedule1);

                await proveClaimPeriod(accounts[0], genesisLedger, claimPeriodIndex, claimPeriodLength, numConfirmations);
                
                // Assert
                const claimPeriodIndexFinality = await stateConnector.getClaimPeriodIndexFinality(chainId, claimPeriodIndex);
                const rewardSchedule2 = await stateConnector.getRewardPeriod();
                const claimPeriodsMined2 = await stateConnector.getClaimPeriodsMined(accounts[0], rewardSchedule2);
                const totalClaimPeriodsMined2 = await stateConnector.getTotalClaimPeriodsMined(rewardSchedule2);
                
                expect(claimPeriodIndexFinality).to.be.true;
                if (i > 1) { // no rewards for the first 2 runs
                    if (rewardSchedule2.eq(rewardSchedule1)) {
                        expect(claimPeriodsMined2.toNumber()).to.equals(claimPeriodsMined1.toNumber() + 1);
                        expect(totalClaimPeriodsMined2.toNumber()).to.equals(totalClaimPeriodsMined1.toNumber() + 1);
                    } else {
                        expect(claimPeriodsMined2.toNumber()).to.equals(1);
                        expect(totalClaimPeriodsMined2.toNumber()).to.equals(1);
                    }
                }

                claimPeriodIndex++;
            }
        });

        it("Should provePaymentFinality", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength;
            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                let transactionType: Map<string, number> = new Map<string, number>();

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);

                    let typeCount = transactionType.get(txData.type) || 0;
                    transactionType.set(txData.type, ++typeCount);

                    // check all payment transactions and 5 others of each type
                    // if (txData.type != "payment" && typeCount == checkNumberOfTxsPerType) console.log("last check for type: " + txData.type);
                    if (txData.type != "payment" && typeCount > checkNumberOfTxsPerType) continue;

                    // Act
                    try {
                        console.log("sending payment proof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));
                    } catch (e) {
                        // Assume that this is being done in the past, so just skip.          
                    }

                    // Assert
                    if (txData.type != "payment" || txData.result != "tesSUCCESS") {
                        await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                            txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    } else {
                        if (txData.currency != "XRP") { // TODO
                            console.log("Skipping payment finality check for currency: " + txData.currency);
                            continue;
                        }
                        const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                            txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                        assert(paymentFinality[2], "Not proved TX: " + txData.txId);
                    }
                }
            }
        });

        it("Should disprovePaymentFinality", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + checkNumberOfLedgers;
            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                let transactionType: Map<string, number> = new Map<string, number>();

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);

                    let typeCount = transactionType.get(txData.type) || 0;
                    transactionType.set(txData.type, ++typeCount);

                    // check all payment transactions and 5 others of each type
                    // if (txData.type != "payment" && typeCount == checkNumberOfTxsPerType) console.log("last check for type: " + txData.type);
                    if (txData.type != "payment" && typeCount > checkNumberOfTxsPerType) continue;

                    // Act
                    try {
                        console.log("sending payment disproof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-1, txData.txId, {gas: 8000000}));
                    } catch (e) {
                        // Assume that this is being done in the past, so just skip.          
                    }

                    if (txData.currency != "" && txData.currency != "XRP") { // TODO
                        console.log("Skipping payment finality check for currency: " + txData.currency);
                        continue;
                    }

                    // Assert
                    const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                    assert(!paymentFinality[2], "Proved TX: " + txData.txId);
                }
            }
        });

        it("Should provePaymentFinality after disprovePaymentFinality", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 2*checkNumberOfLedgers;
            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                let transactionType: Map<string, number> = new Map<string, number>();

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);

                    let typeCount = transactionType.get(txData.type) || 0;
                    transactionType.set(txData.type, ++typeCount);

                    // check all payment transactions and 5 others of each type
                    // if (txData.type != "payment" && typeCount == checkNumberOfTxsPerType) console.log("last check for type: " + txData.type);
                    if (txData.type != "payment" && typeCount > checkNumberOfTxsPerType) continue;

                    // Act
                    try {
                        console.log("sending payment disproof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-2, txData.txId, {gas: 8000000}));
                        console.log("sending payment proof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));
                    } catch (e) {
                        // Assume that this is being done in the past, so just skip.          
                    }

                    if (txData.currency != "" && txData.currency != "XRP") { // TODO
                        console.log("Skipping payment finality check for currency: " + txData.currency);
                        continue;
                    }

                    // Assert
                    const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                    if (txData.type != "payment" || txData.result != "tesSUCCESS") {
                        assert(!paymentFinality[2], "Proved TX: " + txData.txId);
                    } else {
                        assert(paymentFinality[2], "Not proved TX: " + txData.txId);
                    }
                }
            }
        });

        it("Should not disprovePaymentFinality after provePaymentFinality", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 3*checkNumberOfLedgers;
            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                let transactionType: Map<string, number> = new Map<string, number>();

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);

                    let typeCount = transactionType.get(txData.type) || 0;
                    transactionType.set(txData.type, ++typeCount);

                    // check all payment transactions and 5 others of each type
                    // if (txData.type != "payment" && typeCount == checkNumberOfTxsPerType) console.log("last check for type: " + txData.type);
                    if (txData.type != "payment" && typeCount > checkNumberOfTxsPerType) continue;
                    
                    // Act
                    try {
                        console.log("sending payment proof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));
                    } catch (e) {
                        // Assume that this is being done in the past, so just skip.          
                    }

                    // Assert
                    if (txData.type != "payment" || txData.result != "tesSUCCESS") {
                        await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                            txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    } else {
                        if (txData.currency != "" && txData.currency != "XRP") { // TODO
                            console.log("Skipping payment finality check for currency: " + txData.currency);
                            continue;
                        }
                        const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                            txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                        assert(paymentFinality[2], "Not proved TX: " + txData.txId);

                        await expectRevert.unspecified(stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-1, txData.txId, {gas: 8000000}));
                    }
                }
            }
        });

        it("Should disprovePaymentFinality (for > ledger) after disprovePaymentFinality", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 4*checkNumberOfLedgers;
            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                let transactionType: Map<string, number> = new Map<string, number>();

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);

                    let typeCount = transactionType.get(txData.type) || 0;
                    transactionType.set(txData.type, ++typeCount);

                    // check all payment transactions and 5 others of each type
                    // if (txData.type != "payment" && typeCount == checkNumberOfTxsPerType) console.log("last check for type: " + txData.type);
                    if (txData.type != "payment" && typeCount > checkNumberOfTxsPerType) continue;
                    
                    // Act
                    try {
                        console.log("sending payment disproof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-2, txData.txId, {gas: 8000000}));
                        console.log("sending payment disproof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-1, txData.txId, {gas: 8000000}));
                    } catch (e) {
                        // Assume that this is being done in the past, so just skip.          
                    }

                    if (txData.currency != "" && txData.currency != "XRP") { // TODO
                        console.log("Skipping payment finality check for currency: " + txData.currency);
                        continue;
                    }

                    // Assert
                    const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                    assert(!paymentFinality[2], "Proved TX: " + txData.txId);
                }
            }
        });

        it("Should revert disprovePaymentFinality (for <= ledger) after disprovePaymentFinality", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 5*checkNumberOfLedgers;
            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                let transactionType: Map<string, number> = new Map<string, number>();

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);

                    let typeCount = transactionType.get(txData.type) || 0;
                    transactionType.set(txData.type, ++typeCount);

                    // check all payment transactions and 5 others of each type
                    // if (txData.type != "payment" && typeCount == checkNumberOfTxsPerType) console.log("last check for type: " + txData.type);
                    if (txData.type != "payment" && typeCount > checkNumberOfTxsPerType) continue;
                    
                    // Act
                    try {
                        console.log("sending payment disproof for TX: " + txData.txId);
                        await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-1, txData.txId, {gas: 8000000}));
                        await expectRevert(stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-5, txData.txId, {gas: 8000000}), "finalisedPayments[chainId][txIdHash].index >= ledger");
                        await expectRevert(stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger-1, txData.txId, {gas: 8000000}), "finalisedPayments[chainId][txIdHash].index >= ledger");
                    } catch (e) {
                        // Assume that this is being done in the past, so just skip.          
                    }

                    if (txData.currency != "" && txData.currency != "XRP") { // TODO
                        console.log("Skipping payment finality check for currency: " + txData.currency);
                        continue;
                    }

                    // Assert
                    const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                    assert(!paymentFinality[2], "Proved TX: " + txData.txId);
                }
            }
        });

        it("Should not provePaymentFinality if wrong data are sent", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 6*checkNumberOfLedgers;

            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);
                    if (txData.type != "payment" || txData.result != "tesSUCCESS" || txData.currency != "XRP") {
                        continue;
                    }

                    console.log("sending wrong parameters for TX: " + tx);
                    // wrong ledger
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger+1, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                            txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");

                    // wrong txId
                    let txId = "23B8C" + txData.txId.substr(5);
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");

                    let hash = web3.utils.soliditySha3(34534)!;
                    // wrong txIdHash
                    let paymentHash = web3.utils.soliditySha3(hash, txData.source, txData.destination, txData.destinationTagHash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong sourceHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, hash, txData.destination, txData.destinationTagHash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong destinationHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, hash, txData.destinationTagHash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong destinationTagHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, txData.destination, hash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong amountHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, txData.destination, txData.destinationTagHash, hash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong currencyHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, txData.destination, txData.destinationTagHash, txData.amountHash, hash);
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong paymentHash
                    await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, hash, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                }
            }
        });

        it("Should not disprovePaymentFinality if wrong data are sent", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 7*checkNumberOfLedgers;

            for (let i = start; i < Math.min(start + claimPeriodLength, start + checkNumberOfLedgers); i++) {
                console.log("Ledger: " + i);
                const ledger = await rippleApi.getLedger( {ledgerVersion: i, includeTransactions: true} );

                for (let tx of ledger.transactionHashes || []) {
                    let txData: TransactionData = await getTransactionData(rippleApi, tx);
                    if (txData.type != "payment" || txData.result != "tesSUCCESS" || txData.currency != "XRP") {
                        continue;
                    }

                    console.log("sending wrong parameters for TX: " + tx);
                    // wrong ledger
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger+1, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                            txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");

                    // wrong txId
                    let txId = "23B8C" + txData.txId.substr(5);
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger, txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "invalid paymentHash");
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");

                    let hash = web3.utils.soliditySha3(34534)!;
                    // wrong txIdHash
                    let paymentHash = web3.utils.soliditySha3(hash, txData.source, txData.destination, txData.destinationTagHash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong sourceHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, hash, txData.destination, txData.destinationTagHash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong destinationHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, hash, txData.destinationTagHash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong destinationTagHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, txData.destination, hash, txData.amountHash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong amountHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, txData.destination, txData.destinationTagHash, hash, txData.currencyHash);
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong currencyHash
                    paymentHash = web3.utils.soliditySha3(txData.txIdHash, txData.source, txData.destination, txData.destinationTagHash, txData.amountHash, hash);
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, paymentHash!, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                    // wrong paymentHash
                    await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, hash, txData.ledger, txData.txId, {gas: 8000000}));
                    await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                        txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "txId does not exist");
                }
            }
        });

        it("Should provePaymentFinality after disprovePaymentFinality even if wrong data were sent", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 8*checkNumberOfLedgers;

            console.log("Ledger: " + start);
            const ledger = await rippleApi.getLedger( {ledgerVersion: start, includeTransactions: true} );

            const ledgerInFuture = await rippleApi.getLedger( {ledgerVersion: genesisLedger + claimPeriodIndex*claimPeriodLength, includeTransactions: true} );

            let futureTxId: string = "";
            for (let tx of ledgerInFuture.transactionHashes || []) {
                let txData: TransactionData = await getTransactionData(rippleApi, tx);
                if (txData.type != "payment" || txData.result != "tesSUCCESS" || txData.currency != "XRP") {
                    continue;
                }
                futureTxId = txData.txId;
                break;
            }

            for (let tx of ledger.transactionHashes || []) {
                let txData: TransactionData = await getTransactionData(rippleApi, tx);
                if (txData.type != "payment" || txData.result != "tesSUCCESS" || txData.currency != "XRP") {
                    continue;
                }

                // wrong txId
                await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger, futureTxId, {gas: 8000000}));
                await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(futureTxId)!, txData.source,
                    txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "invalid paymentHash");


                await proveClaimPeriod(accounts[0], genesisLedger, claimPeriodIndex, claimPeriodLength, numConfirmations);
                txData = await getTransactionData(rippleApi, futureTxId);

                await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));

                // Assert
                const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                    txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                assert(paymentFinality[2], "Not proved TX: " + txData.txId);

                break;
            }
        });

        it("Should disprovePaymentFinality after disprovePaymentFinality even if wrong data were sent", async() => {
            // Assemble
            const start = genesisLedger + (claimPeriodIndex-1)*claimPeriodLength + 9*checkNumberOfLedgers;

            console.log("Ledger: " + start);
            const ledger = await rippleApi.getLedger( {ledgerVersion: start, includeTransactions: true} );

            const ledgerInFuture = await rippleApi.getLedger( {ledgerVersion: genesisLedger + claimPeriodIndex*claimPeriodLength, includeTransactions: true} );

            let futureTxId: string = "";
            for (let tx of ledgerInFuture.transactionHashes || []) {
                let txData: TransactionData = await getTransactionData(rippleApi, tx);
                if (txData.type != "payment" || txData.result != "tesSUCCESS" || txData.currency != "XRP") {
                    continue;
                }
                futureTxId = txData.txId;
                break;
            }

            for (let tx of ledger.transactionHashes || []) {
                let txData: TransactionData = await getTransactionData(rippleApi, tx);
                if (txData.type != "payment" || txData.result != "tesSUCCESS" || txData.currency != "XRP") {
                    continue;
                }

                // wrong txId
                await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger, futureTxId, {gas: 8000000}));
                await expectRevert(stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(futureTxId)!, txData.source,
                    txData.destination, txData.destinationTag, txData.amount, txData.currencyHash), "invalid paymentHash");


                await proveClaimPeriod(accounts[0], genesisLedger, claimPeriodIndex, claimPeriodLength, numConfirmations);
                txData = await getTransactionData(rippleApi, futureTxId);

                await waitFinalize3(accounts[0], () => stateConnector.disprovePaymentFinality(chainId, txData.paymentHash, txData.ledger - 1, txData.txId, {gas: 8000000}));

                // Assert
                const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                    txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
                assert(!paymentFinality[2], "Proved TX: " + txData.txId);

                break;
            }
        });

        it("Check special case - usd", async () => {
            let txData: TransactionData = await getTransactionData(rippleApi, "8B3FB7F0B5BDAB705FDB152EBA20BF47159898D76812DA80BD367D99206B5C59");
            // Act
            try {
                await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));
            } catch (e) {
                // Assume that this is being done in the past, so just skip.          
            }

            // Assert
            const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
            assert(paymentFinality[2], "Not proved TX: " + txData.txId);
        });

        it("Check special case - btc", async () => {
            let txData: TransactionData = await getTransactionData(rippleApi, "67B3F2CAF2905BC67FEB5417C1C3F9AA941DF8984F1F49EC48D4DCADFAC94418");
            // Act
            try {
                await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));
            } catch (e) {
                // Assume that this is being done in the past, so just skip.          
            }

            // Assert
            const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
            assert(paymentFinality[2], "Not proved TX: " + txData.txId);
        });

        it("Check special case - amount floating error", async () => {
            let txData: TransactionData = await getTransactionData(rippleApi, "7E3AB3834CFEC6F914BC017D8EEE24D04EBD3D23F3B20AC71D4D365E4C668AA1");

            // Act
            try {
                await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));
            } catch (e) {
                // Assume that this is being done in the past, so just skip.          
            }

            // Assert
            const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
            assert(paymentFinality[2], "Not proved TX: " + txData.txId);
        });

        it("Check special case 2 - amount floating error", async () => {
            let txData: TransactionData = await getTransactionData(rippleApi, "98B9850CDC04AA34F93D37170FD5759903C4D0BA3496B1E0D758F376ADD4709A");

            // Act
            try {
                await waitFinalize3(accounts[0], () => stateConnector.provePaymentFinality(chainId, txData.paymentHash, txData.ledger, txData.txId, {gas: 8000000}));
            } catch (e) {
                // Assume that this is being done in the past, so just skip.          
            }

            // Assert
            const paymentFinality = await stateConnector.getPaymentFinality(chainId, web3.utils.soliditySha3(txData.txId)!, txData.source,
                txData.destination, txData.destinationTag, txData.amount, txData.currencyHash);
            assert(paymentFinality[2], "Not proved TX: " + txData.txId);
        });

    });
});

export async function proveClaimPeriod(account: string, genesisLedger: number, claimPeriodIndex: number, claimPeriodLength: number, numConfirmations: number) {
    const currLedger = genesisLedger + (claimPeriodIndex+1)*claimPeriodLength;
    const ledger = await rippleApi.getLedger( {ledgerVersion: currLedger-1} );
    const ledgerTip = await rippleApi.getLedger( {ledgerVersion: currLedger-1 + claimPeriodLength * numConfirmations} );
    
    console.log("Current ledger: " + currLedger);
    console.log("Tip ledger: " + (currLedger-1 + claimPeriodLength * numConfirmations));

    const chainTipHash = web3.utils.sha3(ledgerTip.ledgerHash)!;

    // Act
    // commit
    while (true) {
        try {
            await waitFinalize3(account, () => stateConnector.proveClaimPeriodFinality(chainId, currLedger, 
                web3.utils.sha3(ledger.ledgerHash)!, 
                web3.utils.soliditySha3(account, chainTipHash)!, {gas: 8000000}));
            break;
        } catch(e) {
            await new Promise(resolve => {
                setTimeout(resolve, 5000);
            });
        }
    }
    // reveal
    while (true) {
        try {
            await waitFinalize3(account, () => stateConnector.proveClaimPeriodFinality(chainId, currLedger, 
                web3.utils.sha3(ledger.ledgerHash)!, 
                chainTipHash, {gas: 8000000}));
                break;
        } catch(e) {
            await new Promise(resolve => {
                setTimeout(resolve, 5000);
            });
        }
    }
}

export async function getTransactionData(rippleApi: RippleAPI, txId: string): Promise<TransactionData> {
    let tx: FormattedTransactionType = await rippleApi.getTransaction(txId);

    var sourceAddress = "";
    if ("source" in tx.specification && tx.specification.source.address) {
        sourceAddress = tx.specification.source.address;
    }
    var destinationAddress = "";
    if ("destination" in tx.specification && tx.specification.destination.address) {
        destinationAddress = tx.specification.destination.address;
    }

    var destinationTag = 0;
    if ("destination" in tx.specification && tx.specification.destination.tag) {
        destinationTag = tx.specification.destination.tag;
    }
    var amount = toBN(0);
    var currency = "";
    if ("deliveredAmount" in tx.outcome) {
        let mulPower;
        if (tx.outcome.deliveredAmount!.currency == 'XRP') {
            mulPower = 6;
            currency = 'XRP';
        } else {
            mulPower = 15;
            currency = tx.outcome.deliveredAmount!.currency + tx.outcome.deliveredAmount!.counterparty;
        }
        let amountString = tx.outcome.deliveredAmount!.value;
        let dotIndex = amountString.indexOf('.');
        if (dotIndex >= 0) {
            mulPower = mulPower - amountString.length + dotIndex + 1;
            amountString = amountString.replace('.', '');
        }
        amount = toBN(amountString).mul(toBN(10).pow(toBN(mulPower)));
    }

    const txIdHash = web3.utils.soliditySha3(tx.id);
    const sourceHash = web3.utils.soliditySha3(sourceAddress);
    const destinationHash = web3.utils.soliditySha3(destinationAddress);
    const destinationTagHash = web3.utils.soliditySha3(destinationTag);
    const amountHash = web3.utils.soliditySha3(amount);
    const currencyHash = web3.utils.soliditySha3(currency);
    const paymentHash = web3.utils.soliditySha3(txIdHash!, sourceHash!, destinationHash!, destinationTagHash!, amountHash!, currencyHash!);

    // console.log("HASHES")
    // console.log(txIdHash)
    // console.log(sourceHash)
    // console.log(destinationHash)
    // console.log(destinationTagHash)
    // console.log(amountHash)
    // console.log(currencyHash)
    // console.log(paymentHash)

    return  {
        txId: tx.id,
        txIdHash: txIdHash!,
        type: tx.type,
        result: tx.outcome.result,
        ledger: tx.outcome.ledgerVersion,
        source: sourceHash!,
        destination: destinationHash!,
        destinationTag: destinationTag,
        destinationTagHash: destinationTagHash!,
        amount: amount,
        amountHash: amountHash!,
        currency: currency,
        currencyHash: currencyHash!,
        paymentHash: paymentHash!
    }
}
