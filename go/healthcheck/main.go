package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"healthcheck/async"
	"os"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

func nowMs() int64 {
	return int64(time.Nanosecond) * time.Now().UnixNano() / int64(time.Millisecond)
}

func ConfirmedAsync(client *ethclient.Client, hash common.Hash, timeoutMs int64) error {
	startMs := nowMs()
	receipt, _ := client.TransactionReceipt(context.Background(), hash)
	for (receipt == nil || receipt.BlockNumber == nil) && nowMs() < startMs+timeoutMs {
		receipt, _ = client.TransactionReceipt(context.Background(), hash)
		time.Sleep(100 * time.Millisecond)
	}
	if receipt == nil || receipt.BlockNumber == nil || receipt.Status == 0 {
		return errors.New("Timeout expired")
	} else {
		time.Sleep(250 * time.Millisecond)
		return nil
	}
}

/**
This application optionally deploys the HealthCheck.sol smart contract, and then tests the blockchain
network roundtrip infrastructure by calling a method on that contract to change state on the network,
and provide a means to set timeouts, in order to declare bits of the infrastructure unhealthy,
or for simple notification purposes.

If you do not give a checker address, then the utility will auto-deploy a new HealthCheck contract. Any time a
new contract is deployed, the new address will be written to stdout. For more info about this utility, see
https://gitlab.com/flarenetwork/flare-smart-contracts/-/issues/202.

Command line parameters are as follows:
  -checker string
        Address of already deployed HealthCheck contract
  -pk string
        Private key of an address with some gas to call the HealthCheck methods
  -url string
        URL of API endpoint to test
  -waitms int
        Number of milliseconds to wait before declaring check not healthy (default 5000)
*/
func main() {
	// Get command line args
	urlPtr := flag.String("url", "", "URL of API endpoint to test")
	walletPK := flag.String("pk", "", "Private key of an address with some gas to call the HealthCheck methods")
	waitMs := flag.Int("waitms", 5000, "Number of milliseconds to wait before declaring check not healthy")
	checkerAddress := flag.String("checker", "", "Address of already deployed HealthCheck contract")
	flag.Parse()

	// Connect to an ava node
	blockchain, err := ethclient.Dial(*urlPtr)
	if err != nil {
		// TODO: This repetition sucks. DRY it up.
		fmt.Fprintf(os.Stderr, "Unable to connect to network %v: %v\n", *urlPtr, err)
		os.Exit(2)
	}

	// Wire up PK for calling contract
	checkerRunnerKey, err := crypto.HexToECDSA(*walletPK)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Unable to get public key from private key %v: %v\n", *walletPK, err)
		os.Exit(2)
	}
	auth := bind.NewKeyedTransactor(checkerRunnerKey)

	var healthCheck *HealthCheck
	var healthCheckAddress common.Address
	var tx *types.Transaction

	// Are we deploying a new checker, or using an old one?
	if *checkerAddress == "" {
		// Deploying new
		// Deploy the HealthCheck contract to the network
		healthCheckAddress, tx, healthCheck, err = DeployHealthCheck(auth, blockchain)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Unable to deploy HealthCheck contract: %v\n", err)
			os.Exit(2)
		}
		// Spit out the new address to stdout
		fmt.Println(healthCheckAddress)

		// Await the contract to deploy
		deployFuture := async.Exec(func() interface{} {
			return ConfirmedAsync(blockchain, tx.Hash(), int64(*waitMs))
		})
		if deployFuture.Await() != nil {
			fmt.Fprintf(os.Stderr, "Timeout waiting to deploy HealthCheck contract: %v\n", err)
			os.Exit(2)
		}
	} else {
		// Using old
		healthCheckAddress = common.HexToAddress(*checkerAddress)
		healthCheck, err = NewHealthCheck(healthCheckAddress, blockchain)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Unable to bind to HealthCheck contract at address %v: %v\n", *checkerAddress, err)
			os.Exit(2)
		}
		// Touch the contract to see if we got a good address
		_, err := healthCheck.Counter(nil)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error touching HealthCheck at address %v: %v\n", healthCheckAddress, err)
			os.Exit(2)
		}
	}

	// At this point, we assume there is a network, and we have a live contract to exercise...

	// Get the beginning tick value so we can prove we changed state
	tickCountBegin, err := healthCheck.Counter(nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting HealthCheck beginning tick counter for contract at address %v: %v\n", healthCheckAddress, err)
		os.Exit(1)
	}

	// Create the transaction to tick the HealthCheck contract, in order to change some state on the network
	tx, err = healthCheck.Tick(&bind.TransactOpts{
		From:   auth.From,
		Signer: auth.Signer,
		Value:  nil,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating HealthCheck tick transaction at contract address %v: %v\n", healthCheckAddress, err)
		os.Exit(1)
	}
	tickFuture := async.Exec(func() interface{} {
		return ConfirmedAsync(blockchain, tx.Hash(), int64(*waitMs))
	})
	if tickFuture.Await() != nil {
		fmt.Fprintf(os.Stderr, "Time expired awaiting HealthCheck tick at contract address: %v\n", healthCheckAddress)
		os.Exit(1)
	}

	// Get the ending tick value to see if it updated
	tickCountEnd, err := healthCheck.Counter(nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting HealthCheck ending tick counter for contract at address %v: %v\n", healthCheckAddress, err)
		os.Exit(1)
	}

	// Final act...did state update?
	if tickCountEnd.Cmp(tickCountBegin) > 0 {
		os.Exit(0)
	} else {
		fmt.Fprintf(os.Stderr, "HealthCheck tick counter did not advance for contract at address: %v\n", healthCheckAddress)
		os.Exit(1)
	}
}
