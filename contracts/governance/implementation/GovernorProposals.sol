// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

abstract contract GovernorProposals {

    /**
     * @notice Struct holding the information about proposal properties
     */
    struct Proposal {
        address proposer;           // address of the proposer
        uint256 votePowerBlock;     // block number used for identifying vote power
        uint256 voteStartTime;      // start time of voting window (in seconds from epoch)
        uint256 voteEndTime;        // end time of voting window (in seconds from epoch)
        uint256 execStartTime;      // start time of execution window (in seconds from epoch)
        uint256 execEndTime;        // end time of execution window (in seconds from epoch)
        bool executableOnChain;     // flag indicating if proposal is executable on chain (via execution parameters)
        bool executed;              // flag indicating if proposal has been executed
    }

    struct ProposalParams {
        uint256 proposalId;
        uint256 diffSeconds;
    }

    uint256 internal nextExecutionStartTime;            // first available time for next proposal execution
    mapping(uint256 => Proposal) internal proposals;

    /**
     * @notice Stores a new proposal
     * @param _proposer             Address of the proposer
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _description          String description of the proposal
     * @param _votePowerBlock       Block number used for identifying vote power
     * @param _votingDelay          Duration from proposal submission to voting (in seconds)
     * @param _votingPeriod         Duration of voting (in seconds)
     * @param _executionDelay       Duration from end of voting to execution (in seconds)
     * @param _executionPeriod      Duration of of execution window (in seconds)
     * @return Proposal id and proposal object
     */
    function _storeProposal(
        address _proposer,
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        string memory _description,
        uint256 _votePowerBlock,
        uint256 _rewardEpochEndTime,
        uint256 _votePowerLifeTimeDays,
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _executionDelay,
        uint256 _executionPeriod
    ) internal returns (uint256, Proposal storage) {
        ProposalParams memory proposalParams;
        require(_targets.length == _values.length, "invalid proposal length");
        require(_targets.length == _calldatas.length, "invalid proposal length");
        proposalParams.proposalId = _getProposalId(_targets, _values, _calldatas, _getDescriptionHash(_description));
        
        Proposal storage proposal = proposals[proposalParams.proposalId];
        require(proposal.voteStartTime == 0, "proposal already exists");
        
        proposal.proposer = _proposer;
        proposal.votePowerBlock = _votePowerBlock;
        proposal.voteStartTime = block.timestamp + _votingDelay;
        proposal.voteEndTime = proposal.voteStartTime + _votingPeriod;
        proposalParams.diffSeconds = proposal.voteEndTime - _rewardEpochEndTime;
        require(proposalParams.diffSeconds < (_votePowerLifeTimeDays * 60 * 60 * 24),
            "vote power block is too far in the past");

        proposal.executableOnChain = _targets.length > 0;
        if (proposal.executableOnChain) {
            proposal.execStartTime = proposal.voteEndTime + _executionDelay;
            if (proposal.execStartTime < nextExecutionStartTime) {
                proposal.execStartTime = nextExecutionStartTime;
            }
            proposal.execEndTime = proposal.execStartTime + _executionPeriod;
            nextExecutionStartTime = proposal.execEndTime;
        }

        return (proposalParams.proposalId, proposal);
    }

    /**
     * @notice Executes proposal
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     */
    function _executeProposal(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas
    ) internal {
        uint256 sum = 0;
        for(uint256 i = 0; i < _values.length; i++) {
            sum = sum + _values[i];
        }
        require(msg.value == sum, "sum of _values does not equals msg.value");
        for (uint256 i = 0; i < _targets.length; ++i) {
            /* solhint-disable avoid-low-level-calls */
            (bool success, bytes memory returndata) = _targets[i].call{value: _values[i]}(_calldatas[i]);
            /* solhint-enable avoid-low-level-calls */
            if (!success) {
                if (returndata.length > 0) {
                    /* solhint-disable no-inline-assembly */
                    assembly {
                        let returndata_size := mload(returndata)
                        revert(add(32, returndata), returndata_size)
                    }
                    /* solhint-enable no-inline-assembly */
                } else {
                    revert("call reverted without message");
                }
            }
        }
    }

    /**
     * @notice Creates the hash of a proposal which is used as its id
     * @param _targets              Array of target addresses on which the calls are to be invoked
     * @param _values               Array of values with which the calls are to be invoked
     * @param _calldatas            Array of call data to be invoked
     * @param _descriptionHash      Hashed description of the proposal
     */
    function _getProposalId(
        address[] memory _targets,
        uint256[] memory _values,
        bytes[] memory _calldatas,
        bytes32 _descriptionHash
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(_targets, _values, _calldatas, _descriptionHash)));
    }

    /**
     * @notice Hashes the proposal description
     * @param _description          String representing the proposal description
     * @return Bytes array representing hashed proposal description
     */
    function _getDescriptionHash(string memory _description) internal pure returns (bytes32) {
        return keccak256(bytes(_description));
    }

}
