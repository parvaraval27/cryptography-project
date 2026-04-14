const { createLeaves, getMerkleProof, verifyProof, buildTree } = require("./merkleTree");
const { hashLeaf, hashNode } = require("./utils");

function toSerializableNode(node, level, index, extras = {}) {
  return {
    nodeId: `L${level}N${index}`,
    level,
    index,
    hash: node.hash,
    hashShort: node.hash.slice(0, 12),
    sum: node.sum.toString(),
    ...extras
  };
}

function buildTreeSnapshot(users) {
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error("users must be a non-empty array");
  }

  const leaves = createLeaves(users);
  const levels = [leaves.map((leaf, index) => toSerializableNode(leaf, 0, index, { userId: leaf.id }))];
  const edges = [];
  let currentLevel = leaves;
  let levelIndex = 0;

  while (currentLevel.length > 1) {
    const nextLevel = [];
    const nextLevelSerializable = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1];
      const parentIndex = Math.floor(i / 2);
      const leftNodeId = `L${levelIndex}N${i}`;
      const rightNodeId = right ? `L${levelIndex}N${i + 1}` : null;

      let parent;
      if (!right) {
        parent = {
          hash: hashNode(left.hash, left.hash),
          sum: left.sum
        };
      } else {
        parent = {
          hash: hashNode(left.hash, right.hash),
          sum: left.sum + right.sum
        };
      }

      const parentNodeId = `L${levelIndex + 1}N${parentIndex}`;
      nextLevel.push(parent);

      nextLevelSerializable.push(
        toSerializableNode(parent, levelIndex + 1, parentIndex, {
          leftChildId: leftNodeId,
          rightChildId: rightNodeId
        })
      );

      edges.push({ source: leftNodeId, target: parentNodeId });
      if (rightNodeId) {
        edges.push({ source: rightNodeId, target: parentNodeId });
      }
    }

    levels.push(nextLevelSerializable);
    currentLevel = nextLevel;
    levelIndex += 1;
  }

  const root = levels[levels.length - 1][0];

  return {
    root,
    levels,
    edges,
    leafOrder: leaves.map((leaf) => leaf.id)
  };
}

function buildProofTrace(users, userId) {
  const leaves = createLeaves(users);
  const userIndex = leaves.findIndex((leaf) => leaf.id === userId);

  if (userIndex === -1) {
    throw new Error(`User ${userId} not found in sorted leaves`);
  }

  const root = buildTree(leaves);
  const proof = getMerkleProof(leaves, userIndex);
  const targetUser = users.find((user) => user.id === userId);

  if (!targetUser) {
    throw new Error(`User ${userId} not found in input users`);
  }

  let currentHash = hashLeaf(targetUser.id, targetUser.balance);
  let currentSum = BigInt(targetUser.balance);
  const steps = [];

  for (let i = 0; i < proof.length; i += 1) {
    const sibling = proof[i];
    let nextHash = currentHash;

    if (sibling.position === "right") {
      nextHash = hashNode(currentHash, sibling.hash);
    } else if (sibling.position === "left") {
      nextHash = hashNode(sibling.hash, currentHash);
    } else {
      nextHash = hashNode(currentHash, currentHash);
    }

    const siblingSum = BigInt(sibling.siblingSum ?? currentSum.toString());
    let nextSum = currentSum;
    if (sibling.position === "right" || sibling.position === "left") {
      nextSum = currentSum + siblingSum;
    } else {
      nextSum = currentSum;
    }

    steps.push({
      step: i,
      position: sibling.position,
      siblingHash: sibling.hash,
      siblingSum: siblingSum.toString(),
      inputHash: currentHash,
      inputSum: currentSum.toString(),
      outputHash: nextHash,
      outputSum: nextSum.toString(),
    });

    currentHash = nextHash;
    currentSum = nextSum;
  }

  const valid = verifyProof(targetUser, proof, root.hash, root.sum);

  return {
    userId,
    rootHash: root.hash,
    rootSum: root.sum.toString(),
    valid,
    proof,
    steps,
  };
}

module.exports = {
  buildTreeSnapshot,
  buildProofTrace
};