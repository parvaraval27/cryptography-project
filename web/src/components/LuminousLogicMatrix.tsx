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
  const proofSystemNote = "Proof system: PLONK • Ceremony origin: Hermez ptau file • Regenerate with npm run setup";
  const successTone = "text-[var(--color-text-success,#86efac)]";
  const dangerTone = "text-[var(--color-text-danger,#fda4af)]";
  const secondaryTone = "text-[var(--color-text-secondary,#94a3b8)]";

  let verifierToneClass = "border-slate-700/70 bg-slate-950/90";
  if (verifierPhase === "passed") {
    verifierToneClass = "border-[var(--color-text-success,#86efac)]/50 bg-slate-950/90 atlas-verifier-pass";
  }
  if (verifierPhase === "failed") {
    verifierToneClass = "border-[var(--color-text-danger,#fda4af)]/50 bg-slate-950/90 atlas-verifier-fail";
  }

  const crystalShadow = resolveCrystalShadow(verifierPhase);
  const crystalScale = resolveCrystalScale(proverPhase);

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950/85" style={visualVars}>
      {zkError ? (
        <p className={`border-b border-slate-700/60 px-4 py-3 text-[12px] ${dangerTone}`}>{zkError}</p>
      ) : null}

      {zkLoading ? <p className={`border-b border-slate-700/60 px-4 py-3 text-[12px] ${secondaryTone}`}>Synchronizing cryptographic circuit state...</p> : null}

      <section className="border-b border-slate-700/60 px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Setup origin</p>
            <p className="mt-1 text-[12px] font-normal text-slate-200">{proofSystemNote}</p>
          </div>
          <div className={`border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-[11px] font-normal ${secondaryTone}`}>
            Public signals: Merkle root + reserves only
          </div>
        </div>
      </section>

      <section className="border-b border-slate-700/60 px-4 py-4">
        <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Where it runs</p>
        <h3 className="mt-1 text-[15px] font-medium text-slate-100">Prover, witness generation, verifier, and algorithm flow</h3>
        <div className="mt-3 grid gap-px bg-slate-700/60 md:grid-cols-2 xl:grid-cols-4">
          <article className="bg-slate-950/85 p-3 text-[12px] text-slate-200">
            <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>Witness generation</p>
            <p className="mt-2 leading-5">Runs inside the Node.js proving route when the backend prepares the witness from private balances and circuit inputs.</p>
            <p className={`mt-2 text-[11px] ${secondaryTone}`}>Private data stays here.</p>
          </article>
          <article className="bg-slate-950/85 p-3 text-[12px] text-slate-200">
            <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>Prover</p>
            <p className="mt-2 leading-5">The prover is the backend proof builder in <span className="font-medium text-slate-100">src/zkProof.js</span>, called by <span className="font-medium text-slate-100">/api/zk/visualization</span>.</p>
            <p className={`mt-2 text-[11px] ${secondaryTone}`}>It turns the witness into a zk-SNARK proof.</p>
          </article>
          <article className="bg-slate-950/85 p-3 text-[12px] text-slate-200">
            <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>Verifier</p>
            <p className="mt-2 leading-5">The verifier runs in <span className="font-medium text-slate-100">/api/zk/verify</span> and checks the proof against the selected verification key.</p>
            <p className={`mt-2 text-[11px] ${secondaryTone}`}>It does not need the private balances.</p>
          </article>
          <article className="bg-slate-950/85 p-3 text-[12px] text-slate-200">
            <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>Whole algorithm</p>
            <p className="mt-2 leading-5">Private balances become a witness, the prover creates a proof, the UI sends the proof payload to the verifier, and only public signals such as Merkle root and reserves are exposed.</p>
            <p className={`mt-2 text-[11px] ${secondaryTone}`}>That is the complete setup of our project.</p>
          </article>
        </div>
      </section>

      <section className="border-b border-slate-700/60 px-4 py-4">
        <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Explain It To Me</p>
        <h3 className="mt-1 text-[15px] font-medium text-slate-100">What is happening here?</h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <ol className="list-decimal space-y-2 pl-5 text-[12px] font-normal text-slate-200">
            <li>
              The system takes your <span className="font-medium text-slate-100">Private Balance</span> and the
              <span className="font-medium text-slate-100"> Public Exchange Total</span>.
            </li>
            <li>
              It runs complex math to create a <span className="font-medium text-slate-100">zk-SNARK receipt</span>, a tiny mathematical proof.
            </li>
            <li>
              Anyone can verify this receipt and know your funds are included and solvent,
              <span className="font-medium text-slate-100"> without seeing your balance</span>.
            </li>
          </ol>

          <div className="border border-slate-700/70 bg-slate-950/80 p-3 text-[12px] text-slate-200">
            <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Flow summary</p>
            <div className="mt-3 space-y-2">
              <div className="border border-slate-700/70 bg-slate-900/70 px-3 py-2">
                <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>Step 1</p>
                <p className="mt-1 text-[12px] text-slate-100">Collect balances</p>
              </div>
              <div className="border border-slate-700/70 bg-slate-900/70 px-3 py-2">
                <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>Step 2</p>
                <p className="mt-1 text-[12px] text-slate-100">Commit the Merkle root</p>
              </div>
              <div className="border border-slate-700/70 bg-slate-900/70 px-3 py-2">
                <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>Step 3</p>
                <p className="mt-1 text-[12px] text-slate-100">Verify the proof envelope</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-px bg-slate-700/60 xl:grid-cols-[0.92fr_1.2fr_0.95fr]">
        <section className="bg-slate-950/85 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-[11px] font-medium uppercase tracking-[0.16em] ${secondaryTone}`}>Input stream</p>
            <p className={`text-[11px] ${secondaryTone}`}>Private in, public proof out.</p>
            <span className="ml-auto border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-200">
              root: {shortFingerprint(rootHash)}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-px bg-slate-700/60 sm:grid-cols-2">
            <article className="bg-slate-950/85 p-3">
              <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Hidden Inputs (Private)</p>
              <div className="mt-2 border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                <p className={`text-[11px] ${secondaryTone}`}>Account ID</p>
                <p className="mt-1 font-mono text-[12px] text-slate-100 blur-[1px]">{focusUser}</p>
              </div>
              <div className="mt-2 border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                <p className={`text-[11px] ${secondaryTone}`}>Exact Balance</p>
                <p className="mt-1 font-mono text-[12px] text-slate-100 blur-[1px]">{focusBalance}</p>
              </div>
              <p className={`mt-2 text-[11px] ${secondaryTone}`}>Locked before proving.</p>
            </article>

            <article className="bg-slate-950/85 p-3">
              <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Public Inputs (Transparent)</p>
              <div className="mt-2 border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                <p className={`text-[11px] ${secondaryTone}`}>Merkle Root</p>
                <p className="mt-1 font-mono text-[12px] text-slate-100">{shortFingerprint(rootHash)}</p>
              </div>
              <div className="mt-2 border border-slate-700/70 bg-slate-900/80 px-3 py-2">
                <p className={`text-[11px] ${secondaryTone}`}>Total Exchange Reserves</p>
                <p className="mt-1 text-[12px] font-medium text-slate-100">{zkPayload?.metadata.reserves ?? "-"}</p>
              </div>
              <p className={`mt-2 text-[11px] ${secondaryTone}`}>Visible and verifier-readable.</p>
            </article>
          </div>

          {zkPayload ? (
            <div className="mt-3 grid grid-cols-1 gap-px bg-slate-700/60 sm:grid-cols-3">
              <div className="bg-slate-900/70 px-3 py-2 text-[12px] text-slate-200">
                variant <span className="font-medium text-slate-100">{circuitVariantLabel}</span>
              </div>
              <div className="bg-slate-900/70 px-3 py-2 text-[12px] text-slate-200">
                merkle root <span className="font-medium text-slate-100">{shortFingerprint(zkPayload.merkleRoot)}</span>
              </div>
              <div className="bg-slate-900/70 px-3 py-2 text-[12px] text-slate-200">
                coupling <span className="font-medium capitalize text-slate-100">{couplingLabel}</span>
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
                        borderColor: isActivated ? "rgba(34, 211, 238, 0.62)" : "rgba(100, 116, 139, 0.3)",
                        backgroundColor: isActivated ? "rgba(9, 67, 82, 0.58)" : "rgba(15, 23, 42, 0.72)",
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
              className="mt-3 w-full border border-slate-700/70 bg-slate-900/80 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Replay tree to engine transfer"
            >
              {transferEnabled ? "tree to engine transfer" : "processing"}
            </button>
          </div>
        </section>

        <section className="bg-slate-950/85 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-[11px] font-medium uppercase tracking-[0.16em] ${secondaryTone}`}>Proof Generator</p>
            <span className="ml-auto border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-200">
              phase: {proverPhase}
            </span>
          </div>
          <p className={`mt-2 text-[12px] ${secondaryTone}`}>
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

          <p className={`mt-3 text-[11px] ${secondaryTone}`}>Sealed fragments move through the proving engine and combine into one receipt.</p>

          <div className="mt-3 space-y-2">
            {stageCards.map((stage) => (
              <article key={stage.id} className={`border px-3 py-2 ${stage.status === "active" ? "border-[var(--color-text-success,#86efac)]/45 bg-slate-900/75" : "border-slate-700/70 bg-slate-900/70"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>{stage.id}</p>
                  <p className={`text-[12px] ${successTone}`}>{stage.progress ?? 0}%</p>
                </div>
                <p className="mt-1 text-[12px] font-medium text-slate-100">{stage.label}</p>
                <p className={`mt-1 text-[11px] ${secondaryTone}`}>{stage.detail}</p>
              </article>
            ))}
          </div>

          {zkPayload ? (
            <div className={`mt-3 border border-slate-700/70 bg-slate-900/75 px-3 py-2 text-[12px] ${zkPayload.couplingStatus === "linked" ? successTone : dangerTone}`}>
              {zkPayload.couplingStatus === "linked"
                ? "Merkle root is bound into the solvency proof and verified with the selected circuit key."
                : "The proof envelope is missing a merkle-root link or it does not match the circuit signal."}
            </div>
          ) : null}
        </section>

        <section className="bg-slate-950/85 px-4 py-4">
          <p className={`text-[11px] font-medium uppercase tracking-[0.16em] ${secondaryTone}`}>The zk-SNARK Receipt</p>
          <p className={`mt-1 text-[12px] ${secondaryTone}`}>A tiny verifiable file that proves solvency without revealing balances.</p>

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

            <p className={`mt-3 text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>proof artifact</p>
            <p className={`text-[12px] ${verifierPhase === "failed" ? dangerTone : successTone}`}>{zkVerificationResult}</p>
            <p className={`mt-2 text-[11px] ${secondaryTone}`}>{shortFingerprint(zkPayload?.fingerprint)}</p>
          </div>

          <div className="mt-3 space-y-2">
            {metrics.slice(0, 3).map((metric) => (
              <div key={metric.label} className="border border-slate-700/70 bg-slate-900/70 px-3 py-2">
                <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>{metric.label}</p>
                <p className={`mt-1 text-[12px] font-medium ${successTone}`}>{metric.value}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvancedDetails((current) => !current)}
            className="mt-3 w-full border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-left text-[11px] font-medium text-slate-200 transition hover:bg-slate-800"
          >
            {showAdvancedDetails ? "Hide Advanced Technical Details" : "Show Advanced Technical Details"}
          </button>

          {showAdvancedDetails ? (
            <div className="mt-2 border border-slate-700/70 bg-slate-900/75 px-3 py-2 text-[12px] text-slate-200">
              <p>
                Protocol: <span className={`font-medium ${successTone}`}>{zkPayload?.protocol ?? "-"}</span>
              </p>
              <p className="mt-1">
                Curve: <span className="font-medium text-slate-100">{zkPayload?.curve ?? "-"}</span>
              </p>
              <p className="mt-1">
                Sealed Evidence Fragments: <span className="font-medium text-slate-100">A/B/C commitments</span>
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <div className="divide-y divide-slate-700/60">
        <section className="px-4 py-4">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Analysis & Experiment Panel</p>
            <select
              value={selectedPanel}
              onChange={(event) => setSelectedPanel(event.target.value as "telemetry" | "verifier" | "attacker")}
              className="border border-slate-700/70 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-200 transition hover:border-slate-500/70"
            >
              <option value="telemetry">📊 Proof Telemetry</option>
              <option value="verifier">✓ Verifier Playground</option>
              <option value="attacker">⚠️ Attacker&apos;s Area</option>
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
                <div className="mt-4 grid gap-px bg-slate-700/60 md:grid-cols-2 xl:grid-cols-1">
                  {metrics.map((metric) => (
                    <div key={metric.label} className="bg-slate-900/70 px-3 py-2">
                      <p className={`text-[11px] font-medium uppercase tracking-[0.12em] ${secondaryTone}`}>{metric.label}</p>
                      <p className={`mt-1 text-[12px] font-medium ${successTone}`}>{metric.value}</p>
                      <p className={`text-[11px] ${secondaryTone}`}>{metric.hint}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 border border-slate-700/70 bg-slate-900/75 px-3 py-2 text-[12px] text-slate-200">
                  <p>
                    Public reserves: <span className={`font-medium ${successTone}`}>{zkPayload?.metadata.reserves ?? "-"}</span>
                  </p>
                  <p className="mt-1">
                    Circuit occupancy: <span className="font-medium text-slate-100">{zkPayload?.metadata.usersProvided ?? 0}</span>
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
                <p className={`mt-3 text-[12px] ${secondaryTone}`}>Verify the proof against the public merkle root, address and proof receipt.</p>
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
                  <button type="button" onClick={onVerifyProof} className="w-full border border-slate-700/70 bg-slate-900/80 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-100 transition hover:bg-slate-800">
                    Verify zk-SNARK Receipt
                  </button>
                  <div className="border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-[12px] text-slate-300">
                    Status: <span className={isProofTampered ? `font-medium ${dangerTone}` : `font-medium ${successTone}`}>{isProofTampered ? "tampered" : "intact"}</span>
                  </div>
                </div>
                {peekMessage ? (
                  <p className="mt-3 border border-slate-700/70 bg-slate-900/75 px-3 py-2 text-[12px] text-slate-200">{peekMessage}</p>
                ) : null}
                <p className="mt-3 text-[12px] text-slate-200">
                  Result: <span className={`font-medium ${verifierPhase === "failed" ? dangerTone : successTone}`}>{zkVerificationResult}</span>
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
                <p className={`mt-3 text-[12px] ${secondaryTone}`}>Experiment with sabotage attacks. The cryptography blocks all three.</p>
                <div className="mt-4 space-y-3">
                  <div className="border border-slate-700/70 bg-slate-900/75 p-3">
                    <p className={`text-[11px] font-medium ${dangerTone}`}>Sabotage 1: Break Range Check</p>
                    <p className={`mt-1 text-[11px] ${secondaryTone}`}>Try to create a proof with a negative balance (-500). The circuit has a cryptographic range proof that blocks it.</p>
                    <label className={`mt-2 block text-[11px] uppercase tracking-[0.1em] ${secondaryTone}`}>Injected balance value</label>
                    <input
                      value={rangeAttackBalance}
                      onChange={(event) => setRangeAttackBalance(event.target.value)}
                      placeholder="-500"
                      className="mt-1 w-full border border-slate-700/70 bg-slate-950/90 px-2 py-1 text-[12px] text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => onSabotageRangeCheck(Number(rangeAttackBalance))}
                      disabled={zkLoading}
                      className={`mt-2 w-full border border-slate-700/70 bg-slate-950/90 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.1em] ${dangerTone} transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      Attempt: Negative Balance
                    </button>
                  </div>

                  <div className="border border-slate-700/70 bg-slate-900/75 p-3">
                    <p className={`text-[11px] font-medium ${dangerTone}`}>Sabotage 2: Break Solvency Check</p>
                    <p className={`mt-1 text-[11px] ${secondaryTone}`}>Try to prove solvency when total liabilities exceed reserves by overriding the public reserves request parameter.</p>
                    <label className={`mt-2 block text-[11px] uppercase tracking-[0.1em] ${secondaryTone}`}>Forced reserves parameter</label>
                    <input
                      value={insolvencyReserves}
                      onChange={(event) => setInsolvencyReserves(event.target.value)}
                      placeholder="0"
                      className="mt-1 w-full border border-slate-700/70 bg-slate-950/90 px-2 py-1 text-[12px] text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => onSabotageInsolvency(Number(insolvencyReserves))}
                      disabled={zkLoading}
                      className={`mt-2 w-full border border-slate-700/70 bg-slate-950/90 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.1em] ${dangerTone} transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      Attempt: Liabilities &gt; Reserves
                    </button>
                  </div>

                  <div className="border border-slate-700/70 bg-slate-900/75 p-3">
                    <p className={`text-[11px] font-medium ${dangerTone}`}>Sabotage 3: Tamper with Cryptographic Proof</p>
                    <p className={`mt-1 text-[11px] ${secondaryTone}`}>Mutate one nibble inside a proof hash value. Verification fails instantly at the pairing check.</p>
                    <button
                      type="button"
                      onClick={onSabotageMutateProof}
                      disabled={!zkPayload}
                      className={`mt-2 w-full border border-slate-700/70 bg-slate-950/90 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.1em] ${dangerTone} transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      Mutate Proof Character
                    </button>
                  </div>

                  {sabotageMessage ? (
                    <p className={`border border-slate-700/70 bg-slate-900/75 px-3 py-2 text-[12px] ${dangerTone}`}>{sabotageMessage}</p>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section className="px-4 py-4">
          <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${secondaryTone}`}>Verifier Terminal</p>
          <div className={`mt-3 rounded-xl border p-3 ${verifierToneClass}`}>
            <div className={`max-h-52 overflow-auto font-mono text-[11px] leading-5 ${verifierPhase === "failed" ? dangerTone : successTone}`}>
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