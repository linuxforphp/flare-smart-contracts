var getTestFile = (myFile) => {
  return myFile.slice(myFile.replace(/\\/g, '/').indexOf("test/"));
};

Object.assign(exports, {
  getTestFile
});