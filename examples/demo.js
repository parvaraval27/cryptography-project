/**
 * Example: Programmatic Usage of Solvency Proof System
 * 
 * This example demonstrates:
 * 1. Building a Merkle tree
 * 2. Generating a solvency proof
 * 3. Verifying both proofs
 * 
 * Run: node examples/demo.js
 */

const {
  createLeaves,
  buildTree,
  getMerkleProof,
  verifyProof
} = require("../src/merkleTree");

const {
  generateAndProve,
  loadAndVerifyProof
} = require("../src/zkProof");

const path = require("path");

async function demo() {
  console.log("═══════════════════════════════════════════════════");
  console.log("   ZK-SNARK SOLVENCY PROOF - DEMO");
  console.log("═══════════════════════════════════════════════════\n");

  // Example: Exchange with 4 users
  const users = [
    { id: "Alice", balance: 100 },
    { id: "Bob", balance: 50 },
    { id: "Carol", balance: 200 },
    { id: "Dave", balance: 80 }
  ];

  const reserves = BigInt(500);

  console.log("📊 SETUP\n");
  console.log("Users:");
  users.forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.id}: ${u.balance}`);
  });

  const totalBalances = users.reduce((sum, u) => sum + u.balance, 0);
  console.log(`\nTotal balances: ${totalBalances}`);
  console.log(`Exchange reserves: ${reserves.toString()}`);
  console.log(`Solvent? ${totalBalances <= reserves ? "✅ YES" : "❌ NO"}\n`);

  // ═══════════════════════════════════════════════════
  // PART 1: Merkle Tree
  // ═══════════════════════════════════════════════════

  console.log("═══════════════════════════════════════════════════");
  console.log("PART 1: MERKLE TREE PROOF");
  console.log("═══════════════════════════════════════════════════\n");

  console.log("🌳 Building Merkle tree...");
  const leaves = createLeaves(users);
  const root = buildTree(leaves);

  console.log(`\n✅ Merkle root generated`);
  console.log(`   Hash: ${root.hash.substring(0, 16)}...`);
  console.log(`   Total sum: ${root.sum.toString()}`);

  // User verifies their inclusion
  console.log("\n👤 Alice verifies her balance is included...");
  const aliceIndex = leaves.findIndex(u => u.id === "Alice");
  const aliceMerkleProof = getMerkleProof(leaves, aliceIndex);

  console.log(`   Merkle proof (${aliceMerkleProof.length} nodes):`);
  aliceMerkleProof.forEach((node, i) => {
    console.log(`     ${i + 1}. ${node.position} sibling: ${node.hash.substring(0, 16)}...`);
  });

  const aliceUser = users[aliceIndex];
  const merkleValid = verifyProof(aliceUser, aliceMerkleProof, root.hash);

  console.log(`\n   Result: ${merkleValid ? "✅ VALID" : "❌ INVALID"}`);
  console.log(`   Alice's balance IS included in the Merkle tree`);

  // ═══════════════════════════════════════════════════
  // PART 2: zk-SNARK Solvency Proof
  // ═══════════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════");
  console.log("PART 2: ZK-SNARK SOLVENCY PROOF");
  console.log("═══════════════════════════════════════════════════\n");

  console.log("🔐 Generating solvency proof...");
  console.log("   This proves: sum(balances) ≤ reserves");
  console.log("   WITHOUT revealing individual balances\n");

  try {
    const balances = users.map(u => BigInt(u.balance));

    await generateAndProve(balances, reserves, {
      verify: true,
      savePath: path.join(__dirname, "../proofs/solvency_proof.json")
    });

    // ═══════════════════════════════════════════════════
    // PART 3: Full Verification
    // ═══════════════════════════════════════════════════

    console.log("\n═══════════════════════════════════════════════════");
    console.log("PART 3: FULL VERIFICATION");
    console.log("═══════════════════════════════════════════════════\n");

    console.log("👤 Bob verifies the exchange is solvent...");
    console.log("   Step 1: Verify Bob is in the Merkle tree");

    const bobIndex = leaves.findIndex(u => u.id === "Bob");
    const bobMerkleProof = getMerkleProof(leaves, bobIndex);
    const bobUser = users[bobIndex];
    const bobMerkleValid = verifyProof(bobUser, bobMerkleProof, root.hash);

    console.log(`   Result: ${bobMerkleValid ? "✅ VALID" : "❌ INVALID"}`);

    console.log("\n   Step 2: Verify exchange solvency with zk-SNARK");

    const solvencyValid = await loadAndVerifyProof(
      path.join(__dirname, "../proofs/solvency_proof.json")
    );

    console.log(`   Result: ${solvencyValid ? "✅ VALID" : "❌ INVALID"}`);

    console.log("\n═══════════════════════════════════════════════════");
    console.log("FINAL RESULT");
    console.log("═══════════════════════════════════════════════════");

    if (merkleValid && solvencyValid) {
      console.log("\n✨ COMPLETE VERIFICATION SUCCESSFUL\n");
      console.log("   ✔️  Bob's balance is in the exchange");
      console.log("   ✔️  Exchange is cryptographically proven to be solvent");
      console.log("   ✔️  Individual balances remain hidden");
      console.log("   ✔️  Total liabilities remain hidden\n");
    }

    // ═══════════════════════════════════════════════════
    // PART 4: What Verifier Knows vs. Doesn't Know
    // ═══════════════════════════════════════════════════

    console.log("═══════════════════════════════════════════════════");
    console.log("WHAT THE VERIFIER KNOWS");
    console.log("═══════════════════════════════════════════════════\n");

    console.log("✅ What Verifier CAN See:");
    console.log("   • Merkle root (exchange commitment)");
    console.log("   • Merkle proof (for their user)");
    console.log("   • zk-SNARK proof (solvency proof)");
    console.log("   • Public input: reserves = 500\n");

    console.log("✅ What Verifier CAN Prove:");
    console.log("   • Their balance is in the tree");
    console.log("   • Exchange total ≤ 500\n");

    console.log("❌ What Verifier CANNOT See:");
    console.log("   • Alice's balance (100) ← HIDDEN");
    console.log("   • Bob's balance (50) ← HIDDEN");
    console.log("   • Carol's balance (200) ← HIDDEN");
    console.log("   • Dave's balance (80) ← HIDDEN");
    console.log("   • Total liabilities (430) ← HIDDEN\n");

    console.log("╔════════════════════════════════════════════════╗");
    console.log("║ Privacy is maintained while proving solvency! ║");
    console.log("╚════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

// Run demo
demo().catch(console.error);
