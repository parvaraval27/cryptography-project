const { createLeaves, buildTree } = require("./merkleTree");

/**
 * Merkle Integration Module
 * Provides merkle root computation for zk-SNARK coupling
 * Ensures same deterministic computation as merkleTree.js
 */

/**
 * Compute merkle root from balances
 * Must use same sorting as merkleTree.js for determinism
 * @param {Array} users - Array of { id, balance } objects
 * @returns {string} Merkle root hash
 */
function computeMerkleRootFromUsers(users) {
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error("users must be a non-empty array");
  }

  // Ensure each user has required fields
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

/**
 * Compute merkle root from balances array (for circuit input)
 * When balances are already extracted, compute root deterministically
 * @param {Array} users - Array of { id, balance } for proper sorting
 * @returns {string} Merkle root hash in hex format
 */
function getMerkleRootForCircuit(users) {
  return computeMerkleRootFromUsers(users);
}

/**
 * Verify that a merkle root matches expected value
 * Used in verification to ensure root consistency
 * @param {Array} users - Users to compute root from
 * @param {string} expectedRoot - Expected root hash
 * @returns {boolean} Whether computed root matches expected root
 */
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
