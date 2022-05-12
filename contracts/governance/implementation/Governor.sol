// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../interface/IIGovernor.sol";
import "./GovernorSettings.sol";
import "./GovernorProposals.sol";
import "./GovernorVotes.sol";
import "./GovernorVotePower.sol";
import "../../utils/implementation/Random.sol";
import "../../utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/drafts/EIP712.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "../../ftso/implementation/FtsoManager.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";

abstract contract Governor is
    IIGovernor, EIP712, Random, GovernorSettings, GovernorVotePower, GovernorProposals,
    GovernorVotes, AddressUpdatable {
    
    using SafePct for uint256;

    uint256 internal constant BIPS = 1e4;

    IIFtsoManager public ftsoManager;

    /// @notice The EIP-712 typehash for the ballot struct used by the contract
    bytes32 public constant BALLOT_TYPEHASH = keccak256("Ballot(uint256 proposalId,uint8 support)");

    /**
     * @notice Initializes the contract with default parameters
     * @param _addresses                    Array of contract addresses in the following order
     *          governance                  Address identifying the governance address
     *          ftsoRegistry                Address identifying the ftso registry contract
     *          votePowerContract           Address identifying the vote power contract
     *          addressUpdater              Address identifying the address updater contract
     * @param _proposalSettings             Array of proposal settings in the following order
     *          proposalThresholdBIPS       Percentage in BIPS of the total vote power required to submit a proposal
     *          votingDelaySeconds          Voting delay in seconds
     *          votingPeriodSeconds         Voting period in seconds
     *          executionDelaySeconds       Execution delay in seconds
     *          executionPeriodSeconds      Execution period in seconds
     *          quorumThresholdBIPS         Percentage in BIPS of the total vote power required for proposal quorum
     *          _votePowerLifeTimeDays      Number of days after which checkpoint can be deleted
     *          _vpBlockPeriodSeconds       Minimal length of the period (in seconds) from which the
     vote power block is randomly chosen
     */
    constructor(
        uint256[] memory _proposalSettings,
        address[] memory _addresses
        )
        EIP712(_name(), _version())
        Random(_addresses[1])
        GovernorSettings(
            _addresses[0], 
            _proposalSettings[0], 
            _proposalSettings[1],
            _proposalSettings[2],
            _proposalSettings[3],
            _proposalSettings[4],
            _proposalSettings[5],
            _proposalSettings[6],
            _proposalSettings[7]
        )
        GovernorVotePower(_addresses[2])
        GovernorProposals()
        GovernorVotes()
        AddressUpdatable(_addresses[3])
    {}

    /**
     * @notice Returns information of the specified proposal
     * @param _proposalId           Id of the proposal
     * @return _proposer            Address of the proposal submitter
     * @return _votePowerBlock      Block number used to determine the vote powers in voting process
     * @return _voteStartTime       Start time (in seconds from epoch) of the proposal voting
     * @return _voteEndTime         End time (in seconds from epoch) of the proposal voting
     * @return _execStartTime       Start time (in seconds from epoch) of the proposal execution window
     * @return _execEndTime         End time (in seconds from epoch) of the proposal exectuion window
     * @return _executed            Flag indicating if proposal has been executed
     */
    function getProposalInfo(
        uint256 _proposalId
    )
        external view 
        returns (
            address _proposer,
            uint256 _votePowerBlock,
            uint256 _voteStartTime,
            uint256 _voteEndTime,
            uint256 _execStartTime,
            uint256 _execEndTime,
            bool _executed
        ) 
    {
        Proposal storage proposal = proposals[_proposalId];
        _proposer = proposal.proposer;
        _votePowerBlock = proposal.votePowerBlock;
        _voteStartTime = proposal.voteStartTime;
        _voteEndTime = proposal.voteEndTime;
        _execStartTime = proposal.execStartTime;
        _execEndTime = proposal.execEndTime;
        _executed = proposal.executed;
    }

    /**
     * @notice Returns vote power (for, against, abstain) of the specified proposal 
                and total vote power at the vote power block
     * @param _proposalId       Id of the proposal
     * @return _totalVP         Total vote power at the vote power block
     * @return _for             Accumulated vote power for the proposal
     * @return _against         Accumulated vote power against the proposal
     * @return _abstain         Accumulated vote power abstained from voting
     */
    function getProposalVP(
        uint256 _proposalId
    )
        external view 
        returns (
            uint256 _totalVP,
            uint256 _for,
            uint256 _against,
            uint256 _abstain
        ) 
    {
        ProposalVoting storage voting = proposalVotings[_proposalId];
        Proposal storage proposal = proposals[_proposalId];
        _totalVP = totalVotePowerAt(proposal.votePowerBlock);
        _for = voting.forVotePower;
        _against = voting.againstVotePower;
        _abstain = voting.abstainVotePower;
    }

    /**
     * @notice Returns information if a voter has cast a vote on a specific proposal
     * @param _proposalId           Id of the proposal
     * @param _voter                Address of the voter
     * @return True if the voter has cast a vote on the proposal, and false otherwise
     */
    function hasVoted(uint256 _proposalId, address _voter) external view returns (bool) {
        return proposalVotings[_proposalId].hasVoted[_voter];
    }

    /**
     * @notice Creates a new proposal without execution parameters
     * @param _description          String description of the proposal
     * @return Proposal id (unique identifier obtained by hashing proposal data)
     * @notice Emits a ProposalCreated event
     */
    function propose(string memory _description) external override returns (uint256) {
        return _propose(new address[](0), new uint256[](0), new bytes[](0), _description);
    }    

    /**
     * @notice Creates a new proposal with execution parameters
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _description          String description of the proposal
     * @return Proposal id (unique identifier obtained by hashing proposal data)
     * @notice Emits a ProposalCreated event
     */
    function propose(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        string memory _description
    ) external override returns (uint256) {
        return _propose(_targets, _values, _calldatas, _description);
    }

    /**
     * @notice Casts a vote on a proposal
     * @param _proposalId           Id of the proposal
     * @param _support              A value indicating vote type (against, for, abstaint)
     * @return Vote power of the cast vote
     * @notice Emits a VoteCast event
     */
    function castVote(
        uint256 _proposalId,
        uint8 _support
    ) external override returns (uint256) {
        return _castVote(_proposalId, msg.sender, _support, "");
    }

    /**
     * @notice Casts a vote on a proposal with a reason
     * @param _proposalId           Id of the proposal
     * @param _support              A value indicating vote type (against, for, abstaint)
     * @param _reason               Vote reason
     * @return Vote power of the cast vote
     * @notice Emits a VoteCast event
     */
    function castVoteWithReason(
        uint256 _proposalId,
        uint8 _support,
        string calldata _reason
    ) external override returns (uint256) {
        return _castVote(_proposalId, msg.sender, _support, _reason);
    }

    /**
     * @notice Casts a vote on a proposal using the user cryptographic signature
     * @param _proposalId           Id of the proposal
     * @param _support              A value indicating vote type (against, for, abstaint)
     * @param _v                    v part of the signature
     * @param _r                    r part of the signature
     * @param _s                    s part of the signature
     * @notice Emits a VoteCast event
     */
    function castVoteBySig(
        uint256 _proposalId,
        uint8 _support,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external override returns (uint256) {
        bytes32 messageHash = ECDSA.toEthSignedMessageHash(
            _hashTypedDataV4(keccak256(abi.encode(BALLOT_TYPEHASH, _proposalId, _support)))
        );
        address voter = ECDSA.recover(
            messageHash,
            _v,
            _r,
            _s
        );
        require(voter != address(0), "invalid vote signature");

        return _castVote(_proposalId, voter, _support, "");
    }

    /**
     * @notice Executes a successful proposal without execution parameters
     * @param _description          String description of the proposal
     * @notice Emits a ProposalExecuted event
     */
    function execute(string memory _description) external override returns (uint256) {
        return _execute(new address[](0), new uint256[](0), new bytes[](0), _getDescriptionHash(_description));
    }

    /**
     * @notice Executes a successful proposal
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _descriptionHash      Hashed description of the proposal
     * @notice Emits a ProposalExecuted event
     */
    function execute(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) external payable override returns (uint256 proposalId) {
        return _execute(_targets, _values, _calldatas, _descriptionHash);
    }

    /**
     * @notice Returns the current state of a proposal
     * @param _proposalId           Id of the proposal
     * @return ProposalState enum
     */
    function state(uint256 _proposalId) public view override returns (ProposalState) {
        return _state(_proposalId, proposals[_proposalId]);
    }    

    /**
     * @notice Returns the vote power of a voter at a specific block number
     * @param _voter                Address of the voter
     * @param _blockNumber          The block number
     * @return Vote power of the voter at the block number
     */
    function getVotes(address _voter, uint256 _blockNumber) public view override returns (uint256) {
        return votePowerOfAt(_voter, _blockNumber);
    }

    /**
     * @notice Returns the minimal vote power required for a proposal to be successful
     * @param _blockNumber          Block number for quorum (quorum depends on wNat total supply)
     * @return Vote power representing the quorum at _blockNumber
     */
    function quorum(uint256 _blockNumber) public view override returns (uint256) {        
        return quorumThreshold().mulDiv(totalVotePowerAt(_blockNumber), BIPS);
    }

    /**
     * @notice Returns proposal id determined by hashing proposal data
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _descriptionHash      Hashed description of the proposal
     * @return Proposal id
     */
    function getProposalId(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) public pure returns (uint256) {
        return _getProposalId(_targets, _values, _calldatas, _descriptionHash);
    }

    /**
     * @notice Creates a new proposal
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _description          String description of the proposal
     * @return Proposal id (unique identifier obtained by hashing proposal data)
     * @notice Emits a ProposalCreated event
     */
    function _propose(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        string memory _description
    ) internal returns (uint256) {
        (uint256 votePowerBlock, uint256 rewardEpochTimestamp) = _calculateVotePowerBlock();

        require(_isValidProposer(msg.sender, votePowerBlock), "submitter is not eligible to submit a proposal");
        
        (uint256 proposalId, Proposal storage proposal) = _storeProposal(
            msg.sender,
            _targets,
            _values,
            _calldatas,
            _description,
            votePowerBlock,
            rewardEpochTimestamp,
            getVotePowerLifeTimeDays(),
            votingDelay(),
            votingPeriod(),
            executionDelay(),
            executionPeriod()
        );

        _storeProposalSettings(proposalId);

        emit ProposalCreated(
            proposalId,
            msg.sender,
            _targets,
            _values,
            new string[](_targets.length),
            _calldatas,
            proposal.voteStartTime,
            proposal.voteEndTime,
            _description
        );

        return proposalId;
    }
    
    /**
     * @notice Claculates a vote power block for proposal
     * @return Vote power block number
     */
    function _calculateVotePowerBlock() internal view returns (uint256, uint256) {
        uint256 rewardEpochId = ftsoManager.getCurrentRewardEpoch();

        IIFtsoManager.RewardEpochData memory rewardEpochData = 
            ftsoManager.getRewardEpochData(rewardEpochId);

        uint256 epochTimestamp = rewardEpochData.startTimestamp;
        uint256 nowTimestamp = block.timestamp;
        uint256 nowBlockNumber = block.number;
        uint256 diffSeconds = nowTimestamp - epochTimestamp;
        uint256 vpBlockPeriodSeconds = getVpBlockPeriodSeconds();
        uint256 cleanupBlock = votePower.getCleanupBlockNumber();
        
        while (diffSeconds < vpBlockPeriodSeconds) {
            if (rewardEpochId == 0 || rewardEpochData.startBlock - 1 < cleanupBlock) {
                break;
            }
            rewardEpochId -= 1;
            rewardEpochData = ftsoManager.getRewardEpochData(rewardEpochId);
            epochTimestamp = rewardEpochData.startTimestamp;
            diffSeconds = nowTimestamp - epochTimestamp;
        }

        uint256 epochBlockNumber = rewardEpochData.startBlock;
        
        //slither-disable-next-line weak-prng
        uint256 random = _getRandom() % (nowBlockNumber - epochBlockNumber);

        nowBlockNumber -= random;
        
        return (nowBlockNumber, epochTimestamp);
    }

    /**
     * @notice Casts a vote on a proposal
     * @param _proposalId           Id of the proposal
     * @param _voter                Address of the voter
     * @param _support              A value indicating vote type (against, for, abstaint)
     * @param _reason               Vote reason
     */
    function _castVote(
        uint256 _proposalId,
        address _voter,
        uint8 _support,
        string memory _reason
    ) internal returns (uint256) {
        Proposal storage proposal = proposals[_proposalId];
        require(state(_proposalId) == ProposalState.Active, "proposal not active");

        uint256 votePower = votePowerOfAt(_voter, proposal.votePowerBlock);
        _storeVote(_proposalId, _voter, _support, votePower);

        emit VoteCast(_voter, _proposalId, _support, votePower, _reason);

        return votePower;
    }

    /**
     * @notice Executes a successful proposal
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _descriptionHash      Hashed description of the proposal
     * @notice Emits a ProposalExecuted event
     */
    function _execute(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) internal returns (uint256 proposalId) {
        proposalId = getProposalId(_targets, _values, _calldatas, _descriptionHash);
        Proposal storage proposal = proposals[proposalId];

        require(!proposal.executed, "proposal already executed");
        require(proposal.proposer == msg.sender, "proposal can only be executed by its proposer");

        ProposalState proposalState = _state(proposalId, proposal);
        require(proposalState == ProposalState.Queued, "proposal not in execution state");
        
        proposal.executed = true;
        _executeProposal(_targets, _values, _calldatas);
        emit ProposalExecuted(proposalId);
        
        return proposalId;
    }

    /**
     * @notice Determines if the submitter of a proposal is a valid proposer
     * @param _proposer             Address of the submitter
     * @param _votePowerBlock       Number representing the vote power block for which the validity is checked
     * @return True if the submitter is valid, and false otherwise
     */
    function _isValidProposer(address _proposer, uint256 _votePowerBlock) internal virtual view returns (bool);

    /**
     * @notice Stores some of the proposal settings (quorum threshold, rejection/accept threshold)
     * @param _proposalId             Id of the proposal
     */
    function _storeProposalSettings(uint256 _proposalId) internal virtual;

    /**
     * @notice Determines if the submitter of a proposal has sufficient vote power to propose
     * @param _proposer             Address of the submitter
     * @param _votePowerBlock       Number representing the block at which the vote power is checked
     * @return True if the submitter has sufficient vote power, and false otherwise
     */
    function _hasVotePowerToPropose(address _proposer, uint256 _votePowerBlock) internal view returns (bool) {
        uint256 threshold = proposalThreshold();
        return threshold == 0 ||
            votePowerOfAt(_proposer, _votePowerBlock) >= threshold.mulDiv(totalVotePowerAt(_votePowerBlock), BIPS);
    }

    /**
     * @notice Returns the current state of a proposal
     * @param _proposalId           Id of the proposal
     * @param _proposal             Proposal object
     * @return ProposalState enum
     */
    function _state(uint256 _proposalId, Proposal storage _proposal) internal view returns (ProposalState) {
        if (_proposal.executed) {
            return ProposalState.Executed;
        }

        if (_proposal.voteStartTime == 0) {
            revert("unknown proposal id");
        }

        if (_proposal.voteStartTime > block.timestamp) {
            return ProposalState.Pending;
        }

        if (_proposal.voteEndTime > block.timestamp) {
            return ProposalState.Active;
        }

        if (_proposalSucceeded(_proposalId, _proposal.votePowerBlock)) {
            if (!_proposal.executableOnChain) {
                return ProposalState.Queued;
            }
            if (_proposal.execStartTime > block.timestamp) {
                return ProposalState.Succeeded;
            }
            if (_proposal.execEndTime > block.timestamp) {
                return ProposalState.Queued;
            }
            return ProposalState.Expired;
        }
        
        return ProposalState.Defeated;
    }

    /**
     * @notice Determines if a proposal has been successful
     * @param _proposalId           Id of the proposal
     * @param _votePowerBlock       Proposal vote power block
     * @return True if proposal succeeded and false otherwise
     */
    function _proposalSucceeded(uint256 _proposalId, uint256 _votePowerBlock) internal view virtual returns (bool);

    /**
     * @notice Returns the name of the governor contract
     * @return String representing the name
     */
    function _name() internal pure virtual returns (string memory);

    /**
     * @notice Returns the version of the governor contract
     * @return String representing the version
     */
    function _version() internal pure virtual returns (string memory);


    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        ftsoManager = IIFtsoManager(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoManager"));
    }

}