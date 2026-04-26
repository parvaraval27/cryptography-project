const readline = require("readline");
const {
  createLeaves,
  buildTree,
  getMerkleProof,
  verifyProof
} = require("./merkleTree");
const {
  generateAndProve,
  loadAndVerifyProof
} = require("./zkProof");
const { getMerkleRootForCircuit } = require("./merkleIntegration");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let users = [];

function inputUsers(n, count = 0) {
  if (count === n) {
    showMainMenu();
    return;
  }

  rl.question(`Enter user ${count + 1} (format: id balance): `, (input) => {
    const [id, balance] = input.split(" ");
    users.push({ id, balance: Number(balance) });
    inputUsers(n, count + 1);
  });
}

function showMainMenu() {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("        EXCHANGE SOLVENCY PROOF SYSTEM");
  console.log("═══════════════════════════════════════════════════");
  console.log("\n📋 Users loaded:", users.length);
  console.log("💰 Choose a mode:\n");
  console.log("  1️⃣  Generate Merkle Tree (inclusion proofs)");
  console.log("  2️⃣  Prove Solvency with zk-SNARK");
  console.log("  3️⃣  Verify Merkle Inclusion Proof");
  console.log("  4️⃣  Verify Solvency Proof");
  console.log("  5️⃣  Full Verification (Merkle + zk-SNARK)");
  console.log("  6️⃣  Show User Balances");
  console.log("  0️⃣  Exit\n");

  rl.question("Select mode (0-6): ", (choice) => {
    switch (choice.trim()) {
      case "1":
        merkleTreeMode();
        break;
      case "2":
        solvencyProverMode();
        break;
      case "3":
        merkleVerifierMode();
        break;
      case "4":
        solvencyVerifierMode();
        break;
      case "5":
        fullVerificationMode();
        break;
      case "6":
        showBalances();
        break;
      case "0":
        rl.close();
        return;
      default:
        console.log("❌ Invalid choice");
        showMainMenu();
    }
  });
}

function merkleTreeMode() {
  console.log("\n🌳 Building Merkle Tree...\n");
  
  const leaves = createLeaves(users);
  const root = buildTree(leaves);

  console.log("✅ Merkle Tree built successfully!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📜 Root Hash:", root.hash);
  console.log("💰 Total Balance (hidden in proof):", root.sum.toString());
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  showMainMenu();
}

function solvencyProverMode() {
  console.log("\n🔐 Solvency Proof Generation Mode");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("The exchange will generate a proof that:");
  console.log("  sum(user balances) ≤ reserves\n");
  console.log("WITHOUT revealing individual balances.\n");

  rl.question("Enter exchange reserves: ", async (reservesInput) => {
    try {
      const reserves = BigInt(reservesInput);
      const balances = users.map(u => BigInt(u.balance));
      const merkleRoot = getMerkleRootForCircuit(users);

      const actualSum = balances.reduce((a, b) => a + b, BigInt(0));

      console.log("\n📊 Proof Parameters:");
      console.log(`   Users: ${users.length}`);
      console.log(`   Total user balances: ${actualSum.toString()}`);
      console.log(`   Exchange reserves: ${reserves.toString()}`);

      if (actualSum > reserves) {
        console.log("\n❌ ERROR: Total balances EXCEED reserves!");
        console.log("   Cannot generate valid proof for insolvent exchange.");
        showMainMenu();
        return;
      }

      await generateAndProve(balances, reserves, {
        verify: true,
        merkleRoot,
        users,
        savePath: require("path").join(__dirname, "../proofs/solvency_proof.json")
      });

      showMainMenu();
    } catch (error) {
      console.error("❌ Error:", error.message);
      showMainMenu();
    }
  });
}

function merkleVerifierMode() {
  console.log("\n🔍 Merkle Inclusion Proof Verification");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const leaves = createLeaves(users);
  const root = buildTree(leaves);

  rl.question("Enter user ID to verify: ", (id) => {
    const index = leaves.findIndex(u => u.id === id);

    if (index === -1) {
      console.log("❌ User not found");
      showMainMenu();
      return;
    }

    const proof = getMerkleProof(leaves, index);
    const user = users.find(u => u.id === id);

    console.log("\n📜 Merkle Proof Generated:");
    console.log(JSON.stringify(proof.slice(0, 2), null, 2));
    if (proof.length > 2) {
      console.log(`   ... (${proof.length} total nodes)`);
    }

    const isValid = verifyProof(user, proof, root.hash, root.sum);

    console.log("\n✅ Verification Result:", isValid);
    if (isValid) {
      console.log(`✔️  User ${id} balance IS included in the Merkle tree`);
      console.log("✔️  Merkle sum constraints verified up to the root");
    } else {
      console.log(`❌ User ${id} verification FAILED`);
    }

    showMainMenu();
  });
}

function solvencyVerifierMode() {
  console.log("\n✔️ Solvency Proof Verification");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("Verifying that: sum(balances) ≤ reserves\n");

  const proofPath = require("path").join(__dirname, "../proofs/solvency_proof.json");

  loadAndVerifyProof(proofPath)
    .then((isValid) => {
      console.log("\n" + (isValid ? "✅" : "❌") + " Proof verification " + (isValid ? "PASSED" : "FAILED"));
      showMainMenu();
    })
    .catch((error) => {
      console.error("Error:", error.message);
      showMainMenu();
    });
}

function fullVerificationMode() {
  console.log("\n🔐 Full Verification Mode");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Step 1: Verify user is in Merkle tree");
  console.log("Step 2: Verify exchange solvency with zk-SNARK\n");

  const leaves = createLeaves(users);
  const root = buildTree(leaves);

  rl.question("Enter user ID to verify: ", async (id) => {
    const index = leaves.findIndex(u => u.id === id);

    if (index === -1) {
      console.log("❌ User not found");
      showMainMenu();
      return;
    }

    const user = users.find(u => u.id === id);
    const proof = getMerkleProof(leaves, index);
    const merkleValid = verifyProof(user, proof, root.hash, root.sum);

    console.log("\n✅ Step 1 - Merkle Verification:", merkleValid ? "PASSED" : "FAILED");
    if (merkleValid) {
      console.log(`   User ${id} balance is included in exchange commitment`);
    } else {
      console.log(`   ❌ User could not be verified`);
      showMainMenu();
      return;
    }

    const proofPath = require("path").join(__dirname, "../proofs/solvency_proof.json");
    try {
      const solvencyValid = await loadAndVerifyProof(proofPath);
      console.log("\n✅ Step 2 - Solvency Verification:", solvencyValid ? "PASSED" : "FAILED");

      if (merkleValid && solvencyValid) {
        console.log("\n🎉 COMPLETE VERIFICATION SUCCESSFUL!");
        console.log("   ✔️ Your balance is in the exchange");
        console.log("   ✔️ Exchange is cryptographically proven to be solvent");
      }
    } catch (error) {
      console.error("Error verifying solvency:", error.message);
    }

    showMainMenu();
  });
}

function showBalances() {
  console.log("\n💰 User Balances:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  users.forEach((user, index) => {
    console.log(`${index + 1}. User ${user.id}: ${user.balance}`);
  });
  const total = users.reduce((sum, u) => sum + u.balance, 0);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Total: ${total}`);
  showMainMenu();
}

console.log("═══════════════════════════════════════════════════");
console.log("    EXCHANGE SOLVENCY & MERKLE PROOF SYSTEM");
console.log("═══════════════════════════════════════════════════\n");

rl.question("Enter number of users: ", (n) => {
  inputUsers(Number(n));
});