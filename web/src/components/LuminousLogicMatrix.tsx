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

const RING_BLUEPRINT = [
  { id: "A", size: 246, offsetX: -16, offsetY: -8, speedFactor: 1, hueShift: 0, direction: 1 },
  { id: "B", size: 184, offsetX: 13, offsetY: 11, speedFactor: 1.25, hueShift: 34, direction: -1 },
  { id: "C", size: 128, offsetX: 0, offsetY: -16, speedFactor: 1.5, hueShift: 68, direction: 1 },
] as const;

function shortFingerprint(hash: string | undefined) {
  if (!hash) return "-";
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function resolvePiSuffix(key: string, index: number) {
  if (key === "A") {
    return "a";
  }
  if (key === "B") {
    return "b";
  }
  if (key === "C") {
    return "c";
  }
  return `${index + 1}`;
}

const PROVING_CHECKS = [
  "Checking: Is balance > 0? ... YES",
  "Checking: Does user path match Merkle root? ... YES",
  "Checking: Are total liabilities <= total reserves? ... YES",
] as const;

function resolveCrystalShadow(verifierPhase: VerifierPhase) {
  if (verifierPhase === "passed") {
    return "0 0 30px hsl(calc(var(--user-hue) + 42deg) 84% 62% / 0.45)";
  }
  if (verifierPhase === "failed") {
    return "0 0 26px rgba(251, 113, 133, 0.42)";
  }
  return "0 0 20px rgb(var(--user-glow-rgb) / 0.28)";
}

function resolveCrystalScale(proverPhase: ProverPhase) {
  if (proverPhase === "emission") {
    return [0.88, 1.05, 1];
  }
  if (proverPhase === "settled") {
    return 1.02;
  }
  return 0.96;
}

function resolveActivePathIndex(proverPhase: ProverPhase, totalSteps: number) {
  if (totalSteps === 0 || proverPhase === "idle") {
    return -1;
  }

  if (proverPhase === "inflow") {
    return Math.max(0, Math.floor(totalSteps * 0.34));
  }

  if (proverPhase === "proving") {
    return Math.max(0, Math.floor(totalSteps * 0.7));
  }

  return totalSteps - 1;
}

function selectPiPackets(
  zkPayload: ZkVisualizationPayload | null,
  proverActivePackets: ZkProverEventPayload[],
): PiPacket[] {
  const sourcePackets =
    proverActivePackets.length > 0
      ? proverActivePackets
      : (zkPayload?.proverEvents ?? []).filter((event) => event.stage === "commitment-emission");

  if (sourcePackets.length === 0) {
    return [];
  }

  const preferredKeys = ["A", "B", "C"];
  const selected: ZkProverEventPayload[] = [];

  for (const key of preferredKeys) {
    const packet = sourcePackets.find((event) => event.commitmentKey === key);
    if (packet) {
      selected.push(packet);
    }
  }

  if (selected.length < 3) {
    const known = new Set(selected);
    for (const packet of sourcePackets) {
      if (known.has(packet)) {
        continue;
      }
      selected.push(packet);
      if (selected.length >= 3) {
        break;
      }
    }
  }

  return selected.slice(0, 3).map((packet, index) => {
    const key = packet.commitmentKey ?? `P${index + 1}`;
    const suffix = resolvePiSuffix(key, index);
    return {
      commitmentKey: key,
      piLabel: `pi_${suffix}`,
      payload: shortFingerprint(packet.packetHash),
    };
  });
}

function resolveRingState(phase: ProverPhase) {
  if (phase === "idle") {
    return { opacity: 0.34, duration: 18, offsetScale: 1, scale: 0.97, pulse: 0.35 };
  }
  if (phase === "inflow") {
    return { opacity: 0.58, duration: 8.2, offsetScale: 0.55, scale: 1, pulse: 0.5 };
  }
  if (phase === "proving") {
    return { opacity: 0.9, duration: 2.1, offsetScale: 0.2, scale: 1.04, pulse: 0.85 };
  }
  if (phase === "emission") {
    return { opacity: 0.95, duration: 0.48, offsetScale: 0, scale: 1.02, pulse: 1 };
  }
  return { opacity: 0.76, duration: 9.5, offsetScale: 0, scale: 1, pulse: 0.55 };
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
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [selectedPanel, setSelectedPanel] = useState<"telemetry" | "verifier" | "attacker">("verifier");
  const [rangeAttackBalance, setRangeAttackBalance] = useState("-500");
  const [insolvencyReserves, setInsolvencyReserves] = useState("0");
  const shouldReduceMotion = useReducedMotion();
  const pathSteps = snapshot?.proofPhantomPath?.stepSequence ?? [];
  const activePathIndex = useMemo(() => resolveActivePathIndex(proverPhase, pathSteps.length), [proverPhase, pathSteps.length]);
  const stageCards = zkPayload?.stages ?? [];
  const metrics = zkPayload?.metrics ?? [];
  const piPackets = useMemo(() => selectPiPackets(zkPayload, proverActivePackets), [zkPayload, proverActivePackets]);
  const visualVars = useMemo(() => toVisualProfileStyle(visualProfile) as CSSProperties, [visualProfile]);
  const rootHash = snapshot?.root.hash ?? verifyRoot;
  const focusUser = proof?.userId ?? (verifyAddress || "-");
  const ringState = resolveRingState(proverPhase);
  const circuitVariantLabel = zkPayload?.circuitVariant ? `N=${zkPayload.circuitVariant}` : "unknown";
  const couplingLabel = zkPayload?.couplingStatus ?? "missing";

  let verifierToneClass = "border-slate-600/40 bg-slate-900/70";
  if (verifierPhase === "passed") {
    verifierToneClass = "border-lime-400/45 bg-lime-500/10 atlas-verifier-pass";
  }
  if (verifierPhase === "failed") {
    verifierToneClass = "border-rose-400/45 bg-rose-500/10 atlas-verifier-fail";
  }

  const crystalShadow = resolveCrystalShadow(verifierPhase);
  const crystalScale = resolveCrystalScale(proverPhase);

  return (
    <div className="mt-4 space-y-6" style={visualVars}>
      {zkError ? (
        <p className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{zkError}</p>
      ) : null}

      {zkLoading ? <p className="text-sm text-slate-300">Synchronizing cryptographic circuit state...</p> : null}

      <section className="rounded-2xl border border-cyan-400/30 bg-cyan-950/35 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-cyan-300">Explain It To Me</p>
        <h3 className="mt-1 text-lg font-semibold text-cyan-100">What is happening here?</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-200">
          <li>
            The system takes your <span className="font-semibold text-cyan-200">Private Balance</span> and the
            <span className="font-semibold text-amber-200"> Public Exchange Total</span>.
          </li>
          <li>
            It runs complex math to create a <span className="font-semibold text-lime-200">zk-SNARK receipt</span>, a tiny mathematical proof.
          </li>
          <li>
            Anyone can verify this receipt and know your funds are included and solvent,
            <span className="font-semibold text-cyan-200"> without seeing your balance</span>.
          </li>
        </ol>
      </section>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.2fr_0.95fr]">
        <section className="rounded-2xl border border-slate-500/35 bg-slate-950/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Fiber-Optic Phantom Feed</p>
            <p className="text-[11px] text-slate-400">Private inputs flow in. Public proof comes out.</p>
            <span className="ml-auto rounded-md border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
              root: {shortFingerprint(rootHash)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <article className="rounded-xl border border-cyan-400/35 bg-cyan-950/35 p-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-cyan-300">Hidden Inputs (Private)</p>
              <div className="mt-2 rounded-lg border border-cyan-400/30 bg-slate-900/80 px-3 py-2">
                <p className="text-xs text-slate-300">Account ID</p>
                <p className="mt-1 font-mono text-sm text-cyan-100 blur-[1px]">{focusUser}</p>
              </div>
              <div className="mt-2 rounded-lg border border-cyan-400/30 bg-slate-900/80 px-3 py-2">
                <p className="text-xs text-slate-300">Exact Balance</p>
                <p className="mt-1 font-mono text-sm text-cyan-100 blur-[1px]">{focusBalance}</p>
              </div>
              <p className="mt-2 text-[11px] text-cyan-200/85">Locked in a digital envelope before proving.</p>
            </article>

            <article className="rounded-xl border border-lime-400/35 bg-lime-950/25 p-3">
              <p className="text-[11px] uppercase tracking-[0.14em] text-lime-300">Public Inputs (Transparent)</p>
              <div className="mt-2 rounded-lg border border-lime-400/30 bg-slate-900/80 px-3 py-2">
                <p className="text-xs text-slate-300">Merkle Root</p>
                <p className="mt-1 font-mono text-sm text-lime-100">{shortFingerprint(rootHash)}</p>
              </div>
              <div className="mt-2 rounded-lg border border-lime-400/30 bg-slate-900/80 px-3 py-2">
                <p className="text-xs text-slate-300">Total Exchange Reserves</p>
                <p className="mt-1 text-sm font-semibold text-amber-200">{zkPayload?.metadata.reserves ?? "-"}</p>
              </div>
              <p className="mt-2 text-[11px] text-lime-200/90">Visible to everyone and used for instant checks.</p>
            </article>
          </div>

          {zkPayload ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-500/35 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                variant <span className="font-semibold text-cyan-200">{circuitVariantLabel}</span>
              </div>
              <div className="rounded-lg border border-slate-500/35 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                merkle root <span className="font-semibold text-lime-200">{shortFingerprint(zkPayload.merkleRoot)}</span>
              </div>
              <div className="rounded-lg border border-slate-500/35 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                coupling <span className="font-semibold capitalize text-amber-200">{couplingLabel}</span>
              </div>
            </div>
          ) : null}

          <div className="phantom-intake-shell mt-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Focused Inclusion Path</p>
            <p className="mt-1 text-sm text-slate-200">
              user <span className="font-semibold text-cyan-200">{focusUser}</span>
            </p>

            <div className="mt-3 space-y-2">
              {pathSteps.length > 0 ? (
                pathSteps.map((step, index) => {
                  const isActivated = step.step <= activePathIndex;
                  const isCurrentFlow = proverPhase === "inflow" && index === activePathIndex;

                  return (
                    <motion.article
                      key={`${step.step}-${step.treeNodeId}`}
                      className="relative overflow-hidden rounded-lg border px-3 py-2"
                      animate={{
                        borderColor: isActivated ? "hsl(var(--user-hue) 84% 60% / 0.62)" : "rgba(100, 116, 139, 0.3)",
                        backgroundColor: isActivated ? "hsl(var(--user-hue) 58% 22% / 0.58)" : "rgba(15, 23, 42, 0.72)",
                      }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.32 }}
                    >
                      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">step {step.step}</p>
                      <p className="text-xs text-slate-200">node {step.treeNodeId}</p>
                      <p className="text-[11px] text-slate-400">position {step.position}</p>

                      <AnimatePresence>
                        {isCurrentFlow ? (
                          <motion.div
                            key={`merge-${step.step}`}
                            className="mt-2 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <p className="text-[11px] uppercase tracking-[0.1em] text-cyan-200">active merge: sibling hashes combined</p>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </motion.article>
                  );
                })
              ) : (
                <p className="text-xs text-slate-400">Path mapping will appear after snapshot metadata is ready.</p>
              )}
            </div>

            <button
              type="button"
              onClick={onReplayTransfer}
              disabled={!transferEnabled}
              className="mt-3 w-full rounded-lg border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Replay tree to engine transfer"
            >
              {transferEnabled ? "tree to engine transfer" : "processing"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-500/35 bg-slate-950/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-lime-300">Zero-Knowledge Proof Generator</p>
            <span className="ml-auto rounded-md border border-cyan-300/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">
              phase: {proverPhase}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-300">
            Creates a cryptographic receipt proving this user is included in the exchange total without exposing private balances.
          </p>

          <div className="relative mt-3 min-h-63 overflow-hidden rounded-2xl border border-slate-500/35 bg-[radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.22),transparent_38%),radial-gradient(circle_at_80%_72%,rgba(132,204,22,0.16),transparent_42%),linear-gradient(140deg,rgba(2,6,23,0.94),rgba(15,23,42,0.92))]">
            {RING_BLUEPRINT.map((ring) => (
              <motion.span
                key={ring.id}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                style={{
                  width: ring.size,
                  height: ring.size,
                  borderColor: `hsl(calc(var(--user-hue) + ${ring.hueShift}deg) 82% 62% / 0.72)`,
                  boxShadow: `0 0 24px hsl(calc(var(--user-hue) + ${ring.hueShift}deg) 82% 62% / 0.26)`,
                }}
                animate={
                  shouldReduceMotion
                    ? {
                        opacity: ringState.opacity,
                        x: 0,
                        y: 0,
                        scale: ringState.scale,
                      }
                    : {
                        rotate: ring.direction * 360,
                        opacity: ringState.opacity,
                        x: ring.offsetX * ringState.offsetScale,
                        y: ring.offsetY * ringState.offsetScale,
                        scale: ringState.scale,
                      }
                }
                transition={
                  shouldReduceMotion
                    ? { duration: 0.2 }
                    : {
                        duration: ringState.duration / ring.speedFactor,
                        repeat: proverPhase === "emission" ? 0 : Infinity,
                        ease: "linear",
                      }
                }
              />
            ))}

            <motion.div
              className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-amber-300/55 bg-slate-900/80 text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-100"
              animate={{
                scale: proverPhase === "proving" ? [1, 1.07, 1] : 1,
                boxShadow:
                  proverPhase === "proving"
                    ? "0 0 22px rgba(251,191,36,0.35)"
                    : "0 0 12px rgba(148,163,184,0.18)",
              }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.7, repeat: proverPhase === "proving" ? Infinity : 0 }}
            >
              {proverPhase === "inflow" ? "ENVELOPE" : proverPhase === "emission" || proverPhase === "settled" ? "STAMP" : "PROOF"}
            </motion.div>

            <AnimatePresence>
              {proverPhase === "proving" ? (
                <motion.div
                  key="constraint-cue"
                  className="absolute left-1/2 top-5 -translate-x-1/2 rounded-md border border-lime-300/40 bg-lime-500/15 px-2 py-2 text-[10px] tracking-[0.08em] text-lime-100"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.25 }}
                >
                  {PROVING_CHECKS.map((line) => (
                    <p key={line} className="text-[10px] leading-4">
                      {line}
                    </p>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {(proverPhase === "emission" || proverPhase === "settled") &&
                piPackets.map((packet, index) => (
                  <motion.span
                    key={`${packet.piLabel}-${proverPhase}-${index}`}
                    className="absolute left-6 rounded-full border border-lime-300/60 bg-lime-500/15 px-2 py-1 text-[10px] uppercase tracking-widest text-lime-100"
                    initial={{ x: 0, y: 72 + index * 34, opacity: 0, scale: 0.82 }}
                    animate={{
                      x: proverPhase === "emission" ? 250 : 228,
                      y: 72 + index * 34,
                      opacity: proverPhase === "emission" ? [0, 1, 1] : 0.9,
                      scale: 1,
                    }}
                    exit={{ x: 314, opacity: 0, scale: 0.86 }}
                    transition={{
                      duration: shouldReduceMotion ? 0.2 : 0.75,
                      delay: shouldReduceMotion ? 0 : index * 0.12,
                      ease: "easeOut",
                    }}
                    title={`${packet.commitmentKey}: ${packet.payload}`}
                  >
                    {packet.piLabel}
                  </motion.span>
                ))}
            </AnimatePresence>

            <div className="absolute bottom-3 left-3 rounded-md border border-cyan-300/25 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-100">
              {proverPhase === "inflow"
                ? "wrapping private data in a digital envelope"
                : proverPhase === "proving"
                  ? "running solvency checks"
                  : proverPhase === "emission"
                    ? "emitting zk-SNARK receipt"
                    : `ring pulse: ${Math.round(ringState.pulse * 100)}%`}
            </div>
          </div>

          <p className="mt-3 text-[11px] text-slate-300">Sealed Evidence Fragments move through the proving engine and combine into one final receipt.</p>

          <div className="mt-3 space-y-2">
            {stageCards.map((stage) => (
              <article key={stage.id} className={`rounded-xl border px-3 py-2 ${stage.status === "active" ? "border-lime-300/50 bg-lime-500/10" : "border-slate-500/35 bg-slate-900/70"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{stage.id}</p>
                  <p className="text-xs text-lime-200">{stage.progress ?? 0}%</p>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-100">{stage.label}</p>
                <p className="mt-1 text-xs text-slate-300">{stage.detail}</p>
              </article>
            ))}
          </div>

          {zkPayload ? (
            <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
              {zkPayload.couplingStatus === "linked"
                ? "Merkle root is bound into the solvency proof and verified with the selected circuit key."
                : "The proof envelope is missing a merkle-root link or it does not match the circuit signal."}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-500/35 bg-slate-950/80 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">The zk-SNARK Receipt</p>
          <p className="mt-1 text-[11px] text-slate-300">A tiny, instantly verifiable file that proves solvency without revealing balances.</p>

          <div className="relative mt-3 min-h-47 overflow-hidden rounded-xl border border-slate-500/35 bg-slate-900/70 p-4">
            <AnimatePresence>
              {proverPhase === "emission"
                ? piPackets.map((packet, index) => (
                    <motion.span
                      key={`merge-${packet.piLabel}-${index}`}
                      className="absolute left-3 top-8 rounded-full border border-cyan-300/55 bg-cyan-500/15 px-2 py-1 text-[10px] uppercase tracking-widest text-cyan-100"
                      initial={{ x: -12, y: index * 30, opacity: 0, scale: 0.75 }}
                      animate={{ x: 124, y: 42, opacity: [0, 1, 0], scale: [0.75, 1, 0.58] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.55, delay: shouldReduceMotion ? 0 : index * 0.11, ease: "easeInOut" }}
                    >
                      sealed-{index + 1}
                    </motion.span>
                  ))
                : null}
            </AnimatePresence>

            <motion.div
              className="mx-auto mt-4 flex h-24 w-24 items-center justify-center rounded-xl border border-cyan-300/45 bg-slate-950/70"
              animate={{
                scale: crystalScale,
                boxShadow: crystalShadow,
              }}
              transition={{ duration: shouldReduceMotion ? 0.2 : 0.6, ease: "easeOut" }}
            >
              <motion.span
                className="h-10 w-10 rounded-lg border border-cyan-200/65 bg-cyan-200/20"
                animate={
                  shouldReduceMotion
                    ? { opacity: 1 }
                    : {
                        rotate: proverPhase === "proving" ? 90 : 0,
                        scale: proverPhase === "settled" ? [1, 1.04, 1] : 1,
                      }
                }
                transition={{ duration: shouldReduceMotion ? 0.2 : 1.2, repeat: proverPhase === "settled" ? Infinity : 0 }}
              />
            </motion.div>

            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-slate-400">proof artifact</p>
            <p className="text-sm text-slate-200">{zkVerificationResult}</p>
            <p className="mt-2 text-xs text-slate-400">{shortFingerprint(zkPayload?.fingerprint)}</p>
          </div>

          <div className="mt-3 space-y-2">
            {metrics.slice(0, 3).map((metric) => (
              <div key={metric.label} className="rounded-lg border border-slate-500/30 bg-slate-900/70 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{metric.label}</p>
                <p className="mt-1 text-sm font-semibold text-lime-200">{metric.value}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedDetails((current) => !current)}
            className="mt-3 w-full rounded-lg border border-slate-500/35 bg-slate-900/70 px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-slate-800/80"
          >
            {showAdvancedDetails ? "Hide Advanced Technical Details" : "Show Advanced Technical Details"}
          </button>

          {showAdvancedDetails ? (
            <div className="mt-2 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 py-2 text-xs text-slate-200">
              <p>
                Protocol: <span className="font-semibold text-lime-300">{zkPayload?.protocol ?? "-"}</span>
              </p>
              <p className="mt-1">
                Curve: <span className="font-semibold text-cyan-200">{zkPayload?.curve ?? "-"}</span>
              </p>
              <p className="mt-1">
                Sealed Evidence Fragments: <span className="font-semibold text-amber-300">A/B/C commitments</span>
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-500/30 bg-slate-950/70 p-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Analysis & Experiment Panel</p>
            <select
              value={selectedPanel}
              onChange={(event) => setSelectedPanel(event.target.value as "telemetry" | "verifier" | "attacker")}
              className="rounded-lg border border-slate-500/50 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-400/50"
            >
              <option value="telemetry">📊 Proof Telemetry</option>
              <option value="verifier">✓ Verifier Playground</option>
              <option value="attacker">⚠️ Attacker's Area</option>
            </select>
          </div>

          <AnimatePresence mode="wait">
            {selectedPanel === "telemetry" && (
              <motion.div
                key="telemetry"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <div className="mt-4 space-y-2">
                  {metrics.map((metric) => (
                    <div key={metric.label} className="rounded-lg border border-slate-500/30 bg-slate-900/70 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{metric.label}</p>
                      <p className="mt-1 text-sm font-semibold text-lime-200">{metric.value}</p>
                      <p className="text-xs text-slate-400">{metric.hint}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 py-2 text-xs text-slate-200">
                  <p>
                    Public reserves: <span className="font-semibold text-amber-300">{zkPayload?.metadata.reserves ?? "-"}</span>
                  </p>
                  <p className="mt-1">
                    Circuit occupancy: <span className="font-semibold text-cyan-200">{zkPayload?.metadata.usersProvided ?? 0}</span>
                    /{zkPayload?.metadata.maxUsers ?? 0}
                  </p>
                </div>
              </motion.div>
            )}

            {selectedPanel === "verifier" && (
              <motion.div
                key="verifier"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <p className="mt-3 text-xs text-slate-300">Verify the proof against the public merkle root, address and proof receipt.</p>
                <div className="mt-3 grid gap-3">
                  <input
                    value={verifyRoot}
                    onChange={(event) => onVerifyRootChange(event.target.value)}
                    placeholder="Public Merkle Root"
                    className="ledger-input"
                  />
                  <input
                    value={verifyAddress}
                    onChange={(event) => onVerifyAddressChange(event.target.value)}
                    placeholder="Public User ID"
                    className="ledger-input"
                  />
                  <textarea
                    value={verifyProofInput}
                    onChange={(event) => onVerifyProofInputChange(event.target.value)}
                    placeholder="zk-SNARK Receipt Payload"
                    className="ledger-input min-h-24"
                  />
                </div>
                <div className="mt-3 grid gap-2">
                  <button type="button" onClick={onVerifyProof} className="ledger-button w-full">
                    Verify zk-SNARK Receipt
                  </button>
                  <div className="rounded-lg border border-slate-500/30 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
                    Status: <span className={isProofTampered ? "font-semibold text-rose-200" : "font-semibold text-lime-200"}>{isProofTampered ? "tampered" : "intact"}</span>
                  </div>
                </div>
                {peekMessage ? (
                  <p className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">{peekMessage}</p>
                ) : null}
                <p className="mt-3 text-sm text-slate-200">
                  Result: <span className="font-semibold text-lime-300">{zkVerificationResult}</span>
                </p>
              </motion.div>
            )}

            {selectedPanel === "attacker" && (
              <motion.div
                key="attacker"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <p className="mt-3 text-xs text-slate-300">Experiment with sabotage attacks. The cryptography blocks all three.</p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg border border-rose-400/40 bg-rose-950/30 p-3">
                    <p className="text-xs font-semibold text-rose-300">Sabotage 1: Break Range Check</p>
                    <p className="mt-1 text-[11px] text-slate-300">Try to create a proof with a negative balance (-500). The circuit has a cryptographic range proof that blocks it.</p>
                    <label className="mt-2 block text-[10px] uppercase tracking-[0.1em] text-rose-200/90">Injected balance value</label>
                    <input
                      value={rangeAttackBalance}
                      onChange={(event) => setRangeAttackBalance(event.target.value)}
                      placeholder="-500"
                      className="mt-1 w-full rounded-md border border-rose-300/45 bg-slate-900/80 px-2 py-1 text-xs text-rose-100"
                    />
                    <button
                      type="button"
                      onClick={() => onSabotageRangeCheck(Number(rangeAttackBalance))}
                      disabled={zkLoading}
                      className="mt-2 w-full rounded-lg border border-rose-300/50 bg-rose-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Attempt: Negative Balance
                    </button>
                  </div>

                  <div className="rounded-lg border border-orange-400/40 bg-orange-950/30 p-3">
                    <p className="text-xs font-semibold text-orange-300">Sabotage 2: Break Solvency Check</p>
                    <p className="mt-1 text-[11px] text-slate-300">Try to prove solvency when total liabilities exceed reserves by overriding the public <span className="font-semibold text-orange-200">reserves</span> request parameter.</p>
                    <label className="mt-2 block text-[10px] uppercase tracking-[0.1em] text-orange-200/90">Forced reserves parameter</label>
                    <input
                      value={insolvencyReserves}
                      onChange={(event) => setInsolvencyReserves(event.target.value)}
                      placeholder="0"
                      className="mt-1 w-full rounded-md border border-orange-300/45 bg-slate-900/80 px-2 py-1 text-xs text-orange-100"
                    />
                    <button
                      type="button"
                      onClick={() => onSabotageInsolvency(Number(insolvencyReserves))}
                      disabled={zkLoading}
                      className="mt-2 w-full rounded-lg border border-orange-300/50 bg-orange-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-orange-100 transition hover:bg-orange-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Attempt: Liabilities &gt; Reserves
                    </button>
                  </div>

                  <div className="rounded-lg border border-amber-400/40 bg-amber-950/30 p-3">
                    <p className="text-xs font-semibold text-amber-300">Sabotage 3: Tamper with Cryptographic Proof</p>
                    <p className="mt-1 text-[11px] text-slate-300">Mutate one nibble inside a proof hash value. Verification fails instantly at the pairing check.</p>
                    <button
                      type="button"
                      onClick={onSabotageMutateProof}
                      disabled={!zkPayload}
                      className="mt-2 w-full rounded-lg border border-amber-300/50 bg-amber-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-amber-100 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Mutate Proof Character
                    </button>
                  </div>

                  {sabotageMessage ? (
                    <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{sabotageMessage}</p>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="rounded-2xl border border-slate-500/30 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Verifier Terminal</p>
          <div className={`mt-3 rounded-xl border p-3 ${verifierToneClass}`}>
            <div className="max-h-52 overflow-auto font-mono text-[11px] leading-5 text-lime-200">
              <AnimatePresence initial={false}>
                {verifierTerminalLines.map((line, index) => (
                  <motion.p
                    key={`${line}-${index}`}
                    className="atlas-terminal-line"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={{ duration: shouldReduceMotion ? 0 : 0.24, delay: shouldReduceMotion ? 0 : index * 0.03 }}
                  >
                    {line}
                  </motion.p>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}