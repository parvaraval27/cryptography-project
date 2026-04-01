#!/usr/bin/env node

/**
 * Circuit Setup Script
 * 
 * This script automates:
 * 1. Circuit compilation
 * 2. Powers of Tau download
 * 3. Proving key generation
 * 4. Verification key export
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROOFS_DIR = path.join(__dirname, "proofs");
const CIRCUITS_DIR = path.join(__dirname, "circuits");

console.log("═══════════════════════════════════════════════════");
console.log("   ZK-SNARK SOLVENCY PROOF - CIRCUIT SETUP");
console.log("═══════════════════════════════════════════════════\n");

// Helper function to run shell commands
function run(command, description) {
  console.log(`ℹ️  ${description}...`);
  try {
    execSync(command, { stdio: "inherit", cwd: __dirname });
    console.log(`✅ ${description} completed\n`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} failed`);
    console.error(`   Error: ${error.message}\n`);
    return false;
  }
}

async function setupCircuit() {
  console.log("🔧 STEP 1: Verify Prerequisites\n");

  // Check if circom is installed
  try {
    execSync("circom --version", { stdio: "pipe" });
    console.log("✅ circom is installed\n");
  } catch {
    console.error("❌ circom not found. Install with:");
    console.error("   npm install -g circom");
    console.error("   or see SETUP.md for more details\n");
    process.exit(1);
  }

  // Check if snarkjs is installed locally
  if (!fs.existsSync(path.join(__dirname, "node_modules/snarkjs"))) {
    console.log("📦 Installing dependencies...");
    run("npm install", "Install Node dependencies");
  } else {
    console.log("✅ Dependencies already installed\n");
  }

  console.log("🔧 STEP 2: Compile Circuit\n");

  // Check if circuit exists
  const circuitPath = path.join(CIRCUITS_DIR, "Solvency.circom");
  if (!fs.existsSync(circuitPath)) {
    console.error(`❌ Circuit not found at ${circuitPath}`);
    process.exit(1);
  }

  if (!run(`circom ${circuitPath} --r1cs --wasm --o ${PROOFS_DIR}`, "Compile circuit")) {
    process.exit(1);
  }

  console.log("🔧 STEP 3: Verify Compiled Artifacts\n");

  const r1csPath = path.join(PROOFS_DIR, "Solvency.r1cs");
  const wasmPath = path.join(PROOFS_DIR, "Solvency_js/Solvency.wasm");

  if (!fs.existsSync(r1csPath)) {
    console.error(`❌ R1CS file not found: ${r1csPath}`);
    process.exit(1);
  }
  console.log(`✅ R1CS created: ${r1csPath}`);

  if (!fs.existsSync(wasmPath)) {
    console.error(`❌ WASM file not found: ${wasmPath}`);
    process.exit(1);
  }
  console.log(`✅ WASM created: ${wasmPath}\n`);

  console.log("🔧 STEP 4: Powers of Tau Setup\n");

  const ptauPath = path.join(PROOFS_DIR, "pot14_final.ptau");

  if (!fs.existsSync(ptauPath)) {
    console.log("⚠️  Powers of Tau file not found.");
    console.log("📥  Downloading ptau file (this may take a few minutes)...\n");

    // Try curl first, then wget
    let downloadCmd;
    try {
      execSync("curl --version", { stdio: "pipe" });
      downloadCmd = `curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau -o ${ptauPath}`;
    } catch {
      try {
        execSync("wget --version", { stdio: "pipe" });
        downloadCmd = `wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau -O ${ptauPath}`;
      } catch {
        console.error("❌ Neither curl nor wget found. Please install one of them.\n");
        console.error("   Alternatively, download manually from:");
        console.error("   https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau\n");
        console.error('   Then place it in the "proofs" directory.\n');
        process.exit(1);
      }
    }

    if (!run(downloadCmd, "Download Powers of Tau file (2.5 GB)")) {
      console.error("   Try downloading manually or check your internet connection.\n");
      process.exit(1);
    }
  } else {
    console.log(`✅ Powers of Tau already available: ${ptauPath}\n`);
  }

  console.log("🔧 STEP 5: Generate Proving and Verification Keys\n");

  const zkeyPath = path.join(PROOFS_DIR, "Solvency_final.zkey");
  const vkeyPath = path.join(PROOFS_DIR, "verification_key.json");

  // Generate proving key
  if (!fs.existsSync(zkeyPath)) {
    if (!run(
      `snarkjs plonk setup ${r1csPath} ${ptauPath} ${zkeyPath}`,
      "Generate proving key (this may take a minute)"
    )) {
      process.exit(1);
    }
  } else {
    console.log(`✅ Proving key already exists: ${zkeyPath}\n`);
  }

  // Export verification key
  if (!fs.existsSync(vkeyPath)) {
    if (!run(
      `snarkjs zkey export verificationkey ${zkeyPath} ${vkeyPath}`,
      "Export verification key"
    )) {
      process.exit(1);
    }
  } else {
    console.log(`✅ Verification key already exists: ${vkeyPath}\n`);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("         ✅ SETUP COMPLETED SUCCESSFULLY!");
  console.log("═══════════════════════════════════════════════════\n");

  console.log("✨ You can now run the application:\n");
  console.log("   node src/index.js\n");

  console.log("📋 Next Steps:\n");
  console.log("   1. Run the application with: node src/index.js");
  console.log("   2. Choose mode 2️⃣ to generate a solvency proof");
  console.log("   3. Choose mode 4️⃣ to verify the proof\n");

  console.log("📚 For more details, see SETUP.md\n");
}

// Run setup
setupCircuit().catch((error) => {
  console.error("❌ Unexpected error:", error);
  process.exit(1);
});
