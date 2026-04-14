const fs = require("fs");
const path = require("path");

const PROOFS_DIR = path.join(__dirname, "..", "proofs");
const CIRCUIT_INDEX_PATH = path.join(PROOFS_DIR, "circuit-index.json");

/**
 * Circuit Manager
 * Handles dynamic circuit selection based on user count
 * Manages multi-circuit artifacts (16, 32, 64, 128, 256 user variants)
 */

class CircuitManager {
  constructor() {
    this.index = null;
    this.loadIndex();
  }

  loadIndex() {
    if (!fs.existsSync(CIRCUIT_INDEX_PATH)) {
      throw new Error(
        `Circuit index not found: ${CIRCUIT_INDEX_PATH}\n` +
        "Run 'npm run setup' to generate circuit artifacts"
      );
    }

    this.index = JSON.parse(fs.readFileSync(CIRCUIT_INDEX_PATH, "utf-8"));
  }

  /**
   * Select best circuit variant for user count
   * Returns the circuit size N and artifact information
   */
  selectCircuitForUserCount(userCount) {
    if (!Number.isInteger(userCount) || userCount < 1) {
      throw new Error(`Invalid user count: ${userCount}. Must be positive integer.`);
    }

    const variants = this.index.variants;
    const maxSupported = Math.max(...variants);

    if (userCount > maxSupported) {
      throw new Error(
        `User count ${userCount} exceeds maximum supported: ${maxSupported}\n` +
        `Supported tiers: ${variants.join(", ")}`
      );
    }

    // Select smallest variant that fits
    const selectedN = variants.find((n) => n >= userCount);

    if (!selectedN) {
      throw new Error(`No suitable circuit variant found for ${userCount} users`);
    }

    const padding = selectedN - userCount;
    
    return {
      circuitN: selectedN,
      padding: padding,
      artifacts: this.getCircuitArtifacts(selectedN)
    };
  }

  /**
   * Get full artifact paths for a specific circuit variant
   */
  getCircuitArtifacts(n) {
    if (!this.index.mapping[n]) {
      throw new Error(`Circuit variant N=${n} not found in index`);
    }

    const mapping = this.index.mapping[n];
    const artifacts = {
      r1cs: path.join(PROOFS_DIR, mapping.r1cs),
      wasm: path.join(PROOFS_DIR, mapping.wasm),
      zkey: path.join(PROOFS_DIR, mapping.zkey),
      vkey: path.join(PROOFS_DIR, mapping.vkey)
    };

    // Validate artifacts exist
    const requiredArtifacts = ["wasm", "zkey", "vkey"];
    for (const type of requiredArtifacts) {
      if (!fs.existsSync(artifacts[type])) {
        throw new Error(`Missing circuit artifact: ${artifacts[type]}`);
      }
    }

    return artifacts;
  }

  /**
   * Get list of all supported user counts
   */
  getSupportedUserCounts() {
    return this.index.variants;
  }

  /**
   * Verify all circuits are properly compiled
   */
  ensureCircuitsCompiled() {
    const variants = this.index.variants;
    const missing = [];

    for (const n of variants) {
      try {
        this.getCircuitArtifacts(n);
      } catch (error) {
        missing.push(n);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing circuit artifacts for variants: ${missing.join(", ")}\n` +
        "Run 'npm run setup' to compile circuits"
      );
    }

    return true;
  }

  /**
   * Get circuit index metadata
   */
  getIndex() {
    return this.index;
  }
}

// Singleton instance
let instance = null;

function getCircuitManager() {
  if (!instance) {
    instance = new CircuitManager();
  }
  return instance;
}

module.exports = {
  getCircuitManager,
  CircuitManager
};
