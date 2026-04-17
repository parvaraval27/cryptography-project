import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { verifyProof } from "merkle_tree/src/zkProof.js";
import type { ZkVerifyRequest, ZkVerifyResponse } from "@/lib/contracts";

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

function buildResponse(payload: ZkVerifyResponse, status = 200) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<ZkVerifyRequest>;
    const verificationPayload = body?.verificationPayload;
    const verifyRootRaw = String(body?.verifyRoot ?? "").trim();
    const verifyAddress = String(body?.verifyAddress ?? "").trim();
    const knownAccountIds = Array.isArray(body?.knownAccountIds)
      ? body!.knownAccountIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (!verificationPayload || !verifyRootRaw || !verifyAddress) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "missing-verification-input",
          message: "Verification payload, root, or address is missing.",
          verifierLog: [
            { step: 1, label: "verification payload received", passed: false },
            { step: 2, label: "public root and address checks", passed: false },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        400,
      );
    }

    if (!knownAccountIds.includes(verifyAddress)) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "unknown-address",
          message: "Address is not part of the active snapshot.",
          verifierLog: [
            { step: 1, label: "verification payload received", passed: true },
            { step: 2, label: "public root and address checks", passed: false },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        400,
      );
    }

    if (
      !Array.isArray(verificationPayload.publicSignals) ||
      !Array.isArray(verificationPayload.publicSignalLabels) ||
      verificationPayload.publicSignals.length === 0 ||
      !verificationPayload.proof
    ) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "malformed-proof-payload",
          message: "Proof payload is malformed.",
          verifierLog: [
            { step: 1, label: "verification payload shape", passed: false },
            { step: 2, label: "public root checks", passed: false },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        400,
      );
    }

    const normalizedInputRoot = toFieldElementDecimal(normalizeMerkleRoot(verifyRootRaw));
    const normalizedPayloadRoot = toFieldElementDecimal(normalizeMerkleRoot(String(verificationPayload.merkleRootPublic ?? "")));

    if (!normalizedPayloadRoot || normalizedInputRoot !== normalizedPayloadRoot) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "public-root-mismatch",
          message: "Input root does not match proof payload root.",
          verifierLog: [
            { step: 1, label: "verification payload received", passed: true },
            { step: 2, label: "public root and address checks", passed: false },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        400,
      );
    }

    const merkleSignalIndex = verificationPayload.publicSignalLabels.findIndex((label) => label === "merkleRootPublic");
    if (merkleSignalIndex < 0) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "malformed-proof-payload",
          message: "merkleRootPublic label is missing in public signals.",
          verifierLog: [
            { step: 1, label: "verification payload shape", passed: false },
            { step: 2, label: "public root and address checks", passed: false },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        400,
      );
    }

    const merkleSignalValue = String(verificationPayload.publicSignals[merkleSignalIndex] ?? "").trim();
    if (!merkleSignalValue || merkleSignalValue !== normalizedPayloadRoot) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "signal-root-mismatch",
          message: "Public signal root does not match proof payload root.",
          verifierLog: [
            { step: 1, label: "verification payload received", passed: true },
            { step: 2, label: "public root and address checks", passed: false },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        400,
      );
    }

    const workspaceRoot = path.resolve(process.cwd(), "..");
    const vkeyPath = resolveVerificationKeyPath(workspaceRoot, Number(verificationPayload.circuitVariant ?? 0));

    if (!vkeyPath) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "missing-verification-key",
          message: "Verification key is missing for the selected circuit variant.",
          verifierLog: [
            { step: 1, label: "verification payload received", passed: true },
            { step: 2, label: "public root and address checks", passed: true },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        500,
      );
    }

    const valid = await verifyProof(
      verificationPayload.proof,
      verificationPayload.publicSignals,
      vkeyPath,
    );

    if (!valid) {
      return buildResponse(
        {
          isValid: false,
          verifierPhase: "failed",
          verificationReasonCode: "pairing-check-failed",
          message: "Pairing equation verification failed.",
          verifierLog: [
            { step: 1, label: "verification payload received", passed: true },
            { step: 2, label: "public root and address checks", passed: true },
            { step: 3, label: "pairing equation", passed: false },
          ],
        },
        200,
      );
    }

    return buildResponse({
      isValid: true,
      verifierPhase: "passed",
      verificationReasonCode: "ok",
      message: "Proof verified successfully.",
      verifierLog: [
        { step: 1, label: "verification payload received", passed: true },
        { step: 2, label: "public root and address checks", passed: true },
        { step: 3, label: "pairing equation", passed: true },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown verification error";
    return buildResponse(
      {
        isValid: false,
        verifierPhase: "failed",
        verificationReasonCode: "malformed-proof-payload",
        message,
        verifierLog: [
          { step: 1, label: "verification payload decode", passed: false },
          { step: 2, label: "public root and address checks", passed: false },
          { step: 3, label: "pairing equation", passed: false },
        ],
      },
      400,
    );
  }
}
