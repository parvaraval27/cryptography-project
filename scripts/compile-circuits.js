#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.join(__dirname, "..");
const TEMPLATE_PATH = path.join(ROOT_DIR, "circuits", "Solvency.circom");
const PROOFS_DIR = path.join(ROOT_DIR, "proofs");
const CIRCUITS_DIR = path.join(PROOFS_DIR, "circuits");
const VARIANTS = [16, 32, 64, 128, 256];

function run(command, description) {
  console.log(`- ${description}...`);
  execSync(command, { stdio: "inherit", cwd: ROOT_DIR });
}

function ensureCircomInstalled() {
  try {
    execSync("circom --version", { stdio: "pipe", cwd: ROOT_DIR });
  } catch {
    throw new Error("circom not found. Install with: npm install -g circom");
  }
}

function prepareDirs() {
  fs.mkdirSync(PROOFS_DIR, { recursive: true });
  fs.mkdirSync(CIRCUITS_DIR, { recursive: true });
}

function createVariantSource(n) {
  const template = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const source = template.replace(
    /component\s+main[^\n]*Solvency\(\d+\);/,
    `component main = Solvency(${n});`
  );

  const sourcePath = path.join(CIRCUITS_DIR, `Solvency_${n}.circom`);
  fs.writeFileSync(sourcePath, source);
  return sourcePath;
}

function compileVariants() {
  const compiled = [];
  for (const n of VARIANTS) {
    const sourcePath = createVariantSource(n);
    run(`circom "${sourcePath}" --r1cs --wasm --o "${PROOFS_DIR}"`, `Compile Solvency_${n}`);

    const r1csCandidates = [
      path.join(PROOFS_DIR, "Solvency.r1cs"),
      path.join(PROOFS_DIR, `Solvency_${n}.r1cs`),
      path.join(ROOT_DIR, `Solvency_${n}.r1cs`),
      path.join(ROOT_DIR, "Solvency.r1cs")
    ];
    const wasmCandidates = [
      path.join(PROOFS_DIR, "Solvency_js", "Solvency.wasm"),
      path.join(PROOFS_DIR, `Solvency_${n}_js`, `Solvency_${n}.wasm`),
      path.join(PROOFS_DIR, `Solvency_${n}.wasm`),
      path.join(ROOT_DIR, `Solvency_${n}.wasm`),
      path.join(ROOT_DIR, "Solvency.wasm")
    ];

    const sourceR1cs = r1csCandidates.find((p) => fs.existsSync(p));
    const sourceWasm = wasmCandidates.find((p) => fs.existsSync(p));

    const targetR1cs = path.join(PROOFS_DIR, `Solvency_${n}.r1cs`);
    const targetWasmDir = path.join(PROOFS_DIR, `Solvency_${n}_js`);
    const targetWasm = path.join(targetWasmDir, "Solvency.wasm");

    if (!sourceR1cs || !sourceWasm) {
      throw new Error(`Compilation output missing for variant ${n}`);
    }

    if (sourceR1cs !== targetR1cs) {
      if (fs.existsSync(targetR1cs)) {
        fs.rmSync(targetR1cs, { force: true });
      }
      fs.copyFileSync(sourceR1cs, targetR1cs);
    }

    if (fs.existsSync(targetWasmDir)) {
      fs.rmSync(targetWasmDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetWasmDir, { recursive: true });
    if (sourceWasm !== targetWasm) {
      fs.copyFileSync(sourceWasm, targetWasm);
    }

    // Cleanup transient/legacy outputs to avoid cross-variant confusion.
    const cleanupPaths = [
      path.join(PROOFS_DIR, "Solvency.r1cs"),
      path.join(PROOFS_DIR, "Solvency_js"),
      path.join(ROOT_DIR, `Solvency_${n}.r1cs`),
      path.join(ROOT_DIR, `Solvency_${n}.wasm`),
      path.join(ROOT_DIR, "Solvency.r1cs"),
      path.join(ROOT_DIR, "Solvency.wasm")
    ];
    for (const p of cleanupPaths) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.rmSync(p, { force: true });
        }
      }
    }

    compiled.push(n);
  }
  return compiled;
}

function generateIndex(compiled) {
  const index = {
    variants: compiled,
    default: compiled[0],
    mapping: {}
  };

  for (const n of compiled) {
    index.mapping[n] = {
      r1cs: `Solvency_${n}.r1cs`,
      wasm: path.join(`Solvency_${n}_js`, "Solvency.wasm"),
      zkey: `Solvency_${n}.zkey`,
      vkey: `Solvency_${n}_vkey.json`
    };
  }

  const indexPath = path.join(PROOFS_DIR, "circuit-index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`Created: ${indexPath}`);
}

function verifyArtifacts(compiled) {
  for (const n of compiled) {
    const r1cs = path.join(PROOFS_DIR, `Solvency_${n}.r1cs`);
    const wasm = path.join(PROOFS_DIR, `Solvency_${n}_js`, "Solvency.wasm");
    if (!fs.existsSync(r1cs)) throw new Error(`Missing artifact: ${r1cs}`);
    if (!fs.existsSync(wasm)) throw new Error(`Missing artifact: ${wasm}`);
  }
}

function main() {
  console.log("=== Compile Multi-Variant Circuits ===");
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Circuit template not found: ${TEMPLATE_PATH}`);
  }
  ensureCircomInstalled();
  prepareDirs();
  const compiled = compileVariants();
  verifyArtifacts(compiled);
  generateIndex(compiled);
  console.log(`Done. Compiled variants: ${compiled.join(", ")}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
