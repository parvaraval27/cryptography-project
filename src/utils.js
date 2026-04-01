const SHA256 = require("crypto-js/sha256");

// safer encoding
function hashLeaf(id, balance) {
  return SHA256(`${id}:${balance}`).toString();
}

function hashNode(leftHash, rightHash) {
  return SHA256(leftHash + rightHash).toString();
}

module.exports = { hashLeaf, hashNode };