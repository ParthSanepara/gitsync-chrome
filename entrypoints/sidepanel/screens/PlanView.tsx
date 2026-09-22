import { describePlanBlocker, describePlanWarning } from '@/src/errors';
import type { SyncPlan } from '@/src/plan';
import { Button, cardClass, mutedTextClass } from '../ui';

const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1e3))} KB`);

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export function PlanView({
  plan,
  onGrantWorkflow,
  onRun,
}: {
  plan: SyncPlan;
  onGrantWorkflow: () => void;
  onRun: () => void;
}) {
  const { estimate: e } = plan;
  // Both engines move the target branch straight to the source commit instead of diffing files.
  const movesRef = plan.engine === 'ref-copy' || plan.engine === 'git-clone';
  return (
    <section className={cardClass + ' flex flex-col gap-3'} aria-label="Sync preview">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          <span className="font-mono">
            {plan.source.repo.fullName}@{plan.source.ref}
          </span>{' '}
          →{' '}
          <span className="font-mono">
            {plan.target.repo.fullName}@{plan.target.branch}
          </span>
        </h2>
        <p className={mutedTextClass + ' mt-1'}>
          Engine: <strong>{plan.engine}</strong>. {plan.engineReason}
        </p>
      </div>

      {plan.blockers.length === 0 && (
        <dl className="flex flex-col gap-1">
          {movesRef ? (
            <>
              <Row
                label="Target branch"
                value={plan.target.exists ? 'moves to the source commit' : 'created at the source commit'}
              />
              {plan.engine === 'git-clone' && <Row label="Repository size" value={fmtBytes(e.bytes)} />}
            </>
          ) : (
            <>
              <Row label="Files changed" value={e.filesChanged} />
              <Row label="Files to upload" value={e.blobsToUpload} />
              <Row label="Data to upload" value={fmtBytes(e.bytes)} />
            </>
          )}
          {plan.pullRequest && (
            <Row label="Pull request" value={`${plan.pullRequest.head} → ${plan.pullRequest.base}`} />
          )}
          {plan.engine !== 'git-clone' && (
            <>
              <Row label="Commits created" value={e.commits} />
              <Row label="GitHub API calls" value={`~${e.apiCalls}`} />
            </>
          )}
        </dl>
      )}

      {plan.blockers.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-[#d1242f] dark:text-[#f85149]">
          {plan.blockers.map((b, i) => (
            <li key={i}>{describePlanBlocker(b)}</li>
          ))}
        </ul>
      )}

      {plan.blockers.some((b) => b.code === 'missing_workflow_scope') && (
        <Button onClick={onGrantWorkflow}>Grant workflow permission</Button>
      )}

      {plan.warnings.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-[#9a6700] dark:text-[#d29922]">
          {plan.warnings.map((w, i) => (
            <li key={i}>{describePlanWarning(w)}</li>
          ))}
        </ul>
      )}

      <Button variant="primary" disabled={plan.blockers.length > 0} onClick={onRun}>
        {plan.blockers.length > 0 ? 'Fix the issues above to continue' : 'Run sync'}
      </Button>
    </section>
  );
}
