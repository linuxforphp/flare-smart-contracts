// Code generated - DO NOT EDIT.
// This file is a generated binding and any manual changes will be lost.

package main

import (
	"math/big"
	"strings"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/event"
)

// Reference imports to suppress errors if they are not otherwise used.
var (
	_ = big.NewInt
	_ = strings.NewReader
	_ = ethereum.NotFound
	_ = bind.Bind
	_ = common.Big1
	_ = types.BloomLookup
	_ = event.NewSubscription
)

// HealthCheckABI is the input ABI used to generate the binding from.
const HealthCheckABI = "[{\"inputs\":[],\"name\":\"counter\",\"outputs\":[{\"internalType\":\"uint256\",\"name\":\"\",\"type\":\"uint256\"}],\"stateMutability\":\"view\",\"type\":\"function\"},{\"inputs\":[],\"name\":\"tick\",\"outputs\":[],\"stateMutability\":\"nonpayable\",\"type\":\"function\"}]"

// HealthCheckFuncSigs maps the 4-byte function signature to its string representation.
var HealthCheckFuncSigs = map[string]string{
	"61bc221a": "counter()",
	"3eaf5d9f": "tick()",
}

// HealthCheckBin is the compiled bytecode used for deploying new contracts.
var HealthCheckBin = "0x608060405234801561001057600080fd5b5060d88061001f6000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c80633eaf5d9f14603757806361bc221a14603f575b600080fd5b603d6059565b005b60456070565b604051605091906076565b60405180910390f35b600160008082825460699190607f565b9091555050565b60005481565b90815260200190565b60008219821115609d57634e487b7160e01b81526011600452602481fd5b50019056fea2646970667358221220f2ed07d7279679de063673be01cd2caf33a4ba87c8578fbf07de8d21f85c89b964736f6c63430008010033"

// DeployHealthCheck deploys a new Ethereum contract, binding an instance of HealthCheck to it.
func DeployHealthCheck(auth *bind.TransactOpts, backend bind.ContractBackend) (common.Address, *types.Transaction, *HealthCheck, error) {
	parsed, err := abi.JSON(strings.NewReader(HealthCheckABI))
	if err != nil {
		return common.Address{}, nil, nil, err
	}

	address, tx, contract, err := bind.DeployContract(auth, parsed, common.FromHex(HealthCheckBin), backend)
	if err != nil {
		return common.Address{}, nil, nil, err
	}
	return address, tx, &HealthCheck{HealthCheckCaller: HealthCheckCaller{contract: contract}, HealthCheckTransactor: HealthCheckTransactor{contract: contract}, HealthCheckFilterer: HealthCheckFilterer{contract: contract}}, nil
}

// HealthCheck is an auto generated Go binding around an Ethereum contract.
type HealthCheck struct {
	HealthCheckCaller     // Read-only binding to the contract
	HealthCheckTransactor // Write-only binding to the contract
	HealthCheckFilterer   // Log filterer for contract events
}

// HealthCheckCaller is an auto generated read-only Go binding around an Ethereum contract.
type HealthCheckCaller struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// HealthCheckTransactor is an auto generated write-only Go binding around an Ethereum contract.
type HealthCheckTransactor struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// HealthCheckFilterer is an auto generated log filtering Go binding around an Ethereum contract events.
type HealthCheckFilterer struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// HealthCheckSession is an auto generated Go binding around an Ethereum contract,
// with pre-set call and transact options.
type HealthCheckSession struct {
	Contract     *HealthCheck      // Generic contract binding to set the session for
	CallOpts     bind.CallOpts     // Call options to use throughout this session
	TransactOpts bind.TransactOpts // Transaction auth options to use throughout this session
}

// HealthCheckCallerSession is an auto generated read-only Go binding around an Ethereum contract,
// with pre-set call options.
type HealthCheckCallerSession struct {
	Contract *HealthCheckCaller // Generic contract caller binding to set the session for
	CallOpts bind.CallOpts      // Call options to use throughout this session
}

// HealthCheckTransactorSession is an auto generated write-only Go binding around an Ethereum contract,
// with pre-set transact options.
type HealthCheckTransactorSession struct {
	Contract     *HealthCheckTransactor // Generic contract transactor binding to set the session for
	TransactOpts bind.TransactOpts      // Transaction auth options to use throughout this session
}

// HealthCheckRaw is an auto generated low-level Go binding around an Ethereum contract.
type HealthCheckRaw struct {
	Contract *HealthCheck // Generic contract binding to access the raw methods on
}

// HealthCheckCallerRaw is an auto generated low-level read-only Go binding around an Ethereum contract.
type HealthCheckCallerRaw struct {
	Contract *HealthCheckCaller // Generic read-only contract binding to access the raw methods on
}

// HealthCheckTransactorRaw is an auto generated low-level write-only Go binding around an Ethereum contract.
type HealthCheckTransactorRaw struct {
	Contract *HealthCheckTransactor // Generic write-only contract binding to access the raw methods on
}

// NewHealthCheck creates a new instance of HealthCheck, bound to a specific deployed contract.
func NewHealthCheck(address common.Address, backend bind.ContractBackend) (*HealthCheck, error) {
	contract, err := bindHealthCheck(address, backend, backend, backend)
	if err != nil {
		return nil, err
	}
	return &HealthCheck{HealthCheckCaller: HealthCheckCaller{contract: contract}, HealthCheckTransactor: HealthCheckTransactor{contract: contract}, HealthCheckFilterer: HealthCheckFilterer{contract: contract}}, nil
}

// NewHealthCheckCaller creates a new read-only instance of HealthCheck, bound to a specific deployed contract.
func NewHealthCheckCaller(address common.Address, caller bind.ContractCaller) (*HealthCheckCaller, error) {
	contract, err := bindHealthCheck(address, caller, nil, nil)
	if err != nil {
		return nil, err
	}
	return &HealthCheckCaller{contract: contract}, nil
}

// NewHealthCheckTransactor creates a new write-only instance of HealthCheck, bound to a specific deployed contract.
func NewHealthCheckTransactor(address common.Address, transactor bind.ContractTransactor) (*HealthCheckTransactor, error) {
	contract, err := bindHealthCheck(address, nil, transactor, nil)
	if err != nil {
		return nil, err
	}
	return &HealthCheckTransactor{contract: contract}, nil
}

// NewHealthCheckFilterer creates a new log filterer instance of HealthCheck, bound to a specific deployed contract.
func NewHealthCheckFilterer(address common.Address, filterer bind.ContractFilterer) (*HealthCheckFilterer, error) {
	contract, err := bindHealthCheck(address, nil, nil, filterer)
	if err != nil {
		return nil, err
	}
	return &HealthCheckFilterer{contract: contract}, nil
}

// bindHealthCheck binds a generic wrapper to an already deployed contract.
func bindHealthCheck(address common.Address, caller bind.ContractCaller, transactor bind.ContractTransactor, filterer bind.ContractFilterer) (*bind.BoundContract, error) {
	parsed, err := abi.JSON(strings.NewReader(HealthCheckABI))
	if err != nil {
		return nil, err
	}
	return bind.NewBoundContract(address, parsed, caller, transactor, filterer), nil
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_HealthCheck *HealthCheckRaw) Call(opts *bind.CallOpts, result *[]interface{}, method string, params ...interface{}) error {
	return _HealthCheck.Contract.HealthCheckCaller.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_HealthCheck *HealthCheckRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _HealthCheck.Contract.HealthCheckTransactor.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_HealthCheck *HealthCheckRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _HealthCheck.Contract.HealthCheckTransactor.contract.Transact(opts, method, params...)
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_HealthCheck *HealthCheckCallerRaw) Call(opts *bind.CallOpts, result *[]interface{}, method string, params ...interface{}) error {
	return _HealthCheck.Contract.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_HealthCheck *HealthCheckTransactorRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _HealthCheck.Contract.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_HealthCheck *HealthCheckTransactorRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _HealthCheck.Contract.contract.Transact(opts, method, params...)
}

// Counter is a free data retrieval call binding the contract method 0x61bc221a.
//
// Solidity: function counter() view returns(uint256)
func (_HealthCheck *HealthCheckCaller) Counter(opts *bind.CallOpts) (*big.Int, error) {
	var out []interface{}
	err := _HealthCheck.contract.Call(opts, &out, "counter")

	if err != nil {
		return *new(*big.Int), err
	}

	out0 := *abi.ConvertType(out[0], new(*big.Int)).(**big.Int)

	return out0, err

}

// Counter is a free data retrieval call binding the contract method 0x61bc221a.
//
// Solidity: function counter() view returns(uint256)
func (_HealthCheck *HealthCheckSession) Counter() (*big.Int, error) {
	return _HealthCheck.Contract.Counter(&_HealthCheck.CallOpts)
}

// Counter is a free data retrieval call binding the contract method 0x61bc221a.
//
// Solidity: function counter() view returns(uint256)
func (_HealthCheck *HealthCheckCallerSession) Counter() (*big.Int, error) {
	return _HealthCheck.Contract.Counter(&_HealthCheck.CallOpts)
}

// Tick is a paid mutator transaction binding the contract method 0x3eaf5d9f.
//
// Solidity: function tick() returns()
func (_HealthCheck *HealthCheckTransactor) Tick(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _HealthCheck.contract.Transact(opts, "tick")
}

// Tick is a paid mutator transaction binding the contract method 0x3eaf5d9f.
//
// Solidity: function tick() returns()
func (_HealthCheck *HealthCheckSession) Tick() (*types.Transaction, error) {
	return _HealthCheck.Contract.Tick(&_HealthCheck.TransactOpts)
}

// Tick is a paid mutator transaction binding the contract method 0x3eaf5d9f.
//
// Solidity: function tick() returns()
func (_HealthCheck *HealthCheckTransactorSession) Tick() (*types.Transaction, error) {
	return _HealthCheck.Contract.Tick(&_HealthCheck.TransactOpts)
}
