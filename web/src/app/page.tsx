"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { LuminousLogicMatrix } from "@/components/LuminousLogicMatrix";
import { MerkleTreeCanvas } from "@/components/MerkleTreeCanvas";
import { UserInputTable } from "@/components/UserInputTable";
import type {
  SnapshotRequest,
  SnapshotResponse,
  UserEntryRow,
  ZkProverEventPayload,
  ZkVerifierLogPayload,
  ZkVisualizationPayload,
} from "@/lib/contracts";
import { sampleUsers } from "@/lib/sampleData";
import { deriveUserVisualProfile } from "../lib/visualProfile";

type ProverPhase = "idle" | "inflow" | "proving" | "emission" | "settled";
type VerifierPhase = "pending" | "checking" | "passed" | "failed";

const INFLOW_DURATION_MS = 1500;
const PROVING_DURATION_MS = 2000;
const EMISSION_DURATION_MS = 1000;
const EMISSION_PACKET_TTL_MS = 900;

function makeRowId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function buildSampleRows(): UserEntryRow[] {
  return sampleUsers.map((user) => ({
    rowId: makeRowId("sample"),
    name: user.id,
    accountId: user.id,
    balance: user.balance,
  }));
}

function normalizeFocusUserId(rows: UserEntryRow[], current: string) {
  if (rows.some((row) => row.accountId.trim() === current)) {
    return current;
  }

  const firstValid = rows.find((row) => row.accountId.trim());
  return firstValid?.accountId.trim() ?? current;
}

function validateRows(entries: UserEntryRow[]) {
  const errors: string[] = [];
  const seen = new Set<string>();

  if (!entries.length) {
    errors.push("At least one account is required.");
  }

  if (entries.length > 50) {
    errors.push("Maximum 50 rows supported for animated mode.");
  }

  entries.forEach((row, index) => {
    const name = row.name.trim();
    const accountId = row.accountId.trim();
    const balance = Number(row.balance);

    if (!name) {
      errors.push(`Row ${index + 1}: name is required.`);
    }
    if (!accountId) {
      errors.push(`Row ${index + 1}: accountId is required.`);
    }
    if (accountId && seen.has(accountId)) {
      errors.push(`Row ${index + 1}: duplicate accountId '${accountId}'.`);
    }
    seen.add(accountId);

    if (!Number.isFinite(balance) || balance < 0) {
      errors.push(`Row ${index + 1}: balance must be non-negative.`);
    }
  });

  return errors;
}

function selectEmissionPackets(zkPayload: ZkVisualizationPayload | null) {
  if (!zkPayload) {
    return [];
  }

  const commitmentEvents = (zkPayload.proverEvents ?? []).filter(
    (event) => event.stage === "commitment-emission",
  );

  if (commitmentEvents.length === 0) {
    return [];
  }

  const selectedPackets: ZkProverEventPayload[] = [];
  const preferredCommitments = ["A", "B", "C"];

  for (const commitmentKey of preferredCommitments) {
    const match = commitmentEvents.find((event) => event.commitmentKey === commitmentKey);
    if (match) {
      selectedPackets.push(match);
    }
  }

  if (selectedPackets.length < 3) {
    const seen = new Set(selectedPackets);
    for (const event of commitmentEvents) {
      if (seen.has(event)) {
        continue;
      }
      selectedPackets.push(event);
      if (selectedPackets.length >= 3) {
        break;
      }
    }
  }

  return selectedPackets.slice(0, 3);
}

function formatVerifierTerminalLine(line: ZkVerifierLogPayload) {
  return `${line.passed ? "PASS" : "FAIL"} :: step-${line.step} :: ${line.label}`;
}

function queueVerifierTerminalLines(
  verifierLog: ZkVerifierLogPayload[],
  setVerifierTerminalLines: Dispatch<SetStateAction<string[]>>,
) {
  for (const [index, line] of verifierLog.entries()) {
    const delayMs = 200 + index * 240;
    globalThis.setTimeout(() => {
      const terminalLine = formatVerifierTerminalLine(line);
      setVerifierTerminalLines((current) => [...current, terminalLine]);
    }, delayMs);
  }
}

export default function Home() {
  const [rows, setRows] = useState<UserEntryRow[]>(() => buildSampleRows());
  const [selectedUserId, setSelectedUserId] = useState(sampleUsers[0]?.id ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const [payload, setPayload] = useState<SnapshotResponse | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [merkleAnimationSeed, setMerkleAnimationSeed] = useState(0);
  const [merkleCompleted, setMerkleCompleted] = useState(false);

  const [zkPayload, setZkPayload] = useState<ZkVisualizationPayload | null>(null);
  const [zkLoading, setZkLoading] = useState(false);
  const [zkError, setZkError] = useState<string | null>(null);

  const [proverPhase, setProverPhase] = useState<ProverPhase>("idle");
  const [proverActivePackets, setProverActivePackets] = useState<ZkProverEventPayload[]>([]);

  const [verifyRoot, setVerifyRoot] = useState("");
  const [verifyAddress, setVerifyAddress] = useState("");
  const [verifyProofInput, setVerifyProofInput] = useState("");
  const [zkVerificationResult, setZkVerificationResult] = useState("Pending");
  const [verifierPhase, setVerifierPhase] = useState<VerifierPhase>("pending");
  const [verifierTerminalLines, setVerifierTerminalLines] = useState<string[]>(["terminal:: standby"]);
  const [proverReplayNonce, setProverReplayNonce] = useState(0);

  const rowErrors = useMemo(() => validateRows(rows), [rows]);
  const activeVisualIdentity = selectedUserId || payload?.proof.userId || "observer";
  const visualProfile = useMemo(() => deriveUserVisualProfile(activeVisualIdentity), [activeVisualIdentity]);

  const loadZkVisualization = useCallback(async () => {
    setZkLoading(true);
    setZkError(null);

    try {
      const response = await fetch("/api/zk/visualization");
      const body = (await response.json()) as ZkVisualizationPayload & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load zk visualization");
      }

      setZkPayload(body);
      return body;
    } catch (requestError) {
      setZkError(requestError instanceof Error ? requestError.message : "Unknown error");
      return null;
    } finally {
      setZkLoading(false);
    }
  }, []);

  const loadSnapshot = useCallback(async (users: UserEntryRow[], focusUserId: string) => {
    setLoadingSnapshot(true);
    setFormError(null);
    setMerkleCompleted(false);
    setZkPayload(null);
    setProverPhase("idle");
    setProverActivePackets([]);

    try {
      const requestPayload: SnapshotRequest = {
        users,
        selectedUserId: focusUserId,
      };

      const response = await fetch("/api/merkle/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      const body = (await response.json()) as SnapshotResponse & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load snapshot");
      }

      setPayload(body);
      setVerifyRoot(body.snapshot.root.hash);
      setVerifyAddress(body.proof.userId);
      setVerifyProofInput(JSON.stringify(body.proof.proof, null, 2));
      setZkVerificationResult("Pending");
      setVerifierPhase("pending");
      setVerifierTerminalLines(["terminal:: standby"]);
      setMerkleAnimationSeed((seed) => seed + 1);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unknown error");
    } finally {
      setLoadingSnapshot(false);
    }
  }, []);

  useEffect(() => {
    if (!zkPayload || !merkleCompleted) {
      return;
    }

    let clearEmissionPacketsTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    setProverPhase("inflow");
    setProverActivePackets([]);

    const emissionPackets = selectEmissionPackets(zkPayload);

    const toProvingTimer = globalThis.setTimeout(() => {
      setProverPhase("proving");
    }, INFLOW_DURATION_MS);

    const toEmissionTimer = globalThis.setTimeout(() => {
      setProverPhase("emission");
      setProverActivePackets(emissionPackets);

      clearEmissionPacketsTimer = globalThis.setTimeout(() => {
        setProverActivePackets([]);
      }, EMISSION_PACKET_TTL_MS);
    }, INFLOW_DURATION_MS + PROVING_DURATION_MS);

    const toSettledTimer = globalThis.setTimeout(() => {
      setProverPhase("settled");
      setProverActivePackets([]);
    }, INFLOW_DURATION_MS + PROVING_DURATION_MS + EMISSION_DURATION_MS);

    return () => {
      globalThis.clearTimeout(toProvingTimer);
      globalThis.clearTimeout(toEmissionTimer);
      globalThis.clearTimeout(toSettledTimer);
      if (clearEmissionPacketsTimer) {
        globalThis.clearTimeout(clearEmissionPacketsTimer);
      }
    };
  }, [zkPayload, merkleCompleted, proverReplayNonce]);

  function onRowChange(index: number, key: keyof UserEntryRow, value: string) {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        return {
          ...row,
          [key]: value,
        };
      }),
    );
  }

  function onAddRow() {
    setRows((current) => {
      if (current.length >= 50) {
        return current;
      }

      return [
        ...current,
        {
          rowId: makeRowId("user"),
          name: "",
          accountId: "",
          balance: "",
        },
      ];
    });
  }

  function onRemoveRow(index: number) {
    setRows((current) => {
      if (current.length <= 1) {
        return current;
      }

      const next = current.filter((_, rowIndex) => rowIndex !== index);
      const normalized = normalizeFocusUserId(next, selectedUserId);
      setSelectedUserId(normalized);
      return next;
    });
  }

  function onResetSample() {
    const next = buildSampleRows();
    setRows(next);
    setSelectedUserId(next[0]?.accountId ?? "");
    setFormError(null);
  }

  function handleGenerateMerkleTree() {
    if (rowErrors.length > 0) {
      setFormError(rowErrors[0]);
      return;
    }

    const focus = normalizeFocusUserId(rows, selectedUserId || rows[0].accountId);
    setSelectedUserId(focus);
    void loadSnapshot(rows, focus);
  }

  function handleSelectedUserChange(nextUserId: string) {
    const normalizedFocusUser = normalizeFocusUserId(rows, nextUserId);
    setSelectedUserId(normalizedFocusUser);

    if (
      payload &&
      rowErrors.length === 0 &&
      !loadingSnapshot &&
      normalizedFocusUser !== payload.proof.userId
    ) {
      void loadSnapshot(rows, normalizedFocusUser);
    }
  }

  const handleMerkleBuildComplete = useCallback(() => {
    setMerkleCompleted((current) => {
      if (current) {
        return current;
      }
      void loadZkVisualization();
      return true;
    });
  }, [loadZkVisualization]);

  function handleReplayTransfer() {
    if (!transferEnabled) {
      return;
    }

    setProverPhase("idle");
    setProverActivePackets([]);
    setVerifierPhase("pending");
    setVerifierTerminalLines(["terminal:: standby"]);
    setZkVerificationResult("Pending");
    setProverReplayNonce((current) => current + 1);
  }

  function handleVerifyProof() {
    if (!verifyRoot || !verifyAddress || !verifyProofInput.trim()) {
      setVerifierPhase("failed");
      setZkVerificationResult("Rejected: incomplete verification payload");
      setVerifierTerminalLines([
        "verifier:: session start",
        "error:: missing verification payload",
      ]);
      return;
    }

    setVerifierPhase("checking");
    setZkVerificationResult("Checking...");

    const rootMatch = payload?.snapshot.root.hash === verifyRoot;
    const addressKnown = rows.some((row) => row.accountId === verifyAddress);
    const proofAvailable = verifyProofInput.length > 8;
    const verified = Boolean(rootMatch && addressKnown && proofAvailable && zkPayload?.isValid);

    const verifierLog: ZkVerifierLogPayload[] = zkPayload?.verifierLog ?? [
      { step: 1, label: "pi packet payload parsed", passed: proofAvailable },
      { step: 2, label: "root context and transcript matched", passed: rootMatch && addressKnown },
      { step: 3, label: verified ? "pairing equation accepted" : "pairing equation mismatch", passed: verified },
    ];

    setVerifierTerminalLines(["verifier:: session start"]);
    queueVerifierTerminalLines(verifierLog, setVerifierTerminalLines);

    const verificationResultDelayMs = 200 + verifierLog.length * 240 + 120;
    globalThis.setTimeout(() => {
      setVerifierPhase(verified ? "passed" : "failed");
      setZkVerificationResult(verified ? "Proof Verified" : "Verification Failed");
    }, verificationResultDelayMs);
  }

  const transferEnabled = merkleCompleted && zkPayload !== null && !loadingSnapshot && proverPhase === "settled";

  return (
    <main className="mx-auto flex w-full max-w-350 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="step-shell border-lime-400/30">
        <p className="text-xs uppercase tracking-[0.32em] text-lime-300/90">Proof of Solvency Experience</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Stepwise Merkle-to-ZK Flow</h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-300">
          Build your Merkle dataset, watch the full tree construct in neon-green, then unlock a readable zk-SNARK proving sequence.
        </p>
      </header>

      <section className="step-shell border-lime-400/30">
        <div className="step-heading">
          <span className="step-index">STEP 1</span>
          <h2 className="step-title">Input Merkle Data</h2>
        </div>

        <UserInputTable
          rows={rows}
          selectedUserId={selectedUserId}
          rowErrors={rowErrors}
          formError={formError}
          submitting={loadingSnapshot}
          onRowChange={onRowChange}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          onResetSample={onResetSample}
          onSelectedUserChange={handleSelectedUserChange}
          onGenerate={handleGenerateMerkleTree}
        />
      </section>

      <section className="step-shell border-lime-400/30">
        <div className="step-heading">
          <span className="step-index">STEP 2</span>
          <h2 className="step-title">Merkle Tree Construction</h2>
        </div>

        {loadingSnapshot ? <p className="mt-2 text-sm text-lime-200">Generating cryptographic structure...</p> : null}

        {payload ? (
          <MerkleTreeCanvas
            key={`${payload.snapshot.root.hash}-${merkleAnimationSeed}`}
            snapshot={payload.snapshot}
            proof={payload.proof}
            onBuildComplete={handleMerkleBuildComplete}
            visualMode="phantom"
            visualProfile={visualProfile}
          />
        ) : (
          <div className="mt-4 flex h-[58vh] min-h-130 items-center justify-center rounded-2xl border border-dashed border-slate-500/40 bg-slate-950/55 text-center text-sm text-slate-400">
            Generate a Merkle tree from Step 1 to start the build animation.
          </div>
        )}
      </section>

      <section className="step-shell border-lime-400/30">
        <div className="step-heading">
          <span className="step-index">STEP 3</span>
          <h2 className="step-title">zk-SNARK Proof Stream</h2>
        </div>

        {merkleCompleted ? (
          <LuminousLogicMatrix
            snapshot={payload?.snapshot ?? null}
            proof={payload?.proof ?? null}
            zkPayload={zkPayload}
            zkLoading={zkLoading}
            zkError={zkError}
            proverPhase={proverPhase}
            proverActivePackets={proverActivePackets}
            verifyRoot={verifyRoot}
            verifyAddress={verifyAddress}
            verifyProofInput={verifyProofInput}
            zkVerificationResult={zkVerificationResult}
            verifierPhase={verifierPhase}
            verifierTerminalLines={verifierTerminalLines}
            onVerifyRootChange={setVerifyRoot}
            onVerifyAddressChange={setVerifyAddress}
            onVerifyProofInputChange={setVerifyProofInput}
            onVerifyProof={handleVerifyProof}
            onReplayTransfer={handleReplayTransfer}
            transferEnabled={transferEnabled}
            visualProfile={visualProfile}
          />
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-500/40 bg-slate-950/60 p-6 text-sm text-slate-300">
            Complete Step 2 animation to unlock zk-SNARK visualization.
          </div>
        )}
      </section>
    </main>
  );
}
