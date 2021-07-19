/**
 * Returns truncated file path.
 * @param file module filename
 * @returns file path from `test/` on, separated by `'/'`
 */
export function getTestFile(myFile: string) {
  return myFile.slice(myFile.replace(/\\/g, '/').indexOf("test/"));
};

export const genesisGovernance = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";
