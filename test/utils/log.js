const verbose = true;

const log = (S) => {
  if (verbose) {
    console.log(S);
  }
};

Object.assign(exports, {
  log
});