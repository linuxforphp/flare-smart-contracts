# Accounting On The Flare Network

## Introduction

With its unique oracle design, the Flare Network rewards network participation in a variety of ways through reward pools of pre-minted FLR, and through FLR inflation minted over time. Governance, as facilitated through the Flare Foundation and voted on by FLR holders, will agree (as one example) on a percentage by which FLR is inflated over time. As a custodian of these balances and implementor of these processes, it is important that the Flare Network demonstrate use of a system of controls that can provide a transparent, accurate, and auditable means for ensuring FLR balances are handled in a manner as directed by governance.

One approach is to use an integrated method of accounting for balances. The system chosen is a traditional double-entry bookkeeping system, implemented as an on-chain smart contract. This accounting system is not meant to track all FLR, across all accounts, across the entire network. Instead, it has a targeted use for "keeping the books" of the Flare Network Rewarding System (FNRS). Using traditional financial management tracking and reporting concepts, and doing so on-chain, is perhaps unique, but it is believed that building in such a level of accountability at the core of the FNRS will result in high levels of trust, benefiting all FLR holders.

## Concepts

### General Ledger

At its core, FNRS implements a traditional general ledger (GL), consisting of a collection of GL accounts. These accounts are not to be confused with Flare network accounts, as the GL does not hold any balance, nor does it have access to any keys. GL accounts are simply "buckets" that can be definable to track FLR balance (sub)totals through a lifecycle, and report on that life cycle using a standard financial management methodology. Certainly not all accounting concepts apply. The FNRS is not an income producing entity, so an income statement is not completely applicable, for example. But a balance sheet, which reports a snapshot of the state of GL accounts at a point in time, will produce totals that will match to balances actually contained within FNRS smart contracts. Statements of change between two balance sheets can be produced to illustrate that governance processes are implemented as specified.

### Chart Of Accounts

The chart of accounts defines the accounts that a given general ledger will track. Each account at a minimum is named and can be one of three types: asset, liability, and equity. A GL is first initialized with its chart of accounts, at which point, can be used to post transactions.

### Journal Entries

Journal entries are the means by which balance changes are recorded.  A journal entry contains an account name to be updated, and a debit or credit amount used to update the balance. Not to be confused with "debt" or "credit" cards, debits and credits impact account balances differently based on the account type. Debits increase an asset account, but decrease a liability or equity account. Credits do the opposite.

### Ledger Entries

Ledger entries result from journal entries posting to the GL. They record the balance of an account and the debits and credits that impacted that balance since the last time the account was changed. Posting of ledger entries require that the sum of all journal entry debits equal the sum of all credits.

We currently record these ledger entries by block number and are evaluating whether this level on on-chain detail is worth the expense and overhead, or whether an eventing system might be more appropriate, to push ledger entries off-chain.

### Account Balances

Each account stores its accumulated, current account balance, as a result of all ledger entries to that point, and can be a positive or negative number.

### GL Balances

As accounts can be one of three types, the GL keeps an aggregated balance for all assets, liabilities, and equity. The golden rule of accounting is Assets = Liabilities + Equity. The general ledger contract enforces this rule. Further, in our implementation, these balances can never be negative after ledger posting.

### Sub-Ledgers and Closing

The general ledger can be used to post balance changes in real time. If all contracts did this, the GL would always be consistent from a timing perspective. But this can be a chatty (cross-contract) and data intensive (storage-wise) process. In many cases, real-time posting to the GL is not warranted. Therefore, certain contracts can implement a local ledger (known loosely as a sub-ledger), which can be an informal mechanism to store real-time balance changes since the last posting to the general ledger. The accounting system implements an automated closing manager which will coordinate the synchronization of GL posting across contracts that manage their own local ledger. Close manager will cause a "close" to happen periodically. The blocks at which these closes occur become points in time where timing differences are netted out of the balance sheet, providing consistent sources for statements of change. Currently, close manager calls upon a close every calendar day at the first block starting on or after 00:00:00 GMT.

### Liberties Taken

Liberties were taken in the design and implementation of the accounting system. The more traditional "journal->ledger->trial balance->final accounts" flow has been short-cut to produce a more simplified journalize to post flow in one step, as the accounting system is meant to operate on-chain without intervention or manual process.

## The API

[![](https://mermaid.ink/img/eyJjb2RlIjoiZXJEaWFncmFtXG4gICAgICAgICAgTGVkZ2VyIHx8LS1veyBBY2NvdW50IDogXCJjb21wb3NlZCBvZlwiXG4gICAgICAgICAgTGVkZ2VyIHtcbiAgICAgICAgICAgIHVpbnQyNTYgYXNzZXRCYWxhbmNlXG4gICAgICAgICAgICB1aW50MjU2IGxpYWJpbGl0eUJhbGFuY2VcbiAgICAgICAgICAgIHVpbnQyNTYgZXF1aXR5QmFsYW5jZVxuICAgICAgICAgIH1cbiAgICAgICAgICBGbGFyZU5ldHdvcmtHZW5lcmFsTGVkZ2VyIHx8LS18fCBMZWRnZXIgOiBcImlzIGFcIlxuICAgICAgICAgIEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgfHwuLnx8IEZsYXJlTmV0d29ya0NoYXJ0T2ZBY2NvdW50cyA6IFwiZGVmaW5lZCBieVwiXG4gICAgICAgICAgRmxhcmVOZXR3b3JrQ2hhcnRPZkFjY291bnRzIHx8LS1veyBBY2NvdW50RGVmaW5pdGlvbiA6IFwiY29tcG9zZWQgb2ZcIlxuICAgICAgICAgIEFjY291bnREZWZpbml0aW9uIHtcbiAgICAgICAgICAgIHN0cmluZyBuYW1lXG4gICAgICAgICAgICBlbnVtIGFjY291bnRUeXBlXG4gICAgICAgICAgfVxuICAgICAgICAgIEFjY291bnQgfHwtLW97IExlZGdlckVudHJ5IDogXCJoYXNcIlxuICAgICAgICAgIEFjY291bnQge1xuICAgICAgICAgICAgc3RyaW5nIG5hbWVcbiAgICAgICAgICAgIGVudW0gYWNjb3VudFR5cGVcbiAgICAgICAgICAgIHVpbnQyNTYgY3VycmVudEJhbGFuY2VcbiAgICAgICAgICB9XG4gICAgICAgICAgTGVkZ2VyRW50cnkge1xuICAgICAgICAgICAgdWludDI1NiBibG9ja051bWJlclxuICAgICAgICAgICAgdWludDI1NiBjcmVkaXRcbiAgICAgICAgICAgIHVpbnQyNTYgZGViaXRcbiAgICAgICAgICAgIHVpbnQyNTYgcnVubmluZ0JhbGFuY2VcbiAgICAgICAgICB9XG4gICAgICAgICAgTWludEFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgOiBcInBvc3RzIHRvIGFuZCBxdWVyaWVzXCJcbiAgICAgICAgICBNaW50QWNjb3VudGluZyB8fC4ufHwgRmxhcmVOZXR3b3JrQ2hhcnRPZkFjY291bnRzIDogcmVmZXJlbmNlc1xuICAgICAgICAgIFN1cHBseUFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgOiBxdWVyaWVzXG4gICAgICAgICAgU3VwcGx5QWNjb3VudGluZyB8fC4ufHwgRmxhcmVOZXR3b3JrQ2hhcnRPZkFjY291bnRzIDogcmVmZXJlbmNlc1xuICAgICAgICAgIEZ0c29JbmZsYXRpb25BY2NvdW50aW5nIHx8Li58fCBGbGFyZU5ldHdvcmtHZW5lcmFsTGVkZ2VyIDogXCJwb3N0cyBhbmQgcXVlcmllc1wiXG4gICAgICAgICAgRnRzb0luZmxhdGlvbkFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0NoYXJ0T2ZBY2NvdW50cyA6IHJlZmVyZW5jZXNcbiAgICAgICAgICBGdHNvUmV3YXJkTWFuYWdlckFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgOiBcInBvc3RzIGFuZCBxdWVyaWVzXCJcbiAgICAgICAgICBGdHNvUmV3YXJkTWFuYWdlckFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0NoYXJ0T2ZBY2NvdW50cyA6IHJlZmVyZW5jZXNcbiAgICAgICAgICAiLCJtZXJtYWlkIjp7fSwidXBkYXRlRWRpdG9yIjpmYWxzZX0)](https://mermaid-js.github.io/mermaid-live-editor/#/edit/eyJjb2RlIjoiZXJEaWFncmFtXG4gICAgICAgICAgTGVkZ2VyIHx8LS1veyBBY2NvdW50IDogXCJjb21wb3NlZCBvZlwiXG4gICAgICAgICAgTGVkZ2VyIHtcbiAgICAgICAgICAgIHVpbnQyNTYgYXNzZXRCYWxhbmNlXG4gICAgICAgICAgICB1aW50MjU2IGxpYWJpbGl0eUJhbGFuY2VcbiAgICAgICAgICAgIHVpbnQyNTYgZXF1aXR5QmFsYW5jZVxuICAgICAgICAgIH1cbiAgICAgICAgICBGbGFyZU5ldHdvcmtHZW5lcmFsTGVkZ2VyIHx8LS18fCBMZWRnZXIgOiBcImlzIGFcIlxuICAgICAgICAgIEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgfHwuLnx8IEZsYXJlTmV0d29ya0NoYXJ0T2ZBY2NvdW50cyA6IFwiZGVmaW5lZCBieVwiXG4gICAgICAgICAgRmxhcmVOZXR3b3JrQ2hhcnRPZkFjY291bnRzIHx8LS1veyBBY2NvdW50RGVmaW5pdGlvbiA6IFwiY29tcG9zZWQgb2ZcIlxuICAgICAgICAgIEFjY291bnREZWZpbml0aW9uIHtcbiAgICAgICAgICAgIHN0cmluZyBuYW1lXG4gICAgICAgICAgICBlbnVtIGFjY291bnRUeXBlXG4gICAgICAgICAgfVxuICAgICAgICAgIEFjY291bnQgfHwtLW97IExlZGdlckVudHJ5IDogXCJoYXNcIlxuICAgICAgICAgIEFjY291bnQge1xuICAgICAgICAgICAgc3RyaW5nIG5hbWVcbiAgICAgICAgICAgIGVudW0gYWNjb3VudFR5cGVcbiAgICAgICAgICAgIHVpbnQyNTYgY3VycmVudEJhbGFuY2VcbiAgICAgICAgICB9XG4gICAgICAgICAgTGVkZ2VyRW50cnkge1xuICAgICAgICAgICAgdWludDI1NiBibG9ja051bWJlclxuICAgICAgICAgICAgdWludDI1NiBjcmVkaXRcbiAgICAgICAgICAgIHVpbnQyNTYgZGViaXRcbiAgICAgICAgICAgIHVpbnQyNTYgcnVubmluZ0JhbGFuY2VcbiAgICAgICAgICB9XG4gICAgICAgICAgTWludEFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgOiBcInBvc3RzIHRvIGFuZCBxdWVyaWVzXCJcbiAgICAgICAgICBNaW50QWNjb3VudGluZyB8fC4ufHwgRmxhcmVOZXR3b3JrQ2hhcnRPZkFjY291bnRzIDogcmVmZXJlbmNlc1xuICAgICAgICAgIFN1cHBseUFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgOiBxdWVyaWVzXG4gICAgICAgICAgU3VwcGx5QWNjb3VudGluZyB8fC4ufHwgRmxhcmVOZXR3b3JrQ2hhcnRPZkFjY291bnRzIDogcmVmZXJlbmNlc1xuICAgICAgICAgIEZ0c29JbmZsYXRpb25BY2NvdW50aW5nIHx8Li58fCBGbGFyZU5ldHdvcmtHZW5lcmFsTGVkZ2VyIDogXCJwb3N0cyBhbmQgcXVlcmllc1wiXG4gICAgICAgICAgRnRzb0luZmxhdGlvbkFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0NoYXJ0T2ZBY2NvdW50cyA6IHJlZmVyZW5jZXNcbiAgICAgICAgICBGdHNvUmV3YXJkTWFuYWdlckFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0dlbmVyYWxMZWRnZXIgOiBcInBvc3RzIGFuZCBxdWVyaWVzXCJcbiAgICAgICAgICBGdHNvUmV3YXJkTWFuYWdlckFjY291bnRpbmcgfHwuLnx8IEZsYXJlTmV0d29ya0NoYXJ0T2ZBY2NvdW50cyA6IHJlZmVyZW5jZXNcbiAgICAgICAgICAiLCJtZXJtYWlkIjp7fSwidXBkYXRlRWRpdG9yIjpmYWxzZX0)

The general ledger API is implemented in [Ledger]. A specific implementation of the general ledger used by the Flare Network is implemented in [FlareNetworkGeneralLedger]. The [FlareNetworkChartOfAccounts] is automatically ingested by the [FlareNetworkGeneralLedger] at instantiation time to produce a ready to post GL.

### Accounting Contracts

Smart contracts that implement specific "business" functionality of the FNRS need not be concerned with the intricacies of posting to or reading from the general ledger. Within the accounting/implementation folder of the repository, a series of contracts are named *Accounting.sol. These contracts form an abstraction layer on top of the general ledger to package up GL operations in a form easy for other contracts to consume. Presently, no FNRS business contract interacts directly with the GL.

### mustBalance

FNRS contracts that custody FLR balances have a mustBalance modifier. The purpose is to ensure that FLR entering or leaving the contract balance to what is expected within the accounting system.

## Attack Vectors
- The self-destruct recipient attack vector, where a contract can be a recipient of a FLR balance transfer without a receive or payable function being triggered, is an attack vector we are aware of, and have taken some steps in [FlareKeeper] to address. [FtsoRewardManager] has not been addressed and tickets are contained within the backlog to address.

## Caveats And Notes
- The chart of accounts is currently in development stage and is likely to change as we refine the types of balances required for certain processes and how we want balances to be reported. One example is that the circulating supply balance that drives the low voter turnout feature of the Ftso has not been implemented with the GL.

[Ledger]: ../../contracts/accounting/implementation/Ledger.sol "Ledger.sol"
[FlareNetworkGeneralLedger]: ../../contracts/accounting/implementation/FlareNetworkGeneralLedger.sol "FlareNetworkGeneralLedger"
[FlareNetworkChartOfAccounts]: ../../contracts/accounting/lib/FlareNetworkChartOfAccounts.sol "FlareNetworkChartOfAccounts"
[FlareKeeper]: ../../contracts/utils/implementation/FlareKeeper.sol "FlareKeeper"
[FtsoRewardManager]: ../../contracts/ftso/implementation/FtsoRewardManager.sol "FtsoRewardManager"

