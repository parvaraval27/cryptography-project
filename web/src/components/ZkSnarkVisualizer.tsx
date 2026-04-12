"use client";

import type { ZkVisualizationPayload } from "@/lib/contracts";

type ZkSnarkVisualizerProps = {
  data: ZkVisualizationPayload | null;
  loading: boolean;
  error: string | null;
};

function shortFingerprint(hash: string) {
  if (!hash) return "unknown";
  return `${hash.slice(0, 16)}...${hash.slice(-12)}`;
}

export function ZkSnarkVisualizer({ data, loading, error }: ZkSnarkVisualizerProps) {
  return (
    <section className="mt-6 rounded-3xl border border-cyan-300/20 bg-slate-950/60 p-6 shadow-[0_20px_70px_rgba(6,182,212,0.16)] backdrop-blur-md sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">zk-SNARK Observatory</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-100 sm:text-4xl">Proof Constellation</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Visualize how private balances become a verifiable solvency statement using a compact PLONK proof.
          </p>
        </div>

        {data ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-right ${
              data.isValid
                ? "border-emerald-300/45 bg-emerald-400/10 text-emerald-200"
                : "border-rose-300/45 bg-rose-400/10 text-rose-200"
            }`}
          >
            <p className="text-xs uppercase tracking-[0.2em]">Verifier Status</p>
            <p className="mt-1 text-lg font-semibold">{data.isValid ? "Proof Valid" : "Proof Failed"}</p>
          </div>
        ) : null}
      </div>

      {loading ? <p className="mt-6 text-slate-300">Loading zk transcript data...</p> : null}
      {error ? <p className="mt-6 text-rose-300">{error}</p> : null}

      {data ? (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-500/35 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Protocol</p>
              <p className="mt-2 text-lg font-semibold text-cyan-300">{data.protocol}</p>
            </div>
            <div className="rounded-xl border border-slate-500/35 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Curve</p>
              <p className="mt-2 text-lg font-semibold text-amber-300">{data.curve}</p>
            </div>
            <div className="rounded-xl border border-slate-500/35 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Proof Created</p>
              <p className="mt-2 text-sm font-semibold text-slate-200">
                {new Date(data.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-500/35 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Fingerprint</p>
              <p className="mt-2 font-mono text-sm text-cyan-200">{shortFingerprint(data.fingerprint)}</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[1.25fr_1fr]">
            <div className="rounded-2xl border border-slate-500/30 bg-slate-900/60 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Proof Stages</p>

              <div className="relative mt-4 space-y-3">
                <div className="absolute left-[11px] top-2 h-[calc(100%-16px)] w-[2px] bg-gradient-to-b from-cyan-400/80 via-cyan-300/35 to-slate-600/20" />

                {data.stages.map((stage) => (
                  <div key={stage.id} className="relative pl-9">
                    <span
                      className={`absolute left-0 top-[3px] h-[22px] w-[22px] rounded-full border ${
                        stage.status === "done"
                          ? "border-cyan-300 bg-cyan-400/30"
                          : stage.status === "active"
                            ? "border-emerald-300 bg-emerald-400/30 zk-scan"
                            : "border-slate-500 bg-slate-700/60"
                      }`}
                    />
                    <div className="rounded-xl border border-slate-500/25 bg-slate-950/65 p-3">
                      <p className="text-sm font-semibold text-slate-100">{stage.label}</p>
                      <p className="mt-1 text-xs text-slate-300">{stage.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-500/30 bg-slate-900/60 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Proof Telemetry</p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  {data.metrics.map((metric) => (
                    <div key={metric.label} className="rounded-xl border border-slate-500/25 bg-slate-950/65 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">{metric.label}</p>
                      <p className="mt-1 text-lg font-semibold text-cyan-300">{metric.value}</p>
                      <p className="text-xs text-slate-400">{metric.hint}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-300/25 bg-gradient-to-br from-cyan-500/10 via-slate-900/70 to-amber-500/10 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Public Integrity Statement</p>
                <p className="mt-2 text-sm text-slate-200">
                  Liabilities were constrained against reserves =
                  <span className="ml-1 font-semibold text-amber-300">{data.metadata.reserves}</span>.
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Users included: {data.metadata.usersProvided} / circuit cap {data.metadata.maxUsers}. Public signals:
                  <span className="ml-1 text-cyan-300">{data.publicSignalCount}</span>.
                </p>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}