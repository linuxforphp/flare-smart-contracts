// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

contract StateConnector {

    enum ClaimPeriodFinalityType {
        PROPOSED,
        LOW_FINALISED_CLAIM_PERIOD_INDEX,
        REWARDED,
        BANNED
    }

//====================================================================
// Data Structures
//====================================================================

    struct Chain {
        bool        exists;
        uint64      genesisLedger;
        // Range of ledgers below finalisedLedgerIndex that can be searched when proving a payment
        uint64      ledgerHistorySize;
        // Number of ledgers in a claim period
        uint16      claimPeriodLength; 
        // Number of confirmations required to consider this claim period finalised
        uint16      numConfirmations; 
        uint64      finalisedClaimPeriodIndex;
        uint64      finalisedLedgerIndex;
        uint256     finalisedTimestamp;
        uint256     timeDiffExpected;
        uint256     timeDiffAvg;
    }

    struct HashExists {
        bool        exists;
        bytes32     claimPeriodHash;
        bytes32     commitHash;
        uint256     commitTime;
        uint256     permittedRevealTime;
        bytes32     revealHash;
        uint64      index;
        uint64      indexSearchRegion;
        bool        proven;
        address     provenBy;
    }

    address internal constant GENESIS_COINBASE = address(0x0100000000000000000000000000000000000000);
    address public governanceContract;
    bool public initialised;
    uint32 public numChains;
    uint256 public initialiseTime;
    uint64 public rewardPeriodTimespan;

    // Chain ID mapping to Chain struct
    mapping(uint32 => Chain) public chains;
    // msg.sender => Location hash => claim period
    mapping(address => mapping(bytes32 => HashExists)) public proposedClaimPeriods;
    // Location hash => claim period
    mapping(bytes32 => HashExists) public finalisedClaimPeriods;
    // Finalised payment hashes
    mapping(uint32 => mapping(bytes32 => HashExists)) public finalisedPayments;
    // Mapping of how many claim periods an address has successfully mined
    mapping(address => mapping(uint256 => uint64)) public claimPeriodsMined;
    // Mapping of how many claim periods were successfully mined
    mapping(uint256 => uint64) public totalClaimPeriodsMined;
    // Data availability provers are banned temporarily for submitting chainTipHash values that do not ultimately
    // become accepted, if their submitted chainTipHash value is accepted then they will earn a reward
    mapping(address => uint256) public senderBannedUntil;

//====================================================================
// Events
//====================================================================

    event ChainAdded(uint32 chainId, bool add);
    event ClaimPeriodFinalityProved(uint32 chainId, uint64 ledger, ClaimPeriodFinalityType finType, address sender);
    event PaymentFinalityProved(uint32 chainId, uint64 ledger, string txId, bytes32 paymentHash, address sender);
    event PaymentFinalityDisproved(uint32 chainId, uint64 ledger, string txId, bytes32 paymentHash, address sender);

//====================================================================
// Modifiers
//====================================================================

    modifier onlyGovernance() {
        require(msg.sender == governanceContract, "msg.sender != governanceContract");
        _;
    }

    modifier chainExists(uint32 chainId) {
        require(chains[chainId].exists, "chainId does not exist");
        _;
    }

    modifier senderNotBanned() {
        require(block.timestamp > senderBannedUntil[msg.sender], 
            "msg.sender is currently banned for sending an unaccepted chainTipHash");
        _;
    }

//====================================================================
// Constructor for pre-compiled code
//====================================================================

    constructor() {
    }

    function initialiseChains() external returns (bool success) {
        require(!initialised, "initialised != false");
        governanceContract = 0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7;
        chains[0] = Chain(true, 689300, 0, 1, 4, 0, 689300, block.timestamp, 900, 0); //BTC
        chains[1] = Chain(true, 2086110, 0, 1, 12, 0, 2086110, block.timestamp, 150, 0); //LTC
        chains[2] = Chain(true, 3768500, 0, 2, 40, 0, 3768500, block.timestamp, 120, 0); //DOGE
        chains[3] = Chain(true, 62880000, 0, 30, 1, 0, 62880000, block.timestamp, 120, 0); //XRP
        chains[4] = Chain(true, 35863000, 0, 20, 1, 0, 35863000, block.timestamp, 120, 0); //XLM 
        numChains = 5;
        rewardPeriodTimespan = 7 days; //604800
        initialiseTime = block.timestamp;
        initialised = true;
        return true;
    }

//====================================================================
// Functions
//====================================================================  

    function setGovernanceContract(address _governanceContract) external onlyGovernance {
        require(_governanceContract != address(0x0), "_governanceContract == 0x0");
        governanceContract = _governanceContract;
    }

    function addChain(
        uint64 genesisLedger,
        uint64 ledgerHistorySize,
        uint16 claimPeriodLength,
        uint16 numConfirmations,
        uint256 timeDiffExpected
    ) external onlyGovernance {
        require(!chains[numChains].exists, "chainId already exists"); // Can happen if numChains is overflowed
        require(claimPeriodLength > 0, "claimPeriodLength == 0");
        require(numConfirmations > 0, "numConfirmations == 0");
        require(genesisLedger > numConfirmations, "genesisLedger <= numConfirmations");

        chains[numChains] = Chain(true, genesisLedger, ledgerHistorySize, claimPeriodLength, numConfirmations, 
            0, genesisLedger, block.timestamp, timeDiffExpected, 0);
        
        emit ChainAdded(numChains, true);
        numChains += 1;
    }

    // Solution if an underlying chain loses liveness is to disable that chain temporarily
    function disableChain(uint32 chainId) external onlyGovernance chainExists(chainId) {
        chains[chainId].exists = false;
        emit ChainAdded(chainId, false);
    }

    function enableChain(uint32 chainId) external onlyGovernance {
        require(chainId < numChains, "chainId >= numChains");
        require(chains[chainId].exists == false, "chains[chainId].exists == true");
        chains[chainId].exists = true;
        emit ChainAdded(chainId, true);
    }

    function proveClaimPeriodFinality(
        uint32 chainId,
        uint64 ledger,
        bytes32 claimPeriodHash,
        bytes32 chainTipHash
    ) external chainExists(chainId) senderNotBanned returns (
        uint32 _chainId,
        uint64 _ledger,
        uint16 _numConfirmations,
        bytes32 _claimPeriodHash
    ) {
        require(claimPeriodHash > 0x0, "claimPeriodHash == 0x0");
        require(chainTipHash > 0x0, "chainTipHash == 0x0");
        require(block.coinbase == msg.sender || block.coinbase == GENESIS_COINBASE, "invalid block.coinbase value");
        require(ledger == chains[chainId].finalisedLedgerIndex + chains[chainId].claimPeriodLength, "invalid ledger");
        require(block.timestamp > chains[chainId].finalisedTimestamp, 
            "block.timestamp <= chains[chainId].finalisedTimestamp");
        if (2 * chains[chainId].timeDiffAvg < chains[chainId].timeDiffExpected) {
            require(3 * (block.timestamp - chains[chainId].finalisedTimestamp) >= 2 * chains[chainId].timeDiffAvg, 
                "not enough time elapsed since prior finality");
        } else {
            require(block.timestamp - chains[chainId].finalisedTimestamp + 15 >= chains[chainId].timeDiffAvg, 
                "not enough time elapsed since prior finality");
        }

        bytes32 locationHash = keccak256(abi.encodePacked(chainId, chains[chainId].finalisedClaimPeriodIndex));
        require(!finalisedClaimPeriods[locationHash].proven, "locationHash already finalised");

        if (chains[chainId].finalisedClaimPeriodIndex > 0) {
            bytes32 prevLocationHash = keccak256(abi.encodePacked(
                    chainId, chains[chainId].finalisedClaimPeriodIndex - 1));
            require(finalisedClaimPeriods[prevLocationHash].proven, "previous claim period not yet finalised");
        }

        if (proposedClaimPeriods[msg.sender][locationHash].exists) {
            require(block.timestamp >= proposedClaimPeriods[msg.sender][locationHash].permittedRevealTime, 
                "block.timestamp < proposedClaimPeriods[msg.sender][locationHash].permittedRevealTime");
            require(proposedClaimPeriods[msg.sender][locationHash].commitHash == 
                keccak256(abi.encodePacked(msg.sender, chainTipHash)), 
                "invalid chainTipHash");
        } else if (block.coinbase != msg.sender && block.coinbase == GENESIS_COINBASE) {
            claimPeriodHash = 0x0;
        }

        if (block.coinbase == msg.sender && block.coinbase != GENESIS_COINBASE) {
            if (!proposedClaimPeriods[msg.sender][locationHash].exists) {
                proposedClaimPeriods[msg.sender][locationHash] = HashExists(
                    true,
                    claimPeriodHash,
                    chainTipHash,
                    block.timestamp,
                    block.timestamp + chains[chainId].timeDiffAvg / 2,
                    0x0,
                    ledger,
                    0,
                    false,
                    address(0x0)
                );
                emit ClaimPeriodFinalityProved(chainId, ledger, ClaimPeriodFinalityType.PROPOSED, msg.sender);
            } else {
                // Node checked claimPeriodHash, and it was valid
                // Now determine whether to reward or ban the sender of the suggested chainTipHash
                // from 'numConfirmations' claimPeriodIndexes ago
                if (chains[chainId].finalisedClaimPeriodIndex > chains[chainId].numConfirmations) {
                    bytes32 prevLocationHash = keccak256(abi.encodePacked(
                        chainId, chains[chainId].finalisedClaimPeriodIndex - chains[chainId].numConfirmations));
                    if (finalisedClaimPeriods[prevLocationHash].revealHash == claimPeriodHash) {
                        // Reward
                        uint256 currentRewardPeriod = getRewardPeriod();
                        claimPeriodsMined[finalisedClaimPeriods[prevLocationHash].provenBy][currentRewardPeriod] += 1; 
                        totalClaimPeriodsMined[currentRewardPeriod] += 1;
                        emit ClaimPeriodFinalityProved(chainId, ledger, ClaimPeriodFinalityType.REWARDED, 
                            finalisedClaimPeriods[prevLocationHash].provenBy);
                    } else {
                        // Temporarily ban
                        senderBannedUntil[finalisedClaimPeriods[prevLocationHash].provenBy] = 
                            block.timestamp + chains[chainId].numConfirmations * chains[chainId].timeDiffExpected;
                        emit ClaimPeriodFinalityProved(chainId, ledger, ClaimPeriodFinalityType.BANNED, 
                            finalisedClaimPeriods[prevLocationHash].provenBy);
                    }
                } else {
                    // this is only true for the first few method calls 
                    emit ClaimPeriodFinalityProved(chainId, ledger, 
                        ClaimPeriodFinalityType.LOW_FINALISED_CLAIM_PERIOD_INDEX, msg.sender);
                }

                finalisedClaimPeriods[locationHash] = HashExists(
                    true,
                    claimPeriodHash,
                    0x0,
                    proposedClaimPeriods[msg.sender][locationHash].commitTime,
                    block.timestamp,
                    chainTipHash,
                    ledger,
                    0,
                    true,
                    msg.sender
                );

                chains[chainId].finalisedClaimPeriodIndex += 1;
                chains[chainId].finalisedLedgerIndex = ledger;

                uint256 timeDiffAvgUpdate = (proposedClaimPeriods[msg.sender][locationHash].commitTime -
                    chains[chainId].finalisedTimestamp + chains[chainId].timeDiffAvg) / 2;
                if (timeDiffAvgUpdate > 2 * chains[chainId].timeDiffExpected) {
                    chains[chainId].timeDiffAvg = 2 * chains[chainId].timeDiffExpected;
                } else {
                    chains[chainId].timeDiffAvg = timeDiffAvgUpdate;
                }

                chains[chainId].finalisedTimestamp = proposedClaimPeriods[msg.sender][locationHash].commitTime;
            }
        }
        return (chainId, ledger - 1, chains[chainId].numConfirmations, claimPeriodHash);
    }

    // If ledger == payment's ledger -> return true
    function provePaymentFinality(
        uint32 chainId,
        bytes32 paymentHash,
        uint64 ledger,
        string memory txId
    ) external chainExists(chainId) returns (
        uint32 _chainId,
        uint64 _ledger,
        uint64 _finalisedLedgerIndex,
        bytes32 _paymentHash,
        string memory _txId
    ) {
        bytes32 txIdHash = keccak256(abi.encodePacked(txId));
        require(!finalisedPayments[chainId][txIdHash].proven, "txId already proven");
        require(ledger < chains[chainId].finalisedLedgerIndex, "ledger >= chains[chainId].finalisedLedgerIndex");

        uint64 indexSearchRegion = chains[chainId].genesisLedger;
        if (chains[chainId].ledgerHistorySize > 0) {
            require(chains[chainId].finalisedLedgerIndex - chains[chainId].genesisLedger > 
                chains[chainId].ledgerHistorySize, 
                "finalisedLedgerIndex - genesisLedger <= ledgerHistorySize");
            indexSearchRegion = chains[chainId].finalisedLedgerIndex - chains[chainId].ledgerHistorySize;
        }
        require(ledger >= indexSearchRegion, "ledger < indexSearchRegion");
        require(block.coinbase == msg.sender || block.coinbase == GENESIS_COINBASE, "invalid block.coinbase value");

        if (block.coinbase == msg.sender && block.coinbase != GENESIS_COINBASE) {
            finalisedPayments[chainId][txIdHash] = HashExists(
                true, 
                0x0, 
                0x0,
                0, 
                block.timestamp, 
                paymentHash, 
                ledger, 
                indexSearchRegion, 
                true,
                msg.sender
            );
            emit PaymentFinalityProved(chainId, ledger, txId, paymentHash, msg.sender);
        }
        return (chainId, ledger, chains[chainId].finalisedLedgerIndex, paymentHash, txId);
    }

    // If ledger < payment's ledger or payment does not exist within data-available region -> return true
    function disprovePaymentFinality(
        uint32 chainId,
        bytes32 paymentHash,
        uint64 ledger,
        string memory txId
    ) external chainExists(chainId) returns (
        uint32 _chainId,
        uint64 _ledger,
        uint64 _finalisedLedgerIndex,
        bytes32 _paymentHash,
        string memory _txId
    ) {
        bytes32 txIdHash = keccak256(abi.encodePacked(txId));
        require(!finalisedPayments[chainId][txIdHash].proven, "txId already proven");
        require(finalisedPayments[chainId][txIdHash].index < ledger,
            "finalisedPayments[chainId][txIdHash].index >= ledger");
        require(ledger < chains[chainId].finalisedLedgerIndex, "ledger >= chains[chainId].finalisedLedgerIndex");

        uint64 indexSearchRegion = chains[chainId].genesisLedger;
        if (chains[chainId].ledgerHistorySize > 0) {
            require(chains[chainId].finalisedLedgerIndex - chains[chainId].genesisLedger > 
                chains[chainId].ledgerHistorySize,
                "finalisedLedgerIndex - genesisLedger <= ledgerHistorySize");
            indexSearchRegion = chains[chainId].finalisedLedgerIndex - chains[chainId].ledgerHistorySize;
        }
        require(ledger >= indexSearchRegion, "ledger < indexSearchRegion");
        require(block.coinbase == msg.sender || block.coinbase == GENESIS_COINBASE, "invalid block.coinbase value");

        if (block.coinbase == msg.sender && block.coinbase != GENESIS_COINBASE) {
            finalisedPayments[chainId][txIdHash] = HashExists(
                true, 
                0x0, 
                0x0,
                0, 
                block.timestamp, 
                paymentHash, 
                ledger, 
                indexSearchRegion, 
                false,
                msg.sender
            );
            emit PaymentFinalityDisproved(chainId, ledger, txId, paymentHash, msg.sender);
        }

        return (chainId, ledger, chains[chainId].finalisedLedgerIndex, paymentHash, txId);
    }
    
    function getGovernanceContract() external view returns (address _governanceContract) {
        return governanceContract;
    }

    function getClaimPeriodsMined(address miner, uint256 rewardSchedule) external view returns (uint64 numMined) {
        return claimPeriodsMined[miner][rewardSchedule];
    }

    function getTotalClaimPeriodsMined(uint256 rewardSchedule) external view returns (uint64 numMined) {
        return totalClaimPeriodsMined[rewardSchedule];
    }

    function getLatestIndex(uint32 chainId) external view chainExists(chainId) returns (
        uint64 genesisLedger,
        uint64 finalisedClaimPeriodIndex,
        uint16 claimPeriodLength,
        uint64 finalisedLedgerIndex,
        uint256 finalisedTimestamp,
        uint256 timeDiffAvg
    ) {
        finalisedTimestamp = chains[chainId].finalisedTimestamp;
        timeDiffAvg = chains[chainId].timeDiffAvg;

        bytes32 locationHash = keccak256(abi.encodePacked(chainId, chains[chainId].finalisedClaimPeriodIndex));
        if (proposedClaimPeriods[msg.sender][locationHash].exists) {
            finalisedTimestamp = 0;
            timeDiffAvg = proposedClaimPeriods[msg.sender][locationHash].permittedRevealTime;
        }

        return (
            chains[chainId].genesisLedger,
            chains[chainId].finalisedClaimPeriodIndex,
            chains[chainId].claimPeriodLength,
            chains[chainId].finalisedLedgerIndex,
            finalisedTimestamp,
            timeDiffAvg
        );
    }

    function getClaimPeriodIndexFinality(
        uint32 chainId,
        uint64 claimPeriodIndex
    ) external view chainExists(chainId) returns (bool finality) {
        bytes32 locationHash = keccak256(abi.encodePacked(chainId, claimPeriodIndex));
        return (finalisedClaimPeriods[locationHash].exists);
    }

    function getPaymentFinality(
        uint32 chainId,
        bytes32 txId,
        bytes32 sourceHash,
        bytes32 destinationHash,
        uint64 destinationTag,
        uint64 amount,
        bytes32 currencyHash
    ) external view chainExists(chainId) returns (
        uint64 ledger,
        uint64 indexSearchRegion,
        bool finality
    ) {
        require(finalisedPayments[chainId][txId].exists, "txId does not exist");
        bytes32 paymentHash = keccak256(abi.encodePacked(
            txId,
            sourceHash,
            destinationHash,
            keccak256(abi.encode(destinationTag)),
            keccak256(abi.encode(amount)),
            currencyHash));
        require(finalisedPayments[chainId][txId].revealHash == paymentHash, "invalid paymentHash");

        return (
            finalisedPayments[chainId][txId].index,
            finalisedPayments[chainId][txId].indexSearchRegion,
            finalisedPayments[chainId][txId].proven
        );
    }

    function getRewardPeriod() public view returns (uint256 rewardSchedule) {
        require(block.timestamp > initialiseTime, "block.timestamp <= initialiseTime");
        return (block.timestamp - initialiseTime) / rewardPeriodTimespan;
    }
    
}
