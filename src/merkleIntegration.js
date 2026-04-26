const { createLeaves, buildTree } = require("./merkleTree");

function computeMerkleRootFromUsers(users) {
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error("users must be a non-empty array");
  }

  for (const user of users) {
    if (!user.id || user.balance === undefined) {
      throw new Error("Each user must have 'id' and 'balance' properties");
    }
  }

  try {
    const leaves = createLeaves(users);
    const root = buildTree(leaves);
    return root.hash;
  } catch (error) {
    throw new Error(`Failed to compute merkle root: ${error.message}`);
  }
}

function getMerkleRootForCircuit(users) {
  return computeMerkleRootFromUsers(users);
}

function verifyMerkleRoot(users, expectedRoot) {
  try {
    const computedRoot = computeMerkleRootFromUsers(users);
    return computedRoot === expectedRoot;
  } catch (error) {
    return false;
  }
}

module.exports = {
  computeMerkleRootFromUsers,
  getMerkleRootForCircuit,
  verifyMerkleRoot
};
