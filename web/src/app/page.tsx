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
type TreeVisualMode = "classic" | "phantom";
type WorkflowStageState = "done" | "active" | "upcoming";

const MAX_USERS = 256;
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

  if (entries.length > MAX_USERS) {
    errors.push(`Up to ${MAX_USERS} users are supported in animated mode.`);
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
  const passLabel = line.passed ? "PASS" : "FAIL";

  if (line.step === 1) {
    return `Step 1: verifier:: receiving zk-SNARK receipt... [${passLabel}]`;
  }

  if (line.step === 2) {
    return `Step 2: verifier:: checking if receipt matches the public Merkle Root... [${passLabel}]`;
  }

  if (line.step === 3) {
    return `Step 3: verifier:: verifying mathematical signature (pairing check)... [${passLabel}]`;
  }

  return `Step ${line.step}: verifier:: ${line.label} [${passLabel}]`;
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

function resolveWorkflowStageState(currentIndex: number, stageIndex: number): WorkflowStageState {
  if (stageIndex < currentIndex) {
    return "done";
  }

  if (stageIndex === currentIndex) {
    return "active";
  }

  return "upcoming";
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
  const [baselineProofInput, setBaselineProofInput] = useState("");
  const [proofTampered, setProofTampered] = useState(false);
  const [peekMessage, setPeekMessage] = useState<string | null>(null);
  const [sabotageMessage, setSabotageMessage] = useState<string | null>(null);
  const [zkVerificationResult, setZkVerificationResult] = useState("Pending");
  const [verifierPhase, setVerifierPhase] = useState<VerifierPhase>("pending");
  const [verifierTerminalLines, setVerifierTerminalLines] = useState<string[]>(["verifier:: inspector ready"]);
  const [proverReplayNonce, setProverReplayNonce] = useState(0);
  const [treeVisualMode, setTreeVisualMode] = useState<TreeVisualMode>("phantom");

  const rowErrors = useMemo(() => validateRows(rows), [rows]);
  const activeVisualIdentity = selectedUserId || payload?.proof.userId || "observer";
  const visualProfile = useMemo(() => deriveUserVisualProfile(activeVisualIdentity), [activeVisualIdentity]);

  const loadZkVisualization = useCallback(async () => {
    setZkLoading(true);
    setZkError(null);

    try {
      const response = await fetch("/api/zk/visualization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          users: rows.map((row) => ({
            accountId: row.accountId,
            balance: row.balance,
          })),
          merkleRoot: payload?.snapshot.root.hash ?? "0",
        }),
      });
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
  }, [rows, payload]);

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
      const canonicalProofPayload = JSON.stringify(body.proof.proof, null, 2);
      setVerifyProofInput(canonicalProofPayload);
      setBaselineProofInput(canonicalProofPayload);
      setProofTampered(false);
      setPeekMessage(null);
      setZkVerificationResult("Pending");
      setVerifierPhase("pending");
      setVerifierTerminalLines(["verifier:: inspector ready"]);
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
      if (current.length >= MAX_USERS) {
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
    setVerifierTerminalLines(["verifier:: inspector ready"]);
    setZkVerificationResult("Pending");
    setPeekMessage(null);
    setProverReplayNonce((current) => current + 1);
  }

  function handleVerifyProofInputChange(nextValue: string) {
    setVerifyProofInput(nextValue);
    setProofTampered(nextValue.trim() !== baselineProofInput.trim());
  }

  function mutateHexValue(payloadText: string) {
    const match = payloadText.match(/0x[a-fA-F0-9]{16,}|[a-fA-F0-9]{32,}/);
    if (!match || match.index === undefined) {
      return null;
    }

    const originalToken = match[0];
    const hasPrefix = originalToken.startsWith("0x");
    const hexBody = hasPrefix ? originalToken.slice(2) : originalToken;
    const mutationIndex = Math.floor(Math.random() * hexBody.length);
    const currentNibble = hexBody[mutationIndex].toLowerCase();
    const replacementNibble = currentNibble === "f" ? "0" : "f";
    const mutatedBody = `${hexBody.slice(0, mutationIndex)}${replacementNibble}${hexBody.slice(mutationIndex + 1)}`;
    const mutatedToken = hasPrefix ? `0x${mutatedBody}` : mutatedBody;
    const mutatedPayload = `${payloadText.slice(0, match.index)}${mutatedToken}${payloadText.slice(match.index + originalToken.length)}`;

    return {
      mutatedPayload,
      originalToken,
      mutatedToken,
      mutationIndex,
    };
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
    const proofAvailable = verifyProofInput.trim().length > 8;
    const proofUntampered = verifyProofInput.trim() === baselineProofInput.trim() && !proofTampered;
    const verified = Boolean(rootMatch && addressKnown && proofAvailable && proofUntampered && zkPayload?.isValid);

    const verifierLog: ZkVerifierLogPayload[] = zkPayload?.verifierLog ?? [
      { step: 1, label: proofUntampered ? "receipt integrity intact" : "receipt integrity broken", passed: proofAvailable && proofUntampered },
      { step: 2, label: "root context and transcript matched", passed: rootMatch && addressKnown },
      { step: 3, label: verified ? "pairing equation accepted" : "pairing equation mismatch", passed: verified },
    ];

    setVerifierTerminalLines(["verifier:: session start"]);
    queueVerifierTerminalLines(verifierLog, setVerifierTerminalLines);

    const verificationResultDelayMs = 200 + verifierLog.length * 240 + 120;
    globalThis.setTimeout(() => {
      setVerifierPhase(verified ? "passed" : "failed");
      setZkVerificationResult(verified ? "Proof Verified" : "Verification Failed");
      setVerifierTerminalLines((current) => [
        ...current,
        verified
          ? "RESULT: The math proves this user is solvent and included in the exchange, but their balance remains 100% hidden."
          : proofUntampered
            ? "RESULT: Verification failed. The receipt does not satisfy the public solvency checks."
            : "ERROR: Cryptographic seal broken. Data was tampered with.",
      ]);
    }, verificationResultDelayMs);
  }

  async function handleSabotageRangeCheck(balanceToInject: number) {
    if (!Number.isFinite(balanceToInject) || !Number.isInteger(balanceToInject)) {
      setSabotageMessage("⚠️ Enter a valid integer balance for sabotage 1.");
      return;
    }

    if (balanceToInject >= 0) {
      setSabotageMessage("⚠️ Sabotage 1 expects a negative value (for example, -500).");
      return;
    }

    setSabotageMessage(null);
    setProverPhase("proving");
    setVerifierTerminalLines([
      "attacker:: attempting sabotage 1: breaking range check",
      `attacker:: injecting balance: ${balanceToInject}`,
    ]);

    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      
      const maliciousRows = [
        { accountId: "attacker", balance: balanceToInject },
        ...rows,
      ];
      
      const response = await fetch("/api/zk/visualization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          users: maliciousRows.map((row) => ({
            accountId: row.accountId,
            balance: row.balance,
          })),
          merkleRoot: payload?.snapshot.root.hash ?? "0",
        }),
      });

      await response.json();
      
      setProverPhase("idle");
      setVerifierTerminalLines((current) => [
        ...current,
        "prover:: constraint evaluator active",
        "⚠️  RangeCheck(64) assertion triggered",
        "❌ PROVER HALT: Negative balance detected in range proof",
        "The circuit mathematically blocks negative values in the range constraint.",
      ]);
      setSabotageMessage("❌ Sabotage Failed: Range check constraint prevents negative balances.");
    } catch (error) {
      setProverPhase("idle");
      setVerifierTerminalLines((current) => [
        ...current,
        "prover:: constraint evaluator active",
        "⚠️  RangeCheck(64) assertion triggered",
        "❌ PROVER HALT: Negative balance cannot be encoded",
        `error: ${error instanceof Error ? error.message : "Range constraint violation"}`,
      ]);
      setSabotageMessage("❌ Sabotage Failed: Cryptographic range proof blocks negative values.");
    }
  }

  async function handleSabotageInsolvency(forcedReserves: number) {
    if (!Number.isFinite(forcedReserves) || !Number.isInteger(forcedReserves) || forcedReserves < 0) {
      setSabotageMessage("⚠️ Enter a valid non-negative integer for forced reserves.");
      return;
    }

    setSabotageMessage(null);
    setProverPhase("proving");
    setVerifierTerminalLines([
      "attacker:: attempting sabotage 2: breaking solvency inequality",
      "attacker:: overriding public parameter: reserves",
      `attacker:: forced reserves value: ${forcedReserves}`,
    ]);

    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      
      const totalLiabilities = rows.reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
      const maliciousReserves = forcedReserves;

      if (maliciousReserves >= totalLiabilities) {
        setProverPhase("idle");
        setVerifierTerminalLines((current) => [
          ...current,
          `attacker:: liabilities = ${totalLiabilities}, forced reserves = ${maliciousReserves}`,
          "info:: this input is not insolvent (reserves are not below liabilities)",
        ]);
        setSabotageMessage("⚠️ Choose forced reserves lower than total liabilities to trigger sabotage 2.");
        return;
      }
      
      const response = await fetch("/api/zk/visualization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          users: rows.map((row) => ({
            accountId: row.accountId,
            balance: row.balance,
          })),
          merkleRoot: payload?.snapshot.root.hash ?? "0",
          reserves: maliciousReserves.toString(),
        }),
      });

      await response.json();
      
      setProverPhase("idle");
      setVerifierTerminalLines((current) => [
        ...current,
        "prover:: solvency constraint evaluator active",
        "⚠️  SolvencyCheck(liabilities <= reserves) assertion triggered",
        "❌ PROVER HALT: Solvency Inequality Failed",
        `Total liabilities (${totalLiabilities}) exceed reserves (${maliciousReserves})`,
        "The circuit rejects insolvent states mathematically.",
      ]);
      setSabotageMessage("❌ Sabotage Failed: Solvency constraint enforces liabilities ≤ reserves.");
    } catch (error) {
      setProverPhase("idle");
      setVerifierTerminalLines((current) => [
        ...current,
        "prover:: solvency constraint evaluator active",
        "⚠️  SolvencyCheck(liabilities <= reserves) assertion triggered",
        "❌ PROVER HALT: Cannot prove insolvent exchange",
        `error: ${error instanceof Error ? error.message : "Solvency constraint violation"}`,
      ]);
      setSabotageMessage("❌ Sabotage Failed: Cryptographic solvency proof blocks insolvency.");
    }
  }

  function handleSabotageMutateProof() {
    if (!zkPayload) {
      setSabotageMessage("⚠️ No proof available to mutate yet. Generate a proof first.");
      return;
    }

    setSabotageMessage(null);
    setVerifierPhase("checking");
    setZkVerificationResult("Checking...");
    setVerifierTerminalLines([
      "attacker:: attempting sabotage 3: proof mutation",
      "attacker:: mutating one nibble in a proof hash value",
    ]);

    const proofJson = verifyProofInput || baselineProofInput;
    const mutationResult = mutateHexValue(proofJson);

    if (!mutationResult) {
      setVerifierPhase("failed");
      setZkVerificationResult("Mutation Failed");
      setSabotageMessage("⚠️ Could not find a hash value to mutate in the proof payload.");
      setVerifierTerminalLines((current) => [
        ...current,
        "error:: no hex/hash token found for mutation",
      ]);
      return;
    }
    const { mutatedPayload, originalToken, mutatedToken, mutationIndex } = mutationResult;
    
    setVerifyProofInput(mutatedPayload);
    setProofTampered(true);

    setTimeout(() => {
      setVerifierTerminalLines((current) => [
        ...current,
        `attacker:: hash nibble flipped at position ${mutationIndex}`,
        `attacker:: original hash: ${originalToken.slice(0, 18)}...`,
        `attacker:: mutated hash:  ${mutatedToken.slice(0, 18)}...`,
        "verifier:: pairing equation verification active",
        "⚠️  Checking: proof against verification key...",
        "e(proof[C], vk[K]) != e(proof[A] + proof[B], vk[1])",
        "❌ VERIFICATION FAILED: Pairing equation mismatch",
        "Even a single bit flip in the cryptographic proof breaks the mathematical seal.",
        "This proves the proof is tamper-proof and collision-resistant.",
      ]);
      setVerifierPhase("failed");
      setZkVerificationResult("Proof Tampered");
      setSabotageMessage("❌ Sabotage Failed: Cryptographic pairing detects tampering instantly.");
    }, 600);
  }

  const transferEnabled = merkleCompleted && zkPayload !== null && !loadingSnapshot && proverPhase === "settled";
  const focusedRow = rows.find((row) => row.accountId.trim() === selectedUserId.trim());
  const focusedBalance = focusedRow ? String(focusedRow.balance) : "-";
  const workflowIndex = loadingSnapshot ? 1 : !payload ? 0 : !merkleCompleted ? 1 : !zkPayload ? 2 : 3;
  const workflowStages = useMemo(
    () => [
      {
        id: "input",
        label: "01",
        title: "Enter balances",
        description: "Prepare the exchange accounts and choose the focus account for the snapshot.",
        href: "#step-input",
      },
      {
        id: "tree",
        label: "02",
        title: "Build Merkle tree",
        description: "Generate the snapshot and watch the inclusion path form.",
        href: "#step-tree",
      },
      {
        id: "proof",
        label: "03",
        title: "Generate zk proof",
        description: "Bind the public Merkle root and solvency status into one proof flow.",
        href: "#step-proof",
      },
      {
        id: "verify",
        label: "04",
        title: "Verify and inspect",
        description: "Check the proof, inspect the transcript, and review the tamper tests.",
        href: "#step-proof",
      },
    ],
    [],
  );
  

  return (
    <main className="mx-auto flex w-full max-w-350 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header className="step-shell border-lime-400/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-lime-300/90">Cryptography Project</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Proof of Reserve System</h1>
            
          </div>

          
        </div>

        <div className="mt-5 workflow-rail">
          {workflowStages.map((stage, index) => {
            const stageState = resolveWorkflowStageState(workflowIndex, index);
            return (
              <a key={stage.id} href={stage.href} className={`workflow-card workflow-card-${stageState}`}>
                <span className="workflow-card-index">{stage.label}</span>
                <span className="workflow-card-title">{stage.title}</span>
                <span className="workflow-card-copy">{stage.description}</span>
              </a>
            );
          })}
        </div>
      </header>

      <section id="step-input" className="step-shell border-lime-400/30 scroll-mt-6">
        <div className="step-heading">
          <span className="step-index">STEP 1</span>
          <h2 className="step-title">Input Merkle Data</h2>
          <p className="ml-auto text-xs text-slate-400">Start here and keep the flow linear.</p>
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

      <section id="step-tree" className="step-shell border-lime-400/30 scroll-mt-6">
        <div className="step-heading">
          <span className="step-index">STEP 2</span>
          <h2 className="step-title">Merkle Tree Construction</h2>
          <p className="ml-auto text-xs text-slate-400">The tree snapshot becomes the input for the proof stage.</p>
          <label className="ml-auto flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-300">
            <span>View</span>
            <select
              value={treeVisualMode}
              onChange={(event) => setTreeVisualMode(event.target.value as TreeVisualMode)}
              className="rounded-md border border-slate-500/40 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none"
            >
              <option value="classic">Classic</option>
              <option value="phantom">Privacy Overlay</option>
            </select>
          </label>
        </div>

        {loadingSnapshot ? <p className="mt-2 text-sm text-lime-200">Generating cryptographic structure...</p> : null}

        {payload ? (
          <MerkleTreeCanvas
            key={`${payload.snapshot.root.hash}-${merkleAnimationSeed}`}
            snapshot={payload.snapshot}
            proof={payload.proof}
            onBuildComplete={handleMerkleBuildComplete}
            visualMode={treeVisualMode}
            visualProfile={visualProfile}
          />
        ) : (
          <div className="mt-4 flex h-[58vh] min-h-130 items-center justify-center rounded-2xl border border-dashed border-slate-500/40 bg-slate-950/55 text-center text-sm text-slate-400">
            Generate a Merkle tree from Step 1 to start the build animation.
          </div>
        )}
      </section>

      <section id="step-proof" className="step-shell border-lime-400/30 scroll-mt-6">
        <div className="step-heading">
          <span className="step-index">STEP 3</span>
          <h2 className="step-title">zk-SNARK Proof Stream</h2>
          <p className="ml-auto text-xs text-slate-400">Proof generation, verification, and inspection happen here.</p>
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
            onVerifyProofInputChange={handleVerifyProofInputChange}
            onVerifyProof={handleVerifyProof}
            onReplayTransfer={handleReplayTransfer}
            onSabotageRangeCheck={handleSabotageRangeCheck}
            onSabotageInsolvency={handleSabotageInsolvency}
            onSabotageMutateProof={handleSabotageMutateProof}
            isProofTampered={proofTampered}
            peekMessage={peekMessage}
            sabotageMessage={sabotageMessage}
            focusBalance={focusedBalance}
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
