import { Copy, GitCompare, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { CodeView } from '../../components/CodeView.jsx';
import { Badge, Button, Card, Spinner } from '../../components/ui.jsx';
import { useToast } from '../../lib/toast.jsx';
import { FileTree } from '../ProjectDetail.jsx';

export function CodeTab({ job, getSources, sources }) {
  const toast = useToast();
  const hasBaseline = Boolean(job.baselineValidation);
  const [variant, setVariant] = useState('primary');
  const [baseline, setBaseline] = useState(null);
  const gen = variant === 'baseline' ? baseline : job.generation;
  const files = gen?.files || [];
  const [selected, setSelected] = useState(() => job.generation.files.find((f) => f.kind === 'source')?.path || job.generation.files[0]?.path);
  const [legacyProc, setLegacyProc] = useState(null);

  useEffect(() => {
    getSources().catch(() => {});
  }, [getSources]);

  useEffect(() => {
    if (variant !== 'baseline' || baseline) return;
    api
      .get(`/api/jobs/${job.id}/baseline`)
      .then((r) => setBaseline(r.baseline))
      .catch((e) => toast.error(e.message));
  }, [variant, baseline, job.id, toast]);

  useEffect(() => {
    if (files.length && !files.some((f) => f.path === selected)) setSelected(files.find((f) => f.kind === 'source')?.path || files[0].path);
  }, [files, selected]);

  const file = files.find((f) => f.path === selected);
  const procs = job.analysis?.procedures || [];
  const mapped = useMemo(
    () =>
      (gen?.mapping || [])
        .filter((m) => m.modernFile && selected && (m.modernFile === selected || selected.endsWith(m.modernFile) || m.modernFile.endsWith(selected)))
        .map((m) => ({ ...m, proc: procs.find((p) => p.id === m.legacyProcedure) || procs.find((p) => p.name === String(m.legacyProcedure).split('::').pop()) })),
    [gen, selected, procs],
  );
  const proc = legacyProc && procs.find((p) => p.id === legacyProc);
  const legacySource = proc && sources?.find((s) => s.path === proc.file);
  const snippet = legacySource ? legacySource.content.split('\n').slice(proc.loc.start - 1, proc.loc.end).join('\n') : null;

  if (variant === 'baseline' && !baseline) return <Spinner label="Loading rule-based baseline" />;

  return (
    <div className="stack">
      {hasBaseline && (
        <div className="segmented">
          <button type="button" className={variant === 'primary' ? 'active' : ''} onClick={() => setVariant('primary')}>
            <Sparkles size={14} /> AI output ({job.validation?.score}/100)
          </button>
          <button type="button" className={variant === 'baseline' ? 'active' : ''} onClick={() => setVariant('baseline')}>
            <GitCompare size={14} /> Rule-based baseline ({job.baselineValidation.score}/100)
          </button>
        </div>
      )}
      <div className="split">
        <aside className="split-side">
          <FileTree
            files={files}
            selected={selected}
            onSelect={(p) => {
              setSelected(p);
              setLegacyProc(null);
            }}
            statusOf={variant === 'primary' ? (f) => (f.content !== f.original ? <Badge tone="warning">edited</Badge> : null) : undefined}
          />
        </aside>
        <div className="split-main">
          {file ? (
            <>
              <div className="viewer-head">
                <div>
                  <strong>{file.path}</strong>
                  <span className="muted small">
                    {' '}
                    · {file.kind} · {file.content.split('\n').length} lines
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Copy}
                  onClick={() =>
                    navigator.clipboard
                      .writeText(file.content)
                      .then(() => toast.success('Copied to clipboard'))
                      .catch(() => toast.error('Clipboard is not available'))
                  }
                >
                  Copy
                </Button>
              </div>
              <CodeView code={file.content} path={file.path} maxHeight={600} />
              {mapped.length > 0 && (
                <Card title="Implements legacy procedures" subtitle="Select one to compare with the original source.">
                  <div className="chips wrap">
                    {mapped.map((m) => (
                      <button key={`${m.legacyProcedure}-${m.modernSymbol}`} type="button" className={`chip${legacyProc === m.proc?.id ? ' active' : ''}`} onClick={() => setLegacyProc(m.proc?.id || null)} disabled={!m.proc}>
                        {m.proc?.name || m.legacyProcedure} → {m.modernSymbol}
                      </button>
                    ))}
                  </div>
                  {mapped.find((m) => m.proc?.id === legacyProc)?.notes && <p className="muted small">{mapped.find((m) => m.proc?.id === legacyProc).notes}</p>}
                  {proc && (snippet ? <CodeView code={snippet} path={proc.file} startLine={proc.loc.start} maxHeight={320} /> : <Spinner label="Loading legacy source" />)}
                </Card>
              )}
            </>
          ) : (
            <p className="muted">No files.</p>
          )}
        </div>
      </div>
    </div>
  );
}
