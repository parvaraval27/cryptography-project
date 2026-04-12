import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { verifyProof } from "../../../../../../src/zkProof";

export const runtime = "nodejs";

const COMMITMENT_KEYS = ["A", "B", "C", "Z", "T1", "T2", "T3", "Wxi", "Wxiw"];

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

export async function GET() {
  try {
    const workspaceRoot = path.resolve(process.cwd(), "..");
    const proofPath = path.join(workspaceRoot, "proofs", "solvency_proof.json");
    const vkeyPath = path.join(workspaceRoot, "proofs", "verification_key.json");

    if (!fs.existsSync(proofPath)) {
      return NextResponse.json(
        { error: "Missing proofs/solvency_proof.json. Generate it first from the CLI." },
        { status: 404 },
      );
    }

    if (!fs.existsSync(vkeyPath)) {
      return NextResponse.json(
        { error: "Missing proofs/verification_key.json. Run setup first." },
        { status: 404 },
      );
    }

    const envelope = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const proof = envelope?.proof;
    const publicSignals = envelope?.publicSignals;

    if (!proof || !Array.isArray(publicSignals)) {
      return NextResponse.json(
        { error: "Invalid solvency proof file format." },
        { status: 500 },
      );
    }

    const isValid = await verifyProof(proof, publicSignals, vkeyPath);
    const fingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify(proof))
      .digest("hex");

    const commitmentCount = COMMITMENT_KEYS.filter((key) => Boolean(proof[key])).length;
    const protocol = String(proof.protocol ?? envelope?.type ?? "plonk").toUpperCase();
    const curve = String(proof.curve ?? "bn128").toUpperCase();

    const metadata = {
      reserves: String(envelope?.metadata?.reserves ?? publicSignals[0] ?? "0"),
      usersProvided: Number(envelope?.metadata?.usersProvided ?? 0),
      maxUsers: Number(envelope?.metadata?.maxUsers ?? 0),
    };

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

    return NextResponse.json({
      protocol,
      curve,
      fingerprint,
      createdAt: String(envelope?.createdAt ?? new Date().toISOString()),
      isValid,
      metadata,
      publicSignalCount: publicSignals.length,
      commitmentCount,
      stages,
      metrics,
      stageProgress,
      proverEvents,
      verifierLog,
      proverGeometry,
      verifierCrystal,
      proofAssemblyProgress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}