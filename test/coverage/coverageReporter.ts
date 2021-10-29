import * as fs from 'fs';
const cliProgress = require('cli-progress');

let { argv } = require("yargs")
  .scriptName("coverageReporter")
  .option("f", {
    alias: "coverageReportFile",
    describe: "Path to coverage report file",
    default: "coverage/index.html",
    type: "string",
    nargs: 1,
  })
  .fail(function (msg: any, err: any, yargs: any) {
    if (err) throw err;
    console.error("Exiting with message")
    console.error(msg);
    console.error(yargs.help())
    process.exit(0);
  })

interface dataPairs {
  name: string,
  value: string
}

const reqexMatch = `<span class="[^"]*?[^"]*?">(.*?)<\/span>`
const regexp = new RegExp(`<span class="[^"]*?[^"]*?">(.*?)<\/span>`, 'g');

async function main(coverageReportFile: string, save:boolean, saveToFile: string) {
  let data = fs.readFileSync(coverageReportFile, "utf-8");
  let match = data.match(reqexMatch);

  let matchesFound: dataPairs[] = []

  let previous = ""
  let ispair = false
  while ((match = regexp.exec(data)) !== null) {
    if (ispair) {
      matchesFound.push({ name: match[1], value: previous })
      ispair = false
    }
    else {
      previous = match[1];
      ispair = true
    }
  }

  if(save){
    fs.writeFileSync(saveToFile, JSON.stringify(matchesFound));
  }

  for(let dataObj of matchesFound){
    console.log(`${dataObj.name} coverage: ${dataObj.value}`);
  }
}

const { coverageReportFile, saveToFile, save } = argv;
if (!fs.existsSync(coverageReportFile)) {
  console.error("No Coverage report file ");
}

main(coverageReportFile, save, saveToFile)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
