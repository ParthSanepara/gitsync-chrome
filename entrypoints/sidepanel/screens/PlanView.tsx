import { describePlanBlocker, describePlanWarning } from '@/src/errors';
import type { SyncPlan } from '@/src/plan';

const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`);

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function PlanView({ plan, onGrantWorkflow }: { plan: SyncPlan; onGrantWorkflow: () => void }) {
  const { estimate: e } = plan;
  const isCopy = plan.engine === 'ref-copy';
  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700"
      aria-label="Sync preview"
    >
      <div>
        <h2 className="text-sm font-semibold">
          {plan.source.repo.fullName}@{plan.source.ref} → {plan.target.repo.fullName}@{plan.target.branch}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Engine: <strong>{plan.engine}</strong>. {plan.engineReason}
        </p>
      </div>

      {plan.blockers.length === 0 && (
        <dl className="flex flex-col gap-1">
          {isCopy ? (
            <Row
              label="Target branch"
              value={plan.target.exists ? 'moves to the source commit' : 'created at the source commit'}
            />
          ) : (
            <>
              <Row label="Files changed" value={e.filesChanged} />
              <Row label="Files to upload" value={e.blobsToUpload} />
              <Row label="Data to upload" value={fmtBytes(e.bytes)} />
            </>
          )}
          <Row label="Commits created" value={e.commits} />
          <Row label="GitHub API calls" value={`~${e.apiCalls}`} />
        </dl>
      )}

      {plan.blockers.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-red-600 dark:text-red-400">
          {plan.blockers.map((b, i) => (
            <li key={i}>{describePlanBlocker(b)}</li>
          ))}
        </ul>
      )}

      {plan.blockers.some((b) => b.code === 'missing_workflow_scope') && (
        <button
          onClick={onGrantWorkflow}
          className="rounded-md border border-slate-400 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Grant workflow permission
        </button>
      )}

      {plan.warnings.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-amber-700 dark:text-amber-400">
          {plan.warnings.map((w, i) => (
            <li key={i}>{describePlanWarning(w)}</li>
          ))}
        </ul>
      )}

      <button
        disabled
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
      >
        {plan.blockers.length > 0 ? 'Fix the issues above to continue' : 'Run sync'}
      </button>
      {plan.blockers.length === 0 && (
        <p className="text-xs text-slate-500">Running the sync arrives in the next step.</p>
      )}
    </section>
  );
}
