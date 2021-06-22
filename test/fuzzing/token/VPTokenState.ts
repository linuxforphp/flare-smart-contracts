import { BN_ZERO, MAX_BIPS, saveJson } from "./FuzzingUtils";
import { SparseArray, SparseMatrix } from "./SparseMatrix";

enum DelegationMode {
    NOTSET = 0,
    PERCENTAGE = 1,
    AMOUNT = 2,
}

export class VPTokenState {
    constructor(
        public readonly balances = new SparseArray(),
        public readonly bipsDelegations = new SparseMatrix(),
        public readonly amountDelegations = new SparseMatrix(),
    ) { }

    votePower(account: string) {
        return this.balances.get(account)
            .add(this.delegatedVPTo(account))
            .sub(this.delegatedVPFrom(account));
    }

    undelegatedVotePower(account: string) {
        return this.balances.get(account)
            .sub(this.delegatedVPFrom(account));
    }

    private delegatedVPFrom(account: string) {
        let res = BN_ZERO;
        const balance = this.balances.get(account);
        for (const bips of this.bipsDelegations.rowMap(account).values()) {
            res = res.add(bips.mul(balance).div(MAX_BIPS)); // delegations from account
        }
        for (const amount of this.amountDelegations.rowMap(account).values()) {
            res = res.add(amount); // delegations from account
        }
        return res;
    }

    private delegatedVPTo(account: string) {
        let res = BN_ZERO;
        for (const [from, bips] of this.bipsDelegations.colMap(account)) {
            res = res.add(bips.mul(this.balances.get(from)).div(MAX_BIPS)); // delegations to account
        }
        for (const amount of this.amountDelegations.colMap(account).values()) {
            res = res.add(amount); // delegations to account
        }
        return res;
    }

    undelegateAll(from: string) {
        const list = Array.from(this.bipsDelegations.rowMap(from).keys());
        for (const to of list) {
            this.bipsDelegations.set(from, to, BN_ZERO);
        }
    }

    undelegateAllExplicit(from: string, toList: string[]) {
        for (const to of toList) {
            this.amountDelegations.set(from, to, BN_ZERO);
        }
    }
    
    revokeDelegation(from: string, to: string) {
        this.bipsDelegations.set(from, to, BN_ZERO);
        this.amountDelegations.set(from, to, BN_ZERO);
    }

    votePowerFromTo(from: string, to: string) {
        const bips = this.bipsDelegations.get(from, to);
        if (!bips.isZero()) {
            return bips.mul(this.balances.get(from)).div(MAX_BIPS);
        }
        return this.amountDelegations.get(from, to);    // if missing, zero will be returned anyway
    }
    
    // to simulate vpcontract replacement
    clearAllDelegations() {
        this.bipsDelegations.clear();
        this.amountDelegations.clear();
    }
    
    save(file: string, indent?: string | number) {
        const obj = {
            balances: this.balances.toObject(),
            bipsDelegations: this.bipsDelegations.toObject(),
            amountDelegations: this.amountDelegations.toObject(),
        };
        saveJson(file, obj, indent);
    }
    
    delegationModeOf(account: string) {
        if (this.bipsDelegations.hasRow(account)) return DelegationMode.PERCENTAGE;
        if (this.amountDelegations.hasRow(account)) return DelegationMode.AMOUNT;
        return DelegationMode.NOTSET;
    }
    
    delegatorsOf(account: string) {
        return Array.from(this.bipsDelegations.colMap(account).keys())
            .concat(Array.from(this.amountDelegations.colMap(account).keys()));
    }

    delegateesOf(account: string) {
        return Array.from(this.bipsDelegations.rowMap(account).keys())
            .concat(Array.from(this.amountDelegations.rowMap(account).keys()));
    }

    clone(): VPTokenState {
        return new VPTokenState(
            this.balances.clone(),
            this.bipsDelegations.clone(),
            this.amountDelegations.clone());
    }
}
