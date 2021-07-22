let Tester = artifacts.require("Tester");
let tester = await Tester.new({gasPrice: "500000000000", gas: "2000000"});
let tx = tester.push(1);
