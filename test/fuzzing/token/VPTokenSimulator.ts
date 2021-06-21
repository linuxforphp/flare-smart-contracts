import { VPTokenMockInstance } from "../../../typechain-truffle";
import { loadJson, saveJson, toBN } from "./FuzzingUtils";
import { VPTokenState } from "./VPTokenState";

export type BNArg = number | BN;

export type VPTokenAction = { context: any, sender: string } &
    (
        | { name: '_checkpoint', checkpointId: string }
        | { name: 'mint', to: string, amount: BN }
        | { name: 'approve', spender: string, amount: BN }
        | { name: 'transfer', recipient: string, amount: BN }
        | { name: 'transferFrom', source: string, recipient: string, amount: BN }
        | { name: 'delegate', to: string, bips: BN }
        | { name: 'delegateExplicit', to: string, amount: BN }
        | { name: 'revokeDelegationAt', who: string, checkpointId: string }
        | { name: 'undelegateAll' }
        | { name: 'undelegateAllExplicit', delegateAddresses: string[] }
        | { name: 'votePowerAtCached', checkpointId: string }
        | { name: 'votePowerOfAtCached', who: string, checkpointId: string }
        | { name: 'setCleanupBlock', checkpointId: string }
    );

export interface Checkpoint {
    id: string;
    blockNumber: number;
    state: VPTokenState;
}

export class VPTokenHistory {
    public history: VPTokenAction[] = [];
    public state: VPTokenState = new VPTokenState();
    public checkpoints: Map<string, Checkpoint> = new Map();

    constructor(
        private vpToken: VPTokenMockInstance
    ) { }

    run(action: VPTokenAction) {
        this.history.push(action);
        return this.execute(action);
    }
    
    checkpointList() {
        return Array.from(this.checkpoints.values());
    }

    async createCheckpoint(checkpointId: string) {
        await this.run({ name: '_checkpoint', sender: '', context: null, checkpointId });
    }

    checkpoint(checkpointId: string) {
        const checkpoint = this.checkpoints.get(checkpointId);
        if (checkpoint == null) {
            throw new Error(`Unknown checkpoint ${checkpointId}`);
        }
        return checkpoint;
    }

    save(file: string, indent?: string | number) {
        saveJson(file, this.history, indent);
    }

    load(file: string) {
        this.history = loadJson(file, ['amount', 'bips']);
    }

    async execute(method: VPTokenAction) {
        try {
            switch (method.name) {
                case '_checkpoint': {
                    const blockNumber = await web3.eth.getBlockNumber();
                    if (this.checkpoints.has(method.checkpointId)) {
                        throw new Error(`Checkpoint ${method.checkpointId} already exists`);
                    }
                    this.checkpoints.set(method.checkpointId, { id: method.checkpointId, blockNumber: blockNumber, state: this.state.clone() });
                    return;
                }
                case "mint": {
                    const result = await this.vpToken.mint(method.to, method.amount, { from: method.sender });
                    this.state.balances.set(method.to, (this.state.balances.get(method.to)).add(method.amount));
                    return result;
                }
                case "approve": {
                    return this.vpToken.approve(method.spender, method.amount, { from: method.sender });
                }
                case "transfer": {
                    const result = await this.vpToken.transfer(method.recipient, method.amount, { from: method.sender });
                    this.state.balances.set(method.sender, (this.state.balances.get(method.sender)).sub(method.amount));
                    this.state.balances.set(method.recipient, (this.state.balances.get(method.recipient)).add(method.amount));
                    return result;
                }
                case "transferFrom": {
                    const result = await this.vpToken.transferFrom(method.source, method.recipient, method.amount, { from: method.sender });
                    this.state.balances.set(method.source, (this.state.balances.get(method.source)).sub(method.amount));
                    this.state.balances.set(method.recipient, (this.state.balances.get(method.recipient)).add(method.amount));
                    return result;
                }
                case "delegate": {
                    const result = await this.vpToken.delegate(method.to, method.bips, { from: method.sender });
                    this.state.bipsDelegations.set(method.sender, method.to, method.bips);
                    return result;
                }
                case "delegateExplicit": {
                    const result = await this.vpToken.delegateExplicit(method.to, method.amount, { from: method.sender });
                    this.state.amountDelegations.set(method.sender, method.to, method.amount);
                    return result;
                }
                case "revokeDelegationAt": {
                    const checkpoint = this.checkpoint(method.checkpointId);
                    const result = await this.vpToken.revokeDelegationAt(method.who, checkpoint.blockNumber, { from: method.sender });
                    checkpoint.state.revokeDelegation(method.sender, method.who);
                    return result;
                }
                case "undelegateAll": {
                    const result = await this.vpToken.undelegateAll({ from: method.sender });
                    this.state.undelegateAll(method.sender);
                    return result;
                }
                case "undelegateAllExplicit": {
                    const result = await this.vpToken.undelegateAllExplicit(method.delegateAddresses, { from: method.sender });
                    this.state.undelegateAllExplicit(method.sender, method.delegateAddresses);
                    return result;
                }
                case "votePowerAtCached": {
                    const checkpoint = this.checkpoint(method.checkpointId);
                    return this.vpToken.votePowerAtCached(checkpoint.blockNumber, { from: method.sender });
                }
                case "votePowerOfAtCached": {
                    const checkpoint = this.checkpoint(method.checkpointId);
                    return this.vpToken.votePowerOfAtCached(method.who, checkpoint.blockNumber, { from: method.sender });
                }
                case "setCleanupBlock": {
                    const checkpoint = this.checkpoint(method.checkpointId);
                    const result = await this.vpToken.setCleanupBlockNumber(checkpoint.blockNumber, { from: method.sender });
                }
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : e;
            console.log(`  ${method.context ?? ''} ${method.name}: ${msg}`);
        }
    }
}

export class VPTokenSimulator {
    constructor(
        private history: VPTokenHistory,
    ) { }

    public context: any = null;

    withContext(context: any) {
        const result = new VPTokenSimulator(this.history);
        result.context = context;
        return result;
    }

    mint(sender: string, to: string, amount: BNArg) {
        return this.history.run({ context: this.context, name: "mint", sender, to, amount: toBN(amount) });
    }

    transfer(sender: string, recipient: string, amount: BNArg) {
        return this.history.run({ context: this.context, name: "transfer", sender, recipient, amount: toBN(amount) });
    }

    delegate(sender: string, to: string, bips: BNArg) {
        return this.history.run({ context: this.context, name: "delegate", sender, to, bips: toBN(bips) });
    }

    delegateExplicit(sender: string, to: string, amount: BNArg) {
        return this.history.run({ context: this.context, name: "delegateExplicit", sender, to, amount: toBN(amount) });
    }

    revokeDelegationAt(sender: string, who: string, checkpointId: string) {
        return this.history.run({ context: this.context, name: "revokeDelegationAt", sender, who, checkpointId });
    }

    undelegateAll(sender: string) {
        return this.history.run({ context: this.context, name: "undelegateAll", sender });
    }

    undelegateAllExplicit(sender: string, delegateAddresses: string[]) {
        return this.history.run({ context: this.context, name: "undelegateAllExplicit", sender, delegateAddresses });
    }

    votePowerAtCached(sender: string, checkpointId: string) {
        return this.history.run({ context: this.context, name: "votePowerAtCached", sender, checkpointId });
    }
    
    votePowerOfAtCached(sender: string, who: string, checkpointId: string) {
        return this.history.run({ context: this.context, name: "votePowerOfAtCached", sender, who, checkpointId });
    }
    
    setCleanupBlock(sender: string, checkpointId: string) {
        return this.history.run({ context: this.context, name: "setCleanupBlock", sender, checkpointId });
    }
}
