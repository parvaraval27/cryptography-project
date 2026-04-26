import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyProof } from "merkle_tree/src/zkProof.js";
import type { ZkVerifierLogPayload, ZkVerifyRequest, ZkVerifyResponse } from "@/lib/contracts";

export const runtime = "nodejs";

const BN254_FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function normalizeMerkleRoot(merkleRoot: string) {
  const rootStr = String(merkleRoot ?? "").trim();

  if (!rootStr) {
    return "";
  }

  if (/^(0x)?[a-fA-F0-9]{64}$/.test(rootStr)) {
    const hex = rootStr.startsWith("0x") ? rootStr : `0x${rootStr}`;
    return BigInt(hex).toString();
  }

  if (!/^\d+$/.test(rootStr)) {
    throw new Error("Invalid merkle root format");
  }

  return rootStr;
}

function toFieldElementDecimal(value: string) {
  const normalized = BigInt(String(value));
  const fieldValue = ((normalized % BN254_FIELD_PRIME) + BN254_FIELD_PRIME) % BN254_FIELD_PRIME;
  return fieldValue.toString();
}

function resolveVerificationKeyPath(workspaceRoot: string, circuitVariant: number) {
  const variantPath = path.join(workspaceRoot, "proofs", `Solvency_${circuitVariant}_vkey.json`);
  const fallbackPath = path.join(workspaceRoot, "proofs", "verification_key.json");

  if (fs.existsSync(variantPath)) {
    return variantPath;
  }

  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }

  return "";
}

function normalizeHexHash(value: string) {
  return String(value ?? "").trim().toLowerCase().replace(/^0x/, "");
}

function hashLeaf(accountId: string, balance: string) {
  return createHash("sha256").update(`${accountId}:${balance}`).digest("hex");
}

function hashNode(leftHash: string, rightHash: string) {
  return createHash("sha256").update(leftHash + rightHash).digest("hex");
}

function verifyMerkleInclusion(
  accountId: string,
  balance: string,
  proof: Array<{ hash: string; position: "left" | "right" | "self"; siblingSum?: string }>,
  expectedRootHash: string,
  expectedRootSum?: string,
) {
  let currentHash = hashLeaf(accountId, balance);
  let currentSum = BigInt(balance);
  const strictMode = expectedRootSum !== undefined && expectedRootSum !== null && expectedRootSum !== "";

  for (const proofNode of proof) {
    const siblingHash = normalizeHexHash(proofNode.hash);
    if (!siblingHash) {
      return false;
    }

    if (proofNode.position === "right") {
      currentHash = hashNode(currentHash, siblingHash);
      if (strictMode) {
        if (proofNode.siblingSum === undefined) {
          return false;
        }
        currentSum += BigInt(proofNode.siblingSum);
      }
      continue;
    }

    if (proofNode.position === "left") {
      currentHash = hashNode(siblingHash, currentHash);
      if (strictMode) {
        if (proofNode.siblingSum === undefined) {
          return false;
        }
        currentSum += BigInt(proofNode.siblingSum);
      }
      continue;
    }

    if (proofNode.position === "self") {
      currentHash = hashNode(currentHash, currentHash);
      if (strictMode) {
        if (proofNode.siblingSum === undefined) {
          return false;
        }

        const siblingSum = BigInt(proofNode.siblingSum);
        if (siblingSum !== currentSum) {
          return false;
        }
      }
      continue;
    }

    return false;
  }

  if (normalizeHexHash(currentHash) !== normalizeHexHash(expectedRootHash)) {
    return false;
  }

  if (!strictMode) {
    return true;
  }

  return currentSum === BigInt(expectedRootSum);
}

function buildResponse(payload: ZkVerifyResponse, status = 200) {
  return NextResponse.json(payload, { status });
}

function sanitizeVerifierErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Proof verification failed due to an unknown verifier error.";
  }

  const message = String(error.message ?? "").trim();
  if (!message) {
    return "Proof verification failed due to an unknown verifier error.";
  }

  if (message.includes("Cannot read properties") || message.includes("undefined")) {
    return "Proof payload structure is invalid for pairing verification.";
  }

  return message;
}

export async function POST(req: Request) {
  const verifierLog: ZkVerifierLogPayload[] = [];
  const addLog = (label: string, passed: boolean) => {
    verifierLog.push({
      step: verifierLog.length + 1,
      label,
      passed,
    });
  };

  const fail = (
    verificationReasonCode: ZkVerifyResponse["verificationReasonCode"],
    message: string,
    status = 400,
  ) =>
    buildResponse(
      {
        isValid: false,
        verifierPhase: "failed",
        verificationReasonCode,
        message,
        verifierLog,
      },
      status,
    );

  try {
    const body = (await req.json()) as Partial<ZkVerifyRequest>;
    const verificationPayload = body?.verificationPayload;
    const merkleProof = body?.merkleProof ?? null;
    const verifyRootRaw = String(body?.verifyRoot ?? "").trim();
    const verifyAddress = String(body?.verifyAddress ?? "").trim();
    const knownAccounts = Array.isArray(body?.knownAccounts)
      ? body.knownAccounts
          .map((entry) => ({
            accountId: String(entry?.accountId ?? "").trim(),
            balance: String(entry?.balance ?? "").trim(),
          }))
          .filter((entry) => entry.accountId)
      : [];

    addLog("decode verification request payload", true);

    if (!verificationPayload || !verifyRootRaw || !verifyAddress) {
      addLog("validate required inputs (payload, root, address)", false);
      return fail("missing-verification-input", "Verification payload, root, or address is missing.", 400);
    }
    addLog("validate required inputs (payload, root, address)", true);

    const selectedAccount = knownAccounts.find((entry) => entry.accountId === verifyAddress);
    if (!selectedAccount) {
      addLog("validate address exists in active snapshot", false);
      return fail("unknown-address", "Address is not part of the active snapshot.", 400);
    }
    addLog("validate address exists in active snapshot", true);

    if (!/^\d+$/.test(selectedAccount.balance)) {
      addLog("resolve non-negative balance for Merkle leaf verification", false);
      return fail("unknown-account-balance", "Account balance is missing for Merkle verification.", 400);
    }
    addLog("resolve non-negative balance for Merkle leaf verification", true);

    if (!merkleProof) {
      addLog("load Merkle inclusion proof payload", false);
      return fail("missing-merkle-proof", "Merkle proof payload is missing.", 400);
    }
    addLog("load Merkle inclusion proof payload", true);

    if (String(merkleProof.userId ?? "").trim() !== verifyAddress) {
      addLog("validate Merkle proof user matches verifier address", false);
      return fail("merkle-proof-user-mismatch", "Merkle proof user does not match selected address.", 400);
    }
    addLog("validate Merkle proof user matches verifier address", true);

    if (normalizeHexHash(String(merkleProof.rootHash ?? "")) !== normalizeHexHash(verifyRootRaw)) {
      addLog("validate Merkle proof root matches verifier root", false);
      return fail("merkle-proof-root-mismatch", "Merkle proof root does not match verifier root.", 400);
    }
    addLog("validate Merkle proof root matches verifier root", true);

    if (!Array.isArray(merkleProof.proof) || merkleProof.proof.length === 0) {
      addLog("validate Merkle path nodes are present", false);
      return fail("missing-merkle-proof", "Merkle path is missing from proof payload.", 400);
    }
    addLog("validate Merkle path nodes are present", true);

    const merkleValid = verifyMerkleInclusion(
      verifyAddress,
      selectedAccount.balance,
      merkleProof.proof,
      verifyRootRaw,
      merkleProof.rootSum,
    );
    if (!merkleValid) {
      addLog("run full Merkle inclusion verification (hash path + sum checks)", false);
      return fail("merkle-proof-invalid", "Merkle inclusion proof validation failed.", 400);
    }
    addLog("run full Merkle inclusion verification (hash path + sum checks)", true);

    if (
      !Array.isArray(verificationPayload.publicSignals) ||
      !Array.isArray(verificationPayload.publicSignalLabels) ||
      verificationPayload.publicSignals.length === 0 ||
      !verificationPayload.proof
    ) {
      addLog("validate proof payload shape (proof + public signals)", false);
      return fail("malformed-proof-payload", "Proof payload is malformed.", 400);
    }
    addLog("validate proof payload shape (proof + public signals)", true);

    const normalizedInputRoot = toFieldElementDecimal(normalizeMerkleRoot(verifyRootRaw));
    const normalizedPayloadRoot = toFieldElementDecimal(normalizeMerkleRoot(String(verificationPayload.merkleRootPublic ?? "")));

    if (!normalizedPayloadRoot || normalizedInputRoot !== normalizedPayloadRoot) {
      addLog("check Merkle root-link consistency (request root vs payload root)", false);
      return fail("public-root-mismatch", "Input root does not match proof payload root.", 400);
    }
    addLog("check Merkle root-link consistency (request root vs payload root)", true);

    const merkleSignalIndex = verificationPayload.publicSignalLabels.findIndex((label) => label === "merkleRootPublic");
    if (merkleSignalIndex < 0) {
      addLog("locate merkleRootPublic label in public signals", false);
      return fail("malformed-proof-payload", "merkleRootPublic label is missing in public signals.", 400);
    }
    addLog("locate merkleRootPublic label in public signals", true);

    const merkleSignalValue = String(verificationPayload.publicSignals[merkleSignalIndex] ?? "").trim();
    if (!merkleSignalValue || merkleSignalValue !== normalizedPayloadRoot) {
      addLog("compare merkleRootPublic signal value with payload root", false);
      return fail("signal-root-mismatch", "Public signal root does not match proof payload root.", 400);
    }
    addLog("compare merkleRootPublic signal value with payload root", true);

    const workspaceRoot = path.resolve(process.cwd(), "..");
    const vkeyPath = resolveVerificationKeyPath(workspaceRoot, Number(verificationPayload.circuitVariant ?? 0));

    if (!vkeyPath) {
      addLog("resolve verification key for circuit variant", false);
      return fail("missing-verification-key", "Verification key is missing for the selected circuit variant.", 500);
    }
    addLog("resolve verification key for circuit variant", true);

    let valid = false;
    try {
      valid = await verifyProof(
        verificationPayload.proof,
        verificationPayload.publicSignals,
        vkeyPath,
      );
    } catch (pairingError) {
      addLog("run BN254 PLONK pairing verification", false);
      return fail(
        "pairing-check-failed",
        sanitizeVerifierErrorMessage(pairingError),
        200,
      );
    }

    if (!valid) {
      addLog("run BN254 PLONK pairing verification", false);
      return fail("pairing-check-failed", "Pairing equation verification failed.", 200);
    }
    addLog("run BN254 PLONK pairing verification", true);

    return buildResponse({
      isValid: true,
      verifierPhase: "passed",
      verificationReasonCode: "ok",
      message: "Proof verified successfully.",
      verifierLog,
    });
  } catch (error) {
    const message = sanitizeVerifierErrorMessage(error);
    if (verifierLog.length === 0) {
      addLog("decode verification request payload", false);
    }
    return buildResponse(
      {
        isValid: false,
        verifierPhase: "failed",
        verificationReasonCode: "malformed-proof-payload",
        message,
        verifierLog,
      },
      400,
    );
  }
}
