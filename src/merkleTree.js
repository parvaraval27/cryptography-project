const { hashLeaf, hashNode } = require("./utils");

function createLeaves(users) {
  const sorted = [...users].sort((a, b) => a.id.localeCompare(b.id));

  return sorted.map(user => ({
    hash: hashLeaf(user.id, user.balance),
    sum: BigInt(user.balance),
    id: user.id
  }));
}

function buildTree(leaves) {
  let level = leaves;

  while (level.length > 1) {
    let nextLevel = [];

    for (let i = 0; i < level.length; i += 2) {
      let left = level[i];
      let right = level[i + 1];

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

  return level[0];
}

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
          proof.push({ hash: right.hash, siblingSum: right.sum.toString(), position: "right" });
        } else if (i + 1 === index && right) {
          proof.push({ hash: left.hash, siblingSum: left.sum.toString(), position: "left" });
        } else if (i === index && !right) {
          proof.push({ hash: left.hash, siblingSum: left.sum.toString(), position: "self" });
        }
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

function verifyProof(user, proof, rootHash, expectedRootSum = null) {
  let currentHash = hashLeaf(user.id, user.balance);
  let currentSum = BigInt(user.balance);
  let strictMode = expectedRootSum !== null;

  for (let p of proof) {
    if (p.position === "right") {
      currentHash = hashNode(currentHash, p.hash);
      if (strictMode) {
        if (p.siblingSum === undefined) {
          return false;
        }
        currentSum += BigInt(p.siblingSum);
      }
    } else if (p.position === "left") {
      currentHash = hashNode(p.hash, currentHash);
      if (strictMode) {
        if (p.siblingSum === undefined) {
          return false;
        }
        currentSum += BigInt(p.siblingSum);
      }
    } else if (p.position === "self") {
      currentHash = hashNode(currentHash, currentHash);
      if (strictMode) {
        if (p.siblingSum === undefined) {
          return false;
        }

        const siblingSum = BigInt(p.siblingSum);
        if (siblingSum !== currentSum) {
          return false;
        }
      }
    } else {
      return false;
    }
  }

  if (currentHash !== rootHash) {
    return false;
  }

  if (!strictMode) {
    return true;
  }

  return currentSum === BigInt(expectedRootSum);
}

module.exports = {
  createLeaves,
  buildTree,
  getMerkleProof,
  verifyProof
};