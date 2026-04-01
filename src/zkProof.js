const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");

const MAX_USERS = 16;

function normalizeBalances(balances) {
  if (!Array.isArray(balances)) {
    throw new Error("balances must be an array");
  }

  if (balances.length === 0) {
    throw new Error("At least one balance is required");
  }

  if (balances.length > MAX_USERS) {
    throw new Error(`Circuit supports at most ${MAX_USERS} users`);
  }

  const normalized = balances.map((b) => {
    const value = BigInt(b);
    if (value < 0n) {
      throw new Error("Balances must be non-negative");
    }
    return value;
  });

  while (normalized.length < MAX_USERS) {
    normalized.push(0n);
  }

  return normalized;
}

function ensureArtifacts() {
  const wasmPath = path.join(__dirname, "../proofs/Solvency_js/Solvency.wasm");
  const zkeyPath = path.join(__dirname, "../proofs/Solvency_final.zkey");
  const vkeyPath = path.join(__dirname, "../proofs/verification_key.json");

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Missing circuit artifact: ${wasmPath}. Run npm run setup first.`);
  }

  if (!fs.existsSync(zkeyPath)) {
    throw new Error(`Missing proving key: ${zkeyPath}. Run npm run setup first.`);
  }

  if (!fs.existsSync(vkeyPath)) {
    throw new Error(`Missing verification key: ${vkeyPath}. Run npm run setup first.`);
  }

  return { wasmPath, zkeyPath, vkeyPath };
}

async function verifyProof(proof, publicSignals, verificationKeyPath) {
  const verificationKey = JSON.parse(fs.readFileSync(verificationKeyPath, "utf-8"));
  return snarkjs.plonk.verify(verificationKey, publicSignals, proof);
}

async function generateAndProve(balances, reserves, options = {}) {
  const {
    verify = true,
    savePath = path.join(__dirname, "../proofs/solvency_proof.json")
  } = options;

  try {
    const reservesBigInt = BigInt(reserves);
    if (reservesBigInt < 0n) {
      throw new Error("Reserves must be non-negative");
    }

    const balancesNormalized = normalizeBalances(balances);
    const actualUserCount = balances.length;
    const totalLiabilities = balancesNormalized.reduce((a, b) => a + b, 0n);

    console.log("\n🔐 Generating Circom zk-SNARK solvency proof...\n");
    console.log("📊 Proof Parameters:");
    console.log(`   Users provided: ${actualUserCount}`);
    console.log(`   Users in circuit: ${MAX_USERS} (zero-padded if needed)`);
    console.log(`   Total liabilities (private): ${totalLiabilities.toString()}`);
    console.log(`   Exchange reserves (public): ${reservesBigInt.toString()}`);

    if (totalLiabilities > reservesBigInt) {
      throw new Error("Exchange is insolvent: liabilities exceed reserves");
    }

    const { wasmPath, zkeyPath, vkeyPath } = ensureArtifacts();

    const input = {
      balances: balancesNormalized.map((b) => b.toString()),
      reserves: reservesBigInt.toString()
    };

    console.log("\n🧠 Step 1: Computing witness + generating PLONK proof...");
    const { proof, publicSignals } = await snarkjs.plonk.fullProve(input, wasmPath, zkeyPath);
    console.log("✅ Proof generated");

    const proofEnvelope = {
      type: "circom-plonk-solvency-proof",
      createdAt: new Date().toISOString(),
      metadata: {
        maxUsers: MAX_USERS,
        usersProvided: actualUserCount,
        reserves: reservesBigInt.toString()
      },
      proof,
      publicSignals
    };

    const proofDir = path.dirname(savePath);
    if (!fs.existsSync(proofDir)) {
      fs.mkdirSync(proofDir, { recursive: true });
    }

    fs.writeFileSync(savePath, JSON.stringify(proofEnvelope, null, 2));
    console.log(`💾 Proof saved to ${savePath}`);

    let isValid = null;
    if (verify) {
      console.log("\n✔️ Step 2: Verifying proof against verification key...");
      isValid = await verifyProof(proof, publicSignals, vkeyPath);
      console.log(isValid ? "✅ Proof verification PASSED" : "❌ Proof verification FAILED");
    }

    return { proof, publicSignals, isValid };
  } catch (error) {
    console.error("❌ Error in proof generation:", error.message);
    throw error;
  }
}

async function loadAndVerifyProof(proofPath) {
  try {
    if (!fs.existsSync(proofPath)) {
      throw new Error(`Proof file not found: ${proofPath}`);
    }

    const proofData = JSON.parse(fs.readFileSync(proofPath, "utf-8"));
    const { proof, publicSignals, metadata } = proofData;

    if (!proof || !publicSignals) {
      throw new Error("Invalid proof file format: missing proof/publicSignals");
    }

    const vkeyPath = path.join(__dirname, "../proofs/verification_key.json");

    console.log("\n🔍 Verifying saved Circom proof...");
    if (metadata && metadata.reserves) {
      console.log(`   Public reserves signal: ${metadata.reserves}`);
    }

    const isValid = await verifyProof(proof, publicSignals, vkeyPath);
    console.log(isValid ? "✅ Proof is valid" : "❌ Proof is invalid");
    return isValid;
  } catch (error) {
    console.error("❌ Error loading/verifying proof:", error.message);
    throw error;
  }
}

module.exports = {
  generateAndProve,
  loadAndVerifyProof,
  verifyProof,
  normalizeBalances,
  MAX_USERS
};
