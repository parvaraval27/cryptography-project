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
  if (proverPhase === "emission") return "public-signals";
  if (proverPhase === "proving") return "proof-gen";
  if (proverPhase === "inflow") return "witness-gen";
  if (proverPhase === "settled") return "public-signals";
  if (zkPayload) return "public-signals";
  return "user-input";
}

type PanelKey = "inputs" | "circuit" | "witness" | "keys" | "proof" | "public" | "verify" | "result" | "attacker";

type FlowNode = {
  id: FlowNodeId;
  label: string;
  sublabel: string;
  zone: "prover" | "verifier" | "setup";
  color: "green" | "orange" | "yellow" | "white";
  panelKey: PanelKey;
};

const FLOW_NODES: FlowNode[] = [
  { id: "user-input",       label: "User Balances",      sublabel: "accountId + balance",    zone: "prover",   color: "white",  panelKey: "inputs"  },
  { id: "merkle-tree",      label: "Merkle Sum Tree",    sublabel: "root + inclusion path",  zone: "prover",   color: "white",  panelKey: "inputs"  },
  { id: "circuit-compiler", label: "Circuit Compiler",   sublabel: "Circom → WASM + r1cs",   zone: "prover",   color: "green",  panelKey: "circuit" },
  { id: "witness-gen",      label: "Witness Generator",  sublabel: "Circom WASM",            zone: "prover",   color: "green",  panelKey: "witness" },
  { id: "key-gen",          label: "Key Generator",      sublabel: "snarkjs setup • PTAU",   zone: "setup",    color: "yellow", panelKey: "keys"    },
  { id: "proof-gen",        label: "Proof Generation",   sublabel: "SnarkJS PLONK",          zone: "prover",   color: "orange", panelKey: "proof"   },
  { id: "public-signals",   label: "Public Signals",     sublabel: "reserves + merkleRoot",  zone: "prover",   color: "white",  panelKey: "public"  },
  { id: "proof-verify",     label: "Proof Verification", sublabel: "SnarkJS PLONK",          zone: "verifier", color: "orange", panelKey: "verify"  },
  { id: "result",           label: "Accept / Reject",    sublabel: "pairing check result",   zone: "verifier", color: "white",  panelKey: "result"  },
];

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
  const [selectedPanel, setSelectedPanel] = useState<PanelKey>("inputs");
  const shouldReduceMotion = useReducedMotion();

  const piPackets = useMemo(() => selectPiPackets(zkPayload, proverActivePackets), [zkPayload, proverActivePackets]);
  const visualVars = useMemo(() => toVisualProfileStyle(visualProfile) as CSSProperties, [visualProfile]);
  const rootHash = snapshot?.root.hash ?? verifyRoot;
  const focusUser = proof?.userId ?? (verifyAddress || "-");
  const activeFlowNode = resolveActiveFlowNode(proverPhase, verifierPhase, zkPayload);
  const metrics = zkPayload?.metrics ?? [];
  const stageCards = zkPayload?.stages ?? [];

  const successTone = "text-emerald-300";
  const dangerTone = "text-rose-400";
  const secondaryTone = "text-slate-400";

  function nodeColorClass(node: FlowNode, isActive: boolean) {
    if (isActive) {
      if (node.color === "green") return "border-emerald-400/80 bg-emerald-500/20 shadow-[0_0_16px_rgba(52,211,153,0.3)]";
      if (node.color === "orange") return "border-amber-400/80 bg-amber-500/20 shadow-[0_0_16px_rgba(251,191,36,0.3)]";
      if (node.color === "yellow") return "border-yellow-300/80 bg-yellow-400/20 shadow-[0_0_16px_rgba(250,204,21,0.28)]";
      return "border-cyan-400/80 bg-cyan-500/15 shadow-[0_0_16px_rgba(34,211,238,0.28)]";
    }
    if (node.color === "green") return "border-emerald-800/50 bg-emerald-950/30 hover:border-emerald-600/60";
    if (node.color === "orange") return "border-amber-800/50 bg-amber-950/30 hover:border-amber-600/60";
    if (node.color === "yellow") return "border-yellow-800/50 bg-yellow-950/30 hover:border-yellow-600/60";
    return "border-slate-700/50 bg-slate-900/50 hover:border-slate-500/60";
  }

  function nodeLabelColor(node: FlowNode, isActive: boolean) {
    if (!isActive) return "text-slate-400";
    if (node.color === "green") return "text-emerald-200";
    if (node.color === "orange") return "text-amber-200";
    if (node.color === "yellow") return "text-yellow-200";
    return "text-cyan-200";
  }

  function handleNodeClick(node: FlowNode) {
    setSelectedPanel(node.panelKey);
  }

  function FlowCard({ node }: { node: FlowNode }) {
    const isActive = activeFlowNode === node.id;
    const isSelected = selectedPanel === node.panelKey;

    return (
      <motion.button
        type="button"
        onClick={() => handleNodeClick(node)}
        className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 ${nodeColorClass(node, isActive)} ${isSelected ? "ring-1 ring-white/25" : ""}`}
        animate={isActive && !shouldReduceMotion ? { scale: [1, 1.015, 1] } : { scale: 1 }}
        transition={{ duration: 1.6, repeat: isActive ? Infinity : 0 }}
      >
        {isActive ? (
          <span
            className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full animate-ping"
            style={{ backgroundColor: node.color === "green" ? "#34d399" : node.color === "orange" ? "#fbbf24" : node.color === "yellow" ? "#facc15" : "#22d3ee" }}
          />
        ) : null}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${nodeLabelColor(node, isActive)}`}>{node.label}</p>
            <p className="mt-0.5 text-[9px] text-slate-500">{node.sublabel}</p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] ${node.color === "green" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : node.color === "orange" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : node.color === "yellow" ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-200" : "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"}`}>
            {node.zone}
          </span>
        </div>
      </motion.button>
    );
  }

  function FlowArrow({ label }: { label: string }) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700/70 bg-slate-950/80 text-slate-300">↓</span>
        <span className="leading-none">{label}</span>
      </div>
    );
  }

  const verifierToneClass =
    verifierPhase === "passed"
      ? "border-emerald-500/50 bg-slate-950/90"
      : verifierPhase === "failed"
        ? "border-rose-500/50 bg-slate-950/90"
        : "border-slate-700/60 bg-slate-950/90";

  const proverNodes = FLOW_NODES.filter((n) => n.zone === "prover");
  const setupNodes  = FLOW_NODES.filter((n) => n.zone === "setup");
  const verifierNodes = FLOW_NODES.filter((n) => n.zone === "verifier");

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950/85" style={visualVars}>
      {zkError ? (
        <p className={`border-b border-slate-700/60 px-4 py-3 text-[12px] ${dangerTone}`}>{zkError}</p>
      ) : null}
      {zkLoading ? (
        <div className="border-b border-slate-700/60 px-4 py-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-lime-400 animate-pulse" />
          <p className={`text-[12px] ${secondaryTone}`}>Generating zk-SNARK proof — compiling witness and running PLONK prover...</p>
        </div>
      ) : null}

      {/* ── INTERACTIVE FLOW DIAGRAM ─────────────────────────────────── */}
      <section className="border-b border-slate-700/60 px-4 pt-5 pb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-lime-500/50 bg-lime-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-lime-300">
            Live Flow
          </span>
          <p className={`text-[11px] ${secondaryTone}`}>
            Highlighted node = active step. Click any node to inspect it below.
          </p>
          <span className={`ml-auto rounded-md border border-slate-700/50 bg-slate-900/60 px-2 py-0.5 text-[10px] ${secondaryTone}`}>
            phase: <span className="text-slate-200">{proverPhase}</span>
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.55fr_0.78fr_0.95fr]">
          <article className="rounded-xl border border-cyan-800/50 bg-cyan-950/20 p-3">
            <div className="rounded-lg border border-cyan-800/50 bg-cyan-950/35 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-400">
              🔒 Prover Side
            </div>
            <div className="mt-3 space-y-2">
              {proverNodes.map((node, index) => (
                <div key={node.id} className="space-y-2">
                  <FlowCard node={node} />
                  {index < proverNodes.length - 1 ? <FlowArrow label={index === 0 ? "build leaves" : index === 1 ? "compile circuit" : index === 2 ? "compute witness" : "emit proof"} /> : null}
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-3">
            <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/35 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-400">
              🔑 Setup / Keys
            </div>
            <div className="mt-3 space-y-2">
              {setupNodes.map((node, index) => (
                <div key={node.id} className="space-y-2">
                  <FlowCard node={node} />
                  {index === 0 ? <FlowArrow label="snarkjs setup • PTAU" /> : null}
                </div>
              ))}
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/55 p-3 text-[10px] text-slate-300">
                <p className="font-semibold uppercase tracking-[0.14em] text-yellow-200">Key routing</p>
                <p className="mt-1">zkey → Proof Generation</p>
                <p className="mt-0.5">vkey → Proof Verification</p>
              </div>
            </div>
          </article>

          <article className="rounded-xl border border-violet-800/50 bg-violet-950/20 p-3">
            <div className="rounded-lg border border-violet-800/50 bg-violet-950/35 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-violet-400">
              ✓ Verifier Side
            </div>
            <div className="mt-3 space-y-2">
              {verifierNodes.map((node, index) => (
                <div key={node.id} className="space-y-2">
                  <FlowCard node={node} />
                  {index === 0 ? <FlowArrow label="proof + publicSignals" /> : null}
                </div>
              ))}
            </div>
          </article>
        </div>

        <div className="mt-3 grid gap-2 rounded-xl border border-slate-700/50 bg-slate-950/50 p-3 text-[10px] text-slate-500 sm:grid-cols-3">
          <p>Private data stays on the prover side.</p>
          <p>Proof + publicSignals travel to the verifier.</p>
          <p>Blue, yellow, and violet lanes show computation, keys, and verification.</p>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-600">
          <span>🔒 Private data stays on Prover side</span>
          <span>•</span>
          <span>📤 Only <span className="text-slate-400">proof + publicSignals</span> cross to Verifier</span>
          <span>•</span>
          <span className="text-emerald-700">■ circuit computation</span>
          <span className="text-amber-700">■ zk-proof ops</span>
          <span className="text-yellow-700">■ keys</span>
        </div>
      </section>

      {/* ── DETAIL PANEL ─────────────────────────────────────────────── */}
      <section className="border-b border-slate-700/60 px-4 py-4">
        {/* Tab bar */}
        <div className="grid grid-cols-2 gap-1.5 mb-4 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-9">
          {([
            { key: "inputs",   label: "📥 Inputs"         },
            { key: "circuit",  label: "⚙️ Circuit"        },
            { key: "witness",  label: "👁 Witness"         },
            { key: "keys",     label: "🔑 Keys"            },
            { key: "proof",    label: "🔐 Proof Gen"       },
            { key: "public",   label: "📤 Public Signals"  },
            { key: "verify",   label: "✓ Verifier"         },
            { key: "result",   label: "🏁 Result"          },
            { key: "attacker", label: "⚠️ Attacker"       },
          ] as { key: PanelKey; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedPanel(key)}
              className={`w-full rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-all ${
                selectedPanel === key
                  ? "border-lime-500/60 bg-lime-500/15 text-lime-200"
                  : "border-slate-700/50 bg-slate-900/50 text-slate-500 hover:text-slate-300 hover:border-slate-600/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">

          {/* ── INPUTS ── */}
          {selectedPanel === "inputs" && (
            <motion.div key="inputs" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-3">Input Stream — What enters the prover</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-400 mb-3">🔒 Private Inputs (witness)</p>
                  <div className="space-y-2">
                    <div className="rounded-lg border border-slate-700/50 bg-slate-950/70 px-3 py-2">
                      <p className="text-[10px] text-slate-500">Account ID</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-100 blur-sm select-none">{focusUser}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700/50 bg-slate-950/70 px-3 py-2">
                      <p className="text-[10px] text-slate-500">Exact Balance</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-100 blur-sm select-none">{focusBalance}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700/50 bg-slate-950/70 px-3 py-2">
                      <p className="text-[10px] text-slate-500">All balances[] in circuit</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">N={zkPayload?.circuitVariant ?? "?"} slots, zero-padded</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-600">These are passed into Circom WASM as witness signals. They never leave the prover.</p>
                </div>
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-400 mb-3">📤 Public Inputs (transparent)</p>
                  <div className="space-y-2">
                    <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/30 px-3 py-2">
                      <p className="text-[10px] text-slate-500">Merkle Root</p>
                      <p className="mt-0.5 font-mono text-[11px] text-cyan-200 break-all">{shortFingerprint(rootHash)}</p>
                    </div>
                    <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/30 px-3 py-2">
                      <p className="text-[10px] text-slate-500">Exchange Reserves</p>
                      <p className="mt-0.5 text-[12px] font-semibold text-cyan-200">{zkPayload?.metadata.reserves ?? "—"}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-600">Only these two values exit as publicSignals. Total liabilities stay hidden.</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3 text-[11px] text-slate-400">
                SHA-256 Merkle root (256-bit) is reduced mod BN254 prime before entering the circuit:
                <code className="ml-1 text-slate-200">merkleRoot mod p → toFieldElementDecimal()</code>
              </div>
            </motion.div>
          )}

          {/* ── CIRCUIT ── */}
          {selectedPanel === "circuit" && (
            <motion.div key="circuit" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-3">Circuit Compiler — Circom 2.x → WASM + r1cs</h3>
              <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4 mb-3 overflow-x-auto">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400 mb-2">Solvency Circuit (abridged)</p>
                <pre className="text-[10px] leading-5 text-slate-300 font-mono whitespace-pre">{`template RangeCheck(N) {
  signal input in;          // value to check
  signal bits[N];           // bit decomposition
  var acc = 0;
  for (var i = 0; i < N; i++) {
    bits[i] <-- (in >> i) & 1;
    bits[i] * (bits[i] - 1) === 0; // must be 0 or 1
    acc += (1 << i) * bits[i];
  }
  acc === in;               // reconstruct original
}

template Solvency(N) {
  signal input  balances[N];      // PRIVATE witness
  signal input  reserves;         // PRIVATE witness
  signal input  merkleRoot;       // PRIVATE witness
  signal output reservesPublic;   // PUBLIC signal
  signal output merkleRootPublic; // PUBLIC signal

  // Constraint 1: each balance fits in 64 bits
  // Constraint 2: totalSum = sum(balances)
  // Constraint 3: reserves - totalSum >= 0
  //               (via RangeCheck(256) on difference)
}`}</pre>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-3">
                  <p className="text-[10px] font-semibold text-emerald-400 mb-1">Variant selected</p>
                  <p className="text-[12px] text-slate-100">N = {zkPayload?.circuitVariant ?? "—"}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Pre-compiled: [16, 32, 64, 128, 256]. Runtime selects smallest N ≥ userCount.</p>
                </div>
                <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-3">
                  <p className="text-[10px] font-semibold text-emerald-400 mb-1">Enforced constraints</p>
                  <p className="text-[11px] text-slate-300">• 64-bit range check on each balance[i]</p>
                  <p className="text-[11px] text-slate-300">• Cumulative sum integrity</p>
                  <p className="text-[11px] text-slate-300">• reserves − totalSum ≥ 0</p>
                  <p className="text-[11px] text-slate-300">• Merkle root passthrough → public</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── WITNESS ── */}
          {selectedPanel === "witness" && (
            <motion.div key="witness" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-3">Witness Generator — Private inputs → all circuit signals</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400 mb-2">What the WASM does</p>
                  <ol className="list-decimal pl-4 space-y-1.5 text-[11px] text-slate-300">
                    <li>Receives private balances[], reserves, merkleRoot</li>
                    <li>Runs <code className="text-slate-100">Solvency_js/Solvency.wasm</code></li>
                    <li>Computes intermediate signals (bit decompositions, partial sums)</li>
                    <li>Outputs <code className="text-slate-100">witness.wtns</code></li>
                  </ol>
                  <p className="mt-3 text-[10px] text-slate-600">The witness is ephemeral — used only to generate the proof, never stored or transmitted.</p>
                </div>
                <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-400 mb-2">Stage progress</p>
                  {stageCards.length > 0 ? stageCards.map((stage) => (
                    <div key={stage.id} className="mb-2 rounded-lg border border-slate-700/40 bg-slate-950/60 px-3 py-2">
                      <div className="flex justify-between items-center">
                        <p className="text-[10px] font-medium text-slate-300">{stage.label}</p>
                        <p className={`text-[10px] ${stage.status === "active" ? "text-emerald-400" : "text-slate-500"}`}>{stage.progress ?? 0}%</p>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{stage.detail}</p>
                    </div>
                  )) : (
                    <p className="text-[11px] text-slate-500">Stage data will appear after proof generation.</p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── KEYS ── */}
          {selectedPanel === "keys" && (
            <motion.div key="keys" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-3">Key Material — PTAU Ceremony → zkey → vkey</h3>
              <div className="grid gap-3 sm:grid-cols-3 mb-3">
                <div className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-300 mb-2">PTAU Ceremony</p>
                  <p className="text-[11px] text-slate-300">Hermez Network Powers of Tau. Hundreds of contributors. Secure if ≥1 discards their toxic waste.</p>
                  <p className="text-[10px] text-slate-500 mt-2">File: <code className="text-slate-300">hermez.ptau</code></p>
                </div>
                <div className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-300 mb-2">Proving Key (.zkey)</p>
                  <p className="text-[11px] text-slate-300">Circuit-specific. Derived from PTAU + r1cs in a phase-2 contribution. Used only by the prover.</p>
                  <p className="text-[10px] text-slate-500 mt-2">→ <code className="text-slate-300">snarkjs.plonk.fullProve()</code></p>
                </div>
                <div className="rounded-xl border border-yellow-800/50 bg-yellow-950/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-yellow-300 mb-2">Verification Key (.vkey)</p>
                  <p className="text-[11px] text-slate-300">Extracted from .zkey. Public. Given to every verifier. Contains α, β, γ, δ from SRS.</p>
                  <p className="text-[10px] text-slate-500 mt-2">→ <code className="text-slate-300">snarkjs.plonk.verify()</code></p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 px-4 py-3 text-[11px] text-slate-400">
                Protocol: <span className="text-yellow-300">{zkPayload?.protocol ?? "PLONK"}</span> &nbsp;•&nbsp;
                Curve: <span className="text-yellow-300">{zkPayload?.curve ?? "BN254"}</span> &nbsp;•&nbsp;
                Circuit N: <span className="text-yellow-300">{zkPayload?.circuitVariant ?? "?"}</span> &nbsp;•&nbsp;
                Occupancy: <span className="text-yellow-300">{zkPayload?.metadata.usersProvided ?? 0}/{zkPayload?.metadata.maxUsers ?? "?"}</span>
              </div>
            </motion.div>
          )}

          {/* ── PROOF GEN ── */}
          {selectedPanel === "proof" && (
            <motion.div key="proof" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-3">Proof Generation — snarkjs.plonk.fullProve()</h3>

              {/* Animated proving engine */}
              <div
                className="relative overflow-hidden rounded-2xl mb-4"
                style={{
                  minHeight: 180,
                  background: "radial-gradient(circle at 22% 18%, rgba(56,189,248,0.16),transparent 40%), radial-gradient(circle at 78% 72%, rgba(251,191,36,0.14),transparent 40%), linear-gradient(140deg,rgba(2,6,23,0.96),rgba(15,23,42,0.92))",
                  border: "1px solid rgba(100,116,139,0.35)"
                }}
              >
                {[
                  { size: 140, speed: proverPhase === "proving" ? 2 : 9, dir: 1,  hue: 0  },
                  { size: 100, speed: proverPhase === "proving" ? 1.3 : 6, dir: -1, hue: 40 },
                  { size: 62,  speed: proverPhase === "proving" ? 0.9 : 4, dir: 1,  hue: 20 },
                ].map((ring, i) => (
                  <motion.span
                    key={i}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                    style={{
                      width: ring.size, height: ring.size,
                      borderColor: `hsl(calc(var(--user-hue) + ${ring.hue}deg) 80% 62% / 0.65)`,
                      boxShadow: `0 0 16px hsl(calc(var(--user-hue) + ${ring.hue}deg) 80% 62% / 0.2)`,
                    }}
                    animate={shouldReduceMotion ? {} : {
                      rotate: ring.dir * 360,
                      opacity: proverPhase === "idle" ? 0.3 : 0.82,
                    }}
                    transition={{ duration: ring.speed, repeat: Infinity, ease: "linear" }}
                  />
                ))}
                <motion.div
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-xl border border-amber-300/50 bg-slate-900/80 w-16 h-12 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-100"
                  animate={proverPhase === "proving" ? {
                    scale: [1, 1.08, 1],
                    boxShadow: ["0 0 10px rgba(251,191,36,0.18)", "0 0 22px rgba(251,191,36,0.42)", "0 0 10px rgba(251,191,36,0.18)"]
                  } : {}}
                  transition={{ duration: 0.7, repeat: Infinity }}
                >
                  {proverPhase === "inflow" ? "⬇ IN" : proverPhase === "proving" ? "PROVE" : proverPhase === "emission" ? "⬆ OUT" : "PLONK"}
                </motion.div>
                <AnimatePresence>
                  {(proverPhase === "emission" || proverPhase === "settled") && piPackets.map((packet, i) => (
                    <motion.span
                      key={`${packet.piLabel}-${i}`}
                      className="absolute left-8 top-4 rounded-full border border-lime-300/60 bg-lime-500/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-lime-100"
                      initial={{ x: 0, y: i * 30, opacity: 0, scale: 0.8 }}
                      animate={{ x: 220, y: i * 30, opacity: [0, 1, 0.8], scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.7, delay: i * 0.1, ease: "easeOut" }}
                    >
                      {packet.piLabel}
                    </motion.span>
                  ))}
                </AnimatePresence>
                <div className="absolute bottom-3 left-3 rounded-md border border-cyan-300/20 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200">
                  {proverPhase === "inflow" ? "Encoding witness into polynomial commitments..."
                    : proverPhase === "proving" ? "Running PLONK constraint satisfaction..."
                    : proverPhase === "emission" ? "Emitting proof: pi_a, pi_b, pi_c + publicSignals"
                    : proverPhase === "settled" ? "✓ Proof sealed and ready for transfer"
                    : "Awaiting witness input"}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3">
                  <p className="text-[10px] font-semibold text-amber-300 mb-1">What PLONK produces</p>
                  <p className="text-[11px] text-slate-300">A ≈800-byte proof: polynomial commitments A, B, C as BN254 elliptic curve points. Plus 2 public signals.</p>
                </div>
                <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-3">
                  <p className="text-[10px] font-semibold text-slate-300 mb-1">Proof fingerprint</p>
                  <p className="font-mono text-[10px] text-slate-400 break-all">{shortFingerprint(zkPayload?.fingerprint) ?? "—"}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Coupling: <span className={zkPayload?.couplingStatus === "linked" ? "text-emerald-400" : "text-rose-400"}>{zkPayload?.couplingStatus ?? "—"}</span>
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── PUBLIC SIGNALS ── */}
          {selectedPanel === "public" && (
            <motion.div key="public" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-1">Public Signals — What the world can see</h3>
              <p className="text-[11px] text-slate-400 mb-4">The only outputs that cross the prover→verifier boundary. Everything else stays private.</p>
              <div className="grid gap-3 sm:grid-cols-2 mb-4">
                <div className="rounded-xl border border-cyan-800/50 bg-cyan-950/25 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300 mb-2">reservesPublic</p>
                  <p className="font-mono text-[15px] font-semibold text-cyan-100">{zkPayload?.metadata.reserves ?? "—"}</p>
                  <p className="mt-2 text-[10px] text-slate-500">Exchange's verified reserve amount. Publicly auditable.</p>
                </div>
                <div className="rounded-xl border border-cyan-800/50 bg-cyan-950/25 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300 mb-2">merkleRootPublic</p>
                  <p className="font-mono text-[11px] text-cyan-100 break-all">{shortFingerprint(rootHash)}</p>
                  <p className="mt-2 text-[10px] text-slate-500">Cryptographic commitment to all user balances. Verifier matches this against the proof.</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4 mb-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300 mb-2">What the verifier does NOT learn</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  <span className="text-rose-400">❌ Individual balances</span>
                  <span className="text-rose-400">❌ Total liabilities</span>
                  <span className="text-rose-400">❌ User identities</span>
                </div>
                <p className="mt-2 text-[10px] text-slate-500">PLONK achieves this via polynomial blinding — random masking added to witness polynomials before commitment.</p>
              </div>
              {metrics.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 mb-3">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-lg border border-slate-700/40 bg-slate-900/60 px-3 py-2">
                      <p className="text-[10px] text-slate-500 uppercase tracking-[0.12em]">{m.label}</p>
                      <p className="mt-0.5 text-[12px] font-medium text-emerald-300">{m.value}</p>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={onReplayTransfer}
                disabled={!transferEnabled}
                className="w-full rounded-xl border border-lime-600/50 bg-lime-500/10 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-lime-200 transition hover:bg-lime-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {transferEnabled ? "↻ Replay Proof Transfer Animation" : "⏳ Generating proof..."}
              </button>
            </motion.div>
          )}

          {/* ── VERIFIER ── */}
          {selectedPanel === "verify" && (
            <motion.div key="verify" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-1">Verifier — snarkjs.plonk.verify(vkey, publicSignals, proof)</h3>
              <p className="text-[11px] text-slate-400 mb-4">
                Checks BN254 bilinear pairing: <code className="text-slate-200 text-[10px]">e(A,B) == e(α,β)·e(pubCommit,γ)·e(C,δ)</code>
              </p>
              <div className="grid gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.12em] text-slate-500 mb-1">Public Merkle Root</label>
                  <input value={verifyRoot} onChange={(e) => onVerifyRootChange(e.target.value)} placeholder="Public Merkle Root" className="ledger-input text-[12px]" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.12em] text-slate-500 mb-1">Public User ID</label>
                  <input value={verifyAddress} onChange={(e) => onVerifyAddressChange(e.target.value)} placeholder="Public User ID" className="ledger-input text-[12px]" />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.12em] text-slate-500 mb-1">zk-SNARK Receipt (JSON)</label>
                  <textarea value={verifyProofInput} onChange={(e) => onVerifyProofInputChange(e.target.value)} placeholder="Paste proof JSON..." className="ledger-input min-h-24 font-mono text-[10px]" />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onVerifyProof}
                    className="flex-1 rounded-xl border border-violet-600/50 bg-violet-500/10 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200 transition hover:bg-violet-500/20"
                  >
                    ✓ Run Pairing Check
                  </button>
                  <div className={`rounded-lg border px-3 py-2 text-[11px] ${isProofTampered ? "border-rose-600/50 bg-rose-950/30 text-rose-300" : "border-slate-700/50 bg-slate-900/50 text-slate-500"}`}>
                    {isProofTampered ? "⚠ tampered" : "intact"}
                  </div>
                </div>
              </div>
              {peekMessage && (
                <p className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">{peekMessage}</p>
              )}
            </motion.div>
          )}

          {/* ── RESULT ── */}
          {selectedPanel === "result" && (
            <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-3">Verification Result</h3>
              <motion.div
                className={`rounded-2xl border p-6 text-center mb-4 ${
                  verifierPhase === "passed" ? "border-emerald-500/60 bg-emerald-950/30"
                    : verifierPhase === "failed" ? "border-rose-500/60 bg-rose-950/30"
                    : "border-slate-600/40 bg-slate-900/50"
                }`}
                animate={verifierPhase === "passed" && !shouldReduceMotion ? { scale: [1, 1.018, 1] } : {}}
                transition={{ duration: 1.8, repeat: Infinity }}
              >
                <p className={`text-3xl font-bold mb-2 ${verifierPhase === "passed" ? "text-emerald-300" : verifierPhase === "failed" ? "text-rose-400" : "text-slate-400"}`}>
                  {verifierPhase === "passed" ? "✓ ACCEPTED" : verifierPhase === "failed" ? "✗ REJECTED" : verifierPhase === "checking" ? "⏳ CHECKING" : "PENDING"}
                </p>
                <p className={`text-[12px] ${secondaryTone}`}>{zkVerificationResult}</p>
              </motion.div>
              <div className={`rounded-xl border p-3 ${verifierToneClass}`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Verifier Terminal</p>
                <div className="max-h-48 overflow-auto font-mono text-[10px] leading-5">
                  <AnimatePresence initial={false}>
                    {verifierTerminalLines.map((line, i) => (
                      <motion.p
                        key={`${line}-${i}`}
                        className={verifierPhase === "failed" ? "text-rose-400" : "text-emerald-300"}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
                      >
                        <span className="text-slate-700 select-none mr-1">&gt;</span>{line}
                      </motion.p>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── ATTACKER ── */}
          {selectedPanel === "attacker" && (
            <motion.div key="attacker" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h3 className="text-[13px] font-semibold text-slate-100 mb-1">Attacker's Area — Three sabotage attempts, all blocked</h3>
              <p className="text-[11px] text-slate-400 mb-4">Each attack targets a specific cryptographic guarantee. Try them to watch the circuit reject them.</p>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-400 mb-2">Sabotage 1: Range Check</p>
                  <p className="text-[10px] text-slate-400 mb-3">Inject a negative balance. <code className="text-slate-300">RangeCheck(64)</code> prevents bit-decomposing negative values in the finite field.</p>
                  <label className="block text-[10px] uppercase tracking-[0.12em] text-slate-600 mb-1">Injected balance</label>
                  <input
                    value={rangeAttackBalance}
                    onChange={(e) => setRangeAttackBalance(e.target.value)}
                    placeholder="-500"
                    className="w-full rounded-lg border border-rose-900/50 bg-slate-950/80 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-rose-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => onSabotageRangeCheck(Number(rangeAttackBalance))}
                    className="mt-2 w-full rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-rose-300 transition hover:bg-rose-900/40"
                  >
                    Inject Negative Balance
                  </button>
                </div>

                <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-400 mb-2">Sabotage 2: Solvency</p>
                  <p className="text-[10px] text-slate-400 mb-3">Override reserves below liabilities. The circuit enforces <code className="text-slate-300">difference ≥ 0</code> via <code className="text-slate-300">RangeCheck(256)</code>.</p>
                  <label className="block text-[10px] uppercase tracking-[0.12em] text-slate-600 mb-1">Forced reserves</label>
                  <input
                    value={insolvencyReserves}
                    onChange={(e) => setInsolvencyReserves(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-rose-900/50 bg-slate-950/80 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-rose-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => onSabotageInsolvency(Number(insolvencyReserves))}
                    className="mt-2 w-full rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-rose-300 transition hover:bg-rose-900/40"
                  >
                    Force Insolvency
                  </button>
                </div>

                <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-400 mb-2">Sabotage 3: Tamper Proof</p>
                  <p className="text-[10px] text-slate-400 mb-3">Flip one nibble in a proof hash. BN254 pairing detects even a single bit flip. Security: 2<sup>128</sup> ops to forge.</p>
                  <button
                    type="button"
                    onClick={onSabotageMutateProof}
                    disabled={!zkPayload}
                    className="mt-2 w-full rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-rose-300 transition hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Mutate One Proof Nibble
                  </button>
                </div>
              </div>

              {sabotageMessage && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`mt-4 rounded-xl border px-4 py-3 text-[11px] ${sabotageMessage.startsWith("❌") ? "border-rose-600/50 bg-rose-950/30 text-rose-300" : "border-amber-700/50 bg-amber-950/30 text-amber-300"}`}
                >
                  {sabotageMessage}
                </motion.div>
              )}

              <div className={`mt-4 rounded-xl border p-3 ${verifierToneClass}`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Verifier Terminal</p>
                <div className="max-h-36 overflow-auto font-mono text-[10px] leading-5">
                  <AnimatePresence initial={false}>
                    {verifierTerminalLines.map((line, i) => (
                      <motion.p
                        key={`${line}-${i}`}
                        className={verifierPhase === "failed" ? "text-rose-400" : "text-emerald-300"}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
                      >
                        <span className="text-slate-700 select-none mr-1">&gt;</span>{line}
                      </motion.p>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </section>

      {/* ── BOTTOM STATUS BAR ─────────────────────────────────────────── */}
      <section className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="text-slate-600">Proof system:</span>
        <span className="text-slate-300">{zkPayload?.protocol ?? "PLONK"}</span>
        <span className="text-slate-700">•</span>
        <span className="text-slate-600">Curve:</span>
        <span className="text-slate-300">{zkPayload?.curve ?? "BN254"}</span>
        <span className="text-slate-700">•</span>
        <span className="text-slate-600">Ceremony:</span>
        <span className="text-slate-300">Hermez PTAU</span>
        <span className="text-slate-700">•</span>
        <span className="text-slate-600">Coupling:</span>
        <span className={zkPayload?.couplingStatus === "linked" ? "text-emerald-400" : "text-rose-400"}>
          {zkPayload?.couplingStatus ?? "—"}
        </span>
        <span className="ml-auto text-slate-600">
          {zkPayload ? `${zkPayload.metadata.usersProvided}/${zkPayload.metadata.maxUsers} slots used` : "awaiting proof"}
        </span>
      </section>
    </div>
  );
}
