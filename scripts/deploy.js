async function main() {
  const DummyVPToken = artifacts.require("DummyVPToken");
  let DummyToken = await DummyVPToken.new("Dummy Vote Power Token", "DVPT");

  console.log(DummyToken.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });