import { useEffect, useMemo, useState } from 'react';
import { CodeView } from '../../components/CodeView.jsx';
import { Graph } from '../../components/Graph.jsx';
import { Badge, Card, StatusBadge } from '../../components/ui.jsx';

const VIEWS = [
  { id: 'callgraph', label: 'Call graph' },
  { id: 'cfg', label: 'Control flow' },
  { id: 'procedures', label: 'Procedures' },
  { id: 'data', label: 'Data dictionary' },
  { id: 'findings', label: 'Findings' },
];

function Legend({ items }) {
  return (
    <div className="legend">
      {items.map(([cls, label]) => (
        <span key={label}>
          <i className={`legend-swatch ${cls}`} /> {label}
        </span>
      ))}
    </div>
  );
}

function CallGraphView({ analysis, onPick }) {
  const multi = analysis.modules.length > 1;
  const nodes = useMemo(
    () =>
      analysis.callGraph.nodes.map((n) => ({
        id: n.id,
        label: multi && n.module !== 'external' ? `${n.module}.${n.label}` : n.label,
        kind: n.kind === 'external' ? 'external' : !n.reachable ? 'dead' : n.entry ? 'entry-proc' : 'proc',
        tooltip: `${n.label} (${n.kind}${n.file ? ` in ${n.file}` : ''})${!n.reachable ? ' — never called' : n.entry ? ' — entry point' : ''}`,
      })),
    [analysis, multi],
  );
  const edges = useMemo(
    () =>
      analysis.callGraph.edges.map((e) => ({
        from: e.from,
        to: e.to,
        label: ['perform', 'call'].includes(e.kind) ? (e.count > 1 ? `×${e.count}` : '') : e.kind,
        dashed: e.kind === 'fall-through' || e.kind === 'external',
      })),
    [analysis],
  );
  return (
    <Card title="Call graph" subtitle="Who performs or calls whom. Click a procedure to open its control-flow graph." padded={false}>
      <Legend items={[['entry-proc', 'Entry point'], ['proc', 'Reachable'], ['dead', 'Never called'], ['external', 'External program']]} />
      <Graph nodes={nodes} edges={edges} direction="TB" height={520} onNodeClick={(n) => n.kind !== 'external' && onPick(n.id)} emptyText="No procedures found" />
    </Card>
  );
}

function CfgView({ analysis, procId, setProcId, sources }) {
  const cfg = analysis.cfgs.find((c) => c.procedure === procId) || analysis.cfgs[0];
  const proc = analysis.procedures.find((p) => p.id === cfg?.procedure);
  const [selected, setSelected] = useState(null);
  useEffect(() => setSelected(null), [procId]);
  const nodes = useMemo(
    () =>
      (cfg?.nodes || []).map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.reachable ? n.kind : 'unreachable',
        tooltip: [n.label, ...(n.stmts || []).slice(1)].join('\n'),
      })),
    [cfg],
  );
  const edges = useMemo(() => (cfg?.edges || []).map((e) => ({ from: e.from, to: e.to, label: e.label, kind: e.label === 'true' ? 'true' : e.label === 'false' ? 'false' : e.abrupt ? 'abrupt' : 'default', dashed: e.abrupt })), [cfg]);
  if (!cfg) return <p className="muted">No control-flow graphs.</p>;
  const node = cfg.nodes.find((n) => n.id === selected);
  const source = sources?.find((s) => s.path === proc?.file);
  const snippet = source && proc ? source.content.split('\n').slice(proc.loc.start - 1, proc.loc.end).join('\n') : null;
  return (
    <div className="grid-main wide">
      <Card
        title="Control-flow graph"
        subtitle="Basic blocks, decisions and loops inside one procedure."
        padded={false}
        actions={
          <select value={cfg.procedure} onChange={(e) => setProcId(e.target.value)} aria-label="Procedure">
            {analysis.procedures.map((p) => (
              <option key={p.id} value={p.id}>
                {analysis.modules.length > 1 ? `${p.module}.` : ''}
                {p.name} (complexity {p.complexity})
              </option>
            ))}
          </select>
        }
      >
        <Legend items={[['entry', 'Entry / exit'], ['block', 'Statements'], ['cond', 'Decision'], ['loop', 'Loop'], ['unreachable', 'Unreachable']]} />
        <Graph nodes={nodes} edges={edges} direction="TB" height={560} onNodeClick={(n) => setSelected(n.id)} selected={selected} />
      </Card>
      <div className="stack">
        {proc && (
          <Card title={proc.name} subtitle={`${proc.kind} · ${proc.file} lines ${proc.loc.start}–${proc.loc.end}`}>
            <div className="metrics">
              <div className="metric"><span>Cyclomatic complexity</span><strong>{proc.complexity}</strong></div>
              <div className="metric"><span>Max nesting</span><strong>{proc.nesting}</strong></div>
              <div className="metric"><span>Statements</span><strong>{proc.statements}</strong></div>
              <div className="metric"><span>Risk</span><StatusBadge status={proc.risk} /></div>
              <div className="metric"><span>Calls</span><strong>{proc.calls.join(', ') || '–'}</strong></div>
              <div className="metric"><span>Called by</span><strong>{proc.calledBy.join(', ') || (proc.entry ? 'entry point' : '–')}</strong></div>
              <div className="metric"><span>Reads</span><strong>{proc.reads.join(', ') || '–'}</strong></div>
              <div className="metric"><span>Writes</span><strong>{proc.writes.join(', ') || '–'}</strong></div>
            </div>
          </Card>
        )}
        {node && (
          <Card title={node.kind === 'block' ? 'Basic block' : node.label}>
            {node.stmts?.length ? (
              <ol className="stmt-list">
                {node.stmts.map((s, i) => (
                  <li key={i}>
                    <code>{s}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">{node.reachable ? 'Control node' : 'This block can never execute.'}</p>
            )}
            {node.line && <p className="muted small">Line {node.line}</p>}
          </Card>
        )}
        {snippet && <CodeView code={snippet} path={proc.file} startLine={proc.loc.start} range={node?.line ? { start: node.line, end: node.line } : null} maxHeight={320} />}
      </div>
    </div>
  );
}

function ProceduresView({ analysis, onPick }) {
  const [sort, setSort] = useState('order');
  const rows = useMemo(() => {
    const list = [...analysis.procedures];
    if (sort === 'complexity') list.sort((a, b) => b.complexity - a.complexity);
    if (sort === 'risk') list.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.risk] - ({ high: 0, medium: 1, low: 2 })[b.risk]);
    return list;
  }, [analysis, sort]);
  const max = Math.max(...analysis.procedures.map((p) => p.complexity), 1);
  return (
    <Card
      title="Procedures"
      subtitle="Metrics per paragraph, sub, function or method."
      actions={
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort procedures">
          <option value="order">Source order</option>
          <option value="complexity">Highest complexity</option>
          <option value="risk">Highest risk</option>
        </select>
      }
      padded={false}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Procedure</th>
              <th>Lines</th>
              <th>Complexity</th>
              <th>Nesting</th>
              <th>Calls</th>
              <th>Reads / writes</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => onPick(p.id)}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="muted small">
                    {p.kind}
                    {p.entry ? ' · entry' : ''}
                    {!p.reachable ? ' · never called' : ''}
                  </div>
                </td>
                <td className="muted small">
                  {p.file}:{p.loc.start}–{p.loc.end}
                </td>
                <td>
                  <div className="bar-cell">
                    <div className="bar" style={{ width: `${(p.complexity / max) * 100}%` }} />
                    <span>{p.complexity}</span>
                  </div>
                </td>
                <td>{p.nesting}</td>
                <td className="small">{p.calls.join(', ') || '–'}</td>
                <td className="small">
                  {p.reads.length} / {p.writes.length}
                </td>
                <td>
                  <StatusBadge status={p.risk} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function DataView({ analysis }) {
  return (
    <Card title="Data dictionary" subtitle="Legacy data items, where they are used, and the suggested modern name and type." padded={false}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Legacy item</th>
              <th>Legacy type</th>
              <th>Initial</th>
              <th>Suggested modern</th>
              <th>Read by</th>
              <th>Written by</th>
            </tr>
          </thead>
          <tbody>
            {analysis.dataDictionary.map((d, i) => (
              <tr key={`${d.module}-${d.name}-${i}`} className={d.unused ? 'row-dim' : ''}>
                <td>
                  <strong>{d.name}</strong>
                  {d.level != null && <span className="muted small"> · level {String(d.level).padStart(2, '0')}</span>}
                  {d.path.includes('>') && <div className="muted small">{d.path}</div>}
                  {d.conditions.length > 0 && <div className="muted small">88: {d.conditions.map((c) => `${c.name} = ${c.values.join(', ')}`).join('; ')}</div>}
                  {d.unused && <Badge tone="neutral">unused</Badge>}
                  {d.isConst && <Badge tone="info">constant</Badge>}
                </td>
                <td>
                  <code>{d.legacyType || '–'}</code>
                </td>
                <td>
                  <code>{d.initial ?? '–'}</code>
                </td>
                <td>
                  <code>{d.suggestedName}</code>
                  <div className="muted small">{d.suggestedType}</div>
                </td>
                <td className="small">{d.readBy.join(', ') || '–'}</td>
                <td className="small">{d.writtenBy.join(', ') || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FindingsView({ analysis }) {
  const [severity, setSeverity] = useState('all');
  const list = analysis.findings.filter((f) => severity === 'all' || f.severity === severity);
  return (
    <Card
      title="Findings"
      subtitle="Risks and modernization hints detected by static analysis."
      actions={
        <div className="chips">
          {['all', 'critical', 'warning', 'info'].map((s) => (
            <button key={s} type="button" className={`chip${severity === s ? ' active' : ''}`} onClick={() => setSeverity(s)}>
              {s} {s === 'all' ? analysis.findings.length : analysis.summary.findings[s]}
            </button>
          ))}
        </div>
      }
    >
      {list.length ? (
        <ul className="findings">
          {list.map((f, i) => (
            <li key={i}>
              <Badge tone={f.severity === 'critical' ? 'danger' : f.severity}>{f.severity}</Badge>
              <span>
                <code className="rule">{f.rule}</code> {f.message}
              </span>
              <span className="muted small">
                {f.file}:{f.line}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No findings at this severity.</p>
      )}
    </Card>
  );
}

export function AnalysisTab({ job, getSources, sources }) {
  const analysis = job.analysis;
  const [view, setView] = useState('callgraph');
  const [procId, setProcId] = useState(analysis.summary.entryPoints[0] || analysis.procedures[0]?.id);
  useEffect(() => {
    getSources().catch(() => {});
  }, [getSources]);
  const pick = (id) => {
    setProcId(id);
    setView('cfg');
  };
  return (
    <div className="stack">
      <div className="segmented" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      {view === 'callgraph' && <CallGraphView analysis={analysis} onPick={pick} />}
      {view === 'cfg' && <CfgView analysis={analysis} procId={procId} setProcId={setProcId} sources={sources} />}
      {view === 'procedures' && <ProceduresView analysis={analysis} onPick={pick} />}
      {view === 'data' && <DataView analysis={analysis} />}
      {view === 'findings' && <FindingsView analysis={analysis} />}
    </div>
  );
}
