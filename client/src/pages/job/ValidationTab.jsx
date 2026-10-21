import { CircleCheck, CircleX, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.js';
import { ScoreRing } from '../../components/ScoreRing.jsx';
import { Badge, Button, Card } from '../../components/ui.jsx';
import { scoreTone } from '../../lib/format.js';
import { useToast } from '../../lib/toast.jsx';

const CHECK_ICONS = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX, info: Info };
const BREAKDOWN = [
  ['syntax', 'Syntax', 25],
  ['procedures', 'Procedure coverage', 25],
  ['parity', 'Complexity parity', 20],
  ['tests', 'Tests', 15],
  ['data', 'Data coverage', 10],
];

export function ValidationTab({ job, setJob }) {
  const toast = useToast();
  const v = job.validation;
  const [busy, setBusy] = useState(false);
  const [openFile, setOpenFile] = useState(null);

  const revalidate = async () => {
    setBusy(true);
    try {
      const { validation } = await api.post(`/api/jobs/${job.id}/revalidate`);
      setJob((j) => ({ ...j, validation }));
      toast.success(`Revalidated: ${validation.score}/100`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="grid-main">
        <Card
          title="Fidelity score"
          subtitle="Static validation of the generated code against the legacy analysis."
          actions={['review', 'approved', 'rejected'].includes(job.status) && <Button variant="ghost" size="sm" icon={RefreshCw} loading={busy} onClick={revalidate}>Revalidate</Button>}
        >
          <div className="score-panel">
            <ScoreRing score={v.score} size={132} />
            <div className="breakdown">
              {BREAKDOWN.map(([key, label, weight]) => (
                <div key={key} className="breakdown-row">
                  <span>
                    {label} <span className="muted small">({weight}%)</span>
                  </span>
                  <div className="meter">
                    <div className={`meter-fill tone-${scoreTone(v.breakdown[key])}`} style={{ width: `${v.breakdown[key]}%` }} />
                  </div>
                  <strong>{v.breakdown[key]}%</strong>
                </div>
              ))}
            </div>
          </div>
          {job.baselineValidation && (
            <div className="baseline-compare">
              <div>
                <span className="muted small">AI output</span>
                <strong className={`tone-text-${scoreTone(v.score)}`}>{v.score}/100</strong>
              </div>
              <div>
                <span className="muted small">Rule-based baseline</span>
                <strong className={`tone-text-${scoreTone(job.baselineValidation.score)}`}>{job.baselineValidation.score}/100</strong>
              </div>
              <p className="muted small">The baseline is the platform’s structure-preserving translation that grounded the AI. Scores measure structure and coverage, not idiomatic quality.</p>
            </div>
          )}
        </Card>
        <Card title="Checks">
          <ul className="checks">
            {v.checks.map((c) => {
              const Icon = CHECK_ICONS[c.status] || Info;
              return (
                <li key={c.id} className={`check-${c.status}`}>
                  <Icon size={17} />
                  <div>
                    <strong>{c.label}</strong>
                    <p className="muted small">{c.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card title="Procedure mapping and complexity parity" subtitle="Every legacy procedure should map to a symbol that exists in the generated code with a similar number of decisions." padded={false}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Legacy procedure</th>
                <th>Modern symbol</th>
                <th>Complexity (legacy → modern)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {v.procedures.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      {p.file}
                      {!p.reachable ? ' · never called in legacy code' : ''}
                    </div>
                  </td>
                  <td>
                    <code>{p.modernSymbol || '–'}</code>
                    {p.modernFile && <div className="muted small">{p.modernFile}{p.modernLine ? `:${p.modernLine}` : ''}</div>}
                  </td>
                  <td>
                    {p.parity ? (
                      <span>
                        {p.parity.legacy} → {p.parity.modern}{' '}
                        {p.parity.flag === 'lost-branches' && <Badge tone="danger">possible lost branches</Badge>}
                        {p.parity.flag === 'added-complexity' && <Badge tone="warning">added complexity</Badge>}
                      </span>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td>
                    <Badge tone={p.status === 'mapped' ? 'success' : p.status === 'dropped-dead' ? 'neutral' : 'danger'}>{p.status.replace('-', ' ')}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Generated files" subtitle="Syntax-checked with Tree-sitter grammars for the target language." padded={false}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Kind</th>
                <th>Symbols</th>
                <th>Syntax</th>
              </tr>
            </thead>
            <tbody>
              {v.files.map((f) => (
                <tr key={f.path} className={f.errors.length ? 'clickable' : ''} onClick={() => f.errors.length && setOpenFile(openFile === f.path ? null : f.path)}>
                  <td>
                    <code>{f.path}</code>
                    {openFile === f.path && (
                      <ul className="error-list">
                        {f.errors.map((e, i) => (
                          <li key={i}>
                            Line {e.line}:{e.column} — {e.message}
                            {e.snippet && <pre>{e.snippet}</pre>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{f.kind}</td>
                  <td>{f.symbols?.length || '–'}</td>
                  <td>{!f.checked ? <Badge tone="neutral">not checked</Badge> : f.ok ? <Badge tone="success">parses</Badge> : <Badge tone="danger">{f.errors.length} error(s)</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
