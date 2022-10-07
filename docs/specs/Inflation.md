# Flare Inflation Subsystem

## Introduction

The Flare Network inflation subsystem contains a series of components that orchestrate establishment, recognition, authorization, minting, funding and finally awarding of inflation rewards for certain services performed by participants of the network. An example of one service that is rewarded through inflation is the providing of prices or delegating of vote power to price providers for the Flare Time Series Oracle (Ftso) system. Note that not all services are funded by inflation.

## Definitions

### Establishment

Establishment consists of two activities:

1. Establishing the native token annual inflation percent.
2. Establishing inflation sharing percentage for services that are rewardable on the Flare Network via inflation. Native token annual inflation will be shared between different services according to governance decisions.

All percentages are settable at any point by governance directive, but will come into effect at different points in time as described below.

### Recognition

Recognition is a point in time, on an annual basis, where inflation rewards are recognized to be authorized over the coming annum for any service rewardable via inflation. Inflation recognized on the Flare Network for a given annum is computed by:

`(Inflatable supply * native token annual inflation percent) / 100`

A change in annual inflation percentage can occur at any point during the year but will only apply to the next (and subsequent) annual recognition events.

Recognized inflation shall be kept for each annum, and a total recognized inflation shall kept for all annums, such that:

`Total recognized inflation += annum recognized inflation`

### Authorization

Authorization is a daily point in time where a portion (one day’s worth) of recognized inflation is authorized to become awardable and thus mintable, not necessarily minted, from the pool of recognized inflation remaining. Authorization will be done in advance, on a daily basis. Authorized inflation is shared between one or more services via a sharing percentage. All sharing percentages must total to 100 percent. Daily authorized inflation for a service is then defined as:

`(Total recognized inflation - total inflation authorized) * (inflation sharing percentage for a service / 100) / number of periods remaining in current annum`

Number of periods remaining in the current annum will be computed as the number of days remaining at the time the authorization cycle is executed, inclusive of the current day.

Totals for inflation authorized shall be kept as follows:

`Total inflation authorized for a service within an annum += daily authorized inflation for a service`

`Total inflation authorized = sum of all authorized inflation for services for all annums`

Daily inflation authorized for all services will be reported each day to a supply contract for accumulation within the inflatable supply. Specification for the supply contract will be documented separately.

Note that total inflation authorized should never exceed total inflation recognized.

Updates to service sharing percentages can be made at any time, and will be applied at the next day’s authorization event.

### Minting

Minting is a daily point in time of requesting a “top-up” amount of inflation rewards in the form of native token. The validator will mint the requested rewards, resulting in new native tokens appearing on-chain. Not all authorized inflation is minted at the point of authorization, for safety reasons. There can be a significant lag between earning of awards and claiming of awards, based on how an individual service operates and the behavior of individual claimants. The inflation process by design attempts to limit attack exposure of large native token balances in any given governed contract by using formulas to keep reasonable reserves of native token available for claiming. These formulas are used to arrive at a daily "top-up" amount for each service.

Note that this limitation might result in too little reserve native tokens being available in a rewarding contract at certain points in time to satisfy all claim requests. However, the design is flexible such that governance can change the top-up formulas to strike the right balance of minimizing claim reverts due to insufficient native tokens and not keeping too many native tokens on-chain. But in any event, insufficient native tokens for claiming does not change the liability of the native tokens owed to a claimant. All claimants claims will eventually be satisfied.

The daily minting request is defined as the sum of all top-ups for each service for the day.

A top-up for a service can be calculated by one of two selectable algorithms:

1. By top-up factor (scaled by 100) of daily authorized inflation.

    The daily inflation top-up for a service is then defined as:

    `(Last daily authorized inflation for a service * top-up factor / 100) - service reward contract balance`
    
    Top up factor must be bigger than 100.

2. By inflation authorized.

    The daily inflation top-up for a service is then defined as:

    `Total inflation authorized for a service - total top-up requested for a service`

Totals for the service shall be kept as follows:

`Total top-up requested for a service += daily inflation topup for a service`

Total top-up requested for a service should never exceed total inflation authorized for a service.

### Funding

Funding is a daily point in time, subsequent to minting, of the transfer of minted native tokens to the target rewarding contract. The funding amount for each service should match the daily inflation top-up calculated that day for each service.

Totals for each rewarding service shall track native tokens received as follows:

`Total inflation received for a service += daily amount funded`

### Awarding

Awarding is the act of a rewarding contract allocating a reward to a recipient. Awards are not native tokens, but are pending claims against the network in the form of native tokens. Awards are typically computed in time slices called epochs. A further description of this process for Ftso rewards is defined in [FTSORewardManager.md]

For each service award, the amount awardable for a given epoch is:

`(Total authorized inflation for the service - total distributed inflation by rewarding service) / number of epochs remaining in current day`

Daily authorized inflation will be set upon each rewarding service at authorization time. It is up to the rewarding service to accumulate authorized inflation, distributed inflation and track the starting timestamp of the setting event, in order to calculate epochs remaining for a day.

## Implementation

### Establishment and Governance

Annual inflation percentage and service sharing percentages are pre-determined by governance of the Flare Network and become part of Flare governing parameters. These percentages are maintained via the [InflationAllocation] contract. Consuming contracts access those values through providers, which form a separating abstraction between the governance process and consumers of governing parameters. For example, [IIInflationPercentageProvider] provides the interface through which the inflation process will obtain the annual inflation percentage, while [IIInflationSharingPercentageProvider] provides the implementation consumers can use to obtain the sharing percentages for each service.

Annual inflation percentages can be set up to be yielded on an annual schedule via [InflationAllocation]. The annual schedule can be predefined as a list of percentages (in bips) that can yield a different inflation percentage for each future annum, on a declining basis -  meaning that next year's inflation percentage must be less than or equal to the current year's percentage. The schedule can be replaced be governance at any time. When replaced, the next percentage yielded will apply to the next annum recognition event (as described below). The maximum annual inflation percentage is thus limited to the initial annual inflation percentage set in the constructor. Further, this also implies that once inflation is recognized for an annum, it cannot be adjusted.

One or more inflation sharing percentages can be associated with inflation receiver contracts. This enables inflation rewards to be sharable between different types of services performed. This list of inflation sharing percentages/inflation receiver contracts can be updated by governance at any time. At the next annual inflation recognition event, the then current list of sharing percentages are used to recognize the portion of inflation that will be authorized for that new annum. The sharing percentages (in bips) must always total 100%.

### Recognition

[![](https://mermaid.ink/img/eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSUlJbmZsYXRpb25QZXJjZW50YWdlUHJvdmlkZXJcbiAgICBwYXJ0aWNpcGFudCBTdXBwbHlcbiAgICBwYXJ0aWNpcGFudCBJbmZsYXRpb25Bbm51bXNcbiAgICBwYXJ0aWNpcGFudCBJbmZsYXRpb25Bbm51bVxuICAgIGxvb3AgRXZlcnkgYmxvY2tcbiAgICAgICAgVmFsaWRhdG9yLS0-RmxhcmVLZWVwZXI6IHRyaWdnZXIoKVxuICAgICAgICBhY3RpdmF0ZSBGbGFyZUtlZXBlclxuICAgICAgICBGbGFyZUtlZXBlci0tPkluZmxhdGlvbjoga2VlcCgpXG4gICAgICAgIGFsdCByZWNvZ25pdGlvbiBldmVyeSBhbm51bVxuICAgICAgICAgICAgSW5mbGF0aW9uLT5JSUluZmxhdGlvblBlcmNlbnRhZ2VQcm92aWRlcjogZ2V0QW5udWFsUGVyY2VudGFnZUJpcHMoKVxuICAgICAgICAgICAgSW5mbGF0aW9uLT5TdXBwbHk6IGdldEluZmxhdGFibGVCYWxhbmNlKClcbiAgICAgICAgICAgIEluZmxhdGlvbi0-SW5mbGF0aW9uQW5udW1zOiBpbml0aWFsaXplTmV3QW5udW0oKVxuICAgICAgICAgICAgSW5mbGF0aW9uQW5udW1zLT5JbmZsYXRpb25Bbm51bTogaW5pdGlhbGl6ZSgpXG4gICAgICAgIGVuZFxuICAgICAgICBkZWFjdGl2YXRlIEZsYXJlS2VlcGVyXG4gICAgZW5kICAgICIsIm1lcm1haWQiOnt9LCJ1cGRhdGVFZGl0b3IiOmZhbHNlLCJhdXRvU3luYyI6dHJ1ZSwidXBkYXRlRGlhZ3JhbSI6ZmFsc2V9)](https://mermaid-js.github.io/mermaid-live-editor/edit##eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSUlJbmZsYXRpb25QZXJjZW50YWdlUHJvdmlkZXJcbiAgICBwYXJ0aWNpcGFudCBTdXBwbHlcbiAgICBwYXJ0aWNpcGFudCBJbmZsYXRpb25Bbm51bXNcbiAgICBwYXJ0aWNpcGFudCBJbmZsYXRpb25Bbm51bVxuICAgIGxvb3AgRXZlcnkgYmxvY2tcbiAgICAgICAgVmFsaWRhdG9yLS0-RmxhcmVLZWVwZXI6IHRyaWdnZXIoKVxuICAgICAgICBhY3RpdmF0ZSBGbGFyZUtlZXBlclxuICAgICAgICBGbGFyZUtlZXBlci0tPkluZmxhdGlvbjoga2VlcCgpXG4gICAgICAgIGFsdCByZWNvZ25pdGlvbiBldmVyeSBhbm51bVxuICAgICAgICAgICAgSW5mbGF0aW9uLT5JSUluZmxhdGlvblBlcmNlbnRhZ2VQcm92aWRlcjogZ2V0QW5udWFsUGVyY2VudGFnZUJpcHMoKVxuICAgICAgICAgICAgSW5mbGF0aW9uLT5TdXBwbHk6IGdldEluZmxhdGFibGVCYWxhbmNlKClcbiAgICAgICAgICAgIEluZmxhdGlvbi0-SW5mbGF0aW9uQW5udW1zOmluaXRpYWxpemVOZXdBbm51bSgpXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bXMtPkluZmxhdGlvbkFubnVtOiBpbml0aWFsaXplKClcbiAgICAgICAgZW5kXG4gICAgICAgIGRlYWN0aXZhdGUgRmxhcmVLZWVwZXJcbiAgICBlbmQgICAgIiwibWVybWFpZCI6Int9IiwidXBkYXRlRWRpdG9yIjpmYWxzZSwiYXV0b1N5bmMiOnRydWUsInVwZGF0ZURpYWdyYW0iOmZhbHNlfQ)

After percentage ratification through governance, the process begins in [Inflation] with recognition of an annual inflation amount for a new annum. This is determined when the current `block.timestamp` exceeds the `endTimeStamp` of the current annum (or after a constructor provided timestamp `_rewardEpochStartTs` if it is the first annum). The amount to recognize is derived from the annual inflation percentage, obtained from the percentage provider (as described above), and the inflatable balance, obtained from [Supply].

Administration of inflation annums are performed by the [InflationAnnums] library. [InflationAnnums] holds a collection of each [InflationAnnum], a pointer to the current annum, and grand totals for each of the steps in the inflation process as described above. Inflation recognition is performed within the `initializeNewAnnum` method of [InflationAnnums]. A new annum is added to the collection, the current annum pointer is reset, and the recognized inflation amount is calculated for the new annum via an `initialize` method on the new [InflationAnnum]. Finally, totals across all annums are maintained. `initializeNewAnnum` is triggered automatically by the [FlareDaemon] contract, via the `trigger()` method, which calls the `daemonize()` method within [Inflation], at the end of every block by the validators. `Inflation.daemonize()` determines whether it is time to recognize a new annum.

### Authorization

[![](https://mermaid.ink/img/eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSUlJbmZsYXRpb25TaGFyaW5nUGVyY2VudGFnZVByb3ZpZGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1zXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1cbiAgICBwYXJ0aWNpcGFudCBSZXdhcmRTZXJ2aWNlc1xuICAgIHBhcnRpY2lwYW50IFJld2FyZFNlcnZpY2VcbiAgICBwYXJ0aWNpcGFudCBJSUluZmxhdGlvblJlY2VpdmVyXG4gICAgbG9vcCBFdmVyeSBibG9ja1xuICAgICAgICBWYWxpZGF0b3ItLT5GbGFyZUtlZXBlcjogdHJpZ2dlcigpXG4gICAgICAgIGFjdGl2YXRlIEZsYXJlS2VlcGVyXG4gICAgICAgIEZsYXJlS2VlcGVyLS0-SW5mbGF0aW9uOiBrZWVwKClcbiAgICAgICAgYWx0IGF1dGhvcml6YXRpb24gZXZlcnkgZGF5XG4gICAgICAgICAgICBJbmZsYXRpb24tPklJSW5mbGF0aW9uU2hhcmluZ1BlcmNlbnRhZ2VQcm92aWRlcjogZ2V0U2hhcmluZ1BlcmNlbnRhZ2VzKClcbiAgICAgICAgICAgIEluZmxhdGlvbi0-SW5mbGF0aW9uQW5udW1zOiBhdXRob3JpemVEYWlseUluZmxhdGlvbigpXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bXMtPkluZmxhdGlvbkFubnVtczogZ2V0Q3VycmVudEFubnVtKClcbiAgICAgICAgICAgIEluZmxhdGlvbkFubnVtcy0-SW5mbGF0aW9uQW5udW06IHJld2FyZFNlcnZpY2VzXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bS0-UmV3YXJkU2VydmljZXM6IGNhdXRob3JpemVEYWlseUluZmxhdGlvbigpXG4gICAgICAgICAgICBSZXdhcmRTZXJ2aWNlcy0-UmV3YXJkU2VydmljZXM6IGNvbXB1dGUgZGFpbHkgYXV0aG9yaXplZCBpbmZsYXRpb25cbiAgICAgICAgICAgIGxvb3AgRXZlcnkgc2hhcmluZ1BlcmNlbnRhZ2VcbiAgICAgICAgICAgICAgICBSZXdhcmRTZXJ2aWNlcy0-UmV3YXJkU2VydmljZXM6IGNvbXB1dGUgZGFpbHkgYXV0aG9yaXplZCBpbmZsYXRpb24gZm9yIHNlcnZpY2VcbiAgICAgICAgICAgICAgICBSZXdhcmRTZXJ2aWNlcy0-UmV3YXJkU2VydmljZTogYWRkQXV0aG9yaXplZEluZmxhdGlvbigpXG4gICAgICAgICAgICAgICAgUmV3YXJkU2VydmljZXMtPklJSW5mbGF0aW9uUmVjZWl2ZXI6IHNldERhaWx5QXV0aG9yaXplZEluZmxhdGlvbigpXG4gICAgICAgICAgICBlbmRcbiAgICAgICAgZW5kXG4gICAgICAgIGRlYWN0aXZhdGUgRmxhcmVLZWVwZXJcbiAgICBlbmQgICAgIiwibWVybWFpZCI6e30sInVwZGF0ZUVkaXRvciI6ZmFsc2UsImF1dG9TeW5jIjp0cnVlLCJ1cGRhdGVEaWFncmFtIjpmYWxzZX0)](https://mermaid-js.github.io/mermaid-live-editor/edit/##eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSUlJbmZsYXRpb25TaGFyaW5nUGVyY2VudGFnZVByb3ZpZGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1zXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1cbiAgICBwYXJ0aWNpcGFudCBSZXdhcmRTZXJ2aWNlc1xuICAgIHBhcnRpY2lwYW50IFJld2FyZFNlcnZpY2VcbiAgICBwYXJ0aWNpcGFudCBJSUluZmxhdGlvblJlY2VpdmVyXG4gICAgbG9vcCBFdmVyeSBibG9ja1xuICAgICAgICBWYWxpZGF0b3ItLT5GbGFyZUtlZXBlcjogdHJpZ2dlcigpXG4gICAgICAgIGFjdGl2YXRlIEZsYXJlS2VlcGVyXG4gICAgICAgIEZsYXJlS2VlcGVyLS0-SW5mbGF0aW9uOiBrZWVwKClcbiAgICAgICAgYWx0IGF1dGhvcml6YXRpb24gZXZlcnkgZGF5XG4gICAgICAgICAgICBJbmZsYXRpb24tPklJSW5mbGF0aW9uU2hhcmluZ1BlcmNlbnRhZ2VQcm92aWRlcjogZ2V0U2hhcmluZ1BlcmNlbnRhZ2VzKClcbiAgICAgICAgICAgIEluZmxhdGlvbi0-SW5mbGF0aW9uQW5udW1zOiBhdXRob3JpemVEYWlseUluZmxhdGlvbigpXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bXMtPkluZmxhdGlvbkFubnVtczogZ2V0Q3VycmVudEFubnVtKClcbiAgICAgICAgICAgIEluZmxhdGlvbkFubnVtcy0-SW5mbGF0aW9uQW5udW06IHJld2FyZFNlcnZpY2VzXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bS0-UmV3YXJkU2VydmljZXM6IGNhdXRob3JpemVEYWlseUluZmxhdGlvbigpXG4gICAgICAgICAgICBSZXdhcmRTZXJ2aWNlcy0-UmV3YXJkU2VydmljZXM6IGNvbXB1dGUgZGFpbHkgYXV0aG9yaXplZCBpbmZsYXRpb25cbiAgICAgICAgICAgIGxvb3AgRXZlcnkgc2hhcmluZ1BlcmNlbnRhZ2VcbiAgICAgICAgICAgICAgICBSZXdhcmRTZXJ2aWNlcy0-UmV3YXJkU2VydmljZXM6IGNvbXB1dGUgZGFpbHkgYXV0aG9yaXplZCBpbmZsYXRpb24gZm9yIHNlcnZpY1xuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2VzLT5SZXdhcmRTZXJ2aWNlOiBhZGRBdXRob3JpemVkSW5mbGF0aW9uKClcbiAgICAgICAgICAgICAgICBSZXdhcmRTZXJ2aWNlcy0-SUlJbmZsYXRpb25SZWNlaXZlcjogc2V0RGFpbHlBdXRob3JpemVkSW5mbGF0aW9uKClcbiAgICAgICAgICAgIGVuZFxuICAgICAgICBlbmRcbiAgICAgICAgZGVhY3RpdmF0ZSBGbGFyZUtlZXBlclxuICAgIGVuZCAgICAiLCJtZXJtYWlkIjoie30iLCJ1cGRhdGVFZGl0b3IiOmZhbHNlLCJhdXRvU3luYyI6dHJ1ZSwidXBkYXRlRGlhZ3JhbSI6ZmFsc2V9)

Once annual inflation is recognized for an annum, inflation must be authorized to become awardable and ultimately mintable for a given reward service. Authorization is performed in advance, over the passage of time, at daily intervals, via the Flare daemonize process (as described above). Daily inflation is authorized by [Inflation] by calling `authorizeDailyInflation` on [InflationAnnums]. In order to allocate daily inflation over services that share inflation, the sharing percentages must be obtained from the provider as described in the Governance and Establishment section. [InflationAnnums] will then lookup the current annum, call `authorizeDailyInflation` on the [RewardServices] defined for the current annum (as defined in [InflationAnnum]), sending along the sharing percentages, and then will total the inflation authorized across all services. 

[RewardServices] manage a collection of [RewardService], each of which contain a reference to a rewarding contract defined through the [IIInflationReceiver] interface and associated accumulated totals for a given annum. `authorizeDailyInflation` on [RewardServices] will take in the necessary inputs to authorize the daily inflation for the day's cycle, disburse the authorized daily inflation across the reward services according to the inflation sharing percentages, and maintain the total authorized inflation for the annum. Finally, it will set the daily authorized inflation on each rewarding contract. It is then the rewarding contracts' job to allocate that inflation across award epochs throughout the day.

### Minting
[![](https://mermaid.ink/img/eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1zXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW0gICAgXG4gICAgcGFydGljaXBhbnQgUmV3YXJkU2VydmljZXNcbiAgICBwYXJ0aWNpcGFudCBSZXdhcmRTZXJ2aWNlXG4gICAgbG9vcCBFdmVyeSBibG9ja1xuICAgICAgICBWYWxpZGF0b3ItLT5GbGFyZUtlZXBlcjogdHJpZ2dlcigpXG4gICAgICAgIGFjdGl2YXRlIEZsYXJlS2VlcGVyXG4gICAgICAgIEZsYXJlS2VlcGVyLS0-SW5mbGF0aW9uOiBrZWVwKClcbiAgICAgICAgYWx0IG1pbnQgZXZlcnkgZGF5XG4gICAgICAgICAgICBJbmZsYXRpb24tPkluZmxhdGlvbkFubnVtczogY29tcHV0ZVRvcHVwUmVxdWVzdCgpXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bXMtPkluZmxhdGlvbkFubnVtczogZ2V0Q3VycmVudEFubnVtKClcbiAgICAgICAgICAgIEluZmxhdGlvbkFubnVtcy0-SW5mbGF0aW9uQW5udW06IHJld2FyZFNlcnZpY2VzXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bS0-UmV3YXJkU2VydmljZXM6IGNvbXB1dGVUb3B1cFJlcXVlc3QoKVxuICAgICAgICAgICAgbG9vcCBFdmVyeSByZXdhcmRTZXJ2aWNlXG4gICAgICAgICAgICAgICAgUmV3YXJkU2VydmljZS0-SW5mbGF0aW9uOiBnZXRUb3B1cENvbmZpZ3VyYXRpb24oKVxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2UtPlJld2FyZFNlcnZpY2U6IGNvbXB1dGVUb3B1cFJlcXVlc3QoKVxuICAgICAgICAgICAgZW5kXG4gICAgICAgICAgICBJbmZsYXRpb24tPkZsYXJlS2VlcGVyOiByZXF1ZXN0TWludGluZygpXG4gICAgICAgICAgICBGbGFyZUtlZXBlci0-VmFsaWRhdG9yOiBtaW50IHJlcXVlc3RcbiAgICAgICAgICAgIFZhbGlkYXRvci0-RmxhcmVLZWVwZXI6IGNvbmp1cmUgRkxSXG4gICAgICAgIGRlYWN0aXZhdGUgRmxhcmVLZWVwZXIgICAgICAgIFxuICAgICAgICBlbHNlIG5leHQgYmxvY2sgYWZ0ZXIgbWludFxuICAgICAgICAgICAgRmxhcmVLZWVwZXItPkluZmxhdGlvbjogcmVjZWl2ZU1pbnRpbmcoKVxuICAgICAgICBlbmRcbiAgICBlbmQgICAgIiwibWVybWFpZCI6e30sInVwZGF0ZUVkaXRvciI6ZmFsc2UsImF1dG9TeW5jIjp0cnVlLCJ1cGRhdGVEaWFncmFtIjpmYWxzZX0)](https://mermaid-js.github.io/mermaid-live-editor/edit##eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1zXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW0gICAgXG4gICAgcGFydGljaXBhbnQgUmV3YXJkU2VydmljZXNcbiAgICBwYXJ0aWNpcGFudCBSZXdhcmRTZXJ2aWNlXG4gICAgbG9vcCBFdmVyeSBibG9ja1xuICAgICAgICBWYWxpZGF0b3ItLT5GbGFyZUtlZXBlcjogdHJpZ2dlcigpXG4gICAgICAgIGFjdGl2YXRlIEZsYXJlS2VlcGVyXG4gICAgICAgIEZsYXJlS2VlcGVyLS0-SW5mbGF0aW9uOiBrZWVwKClcbiAgICAgICAgYWx0IG1pbnQgZXZlcnkgZGF5XG4gICAgICAgICAgICBJbmZsYXRpb24tPkluZmxhdGlvbkFubnVtczogY29tcHV0ZVRvcHVwUmVxdWVzdCgpXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bXMtPkluZmxhdGlvbkFubnVtczogZ2V0Q3VycmVudEFubnVtKClcbiAgICAgICAgICAgIEluZmxhdGlvbkFubnVtcy0-SW5mbGF0aW9uQW5udW06IHJld2FyZFNlcnZpY2VzXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bS0-UmV3YXJkU2VydmljZXM6IGNvbXB1dGVUb3B1cFJlcXVlc3QoKVxuICAgICAgICAgICAgbG9vcCBFdmVyeSByZXdhcmRTZXJ2aWNlXG4gICAgICAgICAgICAgICAgUmV3YXJkU2VydmljZS0-SW5mbGF0aW9uOiBnZXRUb3B1cENvbmZpZ3VyYXRpb24oKVxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2UtPlJld2FyZFNlcnZpY2U6IGNvbXB1dGVUb3B1cFJlcXVlc3QoKVxuICAgICAgICAgICAgZW5kXG4gICAgICAgICAgICBJbmZsYXRpb24tPkZsYXJlS2VlcGVyOiByZXF1ZXN0TWludGluZygpXG4gICAgICAgICAgICBGbGFyZUtlZXBlci0-VmFsaWRhdG9yOiBtaW50IHJlcXVlc3RcbiAgICAgICAgICAgIFZhbGlkYXRvci0-RmxhcmVLZWVwZXI6IGNvbmp1cmUgRkxSXG4gICAgICAgIGRlYWN0aXZhdGUgRmxhcmVLZWVwZXIgICAgICAgIFxuXG4gICAgICAgIGVsc2UgbmV4dCBibG9jayBhZnRlciBtaW50XG4gICAgICAgICAgICBGbGFyZUtlZXBlci0-SW5mbGF0aW9uOiByZWNlaXZlTWludGluZygpXG4gICAgICAgIGVuZFxuICAgIGVuZCAgICAiLCJtZXJtYWlkIjoie30iLCJ1cGRhdGVFZGl0b3IiOmZhbHNlLCJhdXRvU3luYyI6dHJ1ZSwidXBkYXRlRGlhZ3JhbSI6ZmFsc2V9)

Minting of new native tokens, if required by rewarding contracts, occurs after the daily cycle of authorizing daily inflation. In order to determine the amount of native tokens to mint, a top-up calculation must be made for each reward service. [Inflation] calls `computeTopupRequest` on [InflationAnnums] in order to compute the daily minting request amount. [InflationAnnums] is concerned about top-up requests because it maintains grand totals of minting activity. `computeTopupRequest` on [InflationAnnums] will get the current annum, compute the top-up request for each reward service by calling `computeTopupRequest` on [RewardServices] for the current annum, and then totals the top-up requested.

In order for [RewardServices] to compute the top-up request for each reward service, `computeTopupRequest` needs to know the top-up formula defined for each [IIInflationReceiver] contract. This configuration is a governance callable API on [Inflation] via the `setTopupConfiguration` method. [RewardServices] calls `getTopupConfiguration` for each [IIInflationReceiver] defined on each [RewardService]. Top-up configurations types and their formulas are defined in the Definitions section.

For each [RewardService], [RewardServices] calls `computeTopupRequest`, sending in the top-up configuration for that service. [RewardServices] then sums the requested top-ups across reward services for the given annum.

Finally, in order to make the mint request, [Inflation] takes the mint request result from `InflationAnnums.computeTopupRequest` and calls `requestMinting` on the [FlareDaemon].

Minting is fulfilled be the [FlareDaemon] by passing on the minting request to the validator at the end of `trigger()` by returning the mint request total from the trigger method. At the end of state transition, the validator will add the requested native tokens to the [FlareDaemon] contract balance.

The process concludes with the [FlareDaemon], in the next block, recognizing and transferring added native tokens from the validator by calling `receiveMinting` on [Inflation]. The [FlareDaemon] detects arrival of the new native tokens by monitoring the contract balance every time `trigger()` is called (every block).

### Funding

[![](https://mermaid.ink/img/eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1zXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1cbiAgICBwYXJ0aWNpcGFudCBSZXdhcmRTZXJ2aWNlc1xuICAgIHBhcnRpY2lwYW50IFJld2FyZFNlcnZpY2VcbiAgICBwYXJ0aWNpcGFudCBJSUluZmxhdGlvblJlY2VpdmVyXG4gICAgbG9vcCBFdmVyeSBibG9ja1xuICAgICAgICBWYWxpZGF0b3ItLT5GbGFyZUtlZXBlcjogdHJpZ2dlcigpXG4gICAgICAgIGFjdGl2YXRlIEZsYXJlS2VlcGVyXG4gICAgICAgIEZsYXJlS2VlcGVyLS0-SW5mbGF0aW9uOiBrZWVwKClcbiAgICAgICAgYWx0IGZ1bmQgYWZ0ZXIgbWludGluZ1xuICAgICAgICAgICAgSW5mbGF0aW9uLT5JbmZsYXRpb25Bbm51bXM6IHJlY2VpdmVUb3B1cFJlcXVlc3QoKVxuICAgICAgICAgICAgSW5mbGF0aW9uQW5udW1zLT5JbmZsYXRpb25Bbm51bXM6IGdldEN1cnJlbnRBbm51bSgpXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bXMtPkluZmxhdGlvbkFubnVtOiByZXdhcmRTZXJ2aWNlc1xuICAgICAgICAgICAgSW5mbGF0aW9uQW5udW0tPlJld2FyZFNlcnZpY2VzOiByZWNlaXZlVG9wdXBSZXF1ZXN0KClcbiAgICAgICAgICAgIGxvb3AgRXZlcnkgcmV3YXJkU2VydmljZVxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2VzLT5SZXdhcmRTZXJ2aWNlOiBnZXRQZW5kaW5nVG9wdXAoKVxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2VzLT5SZXdhcmRTZXJ2aWNlOiBpbmZsYXRpb25SZWNlaXZlclxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2UtPklJSW5mbGF0aW9uUmVjZWl2ZXI6IHJlY2VpdmVJbmZsYXRpb24oKVxuICAgICAgICAgICAgZW5kXG4gICAgICAgIGVuZFxuICAgICAgICBkZWFjdGl2YXRlIEZsYXJlS2VlcGVyICAgICAgICBcbiAgICBlbmQgICAgIiwibWVybWFpZCI6e30sInVwZGF0ZUVkaXRvciI6ZmFsc2UsImF1dG9TeW5jIjp0cnVlLCJ1cGRhdGVEaWFncmFtIjpmYWxzZX0)](https://mermaid-js.github.io/mermaid-live-editor/edit##eyJjb2RlIjoic2VxdWVuY2VEaWFncmFtXG4gICAgYXV0b251bWJlclxuICAgIHBhcnRpY2lwYW50IFZhbGlkYXRvclxuICAgIHBhcnRpY2lwYW50IEZsYXJlS2VlcGVyXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1zXG4gICAgcGFydGljaXBhbnQgSW5mbGF0aW9uQW5udW1cbiAgICBwYXJ0aWNpcGFudCBSZXdhcmRTZXJ2aWNlc1xuICAgIHBhcnRpY2lwYW50IFJld2FyZFNlcnZpY2VcbiAgICBwYXJ0aWNpcGFudCBJSUluZmxhdGlvblJlY2VpdmVyXG4gICAgbG9vcCBFdmVyeSBibG9ja1xuICAgICAgICBWYWxpZGF0b3ItLT5GbGFyZUtlZXBlcjogdHJpZ2dlcigpXG4gICAgICAgIGFjdGl2YXRlIEZsYXJlS2VlcGVyXG4gICAgICAgIEZsYXJlS2VlcGVyLS0-SW5mbGF0aW9uOiBrZWVwKClcbiAgICAgICAgYWx0IGZ1bmQgYWZ0ZXIgbWludGluZ1xuICAgICAgICAgICAgSW5mbGF0aW9uLT5JbmZsYXRpb25Bbm51bXM6IHJlY2VpdmVUb3B1cFJlcXVlc3QoKVxuICAgICAgICAgICAgSW5mbGF0aW9uQW5udW1zLT5JbmZsYXRpb25Bbm51bXM6IGdldEN1cnJlbnRBbm51bSgpXG4gICAgICAgICAgICBJbmZsYXRpb25Bbm51bXMtPkluZmxhdGlvbkFubnVtOiByZXdhcmRTZXJ2aWNlc1xuICAgICAgICAgICAgSW5mbGF0aW9uQW5udW0tPlJld2FyZFNlcnZpY2VzOiByZWNlaXZlVG9wdXBSZXF1ZXN0KClcbiAgICAgICAgICAgIGxvb3AgRXZlcnkgcmV3YXJkU2VydmljZVxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2VzLT5SZXdhcmRTZXJ2aWNlOiBnZXRQZW5kaW5nVG9wdXAoKVxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2VzLT5SZXdhcmRTZXJ2aWNlOiBpbmZsYXRpb25SZWNlaXZlclxuICAgICAgICAgICAgICAgIFJld2FyZFNlcnZpY2UtPklJSW5mbGF0aW9uUmVjZWl2ZXI6IHJlY2VpdmVJbmZsYXRpb24oXG4gICAgICAgICAgICBlbmRcbiAgICAgICAgZW5kXG4gICAgICAgIGRlYWN0aXZhdGUgRmxhcmVLZWVwZXIgICAgICAgIFxuICAgIGVuZCAgICAiLCJtZXJtYWlkIjoie30iLCJ1cGRhdGVFZGl0b3IiOmZhbHNlLCJhdXRvU3luYyI6dHJ1ZSwidXBkYXRlRGlhZ3JhbSI6ZmFsc2V9)

Once [Inflation] receives the minting top-up request from the [FlareDaemon] via a call to `receiveMinting`, [Inflation] allocates received native token to the reward services by calling `receiveTopupRequest` on [InflationAnnums]. `receiveTopupRequest` first fetches the current annum, and then calls `receiveTopupRequest` on [RewardServices] of the current annum. Finally, it sums total received and withdrawn native token top-up.

`RewardServices.receiveTopupRequest` spins through each [RewardService] for the current annum and fetches the pending top-up request by calling `getPendingTopup` on each [RewardService]. Native tokens are then transferred to each associated [RewardService] [IIInflationReceiver] contract by calling `receiveInflation`. Totals are accumulated for the [RewardService] and the total top-up allocated is returned to [InflationAnnums] for totaling.

The funding process is complete and rewarding contracts can now satisfy claim fulfillment.

### Balancing

Contracts that hold Flare Network balances (as of this writing, [FlareDaemon], [FtsoRewardManager] and [Inflation]), have a `mustBalance()` modifier that is called on every invocation of native tokens entering or leaving these respective contracts. The purpose is to ensure that the actual native token balance held by the contracts matches the native tokens flow as recorded within the contract tracking totals.

[InflationAllocation]: ../../contracts/governance/implementation/InflationAllocation.sol "InflationAllocation"
[IIInflationPercentageProvider]: ../../contracts/inflation/interface/IIInflationPercentageProvider.sol "IIInflationPercentageProvider"
[IIInflationSharingPercentageProvider]: ../../contracts/inflation/interface/IIInflationSharingPercentageProvider.sol "IIInflationSharingPercentageProvider"
[Supply]: ../../contracts/accounting/implementation/Supply.sol "Supply"
[Inflation]: ../../contracts/inflation/implementation/Inflation.sol "Inflation"
[FlareDaemon]: ../../contracts/genesis/implementation/FlareDaemon.sol "FlareDaemon"
[InflationAnnums]: ../../contracts/inflation/lib/InflationAnnums.sol "InflationAnnums"
[InflationAnnum]: ../../contracts/inflation/lib/InflationAnnum.sol "InflationAnnum"
[RewardServices]: ../../contracts/inflation/lib/RewardServices.sol "RewardServices"
[RewardService]: ../../contracts/inflation/lib/RewardService.sol "RewardService"
[IIInflationReceiver]: ../../contracts/inflation/interface/IIInflationReceiver.sol "IIInflationReceiver"
[FtsoRewardManager]: ../../contracts/tokenPools/implementation/FtsoRewardManager.sol "FtsoRewardManager"
[FTSORewardManager.md]: ./FTSORewardManager.md "FTSORewardManager.md"