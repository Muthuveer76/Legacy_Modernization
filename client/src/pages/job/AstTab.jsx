import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { AstTree } from '../../components/AstTree.jsx';
import { CodeView } from '../../components/CodeView.jsx';
import { Badge, Spinner } from '../../components/ui.jsx';

export function AstTab({ job, getSources, sources }) {
  const files = job.parse?.files || [];
  const [file, setFile] = useState(files[0]?.file);
  const [ast, setAst] = useState(null);
  const [range, setRange] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSources().catch((e) => setError(e.message));
  }, [getSources]);

  useEffect(() => {
    if (!file) return;
    setAst(null);
    setRange(null);
    api
      .get(`/api/jobs/${job.id}/ast?file=${encodeURIComponent(file)}`)
      .then((r) => setAst(r.ast))
      .catch((e) => setError(e.message));
  }, [file, job.id]);

  const info = files.find((f) => f.file === file);
  const source = sources?.find((s) => s.path === file);

  if (error) return <div className="alert alert-danger">{error}</div>;
  return (
    <div className="split wide-side">
      <aside className="split-side ast-side">
        {files.length > 1 && (
          <select value={file} onChange={(e) => setFile(e.target.value)} aria-label="Source file">
            {files.map((f) => (
              <option key={f.file} value={f.file}>
                {f.file}
              </option>
            ))}
          </select>
        )}
        {info && (
          <div className="parse-info">
            <div>
              <strong>{info.parser}</strong>
            </div>
            <div className="muted small">
              {info.lines} lines · {ast?.nodeCount ?? info.nodeCount} nodes · parsed in {info.ms} ms{ast?.truncated ? ' · tree truncated for display' : ''}
            </div>
            {ast?.kind === 'ir' && <p className="muted small">COBOL and VB6 are parsed by the platform’s own grammars; the tree shows their structured form.</p>}
            {info.diagnostics.length > 0 && (
              <ul className="diag-list">
                {info.diagnostics.map((d, i) => (
                  <li key={i}>
                    <Badge tone={d.severity === 'error' ? 'danger' : 'warning'}>L{d.line}</Badge> {d.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {ast ? <AstTree tree={ast.tree} onSelect={(node) => node.line && setRange({ start: node.line, end: node.endLine || node.line })} /> : <Spinner label="Loading syntax tree" />}
      </aside>
      <div className="split-main">
        <div className="viewer-head">
          <strong>{file}</strong>
          <span className="muted small">Select a node to highlight its source lines</span>
        </div>
        {source ? <CodeView code={source.content} path={file} range={range} maxHeight={660} /> : <Spinner label="Loading source" />}
      </div>
    </div>
  );
}
