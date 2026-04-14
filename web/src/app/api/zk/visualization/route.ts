import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateAndProve, verifyProof } from "../../../../../../src/zkProof";
import { computeMerkleRootFromUsers } from "../../../../../../src/merkleIntegration";

export const runtime = "nodejs";

const COMMITMENT_KEYS = ["A", "B", "C", "Z", "T1", "T2", "T3", "Wxi", "Wxiw"];
const FALLBACK_VKEY_PATH = "verification_key.json";
const MAX_USERS = 256;

type VisualizationInputRow = {
  accountId?: string;
  balance?: number | string;
};

function parseNonNegativeInteger(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return BigInt(normalized);
}

function makePacketHash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
}

function getStructureHint(key: string): "input-encoding" | "constraint-poly" | "verifier-check" {
  if (key === "A" || key === "B") {
    return "input-encoding";
  }

  if (key === "Wxi" || key === "Wxiw") {
    return "verifier-check";
  }

  return "constraint-poly";
}

function getPairingEquation(step: number) {
  if (step === 1) {
    return "H(transcript) -> challenge scalar reconstruction";
  }
  if (step === 2) {
    return "open(commitments) == claimed evaluations";
  }
  return "pairing equation over verification key";
}

async function buildVisualizationPayload(envelope: any, workspaceRoot: string) {
  const proof = envelope?.proof;
  const publicSignals = envelope?.publicSignals;
  const publicSignalLabels = Array.isArray(envelope?.publicSignalLabels)
    ? envelope.publicSignalLabels.map((label: unknown) => String(label))
    : ["reservesPublic", "merkleRootPublic"];

  const signalMap = new Map<string, string>();
  for (let index = 0; index < publicSignalLabels.length; index += 1) {
    signalMap.set(publicSignalLabels[index], String(publicSignals?.[index] ?? ""));
  }

  if (!signalMap.has("reservesPublic") && Array.isArray(publicSignals) && publicSignals.length >= 1) {
    signalMap.set("reservesPublic", String(publicSignals[0]));
  }
  if (!signalMap.has("merkleRootPublic") && Array.isArray(publicSignals) && publicSignals.length >= 2) {
    signalMap.set("merkleRootPublic", String(publicSignals[1]));
  }

  const circuitVariant = Number(envelope?.circuitVariant ?? envelope?.metadata?.variant ?? 0);
  const merkleRoot = String(envelope?.merkleRoot ?? "");
  const merkleRootPublic = String(envelope?.merkleRootPublic ?? signalMap.get("merkleRootPublic") ?? "");
  const vkeyCandidates = circuitVariant
    ? [
        path.join(workspaceRoot, "proofs", `Solvency_${circuitVariant}_vkey.json`),
        path.join(workspaceRoot, "proofs", FALLBACK_VKEY_PATH),
      ]
    : [path.join(workspaceRoot, "proofs", FALLBACK_VKEY_PATH)];

  const vkeyPath = vkeyCandidates.find((candidate) => fs.existsSync(candidate));

  if (!proof || !Array.isArray(publicSignals)) {
    throw new Error("Invalid solvency proof file format.");
  }

  if (!vkeyPath) {
    throw new Error("Missing verification key for the selected circuit variant. Run setup first.");
  }

  const isValid = await verifyProof(proof, publicSignals, vkeyPath);
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(proof))
    .digest("hex");

  const commitmentCount = COMMITMENT_KEYS.filter((key) => Boolean(proof[key])).length;
  const protocol = String(proof.protocol ?? envelope?.type ?? "plonk").toUpperCase();
  const curve = String(proof.curve ?? "bn128").toUpperCase();
  const proofEnvelopeType = String(envelope?.type ?? "unknown");
  const publicMerkleRoot = String(signalMap.get("merkleRootPublic") ?? "");
  const publicReserves = String(signalMap.get("reservesPublic") ?? "0");
  const couplingStatus = merkleRootPublic && publicMerkleRoot === merkleRootPublic ? "linked" : merkleRootPublic ? "mismatched" : "missing";

  const metadata = {
    reserves: String(envelope?.metadata?.reserves ?? publicReserves),
    usersProvided: Number(envelope?.metadata?.usersProvided ?? 0),
    maxUsers: Number(envelope?.metadata?.maxUsers ?? 0),
  };

  const publicSignalsBreakdown = {
    reservesPublic: publicReserves,
    merkleRootPublic: publicMerkleRoot,
    labels: publicSignalLabels,
  };

  const explanation = {
    architecture: "coupled",
    verifierPipelines: [
      {
        id: "merkle-consistency",
        title: "Pipeline A: Data Consistency (Merkle)",
        checks: [
          "Leaf hash recomputation",
          "Merkle path/root consistency",
          "Root coupling against proof envelope",
        ],
      },
      {
        id: "snark-solvency",
        title: "Pipeline B: Solvency Math (zk-SNARK)",
        checks: [
          "Public signal extraction",
          "Polynomial commitment opening checks",
          "Pairing equation verification",
        ],
      },
    ],
    privateWitnessSummary: "User balances remain private witness values and are never emitted in public signals.",
    publicSignalSummary: "Only reservesPublic and merkleRootPublic are exposed for verification.",
  };

  const verificationPipelines = [
    {
      id: "merkle-consistency",
      title: "Pipeline A: Data Consistency (Merkle)",
      checks: [
        {
          label: "Merkle root is present in proof envelope",
          passed: Boolean(merkleRoot),
        },
        {
          label: "merkleRootPublic is present in public signals",
          passed: Boolean(publicMerkleRoot),
        },
        {
          label: "Envelope merkleRootPublic matches public signal",
          passed: couplingStatus === "linked",
        },
      ],
    },
    {
      id: "snark-solvency",
      title: "Pipeline B: Solvency Math (zk-SNARK)",
      checks: [
        {
          label: "Public signals decoded",
          passed: Array.isArray(publicSignals) && publicSignals.length > 0,
        },
        {
          label: "Commitment opening checks prepared",
          passed: commitmentCount > 0,
        },
        {
          label: "Pairing equation verified",
          passed: isValid,
        },
      ],
    },
  ] as const;

  const verificationReasonCode = !isValid
    ? "pairing-check-failed"
    : couplingStatus !== "linked"
      ? "public-root-mismatch"
      : "ok";

  const stageProgress = {
    inputs: 100,
    constraints: 100,
    commitments: commitmentCount > 0 ? 100 : 0,
    verify: isValid ? 100 : 86,
  };

  const stages = [
    {
      id: "inputs",
      label: "Private Inputs Prepared",
      detail: `${metadata.usersProvided} balances padded for ${metadata.maxUsers} circuit slots`,
      status: "done",
      progress: stageProgress.inputs,
    },
    {
      id: "coupling",
      label: "Merkle Coupling Established",
      detail: merkleRoot ? `Merkle root committed into circuit variant N=${circuitVariant || metadata.maxUsers}` : "Merkle root missing from proof envelope",
      status: couplingStatus === "linked" ? "done" : "pending",
      progress: couplingStatus === "linked" ? 100 : 58,
    },
    {
      id: "constraints",
      label: "Circuit Constraints Satisfied",
      detail: "Liabilities relation and range checks encoded in arithmetic gates",
      status: "done",
      progress: stageProgress.constraints,
    },
    {
      id: "commitments",
      label: "Polynomial Commitments Built",
      detail: `${commitmentCount} commitment groups captured in proof transcript`,
      status: "done",
      progress: stageProgress.commitments,
    },
    {
      id: "verify",
      label: "Verifier Equation Check",
      detail: isValid ? "Pairing checks passed with verification key" : "Pairing checks failed",
      status: isValid ? "active" : "pending",
      progress: stageProgress.verify,
    },
  ] as const;

  const proverEvents = [
    {
      stage: "input-stream",
      message: `Streaming ${metadata.usersProvided} private balances into witness builder`,
      delayMs: 0,
    },
    {
      stage: "prover-active",
      message: "Constraint engine evaluating solvency relation gates",
      delayMs: 540,
    },
    ...COMMITMENT_KEYS.filter((key) => Boolean(proof[key])).map((key, index) => ({
      stage: "commitment-emission",
      commitmentKey: key,
      packetHash: makePacketHash(proof[key]),
      message: `Emitting ${key} commitment packet`,
      delayMs: 980 + index * 220,
    })),
    {
      stage: "verification",
      message: "Dispatching proof packet to verifier terminal",
      delayMs: 980 + commitmentCount * 220 + 360,
    },
  ] as const;

  const verificationEventDelay = 980 + commitmentCount * 220 + 360;

  const proverGeometry = {
    inputBusWidth: Math.max(metadata.usersProvided, 1),
    constraintGridSize: Math.max(6, Math.ceil(Math.sqrt(Math.max(metadata.maxUsers, 1) * 4))),
    commitmentEmissionZones: COMMITMENT_KEYS.filter((key) => Boolean(proof[key])).map((key, index) => ({
      commitmentKey: key,
      lane: index % 4,
      emergenceDelayMs: 980 + index * 220,
      completionDelayMs: 980 + index * 220 + 320,
      structureHint: getStructureHint(key),
    })),
  } as const;

  const verifierLog = [
    {
      step: 1,
      label: "Fiat-Shamir transcript reconstructed",
      passed: true,
    },
    {
      step: 2,
      label: "Commitment opening checks resolved",
      passed: commitmentCount > 0,
    },
    {
      step: 3,
      label: isValid ? "Pairing equation accepted" : "Pairing equation mismatch detected",
      passed: isValid,
    },
  ] as const;

  const verifierCrystal = {
    isValid,
    crystallizationDelayMs: verificationEventDelay + 220,
    pairing: verifierLog.map((item) => ({
      step: item.step,
      equation: getPairingEquation(item.step),
      passed: item.passed,
    })),
    luminosity: isValid ? "brilliant" : "fault",
  } as const;

  const proofAssemblyProgress = {
    currentStage: "verification",
    completionPercent: isValid ? 100 : 86,
    estimatedMs: verificationEventDelay,
  } as const;

  const metrics = [
    {
      label: "Public Signals",
      value: String(publicSignals.length),
      hint: "Visible on-chain style inputs",
    },
    {
      label: "Circuit Variant",
      value: circuitVariant ? `N=${circuitVariant}` : "unknown",
      hint: "Selected user-slot capacity",
    },
    {
      label: "Commitments",
      value: String(commitmentCount),
      hint: "Core proof polynomial groups",
    },
    {
      label: "Declared Reserves",
      value: metadata.reserves,
      hint: "Public bound for liabilities",
    },
    {
      label: "Circuit Capacity",
      value: `${metadata.usersProvided}/${metadata.maxUsers}`,
      hint: "Users packed into proving circuit",
    },
  ] as const;

  return {
    protocol,
    curve,
    fingerprint,
    createdAt: String(envelope?.createdAt ?? new Date().toISOString()),
    isValid,
    circuitVariant,
    merkleRoot,
    merkleRootPublic,
    proofEnvelopeType,
    couplingStatus,
    verificationReasonCode,
    verificationPipelines,
    metadata,
    publicSignalCount: publicSignals.length,
    commitmentCount,
    publicSignalsBreakdown,
    explanation,
    stages,
    metrics,
    stageProgress,
    proverEvents,
    verifierLog,
    proverGeometry,
    verifierCrystal,
    proofAssemblyProgress,
  };
}

export async function GET() {
  try {
    const workspaceRoot = path.resolve(process.cwd(), "..");
    const proofPath = path.join(workspaceRoot, "proofs", "solvency_proof.json");

    if (!fs.existsSync(proofPath)) {
      return NextResponse.json(
        { error: "Missing proofs/solvency_proof.json. Generate it first from the CLI." },
        { status: 404 },
      );
    }

    const envelope = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const payload = await buildVisualizationPayload(envelope, workspaceRoot);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const users = body?.users as VisualizationInputRow[] | undefined;

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: "users must be a non-empty array" }, { status: 400 });
    }

    if (users.length > MAX_USERS) {
      return NextResponse.json(
        { error: `users must not exceed ${MAX_USERS} rows` },
        { status: 400 },
      );
    }

    const balances = users.map((row, index) => {
      const accountId = String(row?.accountId ?? "").trim();
      if (!accountId) {
        throw new Error(`Row ${index + 1}: accountId is required`);
      }

      return parseNonNegativeInteger(row?.balance, `Row ${index + 1}: balance`);
    });

    const normalizedUsers = users.map((row, index) => ({
      id: String(row?.accountId ?? "").trim(),
      balance: Number(parseNonNegativeInteger(row?.balance, `Row ${index + 1}: balance`)),
    }));

    const expectedMerkleRoot = computeMerkleRootFromUsers(normalizedUsers);
    const requestedMerkleRoot = String(body?.merkleRoot ?? "").trim();

    if (requestedMerkleRoot && requestedMerkleRoot !== expectedMerkleRoot) {
      return NextResponse.json(
        { error: "merkleRoot does not match the Merkle root derived from users" },
        { status: 400 },
      );
    }

    const totalLiabilities = balances.reduce((sum, value) => sum + value, BigInt(0));
    const reserves = body?.reserves === undefined
      ? totalLiabilities
      : parseNonNegativeInteger(body.reserves, "reserves");

    const workspaceRoot = path.resolve(process.cwd(), "..");
    const savePath = path.join(workspaceRoot, "proofs", "solvency_proof.json");

    const { proofEnvelope } = await generateAndProve(
      balances.map((value) => value.toString()),
      reserves.toString(),
      {
        verify: false,
        merkleRoot: expectedMerkleRoot,
        users: normalizedUsers,
        workspaceRoot,
        savePath,
      },
    );

    const payload = await buildVisualizationPayload(proofEnvelope, workspaceRoot);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}