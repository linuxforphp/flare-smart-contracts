// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { WFLR } from "../../implementations/WFLR.sol";
import { Ftso } from "../../implementations/Ftso.sol";

interface IFlashLenderMock {
    function requestFlareLoan(uint256 value) external;
    function returnFlareLoan() external payable;
}

interface IFlashLoanMock {
    function receiveFlareLoan(IFlashLenderMock lender) external payable;
}

contract FlashLenderMock is IFlashLenderMock {
    mapping(address => uint256) private loans;
    
    receive() external payable {}
    
    function donateTo(address payable target, uint256 value) external {
        require(address(this).balance >= value, "Not enough funds for donation");
        target.transfer(value);
    }
    
    function requestFlareLoan(uint256 value) override external {
        require(address(this).balance >= value, "Not enough funds for loan");
        require(loans[msg.sender] == 0, "Can only loan once to a address");
        loans[msg.sender] = value;
        // call back and send money
        IFlashLoanMock(msg.sender).receiveFlareLoan{ value: value }(this);
        // loan should be returned
        require(loans[msg.sender] == 0, "Flash loan must be returned");
    }
    
    function returnFlareLoan() override external payable {
        require(msg.value > 0);
        require(msg.value == loans[msg.sender]);
        delete loans[msg.sender];
    }
}

contract FlashLoanMock is IFlashLoanMock {
    FlashLenderMock private flashLender;
    WFLR private wflr;
    Ftso private ftso;
    
    uint256 private requestedValue;
    
    constructor(
        FlashLenderMock _flashLender,
        WFLR _wflr,
        Ftso _ftso
    ) {
        flashLender = _flashLender;
        wflr = _wflr;
        ftso = _ftso;
    }
    
    receive() external payable {}
    
    function testRequestLoan(uint256 _value) external {
        requestedValue = _value;
        require(address(this).balance == 0, "Starting balance not zero");
        flashLender.requestFlareLoan(_value);
        require(address(this).balance == 0, "Ending balance not zero");
    }

    function receiveFlareLoan(IFlashLenderMock _lender) override external payable {
        require(msg.value == requestedValue, "Loan value does not match requested value");
        require(address(this).balance == msg.value, "Balance does not match loan value");
        doSomethingWithLoanedFlares(msg.value);
        _lender.returnFlareLoan{ value: msg.value }();
    }
    
    function mintWflr(uint256 _amount) public {
        require(address(this).balance >= _amount, "Not enought flares to mint wflr");
        wflr.deposit{ value: address(this).balance }();
    }

    function cashWflr(uint256 _amount) public {
        wflr.withdraw(_amount);
    }
    
    function submitPrice(uint256 _price, uint256 _random) public {
        bytes32 _hash = keccak256(abi.encodePacked(_price, _random));
        ftso.submitPrice(_hash);
    }

    function revealPrice(uint256 _epochId, uint256 _price, uint256 _random) public {
        ftso.revealPrice(_epochId, _price, _random);
    }

    function doSomethingWithLoanedFlares(uint256) internal virtual {
        // to be overriden
    }
}

contract VotingFlashLoanMock is FlashLoanMock {
    uint256 private epochId;
    uint256 private price;
    uint256 private random;
   
    constructor(
        FlashLenderMock _flashLender,
        WFLR _wflr,
        Ftso _ftso
    ) FlashLoanMock(_flashLender, _wflr, _ftso) {
    }
    
    function setVote(uint256 _epochId, uint256 _price, uint256 _random) public {
        epochId = _epochId;
        price = _price;
        random = _random;
    }

    function doSomethingWithLoanedFlares(uint256 _value) internal override {
        // to be overriden
        mintWflr(_value);
        revealPrice(epochId, price, random);
        cashWflr(_value);
    }
}