#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = __dirname;
const PROOFS_DIR = path.join(ROOT_DIR, "proofs");
const CIRCUITS_DIR = path.join(ROOT_DIR, "circuits");
const SCRIPTS_DIR = path.join(ROOT_DIR, "scripts");
const CIRCUIT_INDEX_PATH = path.join(PROOFS_DIR, "circuit-index.json");
const DEFAULT_PTAU_POWER = Number(process.env.PTAU_POWER || 16);

function run(command, description) {
  console.log(`- ${description}...`);
  try {
    execSync(command, { stdio: "inherit", cwd: ROOT_DIR });
    return true;
  } catch (error) {
    console.error(`Failed: ${description}`);
    console.error(error.message);
    return false;
  }
}

function isValidPtau(ptauPath) {
  if (!fs.existsSync(ptauPath)) return false;
  try {
    execSync(`snarkjs powersoftau verify "${ptauPath}"`, { stdio: "pipe", cwd: ROOT_DIR });
    return true;
  } catch {
    return false;
  }
}

function ensurePrerequisites() {
  try {
    execSync("circom --version", { stdio: "pipe" });
  } catch {
    throw new Error("circom not found. Install with: npm install -g circom");
  }

  if (!fs.existsSync(path.join(ROOT_DIR, "node_modules", "snarkjs"))) {
    if (!run("npm install", "Install Node dependencies")) {
      throw new Error("Unable to install dependencies");
    }
  }
}

function compileCircuits() {
  const circuitPath = path.join(CIRCUITS_DIR, "Solvency.circom");
  const compileScriptPath = path.join(SCRIPTS_DIR, "compile-circuits.js");

  if (!fs.existsSync(circuitPath)) {
    throw new Error(`Circuit template not found: ${circuitPath}`);
  }
  if (!fs.existsSync(compileScriptPath)) {
    throw new Error(`Compilation script not found: ${compileScriptPath}`);
  }

  if (!run(`node "${compileScriptPath}"`, "Compile multi-variant circuits")) {
    throw new Error("Circuit compilation failed");
  }

  if (!fs.existsSync(CIRCUIT_INDEX_PATH)) {
    throw new Error(`Circuit index not generated: ${CIRCUIT_INDEX_PATH}`);
  }

  return JSON.parse(fs.readFileSync(CIRCUIT_INDEX_PATH, "utf-8"));
}

function ensurePtau() {
  if (!Number.isInteger(DEFAULT_PTAU_POWER) || DEFAULT_PTAU_POWER < 14) {
    throw new Error("PTAU_POWER must be an integer >= 14");
  }

  const ptauPath = path.join(PROOFS_DIR, `pot${DEFAULT_PTAU_POWER}_final.ptau`);

  if (isValidPtau(ptauPath)) return ptauPath;

  if (fs.existsSync(ptauPath)) {
    fs.rmSync(ptauPath, { force: true });
  }

  let downloadCmd = null;
  // Public hosted ptau URL is commonly available for power 14. For larger powers,
  // generate locally by default so high-tier circuits (128/256) can be supported.
  if (DEFAULT_PTAU_POWER === 14) {
    try {
      execSync("curl --version", { stdio: "pipe" });
      downloadCmd = `curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau -o "${ptauPath}"`;
    } catch {
      try {
        execSync("wget --version", { stdio: "pipe" });
        downloadCmd = `wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau -O "${ptauPath}"`;
      } catch {
        downloadCmd = null;
      }
    }
  }

  if (downloadCmd) {
    run(downloadCmd, "Download Powers of Tau file");
  }

  if (isValidPtau(ptauPath)) return ptauPath;

  const ptau0 = path.join(PROOFS_DIR, `pot${DEFAULT_PTAU_POWER}_0000.ptau`);
  const ptau1 = path.join(PROOFS_DIR, `pot${DEFAULT_PTAU_POWER}_0001.ptau`);

  if (!run(`snarkjs powersoftau new bn128 ${DEFAULT_PTAU_POWER} "${ptau0}" -v`, `Generate initial ptau (power ${DEFAULT_PTAU_POWER})`)) {
    throw new Error("Failed to create initial ptau");
  }
  if (!run(`snarkjs powersoftau contribute "${ptau0}" "${ptau1}" --name="Local contribution" -v -e="entropy-for-local-setup"`, "Contribute entropy")) {
    throw new Error("Failed to contribute entropy");
  }
  if (!run(`snarkjs powersoftau prepare phase2 "${ptau1}" "${ptauPath}" -v`, "Prepare phase2 ptau")) {
    throw new Error("Failed to prepare phase2 ptau");
  }

  fs.rmSync(ptau0, { force: true });
  fs.rmSync(ptau1, { force: true });
  return ptauPath;
}

function generateKeys(circuitIndex, ptauPath) {
  const readyVariants = [];
  const failedVariants = [];

  for (const N of circuitIndex.variants) {
    const map = circuitIndex.mapping[N];
    const r1csPath = path.join(PROOFS_DIR, map.r1cs);
    const zkeyPath = path.join(PROOFS_DIR, map.zkey);
    const vkeyPath = path.join(PROOFS_DIR, map.vkey);

    if (!fs.existsSync(r1csPath)) {
      console.log(`Skipping N=${N}: missing R1CS`);
      failedVariants.push(N);
      continue;
    }

    const tryGenerateZkey = () =>
      run(
        `snarkjs plonk setup "${r1csPath}" "${ptauPath}" "${zkeyPath}"`,
        `Generate proving key for N=${N}`
      );

    const tryExportVkey = () =>
      run(
        `snarkjs zkey export verificationkey "${zkeyPath}" "${vkeyPath}"`,
        `Export verification key for N=${N}`
      );

    const hasZkey = fs.existsSync(zkeyPath);
    const hasVkey = fs.existsSync(vkeyPath);
    const r1csMtimeMs = fs.statSync(r1csPath).mtimeMs;
    const zkeyMtimeMs = hasZkey ? fs.statSync(zkeyPath).mtimeMs : 0;
    const vkeyMtimeMs = hasVkey ? fs.statSync(vkeyPath).mtimeMs : 0;

    // Rebuild keys whenever the circuit was recompiled after key generation.
    const needsFreshZkey = !hasZkey || zkeyMtimeMs < r1csMtimeMs;
    const needsFreshVkey = !hasVkey || vkeyMtimeMs < zkeyMtimeMs || needsFreshZkey;

    if (needsFreshZkey) {
      if (hasZkey) {
        fs.rmSync(zkeyPath, { force: true });
      }
      if (fs.existsSync(vkeyPath)) {
        fs.rmSync(vkeyPath, { force: true });
      }
      if (!tryGenerateZkey()) {
        failedVariants.push(N);
        continue;
      }
    }

    if (needsFreshVkey) {
      if (fs.existsSync(vkeyPath)) {
        fs.rmSync(vkeyPath, { force: true });
      }
      if (!tryExportVkey()) {
        failedVariants.push(N);
        continue;
      }
    }

    readyVariants.push(N);
  }

  if (readyVariants.length === 0) {
    throw new Error("No proving/verification keys were generated");
  }

  return { readyVariants, failedVariants };
}

async function main() {
  console.log("=== ZK Solvency Multi-Circuit Setup ===");
  ensurePrerequisites();
  const circuitIndex = compileCircuits();
  const ptauPath = ensurePtau();
  const { readyVariants, failedVariants } = generateKeys(circuitIndex, ptauPath);

  // Persist only ready variants so runtime selection cannot pick unsupported tiers.
  const filteredIndex = {
    variants: readyVariants,
    default: readyVariants[0],
    mapping: {}
  };
  for (const N of readyVariants) {
    filteredIndex.mapping[N] = circuitIndex.mapping[N];
  }
  fs.writeFileSync(CIRCUIT_INDEX_PATH, JSON.stringify(filteredIndex, null, 2));

  console.log("Setup completed successfully.");
  console.log(`Circuit variants ready: ${readyVariants.join(", ")}`);
  if (failedVariants.length > 0) {
    console.log(`Skipped variants (ptau too small or keygen failed): ${failedVariants.join(", ")}`);
  }
  console.log("Run: npm start");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
