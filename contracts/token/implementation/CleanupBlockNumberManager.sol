// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {Governed} from "../../governance/implementation/Governed.sol";
import "../../token/interface/IICleanable.sol";


/**
 * @title Token history cleanup manager
 * @notice Maintains the list of cleanable tokens for which history cleanup can be collectively cleaned u 
 */
contract CleanupBlockNumberManager is Governed {
    
    string internal constant ERR_CONTRACT_NOT_FOUND = "contract not found";
    string internal constant ERR_TRIGGER_CONTRACT_OR_GOVERNANCE_ONLY = "trigger or governance only";

    IICleanable[] public registeredTokens;
    address public triggerContract;

    event RegistrationUpdated (IICleanable theContract, bool add);
    event CleanupBlockNumberSet (IICleanable theContract, uint256 blockNumber, bool success);
        
    modifier onlyTriggerOrGovernance {
        require(
            msg.sender == address(triggerContract) || 
            msg.sender == governance, ERR_TRIGGER_CONTRACT_OR_GOVERNANCE_ONLY
        );
        _;
    }

    constructor(
        address _governance        
    ) Governed(_governance) {        
    }

    /**
     * @notice Sets trigger contract address. 
     * @dev Usually this is FTSO Manager contract address.
     */
    function setTriggerContractAddress(address _triggerContract) external onlyGovernance {
        triggerContract = _triggerContract;
    }
    /**
     * @notice Register a contract of which history cleanup index is to be managed
     * @param _cleanableToken     The address of the contract to be managed.
     * @dev when using this function take care that call of setCleanupBlockNumber
     * is permitted by this object
     */
    function registerToken(IICleanable _cleanableToken) external onlyGovernance {
        uint256 len = registeredTokens.length;

        for (uint256 i = 0; i < len; i++) {
            if (_cleanableToken == registeredTokens[i]) {
                return; // already registered
            }
        }

        registeredTokens.push(_cleanableToken);
        emit RegistrationUpdated (_cleanableToken, true);
    }

    /**
     * @notice Unregiseter a contract from history cleanup index management
     * @param _cleanableToken     The address of the contract to unregister.
     */
    function unregisterToken(IICleanable _cleanableToken) external onlyGovernance {        
        uint256 len = registeredTokens.length;

        for (uint256 i = 0; i < len; i++) {
            if (_cleanableToken == registeredTokens[i]) {
                registeredTokens[i] = registeredTokens[len -1];
                registeredTokens.pop();
                emit RegistrationUpdated (_cleanableToken, false);
                return;
            }
        }

        revert(ERR_CONTRACT_NOT_FOUND);
    }

    /**
     * @notice Sets clean up block number on managed cleanable tokens
     * @param _blockNumber cleanup block number
     */
    function setCleanUpBlockNumber(uint256 _blockNumber) external onlyTriggerOrGovernance {
        uint256 len = registeredTokens.length;
        for (uint256 i = 0; i < len; i++) {
            try registeredTokens[i].setCleanupBlockNumber(_blockNumber) {
                emit CleanupBlockNumberSet(registeredTokens[i], _blockNumber, true);
            } catch {
                emit CleanupBlockNumberSet(registeredTokens[i], _blockNumber, false);
            }
        }
    }


}