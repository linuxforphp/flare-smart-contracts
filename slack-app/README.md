## Flare slack app

###  Install:
https://ftso-monitor-sc-team.flare.rocks/slack



### Command details
| Command | Description | Input parameters  | Examples |
| --- | --- | --- | --- |
| `/list_ftso` | returns a lists all FTSOs details - id, name, address, asset price(USD) | none  |`/list_ftso`|
| `/currentprice` | returns USD price of FTSO asset | • Ftso id or Ftso address(optional, default: 1) | • `/currentprice`  <br> • `/currentprice 0`  <br> • `/currentprice 2`  <br> • /`currentprice 0x53369fd4680FfE3DfF39Fc6DDa9CfbfD43daeA2E`|
| `/ftso_epochid`     |  returns current epoch id if no input  <br> returns epoch id at timestamp given as input    |   • timestamp (optional, default: current timestamp)   |   • `/ftso_epochid`  <br> • `/ftso_epochid 1621262110`   |
|   `/ftso_epoch`   |  returns Last median calculation results of given Ftso and epoch id    |   • Ftso id or address <br>• epochId (optional, default: current timestamp)   |   • `/ftso_epoch`  <br> • `/ftso_epoch 1,2900`  <br> • `/ftso_epoch 0x2D8553F9ddA85A9B3259F6Bf26911364B85556F5, 24`   |
| `/ftso_price` | returns price(USD) of FTSO asset at given epoch id | • Ftso id or address <br>• epochId (optional, default: current timestamp) | • `/ftso_price` <br> • `/ftso_price 3,2187` <br> • `/ftso_price 0x18b9306737eaf6E8FC8e737F488a1AE077b18053, 33`|
|  `/ftso_votes`    |    Returns vote details of FTSO asset at given epoch id  |  • Ftso id or address <br>• epochId (optional, default: current timestamp)   |   • `/ftso_votes`  <br> • `/ftso_votes 2,1084`  <br> • `/ftso_votes 0x92cfBAB5A86631e9F1A6126b42E01A74eadA61Df, 39`   |
| `/epoch_price_for_voter` | Returns price(USD) of FTSO Fasset at given epoch id for a Voter | • Ftso id or address <br> • epochId (optional, default: current timestamp)<br> • Voter address | • `/epoch_price_for_voter 0x0c25d8d55d50b7CCEb09493061B088DA173f18aA`  <br> • `/epoch_price_for_voter 3,0x237Ddc5d734e4AF318088a645619A623dCEa2cF7` <br> • `/epoch_price_for_voter 7,3627,0x5157f5c480A0D887e79435A6D497E17485BDc1F1`|
---

### Parameters - 
• ftso id: id of FAsset<br>
    `/list_ftso` command lists id of all FAssets along with other details. <br>
• ftso address: contract address of FAsset<br>
    `/list_ftso` command lists contract address of all FAssets along with other details. <br>
• timestamp:  Unix epoch time<br>
• Voter address: address of voters of FAssets<br>
    `/ftso_votes` command lists all voters address along with other details.
