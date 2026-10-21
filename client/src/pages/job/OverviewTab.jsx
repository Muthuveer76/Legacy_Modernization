import { CircleAlert, Lightbulb, ListChecks, LoaderCircle, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { ScoreRing } from '../../components/ScoreRing.jsx';
import { Badge, Button, Card } from '../../components/ui.jsx';
import { plural, scoreTone } from '../../lib/format.js';

const NOTE_META = {
  decision: { label: 'Decisions', icon: Lightbulb, tone: 'info' },
  risk: { label: 'Risks', icon: TriangleAlert, tone: 'warning' },
  assumption: { label: 'Assumptions', icon: CircleAlert, tone: 'neutral' },
  todo: { label: 'Follow-ups', icon: ListChecks, tone: 'danger' },
};

function ProgressCard({ job }) {
  const p = job.progress || {};
  return (
    <Card title="Pipeline running" subtitle="This page updates automatically.">
      <div className="progress-line">
        <LoaderCircle size={18} className="spin" />
        <strong>{p.message || 'Queued'}</strong>
        {p.outputChars ? <span className="muted small">· {(p.outputChars / 1024).toFixed(1)} KB of output generated</span> : null}
      </div>
      {p.currentFile && (
        <p className="muted small">
          Current file: <code>{p.currentFile}</code>
        </p>
      )}
      {p.thinking && (
        <div className="reasoning live">
          <div className="reasoning-title">Model reasoning (summary)</div>
          <pre>{p.thinking}</pre>
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function OverviewTab({ job, onOpen, onRerun }) {
  const a = job.analysis;
  const g = job.generation;
  const v = job.validation;
  const active = ['queued', 'running'].includes(job.status);
  const notes = g?.notes || [];
  const kinds = g?.files.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] || 0) + 1 }), {}) || {};

  return (
    <div className="stack">
      {active && <ProgressCard job={job} />}
      {job.status === 'failed' && (
        <div className="alert alert-danger">
          <CircleAlert size={16} />
          <div>
            <strong>{job.error?.stage ? `The ${job.error.stage} stage failed.` : 'The job failed.'}</strong> {job.error?.message}
          </div>
          <Button size="sm" variant="secondary" icon={RotateCcw} className="push-right" onClick={onRerun}>
            Run again
          </Button>
        </div>
      )}
      {job.status === 'cancelled' && <div className="alert alert-info">This job was cancelled.</div>}
      {job.feedback && (
        <Card title="Reviewer feedback for this regeneration">
          <pre className="feedback">{job.feedback}</pre>
        </Card>
      )}

      <div className="grid-3">
        <Card title="Legacy code" actions={a && <button type="button" className="link" onClick={() => onOpen('analysis')}>Open analysis</button>}>
          {a ? (
            <div className="metrics">
              <Metric label="Files" value={`${a.summary.files} (${a.summary.lines.toLocaleString()} lines)`} />
              <Metric label="Procedures" value={a.summary.procedures} />
              <Metric label="Data items" value={a.summary.dataItems} />
              <Metric label="Complexity (avg / max)" value={`${a.summary.avgComplexity} / ${a.summary.maxComplexity}`} />
              <Metric label="Unreachable procedures" value={a.summary.deadProcedures.length} />
              <Metric
                label="Findings"
                value={
                  <span className="badge-row">
                    {a.summary.findings.critical > 0 && <Badge tone="danger">{a.summary.findings.critical} critical</Badge>}
                    <Badge tone="warning">{a.summary.findings.warning} warning</Badge>
                    <Badge tone="info">{a.summary.findings.info} info</Badge>
                  </span>
                }
              />
            </div>
          ) : (
            <p className="muted">Waiting for the Analyze stage.</p>
          )}
        </Card>

        <Card title="Generation" actions={g && <button type="button" className="link" onClick={() => onOpen('code')}>Open code</button>}>
          {g ? (
            <div className="metrics">
              <Metric label="Engine" value={g.engine === 'claude' ? 'AI (Claude)' : 'Rule-based translator'} />
              <Metric label="Model" value={g.model} />
              <Metric label="Files" value={Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(' · ')} />
              <Metric label="Mapped procedures" value={g.mapping?.length ?? 0} />
              {g.usage && <Metric label="Tokens (in / out)" value={`${g.usage.inputTokens.toLocaleString()} / ${g.usage.outputTokens.toLocaleString()}`} />}
              {g.usage?.cacheReadTokens > 0 && <Metric label="Cached input tokens" value={g.usage.cacheReadTokens.toLocaleString()} />}
            </div>
          ) : (
            <p className="muted">{job.engine?.reason || 'Waiting for the Generate stage.'}</p>
          )}
          {g?.summary && <p className="summary-text">{g.summary}</p>}
        </Card>

        <Card title="Validation" actions={v && <button type="button" className="link" onClick={() => onOpen('validation')}>Open validation</button>}>
          {v ? (
            <div className="validation-mini">
              <ScoreRing score={v.score} size={104} />
              <div className="metrics">
                <Metric label="Checks passed" value={`${v.checks.filter((c) => c.status === 'pass').length} / ${v.checks.filter((c) => c.status !== 'info').length}`} />
                <Metric label="Tests generated" value={plural(v.tests.cases, 'case')} />
                {job.baselineValidation && (
                  <Metric
                    label="Rule-based baseline"
                    value={
                      <Badge tone={scoreTone(job.baselineValidation.score)}>
                        {job.baselineValidation.score}/100
                      </Badge>
                    }
                  />
                )}
              </div>
            </div>
          ) : (
            <p className="muted">
              <ShieldCheck size={14} /> Waiting for the Validate stage.
            </p>
          )}
        </Card>
      </div>

      {notes.length > 0 && (
        <Card title="Migration notes" subtitle="Decisions, risks and follow-ups recorded by the generation engine.">
          <div className="notes-grid">
            {Object.entries(NOTE_META).map(([cat, m]) => {
              const items = notes.filter((n) => n.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat} className="note-group">
                  <div className="note-title">
                    <m.icon size={15} /> {m.label}
                  </div>
                  <ul>
                    {items.map((n, i) => (
                      <li key={i}>{n.text}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {a?.findings?.length > 0 && (
        <Card title="What the analysis found in the legacy code" actions={<button type="button" className="link" onClick={() => onOpen('analysis')}>All findings</button>}>
          <ul className="findings">
            {a.findings.slice(0, 6).map((f, i) => (
              <li key={i}>
                <Badge tone={f.severity === 'critical' ? 'danger' : f.severity}>{f.severity}</Badge>
                <span>{f.message}</span>
                <span className="muted small">
                  {f.file}:{f.line}
                </span>
              </li>
            ))}
          </ul>
          {a.hints?.length > 0 && (
            <div className="hints">
              {a.hints.map((h, i) => (
                <p key={i}>
                  <Lightbulb size={14} /> {h}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}

      {g?.reasoning && (
        <details className="card reasoning-card">
          <summary>Model reasoning summary</summary>
          <pre>{g.reasoning}</pre>
        </details>
      )}
    </div>
  );
}
