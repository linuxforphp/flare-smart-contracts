# Note that the build context of this file should be one directory up!
# So from that directory, to build the monitor-app image, do this...
# docker build -t <docker username>/monitor-app -f monitor-app/Dockerfile .

# To access hardhat node running locally, use ENDPOINT="http://host.docker.internal:8545"
# If accessing hardhat node locally on Linux, you additionally need to add: --add-host=host.docker.internal:host-gateway
# To run: docker run -e ENDPOINT=<chain endpoint url> -e CHAINID=<chain id> -v <flare contracts file directory>:/usr/src/flare-smart-contracts/deploys  -e CONTRACTS=<flare contracts file>.json -p 4000:4000 -d <docker username>/monitor-app
FROM node:16

WORKDIR /opt/flare-smart-contracts/monitor-app

# Install app dependencies
COPY ./monitor-app/package*.json ./
RUN yarn install

WORKDIR /opt/flare-smart-contracts
COPY . .

WORKDIR /opt/flare-smart-contracts/monitor-app

RUN yarn build:hardhat
RUN yarn build:node

EXPOSE 4000

CMD ["sh", "-c", "cd /opt/flare-smart-contracts/monitor-app && yarn start -e ${ENDPOINT} -c ${CONTRACTS} -i ${CHAINID}"]
