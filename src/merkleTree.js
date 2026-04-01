const { hashLeaf, hashNode } = require("./utils");

// Step 1: Create leaves (sorted for determinism)
function createLeaves(users) {
  const sorted = [...users].sort((a, b) => a.id.localeCompare(b.id));

  return sorted.map(user => ({
    hash: hashLeaf(user.id, user.balance),
    sum: BigInt(user.balance),
    id: user.id
  }));
}

// Step 2: Build tree
function buildTree(leaves) {
  let level = leaves;

  while (level.length > 1) {
    let nextLevel = [];

    for (let i = 0; i < level.length; i += 2) {
      let left = level[i];
      let right = level[i + 1];

      if (!right) {
        // Unpaired node - hash with itself but count sum only once
        nextLevel.push({
          hash: hashNode(left.hash, left.hash),
          sum: left.sum
        });
      } else {
        nextLevel.push({
          hash: hashNode(left.hash, right.hash),
          sum: left.sum + right.sum
        });
      }
    }

    level = nextLevel;
  }

  return level[0];
}

// Step 3: Generate proof (WITH direction)
function getMerkleProof(leaves, index) {
  let proof = [];
  let level = leaves;

  while (level.length > 1) {
    let nextLevel = [];

    for (let i = 0; i < level.length; i += 2) {
      let left = level[i];
      let right = level[i + 1];

      if (i === index || i + 1 === index) {
        if (i === index && right) {
          // Left is the target, right is the sibling
          proof.push({ hash: right.hash, position: "right" });
        } else if (i + 1 === index && right) {
          // Right is the target, left is the sibling
          proof.push({ hash: left.hash, position: "left" });
        } else if (i === index && !right) {
          // Unpaired node hashes with itself
          proof.push({ hash: left.hash, position: "self" });
        }
        // If target node is unpaired at higher levels, it will be handled the same way
        index = Math.floor(i / 2);
      }

      if (!right) {
        nextLevel.push({
          hash: hashNode(left.hash, left.hash),
          sum: left.sum
        });
      } else {
        nextLevel.push({
          hash: hashNode(left.hash, right.hash),
          sum: left.sum + right.sum
        });
      }
    }

    level = nextLevel;
  }

  return proof;
}

// Step 4: Verify proof
function verifyProof(user, proof, rootHash) {
  let currentHash = hashLeaf(user.id, user.balance);

  for (let p of proof) {
    if (p.position === "right") {
      currentHash = hashNode(currentHash, p.hash);
    } else if (p.position === "left") {
      currentHash = hashNode(p.hash, currentHash);
    } else if (p.position === "self") {
      currentHash = hashNode(currentHash, currentHash);
    }
  }

  return currentHash === rootHash;
}

module.exports = {
  createLeaves,
  buildTree,
  getMerkleProof,
  verifyProof
};