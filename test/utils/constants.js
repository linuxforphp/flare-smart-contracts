var getTestFile = (myFile) => {
  return myFile.slice(myFile.indexOf("test/"));
};

Object.assign(exports, {
  getTestFile
});