"use client";

import type { UserEntryRow } from "@/lib/contracts";

type UserInputTableProps = {
  rows: UserEntryRow[];
  selectedUserId: string;
  reservesInput: string;
  rowErrors: string[];
  reservesError: string | null;
  formError: string | null;
  submitting: boolean;
  onRowChange: (index: number, key: keyof UserEntryRow, value: string) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onResetSample: () => void;
  onSelectedUserChange: (nextUserId: string) => void;
  onReservesChange: (value: string) => void;
  onGenerate: () => void;
};

export function UserInputTable({
  rows,
  selectedUserId,
  reservesInput,
  rowErrors,
  reservesError,
  formError,
  submitting,
  onRowChange,
  onAddRow,
  onRemoveRow,
  onResetSample,
  onSelectedUserChange,
  onReservesChange,
  onGenerate,
}: Readonly<UserInputTableProps>) {
  return (
    <section className="mt-6 rounded-3xl border border-emerald-200/20 bg-slate-950/60 p-5 backdrop-blur-md sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-300/80">Tree Composer</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50">Build Merkle Input</h2>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddRow}
            className="rounded-lg border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20"
          >
            Add row
          </button>
          <button
            type="button"
            onClick={onResetSample}
            className="rounded-lg border border-slate-400/30 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Reset sample
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={submitting}
            className="rounded-lg border border-lime-300/40 bg-lime-500/10 px-3 py-2 text-sm font-medium text-lime-100 transition hover:bg-lime-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Generating..." : "Generate tree"}
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-500/35">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-700/60 text-sm">
            <thead className="bg-slate-900/85 text-left text-xs uppercase tracking-[0.2em] text-slate-300">
              <tr>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Account ID</th>
                <th className="px-3 py-3">Balance</th>
                <th className="px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60 bg-slate-950/70 text-slate-100">
              {rows.map((row, index) => (
                <tr key={row.rowId ?? `fallback-${row.accountId}-${row.name}-${row.balance}`}>
                  <td className="px-3 py-2">
                    <input
                      value={row.name}
                      onChange={(event) => onRowChange(index, "name", event.target.value)}
                      placeholder="e.g. Alice"
                      className="w-full rounded-md border border-slate-500/40 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-lime-300/60"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.accountId}
                      onChange={(event) => onRowChange(index, "accountId", event.target.value)}
                      placeholder="ACC-001"
                      className="w-full rounded-md border border-slate-500/40 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-lime-300/60"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={String(row.balance)}
                      onChange={(event) => onRowChange(index, "balance", event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-full rounded-md border border-slate-500/40 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-lime-300/60"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onRemoveRow(index)}
                      disabled={rows.length === 1}
                      className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-3 text-center">
        {rowErrors.length > 0 ? (
          <p className="text-sm text-rose-300">{rowErrors[0]}</p>
        ) : (
          <p className="text-sm text-slate-300">Enter up to 256 accounts.</p>
        )}

        <label className="flex w-full max-w-xl flex-col gap-2 rounded-xl border border-slate-500/35 bg-slate-900/70 px-3 py-3 text-left">
          <span className="text-sm text-slate-300">Exchange reserves</span>
          <input
            value={reservesInput}
            onChange={(event) => onReservesChange(event.target.value)}
            inputMode="numeric"
            placeholder="Leave blank to auto-use total liabilities"
            className="rounded-md border border-slate-500/40 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-lime-300/60"
          />
          {reservesError ? <span className="text-xs text-rose-300">{reservesError}</span> : null}
        </label>

        <label className="flex items-center gap-2 rounded-xl border border-slate-500/35 bg-slate-900/70 px-3 py-2">
          <span className="text-sm text-slate-300">Focus account</span>
          <select
            value={selectedUserId}
            onChange={(event) => onSelectedUserChange(event.target.value)}
            className="rounded-md border border-slate-500/40 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none"
          >
            {rows.map((row, index) => {
              const fallback = `row-${index + 1}`;
              const value = row.accountId.trim() || fallback;
              const label = row.accountId.trim() || `Unnamed ${index + 1}`;
              return (
                <option key={`${value}-${index}`} value={value}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {formError ? <p className="mt-2 text-sm text-rose-300">{formError}</p> : null}
    </section>
  );
}
