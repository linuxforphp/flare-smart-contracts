const BobAddress;
const providerAddress; // price provider address
 
// below values should be obtained from deployment json file
const wFlr;
const xrpFtso;
const priceEpochDurationSec;
// FTSO address list should be loaded from a json that will be published
const FTSOAddressList {XRP_FTSO_Address, LTC_FTSO_Address, DOGE_FTSO_Address};
 
// preliminary steps of wrapping flare and delegating vote power.
// these steps will usually be done in a different scope
/////////////////////////////////////////////////////////////////
 
// Bob wrapps 100 FLR
wFlr.deposit(){from: BobAddress, amount: 100};
 
// Bob delegates 100% of his vote power to a price provider
wFlr.delegate(providerAddress, percentToBips(100)){from: BobAddress};
 
// price provider steps
///////////////////////
main() {
    while (true) {

        let providerVotePower;
        let validFtsoAddressList[];
        let ftsoPriceHashes[];
        let ftsoPrices[];
        let ftsoRandoms[];

        for (uint i = 0; i < FTSOAddressList.length; i++) {

            address ftso = FTSOAddressList[i];

            {
                epochId;
                epochSubmitEndTime;
                epochRevealEndTime;
                votePowerBlock;
                lowFlrVotePowerThreshold;
                isFallBackMode;
            } = ftso.getPriceEpochData();

            // note price epochs have fixed time frames
            // note vote power block for each price epoch is shared between all FTSOs
            if(providerVotePower == 0) providerVotePower = wFlr.votePowerOfAt(providerAddress, votePowerBlock))

            if (isFallBackMode || providerVotePower < lowFlrVotePowerThreshold) {
                // shouldn't post to this FTSO. go to next
                continue;
            }

            validFtsoAddressList.push(FTSOAddressList[i]);

            // create a new random
            ftsoRandoms.push(rand());

            // read token symbol
            let symbol = symbolftso.symbol();

            // read price from any chosen price source one wishes to use
            ftsoPrices.push(priceSource.getPrice(symbol));

            uint currentFtso = ftsoPrices.length - 1;
            // create hash of above values and submit
            ftsoPriceHashes[currentFtso] = solidityKeccak256(
                ["uint256", "uint256"], 
                [ftsoPrices[currentFtso], ftsoRandoms[currentFtso]]
            );
        }

        // submit hashes in batch

        if (validFtsoAddressList > 0) {
            priceSubmitter.submitPriceHashes(validFtsoAddressList, ftsoRandoms);
        }

        // wait for this commit period to end
        wait(epochSubmitEndTime);

        // send reveal batch
       if (validFtsoAddressList > 0) {
            priceSubmitter.revealPrices(
                validFtsoAddressList,
                ftsoPrices,
                ftsoRandoms
            );
        }
    }

    function percentToBips(percent) {
        return percent * 100;
    }
 
    function wait(waitUntil) {
       while(now() < waitUntil) {
           // sleep 1 second
            sleep(1);
        }
    }
