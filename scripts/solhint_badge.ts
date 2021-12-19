const fs = require("fs");


const { argv } = require("yargs")
    .scriptName("solhint_badge")
    .option("f", {
      alias: "file-name",
      describe: "name of badge file",
      type: "string",
      default: "solhint_badge.json",
      nargs: 1
  })

async function main(badgeFileName:string) {
    const badge_data = {
        "schemaVersion": 1,
        "label": "Solhint linter",
        "color": "green",
        "message": "Pass"}
    fs.writeFileSync(badgeFileName,JSON.stringify(badge_data))
}

const { fileName } = argv;
main(fileName)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
