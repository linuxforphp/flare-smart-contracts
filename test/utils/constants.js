var getTestFile = (myFile) => {
  return myFile.slice(myFile.replace(/\\/g, '/').indexOf("test/"));
};

var genesisGovernance = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";

Object.assign(exports, {
  getTestFile,
  genesisGovernance
});