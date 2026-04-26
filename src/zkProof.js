const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const { getMerkleRootForCircuit } = require("./merkleIntegration");

const BN254_FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

const CIRCUIT_VARIANTS = [16, 32, 64, 128, 256];
const MAX_USERS = CIRCUIT_VARIANTS[CIRCUIT_VARIANTS.length - 1];

function resolveProofDir(options = {}) {
  const explicitWorkspaceRoot = options.workspaceRoot;
  const explicitProofDir = options.proofDir;
  const envWorkspaceRoot = process.env.ZK_WORKSPACE_ROOT;

  const candidates = [
    explicitProofDir,
    explicitWorkspaceRoot ? path.join(explicitWorkspaceRoot, "proofs") : undefined,
    envWorkspaceRoot ? path.join(envWorkspaceRoot, "proofs") : undefined,
    path.join(process.cwd(), "proofs"),
    path.join(process.cwd(), "..", "proofs"),
    path.join(__dirname, "../proofs"),
  ].filter(Boolean);

  for (const proofDirCandidate of candidates) {
    if (fs.existsSync(proofDirCandidate)) {
      return proofDirCandidate;
    }
  }

  return candidates[0] || path.join(process.cwd(), "proofs");
}

function selectCircuitVariant(userCount) {
  const normalizedCount = Number(userCount);
  if (!Number.isInteger(normalizedCount) || normalizedCount <= 0) {
    throw new Error("User count must be a positive integer");
  }

  return CIRCUIT_VARIANTS.find((variant) => normalizedCount <= variant) ?? MAX_USERS;
}

function normalizeBalances(balances, maxUsers) {
  if (!Array.isArray(balances)) {
    throw new Error("balances must be an array");
  }

  if (balances.length === 0) {
    throw new Error("At least one balance is required");
  }

  if (balances.length > maxUsers) {
    throw new Error(`Circuit supports at most ${maxUsers} users`);
  }

  const normalized = balances.map((b) => {
    const value = BigInt(b);
    if (value < 0n) {
      throw new Error("Balances must be non-negative");
    }
    return value;
  });

  while (normalized.length < maxUsers) {
    normalized.push(0n);
  }

  return normalized;
}

function normalizeMerkleRoot(merkleRoot) {
  const rootStr = String(merkleRoot ?? "0").trim();
  
  if (/^(0x)?[a-fA-F0-9]{64}$/.test(rootStr)) {
    const hex = rootStr.startsWith("0x") ? rootStr : "0x" + rootStr;
    return BigInt(hex).toString();
  }
  
  if (!/^\d+$/.test(rootStr)) {
    throw new Error(`Invalid merkle root format: must be hex string or decimal number, got "${rootStr}"`);
  }
  
  return rootStr;
}

function toFieldElementDecimal(value) {
  const normalized = BigInt(String(value));
  const fieldValue = ((normalized % BN254_FIELD_PRIME) + BN254_FIELD_PRIME) % BN254_FIELD_PRIME;
  return fieldValue.toString();
}

function ensureArtifacts(circuitVariant, options = {}) {
  const proofDir = resolveProofDir(options);
  const wasmPath = path.join(proofDir, `Solvency_${circuitVariant}_js`, "Solvency.wasm");
  const zkeyPath = path.join(proofDir, `Solvency_${circuitVariant}.zkey`);
  const vkeyPath = circuitVariant
    ? path.join(proofDir, `Solvency_${circuitVariant}_vkey.json`)
    : path.join(proofDir, "verification_key.json");

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

function selectDeclaredPublicSignals(publicSignals) {
  if (!Array.isArray(publicSignals) || publicSignals.length < 2) {
    throw new Error("Invalid publicSignals: expected at least reservesPublic and merkleRootPublic");
  }

  return [String(publicSignals[0]), String(publicSignals[1])];
}

async function generateAndProve(balances, reserves, options = {}) {
  const {
    verify = true,
    merkleRoot = "0",
    circuitVariant: requestedCircuitVariant,
    savePath = path.join(resolveProofDir(options), "solvency_proof.json"),
    users = null,
  } = options;

  try {
    const reservesBigInt = BigInt(reserves);
    if (reservesBigInt < 0n) {
      throw new Error("Reserves must be non-negative");
    }

    const circuitVariant = requestedCircuitVariant ?? selectCircuitVariant(balances.length);
    const balancesNormalized = normalizeBalances(balances, circuitVariant);
    const actualUserCount = balances.length;
    const totalLiabilities = balancesNormalized.reduce((a, b) => a + b, 0n);
    const hasExplicitMerkleRoot = String(merkleRoot ?? "").trim() !== "" && String(merkleRoot ?? "").trim() !== "0";
    const canonicalMerkleRoot = Array.isArray(users) && users.length > 0
      ? getMerkleRootForCircuit(users)
      : null;

    let merkleRootForProof = String(merkleRoot ?? "0");
    if (canonicalMerkleRoot) {
      if (hasExplicitMerkleRoot) {
        const providedNormalizedRoot = normalizeMerkleRoot(merkleRootForProof);
        const canonicalNormalizedRoot = normalizeMerkleRoot(canonicalMerkleRoot);

        if (providedNormalizedRoot !== canonicalNormalizedRoot) {
          throw new Error("Provided merkleRoot does not match the Merkle root derived from users");
        }
      }

      merkleRootForProof = canonicalMerkleRoot;
    }

    console.log("\n🔐 Generating Circom zk-SNARK solvency proof...\n");
    console.log("📊 Proof Parameters:");
    console.log(`   Users provided: ${actualUserCount}`);
    console.log(`   Circuit variant: N=${circuitVariant}`);
    console.log(`   Users in circuit: ${circuitVariant} (zero-padded if needed)`);
    console.log(`   Total liabilities (private): ${totalLiabilities.toString()}`);
    console.log(`   Exchange reserves (public): ${reservesBigInt.toString()}`);

    if (totalLiabilities > reservesBigInt) {
      throw new Error("Exchange is insolvent: liabilities exceed reserves");
    }

    const { wasmPath, zkeyPath, vkeyPath } = ensureArtifacts(circuitVariant, options);

    const normalizedMerkleRoot = normalizeMerkleRoot(merkleRootForProof);
    const merkleRootFieldElement = toFieldElementDecimal(normalizedMerkleRoot);
    const input = {
      balances: balancesNormalized.map((b) => b.toString()),
      reserves: reservesBigInt.toString(),
      merkleRoot: merkleRootFieldElement,
    };

    console.log("\n🧠 Step 1: Computing witness + generating PLONK proof...");
    const { proof, publicSignals } = await snarkjs.plonk.fullProve(input, wasmPath, zkeyPath);
    const declaredPublicSignals = selectDeclaredPublicSignals(publicSignals);
    console.log("✅ Proof generated");

    const proofEnvelope = {
      type: "circom-plonk-solvency-proof",
      createdAt: new Date().toISOString(),
      circuitVariant,
      merkleRoot: merkleRootForProof,
      merkleRootPublic: merkleRootFieldElement,
      metadata: {
        maxUsers: circuitVariant,
        usersProvided: actualUserCount,
        reserves: reservesBigInt.toString(),
        variant: circuitVariant,
      },
      proof,
      publicSignals: declaredPublicSignals,
      publicSignalLabels: ["reservesPublic", "merkleRootPublic"],
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
      isValid = await verifyProof(proof, declaredPublicSignals, vkeyPath);
      console.log(isValid ? " Proof verification PASSED" : "Proof verification FAILED");
    }

    return { proof, publicSignals: declaredPublicSignals, isValid, proofEnvelope };
  } catch (error) {
    console.error(" Error in proof generation:", error.message);
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

    const circuitVariant = Number(proofData?.circuitVariant ?? metadata?.variant ?? 0);
    const proofDir = resolveProofDir();
    const vkeyPath = circuitVariant
      ? path.join(proofDir, `Solvency_${circuitVariant}_vkey.json`)
      : path.join(proofDir, "verification_key.json");
    const declaredPublicSignals = selectDeclaredPublicSignals(publicSignals);
    const envelopeMerkleRootRaw = String(proofData?.merkleRootPublic ?? proofData?.merkleRoot ?? "");
    const envelopeMerkleRoot = envelopeMerkleRootRaw ? toFieldElementDecimal(normalizeMerkleRoot(envelopeMerkleRootRaw)) : "";
    const publicMerkleRoot = declaredPublicSignals[1] ?? "";

    console.log("\n Verifying saved Circom proof...");
    if (metadata && metadata.reserves) {
      console.log(`   Public reserves signal: ${metadata.reserves}`);
    }

    if (envelopeMerkleRoot && publicMerkleRoot && envelopeMerkleRoot !== publicMerkleRoot) {
      throw new Error("Proof envelope merkle root does not match the public merkle root signal");
    }

    const isValid = await verifyProof(proof, declaredPublicSignals, vkeyPath);
    console.log(isValid ? " Proof is valid" : " Proof is invalid");
    return isValid;
  } catch (error) {
    console.error(" Error loading/verifying proof:", error.message);
    throw error;
  }
}

module.exports = {
  generateAndProve,
  loadAndVerifyProof,
  verifyProof,
  normalizeBalances,
  selectCircuitVariant,
  CIRCUIT_VARIANTS,
  MAX_USERS
};
