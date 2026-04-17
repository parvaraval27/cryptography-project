const { createHash } = require("crypto");

// safer encoding
function hashLeaf(id, balance) {
  return createHash("sha256").update(`${id}:${balance}`).digest("hex");
}

function hashNode(leftHash, rightHash) {
  return createHash("sha256").update(leftHash + rightHash).digest("hex");
}

module.exports = { hashLeaf, hashNode };