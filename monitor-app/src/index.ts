import { register } from 'prom-client';
import express from 'express';
import { ethers, Signer } from 'ethers';
import { addMetrics } from './helper';
import { getArgs } from './cl';
import { Contracts } from "../../deployment/scripts/Contracts";
import { createReadStream } from "fs";
import { Histogram } from "prom-client";

const METRICS_PATH = "/metrics";

// Load up .env environment variables if not in production
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Get and parse command line args
const args = getArgs("monitor");

// Get an ethers provider to the chain to monitor
// Command line contains the url of a web3 endpoint and the chain id
const provider = new ethers.providers.StaticJsonRpcProvider(
  args.e, 
  {name: "unknown", chainId: (args.i as number)
});

// Get a signer that will make smart contract calls
let signer: Signer;
if (process.env.MONITOR_PRIVATE_KEY !== undefined ) {
  signer = new ethers.Wallet(process.env.MONITOR_PRIVATE_KEY, provider);
} else {
  console.error(`Environment variable MONITOR_PRIVATE_KEY for signing monitoring transactions not defined.`);
  process.exit(1);
}

// Get the Ftso Monitor api url for external calls
let ftsoMonitorApiUrl: string;
if (process.env.FTSO_MONITOR_API_URL !== undefined ) {
  ftsoMonitorApiUrl = process.env.FTSO_MONITOR_API_URL;
} else {
  console.error(`Environment variable FTSO_MONITOR_API_URL not defined.`);
  process.exit(1);
}

// Make an express server reference
const server = express();

// Create a stream for the contracts definition file
const contractsStream = createReadStream(args.c);

// Load up contract addresses
const contracts = new Contracts();
contracts.deserialize(contractsStream).then(() => {
  // Add the metrics to collect
  addMetrics(provider, contracts, signer, ftsoMonitorApiUrl);

  // Add a top level metric to monitor node get requests
  const responseTimeHistogram = new Histogram({
    name: 'monitor_app_http_response_time_seconds',
    help: 'Histogram of request response time in seconds',
    labelNames: ['code', 'path']
  });

  // Setup server to service Prometheus scrapes
  server.get(METRICS_PATH, async (req, res) => {
    const stopTimer = responseTimeHistogram.startTimer();
    let code = "";
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics(), () => {
        stopTimer({ code: "200", path: METRICS_PATH });
      });
    } catch (ex) {
      res.status(500).end(ex, () => {
        stopTimer({ code: "500", path: METRICS_PATH });
      });
    }
  });

  console.log(
    `Server listening to ${args.p}, smart contract metrics exposed on ${METRICS_PATH} endpoint`,
  );

  // Start the server listenting...
  server.listen(args.p);
}).catch((e) => {
  console.error(`${e}`);
  process.exit(1);
});