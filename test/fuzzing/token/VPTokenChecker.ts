import { VPTokenMockInstance } from "../../../typechain-truffle";
import { BN_ZERO, Nullable, toBN } from "./FuzzingUtils";
import { VPTokenState } from "./VPTokenState";

export class VPTokenChecker {
    constructor(
        private vpToken: VPTokenMockInstance,
        private blockNumber: Nullable<number>,
        private accounts: string[],
        private state: VPTokenState,
        // when true, sums all votePowerFromTo in totalDelegationsTo and totalDelegationsFrom
        // when false, only sum up all existing delegates (based on state) - much faster but not as thorough
        private checkZeroDelegations: boolean = false,
    ) {}

    // VPToken wrappers

    totalSupply() {
        return this.cached(['totalSupply'],
            () => this.blockNumber == null ? this.vpToken.totalSupply() : this.vpToken.totalSupplyAt(this.blockNumber));
    }

    balanceOf(account: string) {
        return this.cached(['balanceOf', account],
            () => this.blockNumber == null ? this.vpToken.balanceOf(account) : this.vpToken.balanceOfAt(account, this.blockNumber));
    }

    votePower() {
        return this.cached(['votePower'],
            () => this.blockNumber == null ? this.vpToken.votePower() : this.vpToken.votePowerAt(this.blockNumber));
    }

    votePowerOf(account: string) {
        return this.cached(['votePowerOf', account],
            () => this.blockNumber == null ? this.vpToken.votePowerOf(account) : this.vpToken.votePowerOfAt(account, this.blockNumber));
    }

    votePowerFromTo(from: string, to: string) {
        return this.cached(['votePowerFromTo', from, to],
            () => this.blockNumber == null ? this.vpToken.votePowerFromTo(from, to) : this.vpToken.votePowerFromToAt(from, to, this.blockNumber));
    }

    undelegatedVotePowerOf(from: string) {
        return this.cached(['undelegatedVotePowerOf', from],
            () => this.blockNumber == null ? this.vpToken.undelegatedVotePowerOf(from) : this.vpToken.undelegatedVotePowerOfAt(from, this.blockNumber));
    }

    // utility functions

    private cache: { [key: string]: any } = {};
    
    async cached<T>(key: string[], func: () => Promise<T>): Promise<T> {
        // return func();
        const skey = key.join("|");
        if (!(skey in this.cache)) {
            this.cache[skey] = await func()
        }
        return this.cache[skey];
    }

    async totalBalance() {
        let total = toBN(0);
        for (const account of this.accounts) {
            total = total.add(await this.balanceOf(account));
        }
        return total;
    }

    async totalVotePower() {
        let total = toBN(0);
        for (const account of this.accounts) {
            total = total.add(await this.votePowerOf(account));
        }
        return total;
    }

    async totalDelegationsTo(account: string) {
        let total = BN_ZERO;
        const delegators = this.checkZeroDelegations ? this.accounts : this.state.delegatorsOf(account);
        for (const other of delegators) {
            // if (other === account) continue;
            const vpFromOther = await this.votePowerFromTo(other, account);
            total = total.add(vpFromOther);
        }
        return total;
    }

    async totalDelegationsFrom(account: string) {
        let total = BN_ZERO;
        const delegatees = this.checkZeroDelegations ? this.accounts : this.state.delegateesOf(account);
        for (const other of delegatees) {
            // if (other === account) continue;
            const vpToOther = await this.votePowerFromTo(account, other);
            total = total.add(vpToOther);
        }
        return total;
    }

    // invariant checks

    async checkInvariants() {
        await this.checkTotalBalance();
        await this.checkTotalVotePower();
        await this.checkTotalVotePowerIsUndelegatedPlusDelegationsTo();
        await this.checkTotalVotePowerIsBalanceMinusFromPlusToDelegations();
        await this.checkCachedVotePower();
        await this.checkTotalCachedVotePower();
    }

    async checkStateMatch() {
        await this.checkStateBalance();
        await this.checkStateVotePower();
        await this.checkStateUndelegatedVotePower();
    }

    async checkTotalBalance() {
        console.log('   checkTotalBalance');
        const balance = await this.totalBalance();
        const supply = await this.totalSupply();
        assert(balance.eq(supply), `Balance does not match supply: ${balance} != ${supply}`);
    }

    async checkTotalVotePower() {
        console.log('   checkTotalVotePower');
        const calculatedVP = await this.totalVotePower();
        const vp = await this.votePower();
        assert(calculatedVP.eq(calculatedVP), `Calculated VP does not match contract VP: ${calculatedVP} != ${vp}`);
    }

    // totalVP = undelegatedVP + all delegations TO account
    async checkTotalVotePowerIsUndelegatedPlusDelegationsTo() {
        console.log('   checkTotalVotePowerIsUndelegatedPlusDelegationsTo');
        for (const account of this.accounts) {
            await this.checkTotalVotePowerIsUndelegatedPlusDelegationsToFor(account);
        }
    }

    async checkTotalVotePowerIsUndelegatedPlusDelegationsToFor(account: string) {
        const undelegated = await this.undelegatedVotePowerOf(account);
        const delegationsTo = await this.totalDelegationsTo(account);
        const calculated = undelegated.add(delegationsTo);
        const vp = await this.votePowerOf(account);
        assert(calculated.eq(vp), `Sum of delegated and undelagated mismatch VP for account ${account}: ${calculated} != ${vp}`);
    }

    // totalVP = balance + all delegations TO account - all delegations FROM account
    async checkTotalVotePowerIsBalanceMinusFromPlusToDelegations() {
        console.log('   checkTotalVotePowerIsBalanceMinusFromPlusToDelegations');
        for (const account of this.accounts) {
            await this.checkTotalVotePowerIsBalanceMinusFromPlusToDelegationsFor(account);
        }
    }

    async checkTotalVotePowerIsBalanceMinusFromPlusToDelegationsFor(account: string) {
        const balance = await this.balanceOf(account);
        const delegationsTo = await this.totalDelegationsTo(account);
        const delegationsFrom = await this.totalDelegationsFrom(account);
        const calculated = balance.add(delegationsTo).sub(delegationsFrom);
        const vp = await this.votePowerOf(account);
        assert(calculated.eq(vp), `Diff of balance and delegated mismatch VP for account ${account}: ${calculated} != ${vp}`);
    }

    async checkCachedVotePower() {
        if (this.blockNumber == null) return;
        console.log('   checkCachedVotePower');
        for (const account of this.accounts) {
            await this.checkCachedVotePowerFor(account);
        }
    }

    async checkCachedVotePowerFor(account: string) {
        if (this.blockNumber == null) return;
        const vp = await this.votePowerOf(account);
        const vpcached = await this.vpToken.votePowerOfAtCached.call(account, this.blockNumber);
        assert(vpcached.eq(vp), `Vote power and vote power cached mismatch for account ${account}: ${vpcached} != ${vp}`);
    }

    async checkTotalCachedVotePower() {
        if (this.blockNumber == null) return;
        console.log('   checkTotalCachedVotePower');
        const vp = await this.votePower();
        const vpcached = await this.vpToken.votePowerAtCached.call(this.blockNumber);
        assert(vpcached.eq(vp), `Total vote power and vote power cached mismatch: ${vpcached} != ${vp}`);
    }
    
    // state checks
    
    async checkStateBalance() {
        console.log('   checkStateBalance');
        for (const account of this.accounts) {
            await this.checkStateBalanceFor(account);
        }
    }

    private async checkStateBalanceFor(account: string) {
        const balance = await this.balanceOf(account);
        const stateBalance = this.state.balances.get(account);
        assert(balance.eq(stateBalance), `Simulator state balance mismatch for acount:  ${account}: ${balance} != ${stateBalance}`);
    }

    async checkStateVotePower() {
        console.log('   checkStateVotePower');
        for (const account of this.accounts) {
            await this.checkStateVotePowerFor(account);
        }
    }

    private async checkStateVotePowerFor(account: string) {
        const vp = await this.votePowerOf(account);
        const stateVp = this.state.votePower(account);
        assert(vp.eq(stateVp), `Simulator state vote power mismatch for acount:  ${account}: ${vp} != ${stateVp}`);
    }

    async checkStateUndelegatedVotePower() {
        console.log('   checkStateUndelegatedVotePower');
        for (const account of this.accounts) {
            await this.checkStateUndelegatedVotePowerFor(account);
        }
    }

    private async checkStateUndelegatedVotePowerFor(account: string) {
        const uvp = await this.undelegatedVotePowerOf(account);
        const stateUVp = this.state.undelegatedVotePower(account);
        assert(uvp.eq(stateUVp), `Simulator state undelegated vote power mismatch for acount:  ${account}: ${uvp} != ${stateUVp}`);
    }
}
