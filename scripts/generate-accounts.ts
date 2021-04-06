
function generateAccounts() {
    const fs = require('fs');
    const Wallet = require('ethereumjs-wallet').default;

    let accountsCount = process.argv[2] || 100;
    let balance = "100000000000000000000000000000000"

    let accounts = [];
    for (let i = 0; i < accountsCount; i++) {
        let wallet = Wallet.generate();
        accounts.push({ privateKey: wallet.getPrivateKeyString(), balance });
        console.log(wallet.address)
    }

    fs.writeFileSync("accounts.json", JSON.stringify(accounts));
    console.log(`${ accountsCount } accounts generated`);
}

generateAccounts();