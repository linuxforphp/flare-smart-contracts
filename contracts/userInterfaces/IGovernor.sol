// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

interface IGovernor {

    /**
     * @notice Enum describing a proposal state
     */
    enum ProposalState {
        Pending,
        Active,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    /**
     * @notice Event emitted when a proposal is created
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     * @dev Violates compatibility with Tally (startTime and endTime instead of startBlock and endBlock)
     */
    event ProposalCreated(
        uint256 proposalId,
        address proposer,
        address[] targets,
        uint256[] values,
        string[] signatures,
        bytes[] calldatas,
        uint256 startTime,
        uint256 endTime,
        string description
    );

    /**
     * @notice Event emitted when a proposal is canceled
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    event ProposalCanceled(uint256 proposalId);

    /**
     * @notice Event emitted when a proposal is executed
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    event ProposalExecuted(uint256 proposalId);

    /**
     * @notice Event emitted when a vote is cast
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason);

    /**
     * @notice Creates a new proposal without execution parameters
     * @param _description          String description of the proposal
     * @return Proposal id (unique identifier obtained by hashing proposal data)
     * @notice Emits a ProposalCreated event
     */
    function propose(string memory _description) external returns (uint256);

    /**
     * @notice Creates a new proposal with execution parameters
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _description          String description of the proposal
     * @return Proposal id (unique identifier obtained by hashing proposal data)
     * @notice Emits a ProposalCreated event
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function propose(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        string memory _description
    ) external returns (uint256);

    /**
     * @notice Casts a vote on a proposal
     * @param _proposalId           Id of the proposal
     * @param _support              A value indicating vote type (against, for, abstaint)
     * @return Vote power of the cast vote
     * @notice Emits a VoteCast event
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function castVote(uint256 _proposalId, uint8 _support) external returns (uint256);

    /**
     * @notice Casts a vote on a proposal with a reason
     * @param _proposalId           Id of the proposal
     * @param _support              A value indicating vote type (against, for, abstaint)
     * @param _reason               Vote reason
     * @return Vote power of the cast vote
     * @notice Emits a VoteCast event
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function castVoteWithReason(
        uint256 _proposalId,
        uint8 _support,
        string calldata _reason
    ) external returns (uint256);

    /**
     * @notice Casts a vote on a proposal using the user cryptographic signature
     * @param _proposalId           Id of the proposal
     * @param _support              A value indicating vote type (against, for, abstaint)
     * @param _v                    v part of the signature
     * @param _r                    r part of the signature
     * @param _s                    s part of the signature
     * @notice Emits a VoteCast event
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function castVoteBySig(
        uint256 _proposalId,
        uint8 _support,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external returns (uint256);

    /**
     * @notice Executes a successful proposal without execution parameters
     * @param _description          String description of the proposal
     * @notice Emits a ProposalExecuted event
     */
    function execute(string memory _description) external returns (uint256);

    /**
     * @notice Executes a successful proposal with execution parameters
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _descriptionHash      Hashed description of the proposal
     * @notice Emits a ProposalExecuted event
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function execute(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) external payable returns (uint256);

    /**
     * @notice Returns the current state of a proposal
     * @param _proposalId           Id of the proposal
     * @return ProposalState enum
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function state(uint256 _proposalId) external view returns (ProposalState);

    /**
     * @notice Returns the vote power of a voter at a specific block number
     * @param _voter                Address of the voter
     * @param _blockNumber          The block number
     * @return Vote power of the voter at the block number
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function getVotes(address _voter, uint256 _blockNumber) external view returns (uint256);

    /**
     * @notice Returns the minimal vote power required for a proposal to be successful
     * @param _blockNumber          Block number for quorum (quorum depends on wNat total supply)
     * @return Vote power representing the quorum at _blockNumber
     * @dev Required for compatibility with Tally (OpenZeppelin style)
     */
    function quorum(uint256 _blockNumber) external view returns (uint256);

    /**
     * @notice Returns information if a voter has cast a vote on a specific proposal
     * @param _proposalId           Id of the proposal
     * @param _voter                Address of the voter
     * @return True if the voter has cast a vote on the proposal, and false otherwise
     */
    function hasVoted(uint256 _proposalId, address _voter) external view returns (bool);

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
        );


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
        );
}
