"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, type CSSProperties } from "react";
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
  transferEnabled,
  visualProfile,
}: Readonly<LuminousLogicMatrixProps>) {
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

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.2fr_0.95fr]">
        <section className="rounded-2xl border border-slate-500/35 bg-slate-950/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Fiber-Optic Phantom Feed</p>
            <span className="ml-auto rounded-md border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
              root: {shortFingerprint(rootHash)}
            </span>
          </div>

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
                            className="pointer-events-none relative mt-2 h-5"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <motion.span
                              className="absolute left-0 top-2 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.75)]"
                              animate={
                                shouldReduceMotion
                                  ? { opacity: 1 }
                                  : { x: [0, 20, 32], opacity: [0, 1, 1, 0], scale: [0.8, 1, 0.7] }
                              }
                              transition={{ duration: 0.85, repeat: shouldReduceMotion ? 0 : Infinity, repeatDelay: 0.25 }}
                            />
                            <motion.span
                              className="absolute right-0 top-2 h-2 w-2 rounded-full bg-lime-300 shadow-[0_0_12px_rgba(132,204,22,0.8)]"
                              animate={
                                shouldReduceMotion
                                  ? { opacity: 1 }
                                  : { x: [0, -20, -32], opacity: [0, 1, 1, 0], scale: [0.8, 1, 0.7] }
                              }
                              transition={{ duration: 0.85, repeat: shouldReduceMotion ? 0 : Infinity, repeatDelay: 0.25 }}
                            />
                            <motion.span
                              className="absolute left-1/2 top-1.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-emerald-200 shadow-[0_0_14px_rgba(110,231,183,0.9)]"
                              animate={
                                shouldReduceMotion
                                  ? { opacity: 1 }
                                  : { y: [6, 0, -8], opacity: [0, 1, 1, 0], scale: [0.5, 1.05, 0.85] }
                              }
                              transition={{ duration: 0.85, repeat: shouldReduceMotion ? 0 : Infinity, repeatDelay: 0.25 }}
                            />
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

            <div className="relative mt-4 h-12 overflow-hidden rounded-lg border border-cyan-400/25 bg-slate-900/75">
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 56" preserveAspectRatio="none">
                <path
                  d="M10 38 C 75 36, 110 12, 175 18 S 260 30, 292 26"
                  fill="none"
                  stroke="rgba(56,189,248,0.55)"
                  strokeWidth="2"
                />
              </svg>
              {(proverPhase === "inflow" || proverPhase === "proving" || proverPhase === "emission") &&
                [0, 1, 2].map((particle) => (
                  <motion.span
                    key={`bridge-particle-${particle}`}
                    className="absolute left-2 top-7 h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(56,189,248,0.85)]"
                    animate={
                      shouldReduceMotion
                        ? { opacity: 0.9 }
                        : {
                            x: [0, 76, 138, 198, 250],
                            y: [0, -12, -17, -10, -14],
                            opacity: [0, 1, 1, 1, 0],
                            scale: [0.7, 1, 1, 1, 0.7],
                          }
                    }
                    transition={{
                      duration: 1.25,
                      repeat: shouldReduceMotion ? 0 : Infinity,
                      delay: particle * 0.2,
                      ease: "easeInOut",
                    }}
                  />
                ))}
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
            <p className="text-xs uppercase tracking-[0.2em] text-lime-300">R1CS Proving Engine</p>
            <span className="ml-auto rounded-md border border-cyan-300/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">
              phase: {proverPhase}
            </span>
          </div>

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
              R1CS
            </motion.div>

            <AnimatePresence>
              {proverPhase === "proving" ? (
                <motion.div
                  key="constraint-cue"
                  className="absolute left-1/2 top-5 -translate-x-1/2 rounded-md border border-lime-300/40 bg-lime-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-lime-100"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: [0.35, 1, 0.35], y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.9, repeat: shouldReduceMotion ? 0 : Infinity }}
                >
                  A * B = C
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {proverPhase === "emission" ? (
                <motion.span
                  key="emission-burst"
                  className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/55"
                  initial={{ opacity: 0.85, scale: 0.45 }}
                  animate={{ opacity: 0, scale: 2.3 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.65, ease: "easeOut" }}
                />
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
              ring pulse: {Math.round(ringState.pulse * 100)}%
            </div>
          </div>

          <p className="mt-3 text-[11px] text-slate-400">UI aliases map PLONK A/B/C commitments to pi_a/pi_b/pi_c labels for readability.</p>

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
        </section>

        <section className="rounded-2xl border border-slate-500/35 bg-slate-950/80 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Succinct Proof Output</p>

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
                      {packet.piLabel}
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

          <div className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-3 py-2 text-xs text-slate-200">
            <p>
              Protocol: <span className="font-semibold text-lime-300">{zkPayload?.protocol ?? "-"}</span>
            </p>
            <p className="mt-1">
              Curve: <span className="font-semibold text-cyan-200">{zkPayload?.curve ?? "-"}</span>
            </p>
            <p className="mt-1">
              Reserves: <span className="font-semibold text-amber-300">{zkPayload?.metadata.reserves ?? "-"}</span>
            </p>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-slate-500/30 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Proof Telemetry</p>
          <div className="mt-3 space-y-2">
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
        </section>

        <section className="rounded-2xl border border-slate-500/30 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Verifier Inputs</p>
          <div className="mt-3 grid gap-3">
            <input
              value={verifyRoot}
              onChange={(event) => onVerifyRootChange(event.target.value)}
              placeholder="Merkle Root"
              className="ledger-input"
            />
            <input
              value={verifyAddress}
              onChange={(event) => onVerifyAddressChange(event.target.value)}
              placeholder="User Public Address"
              className="ledger-input"
            />
            <textarea
              value={verifyProofInput}
              onChange={(event) => onVerifyProofInputChange(event.target.value)}
              placeholder="Proof Payload"
              className="ledger-input min-h-24"
            />
          </div>
          <button type="button" onClick={onVerifyProof} className="ledger-button mt-3 w-full">
            Verify R1CS
          </button>
          <p className="mt-3 text-sm text-slate-200">
            Result: <span className="font-semibold text-lime-300">{zkVerificationResult}</span>
          </p>
        </section>

        <section className="rounded-2xl border border-slate-500/30 bg-slate-950/70 p-4 xl:col-span-2">
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