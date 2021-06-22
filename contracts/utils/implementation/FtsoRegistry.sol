// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "../../ftso/interface/IIFtso.sol";
import "../../genesis/interface/IFtsoRegistry.sol";
import "../../ftso/interface/IIFtsoManager.sol";
import "../../governance/implementation/Governed.sol";

/**
 * @title A contract for FTSO registry
 */
contract FtsoRegistry is Governed, IFtsoRegistry{

    // constants
    uint256 internal constant MAX_HISTORY_LENGTH = 5;

    // errors
    string internal constant ERR_SYMBOL_NOT_SUPPORTED = "FTSO symbol not supported";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSO manager only";

    // storage 
    string[] private supportedSymbols;
    mapping(bytes32 => IIFtso[MAX_HISTORY_LENGTH]) private ftsoHistory;

    // addresses
    // This address has to be set in deploy phase
    IIFtsoManager private ftsoManager;

    modifier onlyFtsoManager () {
        require (msg.sender == address(ftsoManager), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    constructor(address _governance) Governed(_governance) { }

    function setFtsoManagerAddress(IIFtsoManager _ftsoManager) external override onlyGovernance {
        ftsoManager = _ftsoManager;
    }

    /**
     * @notice Update current active FTSO contracts mapping
     * @param _ftsoContract new target FTSO contract
     */
    function addFtso(IIFtso _ftsoContract) external override onlyFtsoManager {
        uint256 len = supportedSymbols.length;
        string memory _symbol = _ftsoContract.symbol();
        bytes32 _encodedSymbol = keccak256(abi.encode(_symbol));
        uint256 i;
        // Iterate over supported symbol array
        for ( ; i < len; i++) {
            if (_encodedSymbol == keccak256(abi.encode(supportedSymbols[i]))) {
                // symbol is in supportedSymbol array
                break;
            }
        }
        // symbol is not yet in supportedSymbol array, add it to array
        if (i == len){
            supportedSymbols.push(_symbol);
        }
        // set new ftso as currently active ftso and shift history
        _shiftHistory(_encodedSymbol);
        ftsoHistory[_encodedSymbol][0] = _ftsoContract;
    }

    /**
     * @notice Fully removes symbol and associated history
     * @dev Reverts if the provided symbol is unsupported
     * @param _symbol abbreviated asset name string
     */
    function removeFtso(string memory _symbol) external override onlyFtsoManager {
        // If asset is a new asset (not yet )
        uint256 len = supportedSymbols.length;
        bytes32 _encodedSymbol = keccak256(abi.encode(_symbol));
        
        // Iterate over supported symbol array
        for (uint256 i = 0; i < len; i++) {
            if (_encodedSymbol == keccak256(abi.encode(supportedSymbols[i]))) {
                supportedSymbols[i] = supportedSymbols[len - 1];
                supportedSymbols.pop();
                delete ftsoHistory[_encodedSymbol];
                return;
            }
        }
        revert(ERR_SYMBOL_NOT_SUPPORTED);
    }

    /**
     * @notice Public view function to get the active FTSO for given symbol
     * Note: take a look at internal method at the bottom of this file for more info
     * @dev Reverts if unsupported symbol is passed
     * @param _symbol abbreviated asset name string 
     * @return _activeFtso FTSO contract for provided symbol
     */
    function getFtso(string memory _symbol) external view override 
        returns(IIFtso _activeFtso) 
    {
        return _getFtso(_symbol);
    }

    /**
     * @notice Public view function to get the price of active FTSO for given symbol
     * @dev Reverts if unsupported symbol is passed
     * @param _symbol abbreviated asset name string 
     * @return _price current price of asset in USD
     * @return _timestamp timestamp for when this price was updated
     */
    function getCurrentPrice(string memory _symbol) external view override 
        returns(uint256 _price, uint256 _timestamp) 
    {
        return _getFtso(_symbol).getCurrentPrice();
    }

    /**
     * @notice Get array of all supported symbols (abbreviated asset names)
     * @dev Order of symbols returned is NOT ordered in any way
     * @return _supportedSymbols the array of all supported symbols
     */
    function getSupportedSymbols() external view override 
        returns(string[] memory _supportedSymbols) 
    {
        _supportedSymbols = supportedSymbols;
    }

    /**
     * @notice Get array of all supported symbols (abbreviated asset names) and corresponding FTSOs
     * @return _supportedSymbols the array of all supported symbols
     */
    function getSupportedSymbolsAndFtsos() external view override
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos)
    {
        _supportedSymbols = supportedSymbols;
        _ftsos = new IIFtso[](supportedSymbols.length);
        uint256 len = supportedSymbols.length;
        for(uint256 i = 0; i < len; i++) {
            _ftsos[i] = _getFtso(_supportedSymbols[i]);
        }
    }

    /**
     * @notice Get array of all FTSO contract for supported symbols (abbreviated asset names)
     * @dev Order of FTSOs returned is NOT ordered in any way
     * @return _ftsos the array of all supported FTSOs
     */
    function getSupportedFtsos() external view override
        returns(IIFtso[] memory _ftsos) 
    {
        _ftsos = new IIFtso[](supportedSymbols.length);
        uint256 len = supportedSymbols.length;
        for(uint256 i = 0; i < len; i++) {
            _ftsos[i] = _getFtso(supportedSymbols[i]);
        }
    }

    /**
     * @notice Get the history of FTSOs for given symbol
     * @dev If there are less then MAX_HISTORY_LENGTH the remaining addresses will be 0 addresses
     * @param _symbol abbreviated asset name string 
     * @return _ftsoAddressHistory the history of FTSOs contract for provided symbol
     */
    function getFtsoHistory(string calldata _symbol) external view 
        returns(IIFtso[MAX_HISTORY_LENGTH] memory _ftsoAddressHistory) 
    {
        _ftsoAddressHistory = ftsoHistory[keccak256(abi.encode(_symbol))];
        if(address(_ftsoAddressHistory[0]) == address(0)){
            revert(ERR_SYMBOL_NOT_SUPPORTED);
        }
    }

    /**
     * @notice Shift the FTSOs history by one so the FTSO at index 0 can be overwritten
     * @dev Internal helper function
     */
    function _shiftHistory(bytes32 _encodedSymbol) internal {
        for (uint256 i = MAX_HISTORY_LENGTH-1; i > 0; i--) {
            ftsoHistory[_encodedSymbol][i] = ftsoHistory[_encodedSymbol][i-1];
        }
    }

    /**
     * @notice Get the active FTSO for given symbol
     * @dev Internal get ftso function so it can be used within other methods
     */
    function _getFtso(string memory _symbol) private view 
        returns(IIFtso _activeFtsoAddress) 
    {
        bytes32 _encodedSymbol = keccak256(abi.encode(_symbol));
        IIFtso ftsoAddress = ftsoHistory[_encodedSymbol][0];
        if (address(ftsoAddress) == address(0)){
            // Invalid symbol, revert if address is zero address
            revert(ERR_SYMBOL_NOT_SUPPORTED);
        }
        _activeFtsoAddress = ftsoAddress;
    }
}
