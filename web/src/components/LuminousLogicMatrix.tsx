"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState, type CSSProperties } from "react";
import type {
  MerkleSnapshotPayload,
  ProofTracePayload,
  ZkProverEventPayload,
  ZkVisualizationPayload,
} from "@/lib/contracts";
import type { UserVisualProfile } from "../lib/visualProfile";
import { toVisualProfileStyle } from "../lib/visualProfile";

type ProverPhase = "idle" | "inflow" | "proving" | "emission" | "settled";
type VerifierPhase = "pending" | "checking" | "passed" | "failed";

type LuminousLogicMatrixProps = {
  snapshot: MerkleSnapshotPayload | null;
  proof: ProofTracePayload | null;
  zkPayload: ZkVisualizationPayload | null;
  zkLoading: boolean;
  zkError: string | null;
  proverPhase: ProverPhase;
  proverActivePackets: ZkProverEventPayload[];
  verifyRoot: string;
  verifyAddress: string;
  verifyProofInput: string;
  zkVerificationResult: string;
  verifierPhase: VerifierPhase;
  verifierTerminalLines: string[];
  onVerifyRootChange: (value: string) => void;
  onVerifyAddressChange: (value: string) => void;
  onVerifyProofInputChange: (value: string) => void;
  onVerifyProof: () => void;
  onReplayTransfer: () => void;
  onSabotageRangeCheck: (balanceToInject: number) => void;
  onSabotageInsolvency: (forcedReserves: number) => void;
  onSabotageMutateProof: () => void;
  isProofTampered: boolean;
  peekMessage: string | null;
  sabotageMessage: string | null;
  focusBalance: string;
  transferEnabled: boolean;
  visualProfile: UserVisualProfile;
};

type PiPacket = {
  commitmentKey: string;
  piLabel: string;
  payload: string;
};

type FlowNodeId =
  | "user-input"
  | "merkle-tree"
  | "circuit-compiler"
  | "witness-gen"
  | "key-gen"
  | "proof-gen"
  | "public-signals"
  | "proof-verify"
  | "result";

type PanelKey = "overview" | "verify" | "result" | "attacker";

type FlowNode = {
  id: FlowNodeId;
  label: string;
  sublabel: string;
  zone: "prover" | "verifier" | "setup";
  panelKey: PanelKey;
};

const FLOW_NODES: FlowNode[] = [
  { id: "user-input", label: "User Balances", sublabel: "accountId + balance", zone: "prover", panelKey: "overview" },
  { id: "merkle-tree", label: "Merkle Sum Tree", sublabel: "root + inclusion path", zone: "prover", panelKey: "overview" },
  { id: "circuit-compiler", label: "Circuit Compiler", sublabel: "Circom -> WASM + r1cs", zone: "prover", panelKey: "overview" },
  { id: "witness-gen", label: "Witness Generator", sublabel: "private signal expansion", zone: "prover", panelKey: "overview" },
  { id: "key-gen", label: "Key Material", sublabel: "PTAU + zkey + vkey", zone: "setup", panelKey: "overview" },
  { id: "proof-gen", label: "Proof Generation", sublabel: "snarkjs PLONK", zone: "prover", panelKey: "overview" },
  { id: "public-signals", label: "Root Bridge", sublabel: "reserves + merkleRoot", zone: "prover", panelKey: "overview" },
  { id: "proof-verify", label: "Verifier", sublabel: "pairing checks", zone: "verifier", panelKey: "verify" },
  { id: "result", label: "Result", sublabel: "accept or reject", zone: "verifier", panelKey: "result" },
];

function shortFingerprint(hash: string | undefined) {
  if (!hash) return "-";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function resolvePiSuffix(key: string, index: number) {
  if (key === "A") return "a";
  if (key === "B") return "b";
  if (key === "C") return "c";
  return `${index + 1}`;
}

function selectPiPackets(
  zkPayload: ZkVisualizationPayload | null,
  proverActivePackets: ZkProverEventPayload[],
): PiPacket[] {
  const sourcePackets =
    proverActivePackets.length > 0
      ? proverActivePackets
      : (zkPayload?.proverEvents ?? []).filter((event) => event.stage === "commitment-emission");
  if (sourcePackets.length === 0) return [];

  const preferredKeys = ["A", "B", "C"];
  const selected: ZkProverEventPayload[] = [];
  for (const key of preferredKeys) {
    const packet = sourcePackets.find((event) => event.commitmentKey === key);
    if (packet) selected.push(packet);
  }

  if (selected.length < 3) {
    const known = new Set(selected);
    for (const packet of sourcePackets) {
      if (known.has(packet)) continue;
      selected.push(packet);
      if (selected.length >= 3) break;
    }
  }

  return selected.slice(0, 3).map((packet, index) => {
    const key = packet.commitmentKey ?? `P${index + 1}`;
    return {
      commitmentKey: key,
      piLabel: `pi_${resolvePiSuffix(key, index)}`,
      payload: shortFingerprint(packet.packetHash),
    };
  });
}

function resolveActiveFlowNode(
  proverPhase: ProverPhase,
  verifierPhase: VerifierPhase,
  zkPayload: ZkVisualizationPayload | null,
): FlowNodeId {
  if (verifierPhase === "passed" || verifierPhase === "failed") return "result";
  if (verifierPhase === "checking") return "proof-verify";
  if (proverPhase === "emission" || proverPhase === "settled") return "public-signals";
  if (proverPhase === "proving") return "proof-gen";
  if (proverPhase === "inflow") return "witness-gen";
  if (zkPayload) return "public-signals";
  return "user-input";
}

function resolveTerminalLineClass(line: string) {
  const normalized = line.toLowerCase();

  if (normalized.includes("error") || normalized.includes("fail") || normalized.includes("rejected")) {
    return "text-rose-400";
  }
  if (normalized.includes("warn")) {
    return "text-amber-300";
  }
  if (normalized.includes("backend::") || normalized.includes("verifier::") || normalized.includes("checking")) {
    return "text-cyan-300";
  }
  if (normalized.includes("pass") || normalized.includes("accepted") || normalized.includes("blocked")) {
    return "text-emerald-300";
  }

  return "text-slate-300";
}

export function LuminousLogicMatrix({
  snapshot,
  proof,
  zkPayload,
  zkLoading,
  zkError,
  proverPhase,
  proverActivePackets,
  verifyRoot,
  verifyAddress,
  verifyProofInput,
  zkVerificationResult,
  verifierPhase,
  verifierTerminalLines,
  onVerifyRootChange,
  onVerifyAddressChange,
  onVerifyProofInputChange,
  onVerifyProof,
  onReplayTransfer,
  onSabotageRangeCheck,
  onSabotageInsolvency,
  onSabotageMutateProof,
  isProofTampered,
  peekMessage,
  sabotageMessage,
  focusBalance,
  transferEnabled,
  visualProfile,
}: Readonly<LuminousLogicMatrixProps>) {
  const [rangeAttackBalance, setRangeAttackBalance] = useState("-500");
  const [insolvencyReserves, setInsolvencyReserves] = useState("0");
  const [selectedPanel, setSelectedPanel] = useState<PanelKey>("overview");
  const shouldReduceMotion = useReducedMotion();

  const piPackets = useMemo(() => selectPiPackets(zkPayload, proverActivePackets), [zkPayload, proverActivePackets]);
  const visualVars = useMemo(() => toVisualProfileStyle(visualProfile) as CSSProperties, [visualProfile]);
  const rootHash = snapshot?.root.hash ?? verifyRoot;
  const focusUser = proof?.userId ?? (verifyAddress || "-");
  const activeFlowNode = resolveActiveFlowNode(proverPhase, verifierPhase, zkPayload);
  const metrics = zkPayload?.metrics ?? [];
  const stageCards = zkPayload?.stages ?? [];
  const proofLinkStatus = zkPayload?.couplingStatus ?? "missing";
  const rangeAttackValue = Number(rangeAttackBalance);
  const insolvencyValue = Number(insolvencyReserves);
  const isRangeAttackInputValid = Number.isFinite(rangeAttackValue) && Number.isInteger(rangeAttackValue) && rangeAttackValue < 0;
  const isInsolvencyInputValid = Number.isFinite(insolvencyValue) && Number.isInteger(insolvencyValue) && insolvencyValue >= 0;

  const pipelineStatus = useMemo(() => {
    let merkle = "pending";
    let bridge = "pending";
    let zk = "pending";

    if (verifierPhase !== "pending") {
      merkle = "checking";

      const isMockZkAttack = verifierTerminalLines.some((l) => l.includes("pairing equation verification active"));
      const merklePassed = isMockZkAttack || verifierTerminalLines.some((l) => l.includes("Merkle inclusion verification") && l.includes("[PASS]"));
      const hasAnyFail = verifierTerminalLines.some((l) => l.includes("[FAIL]") || l.includes("FAIL:"));

      if (merklePassed) {
        merkle = "passed";
        bridge = "checking";
      } else if (hasAnyFail) {
        merkle = "failed";
      }

      if (merkle === "passed") {
        const bridgePassed = isMockZkAttack || verifierTerminalLines.some((l) => l.includes("compare merkleRootPublic") && l.includes("[PASS]"));
        if (bridgePassed) {
          bridge = "passed";
          zk = "checking";
        } else if (hasAnyFail && !bridgePassed) {
          bridge = "failed";
        }
      }

      if (bridge === "passed") {
        const zkPassed = verifierTerminalLines.some((l) => l.includes("pairing verification") && l.includes("[PASS]"));
        if (zkPassed) {
          zk = "passed";
        } else if (hasAnyFail && !zkPassed) {
          zk = "failed";
        }
      }

      if (verifierPhase === "failed") {
        if (merkle === "checking") merkle = "failed";
        else if (bridge === "checking") bridge = "failed";
        else if (zk === "checking") zk = "failed";
      }
    }

    return { merkle, bridge, zk };
  }, [verifierTerminalLines, verifierPhase]);

  function renderPipelineStep(label: string, status: string) {
    const toneClass =
      status === "passed"
        ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-300"
        : status === "failed"
          ? "border-rose-700/50 bg-rose-950/30 text-rose-300"
          : status === "checking"
            ? "border-amber-700/50 bg-amber-950/30 text-amber-300"
            : "border-slate-700/50 bg-slate-900/50 text-slate-400";

    const statusText =
      status === "passed" ? "verified" : status === "failed" ? "failed" : status === "checking" ? "checking" : "waiting";

    return (
      <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em]">{label}</p>
        <p className="mt-0.5 text-[10px] capitalize">{statusText}</p>
      </div>
    );
  }

  function renderTerminalPanel() {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-950/80 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Verifier Terminal</p>
        <div className="max-h-52 overflow-auto rounded-lg border border-slate-700/60 bg-slate-950/70 p-2 font-mono text-[10px] leading-5">
          <AnimatePresence initial={false}>
            {verifierTerminalLines.map((line, i) => (
              <motion.p
                key={`${line}-${i}`}
                className={resolveTerminalLineClass(line)}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
              >
                <span className="mr-1 select-none text-slate-600">&gt;</span>
                {line}
              </motion.p>
            ))}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-4 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950/85"
      style={visualVars}
    >
      {zkError ? (
        <p className="border-b border-rose-900/50 bg-rose-950/30 px-4 py-3 text-[12px] text-rose-300">{zkError}</p>
      ) : null}
      {zkLoading ? (
        <div className="flex items-center gap-2 border-b border-slate-700/60 bg-slate-900/50 px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-lime-400 animate-pulse" />
          <p className="text-[12px] text-slate-300">Generating zk proof and verifier artifacts...</p>
        </div>
      ) : null}

      <section className="border-b border-slate-700/60 px-4 py-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-cyan-800/50 bg-cyan-950/20 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Merkle Proof</p>
            <p className="mt-1 text-[11px] text-slate-300">Membership and sum consistency are proven from the tree path.</p>
          </div>
          <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">ZK Solvency</p>
            <p className="mt-1 text-[11px] text-slate-300">PLONK proves reserves cover liabilities without exposing balances.</p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Bridge Status</p>
            <p className={`mt-1 text-[11px] font-semibold ${proofLinkStatus === "linked" ? "text-emerald-400" : "text-rose-400"}`}>
              {proofLinkStatus === "linked" ? "Linked root across both proofs" : "Root link missing"}
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-700/60 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Pipeline</p>
          <span className="ml-auto rounded-full border border-slate-700/60 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300">phase {proverPhase}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW_NODES.map((node) => {
            const isActive = activeFlowNode === node.id;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelectedPanel(node.panelKey)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  isActive
                    ? "border-cyan-500/50 bg-cyan-950/35"
                    : "border-slate-700/60 bg-slate-900/50 hover:border-slate-600/60 hover:bg-slate-900/70"
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200">{node.label}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{node.sublabel}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-b border-slate-700/60 px-4 py-4">
        <div className="mb-4 flex flex-wrap gap-2">
          {([
            { key: "overview", label: "Overview" },
            { key: "verify", label: "Verifier" },
            { key: "result", label: "Result" },
            { key: "attacker", label: "Attacker" },
          ] as { key: PanelKey; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedPanel(key)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition ${
                selectedPanel === key
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-700/50 bg-slate-900/50 text-slate-400 hover:border-slate-600/60 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {selectedPanel === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <h3 className="text-[13px] font-semibold text-slate-100">Proof Overview</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Private Witness Inputs</p>
                  <div className="mt-2 space-y-2 text-[11px] text-slate-300">
                    <p><span className="text-slate-500">Focus account:</span> {focusUser}</p>
                    <p><span className="text-slate-500">Focus balance:</span> {focusBalance}</p>
                    <p><span className="text-slate-500">Circuit size:</span> N={zkPayload?.circuitVariant ?? "?"}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/25 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Public Bridge Signals</p>
                  <div className="mt-2 space-y-2 text-[11px] text-cyan-100">
                    <p><span className="text-cyan-400">Merkle root:</span> {shortFingerprint(rootHash)}</p>
                    <p><span className="text-cyan-400">Reserves:</span> {zkPayload?.metadata.reserves ?? "-"}</p>
                    <p>
                      <span className="text-cyan-400">Coupling:</span>{" "}
                      <span className={zkPayload?.couplingStatus === "linked" ? "text-emerald-400" : "text-rose-400"}>
                        {zkPayload?.couplingStatus ?? "-"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Prover Stages</p>
                  <div className="mt-2 space-y-2">
                    {stageCards.length > 0 ? (
                      stageCards.map((stage) => (
                        <div key={stage.id} className="rounded-lg border border-slate-700/50 bg-slate-950/70 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-medium text-slate-300">{stage.label}</p>
                            <p className="text-[10px] text-slate-500">{stage.progress ?? 0}%</p>
                          </div>
                          <p className="mt-0.5 text-[10px] text-slate-500">{stage.detail}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-slate-500">Stage data appears after proof generation.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/25 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Proof Output</p>
                  <div className="mt-2 space-y-1.5 text-[11px] text-emerald-100">
                    <p><span className="text-emerald-400">Fingerprint:</span> {shortFingerprint(zkPayload?.fingerprint)}</p>
                    <p><span className="text-emerald-400">Protocol:</span> {zkPayload?.protocol ?? "PLONK"}</p>
                    <p><span className="text-emerald-400">Curve:</span> {zkPayload?.curve ?? "BN254"}</p>
                    {piPackets.length > 0 ? (
                      <div className="pt-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-400">Commitments</p>
                        {piPackets.map((packet) => (
                          <p key={packet.commitmentKey} className="font-mono text-[10px]">
                            {packet.piLabel}: {packet.payload}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={onReplayTransfer}
                    disabled={!transferEnabled}
                    className="mt-3 w-full rounded-lg border border-emerald-600/50 bg-emerald-500/10 px-3 py-2 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {transferEnabled ? "Replay Proof Transfer" : "Generating proof..."}
                  </button>
                </div>
              </div>

              {metrics.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{m.label}</p>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-300">{m.value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </motion.div>
          )}

          {selectedPanel === "verify" && (
            <motion.div
              key="verify"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <h3 className="text-[13px] font-semibold text-slate-100">Verifier</h3>
              <p className="text-[11px] text-slate-600">Run root-link and pairing checks. Result tab shows the final pipeline status and logs.</p>

              <div className="grid gap-3">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-slate-500">Public Merkle Root</label>
                  <input
                    value={verifyRoot}
                    onChange={(e) => onVerifyRootChange(e.target.value)}
                    placeholder="Public Merkle Root"
                    className="ledger-input text-[12px]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-slate-500">Public User ID</label>
                  <input
                    value={verifyAddress}
                    onChange={(e) => onVerifyAddressChange(e.target.value)}
                    placeholder="Public User ID"
                    className="ledger-input text-[12px]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-slate-500">zk Proof JSON</label>
                  <textarea
                    value={verifyProofInput}
                    onChange={(e) => onVerifyProofInputChange(e.target.value)}
                    placeholder="Paste proof JSON..."
                    className="ledger-input min-h-28 font-mono text-[10px]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onVerifyProof}
                    className="rounded-lg border border-cyan-600/50 bg-cyan-500/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/20"
                  >
                    Run Pairing Check
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPanel("result")}
                    className="rounded-lg border border-emerald-600/50 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-200 transition hover:bg-emerald-500/20"
                  >
                    Open Result
                  </button>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                      isProofTampered
                        ? "border-rose-600/50 bg-rose-950/30 text-rose-300"
                        : "border-emerald-600/50 bg-emerald-950/30 text-emerald-300"
                    }`}
                  >
                    {isProofTampered ? "tampered" : "intact"}
                  </span>
                </div>
              </div>

              {peekMessage ? (
                <p className="rounded-lg border border-slate-700/50 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">{peekMessage}</p>
              ) : null}
            </motion.div>
          )}

          {selectedPanel === "result" && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <h3 className="text-[13px] font-semibold text-slate-100">Pipeline Result</h3>

              <div className="grid gap-2 sm:grid-cols-3">
                {renderPipelineStep("Merkle Check", pipelineStatus.merkle)}
                {renderPipelineStep("Root Bridge", pipelineStatus.bridge)}
                {renderPipelineStep("ZK Verify", pipelineStatus.zk)}
              </div>

              <motion.div
                className={`rounded-2xl border p-6 text-center ${
                  verifierPhase === "passed"
                    ? "border-emerald-700/50 bg-emerald-950/30"
                    : verifierPhase === "failed"
                      ? "border-rose-700/50 bg-rose-950/30"
                      : "border-slate-700/60 bg-slate-900/50"
                }`}
                animate={verifierPhase === "passed" && !shouldReduceMotion ? { scale: [1, 1.015, 1] } : {}}
                transition={{ duration: 1.8, repeat: Infinity }}
              >
                <p
                  className={`mb-2 text-3xl font-bold ${
                    verifierPhase === "passed"
                      ? "text-emerald-300"
                      : verifierPhase === "failed"
                        ? "text-rose-400"
                        : "text-slate-400"
                  }`}
                >
                  {verifierPhase === "passed"
                    ? "ACCEPTED"
                    : verifierPhase === "failed"
                      ? "REJECTED"
                      : verifierPhase === "checking"
                        ? "CHECKING"
                        : "PENDING"}
                </p>
                      <p className="text-[12px] text-slate-400">{zkVerificationResult}</p>
              </motion.div>

              {renderTerminalPanel()}
            </motion.div>
          )}

          {selectedPanel === "attacker" && (
            <motion.div
              key="attacker"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="space-y-3"
            >
              <h3 className="text-[13px] font-semibold text-slate-100">Attacker Tests</h3>
              <p className="text-[11px] text-slate-600">Try sabotage inputs to confirm the system rejects invalid proofs.</p>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-400">Range Check Attack</p>
                  <p className="mt-2 text-[10px] text-slate-400">Inject a negative balance and expect rejection.</p>
                  <label className="mt-2 block text-[10px] uppercase tracking-[0.1em] text-slate-500">Injected balance</label>
                  <input
                    value={rangeAttackBalance}
                    onChange={(e) => setRangeAttackBalance(e.target.value)}
                    placeholder="-500"
                    className="mt-1 w-full rounded-lg border border-rose-900/50 bg-slate-950/80 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-rose-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => onSabotageRangeCheck(Number(rangeAttackBalance))}
                    disabled={!isRangeAttackInputValid}
                    className="mt-2 w-full rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-rose-300 transition hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Inject Negative Balance
                  </button>
                </div>

                <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-400">Insolvency Attack</p>
                  <p className="mt-2 text-[10px] text-slate-400">Force reserves below liabilities and expect rejection.</p>
                  <label className="mt-2 block text-[10px] uppercase tracking-[0.1em] text-slate-500">Forced reserves</label>
                  <input
                    value={insolvencyReserves}
                    onChange={(e) => setInsolvencyReserves(e.target.value)}
                    placeholder="0"
                    className="mt-1 w-full rounded-lg border border-rose-900/50 bg-slate-950/80 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-rose-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => onSabotageInsolvency(Number(insolvencyReserves))}
                    disabled={!isInsolvencyInputValid}
                    className="mt-2 w-full rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-rose-300 transition hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Force Insolvency
                  </button>
                </div>

                <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-400">Proof Tamper Attack</p>
                  <p className="mt-2 text-[10px] text-slate-400">Mutate one nibble of the proof to trigger failure.</p>
                  <button
                    type="button"
                    onClick={onSabotageMutateProof}
                    disabled={!zkPayload}
                    className="mt-6 w-full rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-rose-300 transition hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Mutate Proof Nibble
                  </button>
                </div>
              </div>

              {sabotageMessage ? (
                <div
                  className={`rounded-xl border px-4 py-3 text-[11px] ${
                    sabotageMessage.startsWith("FAIL:")
                      ? "border-rose-600/50 bg-rose-950/30 text-rose-300"
                      : "border-amber-700/50 bg-amber-950/30 text-amber-300"
                  }`}
                >
                  {sabotageMessage}
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[10px] text-slate-600">
        <span className="ml-auto">
          {zkPayload ? `${zkPayload.metadata.usersProvided}/${zkPayload.metadata.maxUsers} slots used` : "awaiting proof"}
        </span>
      </section>
    </div>
  );
}