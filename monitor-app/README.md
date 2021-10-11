# Smart Contract Monitoring Proof of Concept

## Prometheus Metrics From Smart Contracts

This project surfaces up metrics from the smart contract project and presents them in a prometheus formatted web page, that can then be pointed to by prometheus and then called periodically to record interesting metrics.

First, run the smart contract app.

Then, run here:
`yarn start`

This should start a web server that will respond to `http:localhost:4000`. You should see prometheus formatted metrics.