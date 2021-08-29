import { toBN } from "./test-helpers";

export interface RawEvent {
    removed: boolean;
    logIndex: number;
    transactionIndex: number;
    transactionHash: string;
    blockHash: string;
    blockNumber: number;
    address: string;
    data: string;
    topics: string[];
    id: string;
}

export function formatEvent(event: Truffle.TransactionLog<any>) {
    const keys = Object.keys(event.args).filter(k => /^\d+$/.test(k)).map(k => Number(k));
    keys.sort((a, b) => a - b);
    const args = keys.map(k => event.args[k]).map(x => web3.utils.isBN(x) ? x.toString() : x);
    return `${event.address.slice(0, 10)}:${event.event}(${args.join(', ')})`;
}

export class Web3EventDecoder {
    public eventTypes = new Map<string, AbiItem>();     // topic => type

    constructor(contracts: Truffle.ContractInstance[], filter?: string[]) {
        for (const contract of contracts) {
            for (const item of contract.abi) {
                if (item.type === 'event' && (filter == null || filter.includes(item.name!))) {
                    this.eventTypes.set((item as any).signature, item);
                }
            }
        }
    }

    decodeEvent(event: RawEvent): Truffle.TransactionLog<any> | null {
        const evtType = this.eventTypes.get(event.topics[0]);
        if (evtType == null) return null;
        // based on web3 docs, first topic has to be removed for non-anonymous events
        const topics = evtType.anonymous ? event.topics : event.topics.slice(1);
        const decodedArgs: any = web3.eth.abi.decodeLog(evtType.inputs!, event.data, topics);
        // convert parameters based on type (BN for now)
        evtType.inputs!.forEach((arg, i) => {
            if (/^u?int\d*$/.test(arg.type)) {
                decodedArgs[i] = decodedArgs[arg.name] = toBN(decodedArgs[i]);
            }
        });
        return {
            address: event.address,
            type: evtType.type,
            event: evtType.name,
            args: decodedArgs,
            blockHash: event.blockHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            transactionIndex: event.transactionIndex,
        }
    }

    decodeEvents(tx: Truffle.TransactionResponse<any>): Truffle.TransactionLog<any>[] {
        const rawLogs = tx.receipt.rawLogs as RawEvent[];
        return rawLogs.map(raw => this.decodeEvent(raw))
            .filter(ev => ev != null) as Truffle.TransactionLog<any>[];
    }
}
