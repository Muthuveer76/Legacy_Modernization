import { ClipboardPaste, FileCode, FolderPlus, Plus, Trash2, Upload, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CodeEditor } from '../components/CodeEditor.jsx';
import { FileDropzone } from '../components/FileDropzone.jsx';
import { Button, Card, EmptyState, Field, LangBadge, Spinner, Tabs } from '../components/ui.jsx';
import { guessLanguage } from '../lib/actions.js';
import { useMeta } from '../lib/meta.jsx';
import { useToast } from '../lib/toast.jsx';

export function TargetPicker({ value, onChange }) {
  const meta = useMeta();
  if (!meta) return null;
  const target = meta.targets[value.language];
  return (
    <div className="grid-2 tight">
      <Field label="Target language" htmlFor="target-lang">
        <select
          id="target-lang"
          value={value.language}
          onChange={(e) => {
            const language = e.target.value;
            onChange({ language, framework: Object.keys(meta.targets[language].frameworks)[0] });
          }}
        >
          {Object.entries(meta.targets).map(([id, t]) => (
            <option key={id} value={id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Framework" htmlFor="target-fw">
        <select id="target-fw" value={value.framework} onChange={(e) => onChange({ ...value, framework: e.target.value })}>
          {Object.entries(target?.frameworks || {}).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export function NewProject() {
  const meta = useMeta();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState({ language: 'java', framework: 'plain' });
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState('upload');
  const [paste, setPaste] = useState({ path: '', content: '' });
  const [runNow, setRunNow] = useState(true);
  const [engine, setEngine] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (meta?.ai?.enabled === false && engine === 'claude') setEngine('auto');
  }, [meta, engine]);

  const addFiles = (incoming) => {
    setFiles((prev) => {
      const map = new Map(prev.map((f) => [f.path, f]));
      for (const f of incoming) map.set(f.path, { ...f, language: guessLanguage(f.path, f.content) });
      return [...map.values()];
    });
    setError('');
  };

  const addSample = async (sample) => {
    try {
      const { sample: full } = await api.get(`/api/samples/${sample.id}`);
      addFiles([{ path: full.file, content: full.content }]);
      if (!name) setName(full.name);
      if (!description) setDescription(full.description);
      setTarget(full.target);
      toast.success(`Added ${full.file}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const unknown = useMemo(() => files.filter((f) => !f.language), [files]);

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Give the project a name (at least 2 characters).');
    if (!files.length) return setError('Add at least one legacy source file.');
    if (unknown.length) return setError(`Cannot tell the language of ${unknown.map((f) => f.path).join(', ')}; rename with a .cbl, .bas, .java or .cpp extension.`);
    setBusy(true);
    setError('');
    try {
      const { project } = await api.post('/api/projects', { name: name.trim(), description: description.trim(), target, files: files.map((f) => ({ path: f.path, content: f.content })) });
      if (runNow) {
        const { job } = await api.post(`/api/projects/${project.id}/jobs`, { engine });
        navigate(`/jobs/${job.id}`);
      } else {
        navigate(`/projects/${project.id}`);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!meta) return <Spinner />;

  return (
    <form className="page" onSubmit={submit}>
      <div className="page-head">
        <div>
          <h1>New modernization project</h1>
          <p className="muted">Add legacy sources, choose the modern stack, and run the pipeline.</p>
        </div>
      </div>

      <div className="grid-main">
        <div className="stack">
          <Card title="1. Legacy sources" subtitle={`COBOL, VB6, Java or C/C++ · up to ${meta.limits.maxFilesPerProject} files · COBOL copybooks (.cpy) are resolved automatically`}>
            <Tabs
              active={mode}
              onChange={setMode}
              tabs={[
                { id: 'upload', label: 'Upload', icon: Upload },
                { id: 'paste', label: 'Paste code', icon: ClipboardPaste },
                { id: 'sample', label: 'Samples', icon: Wand2 },
              ]}
            />
            <div className="tab-panel">
              {mode === 'upload' && <FileDropzone onFiles={addFiles} maxKb={meta.limits.maxFileKb} onError={(m) => toast.error(m)} />}
              {mode === 'paste' && (
                <div className="stack">
                  <Field label="File name" hint="The extension decides the parser: .cbl, .bas, .java, .cpp …" htmlFor="paste-name">
                    <input id="paste-name" placeholder="e.g. BILLING.cbl" value={paste.path} onChange={(e) => setPaste({ ...paste, path: e.target.value })} />
                  </Field>
                  <CodeEditor value={paste.content} onChange={(content) => setPaste({ ...paste, content })} path={paste.path} maxHeight={320} placeholder="Paste legacy source code here" />
                  <div>
                    <Button
                      variant="secondary"
                      icon={Plus}
                      disabled={!paste.path.trim() || !paste.content.trim()}
                      onClick={() => {
                        addFiles([{ path: paste.path.trim().replace(/[^\w\-. /]+/g, '_'), content: paste.content }]);
                        setPaste({ path: '', content: '' });
                      }}
                    >
                      Add file
                    </Button>
                  </div>
                </div>
              )}
              {mode === 'sample' && (
                <div className="sample-grid compact">
                  {meta.samples.map((s) => (
                    <div key={s.id} className="sample-card">
                      <LangBadge language={s.language} label={meta.languages[s.language]?.label} />
                      <h4>{s.name}</h4>
                      <p className="muted small">{s.description}</p>
                      <Button variant="secondary" size="sm" icon={Plus} onClick={() => addSample(s)}>
                        Add {s.file}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {files.length ? (
              <ul className="file-list">
                {files.map((f) => (
                  <li key={f.path} className={preview === f.path ? 'active' : ''}>
                    <button type="button" className="file-row" onClick={() => setPreview(preview === f.path ? null : f.path)}>
                      <FileCode size={16} />
                      <span className="file-path">{f.path}</span>
                      {f.language ? <LangBadge language={f.language} label={meta.languages[f.language]?.label} /> : <span className="badge badge-danger">Unknown language</span>}
                      <span className="muted small">{f.content.split('\n').length} lines</span>
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${f.path}`} onClick={() => setFiles(files.filter((x) => x.path !== f.path))}>
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={FileCode} title="No files added yet">
                Upload files, paste code, or add a sample.
              </EmptyState>
            )}
            {preview && (
              <div className="preview">
                <CodeEditor value={files.find((f) => f.path === preview)?.content || ''} onChange={(content) => setFiles(files.map((f) => (f.path === preview ? { ...f, content } : f)))} path={preview} maxHeight={360} />
              </div>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="2. Project details">
            <div className="form">
              <Field label="Project name" htmlFor="name">
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Payroll system migration" maxLength={100} />
              </Field>
              <Field label="Description" htmlFor="desc" hint="Optional">
                <textarea id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
              </Field>
            </div>
          </Card>
          <Card title="3. Target stack">
            <TargetPicker value={target} onChange={setTarget} />
          </Card>
          <Card title="4. Run">
            <label className="check">
              <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
              Start the modernization pipeline right away
            </label>
            {runNow && (
              <Field label="Generation engine" htmlFor="engine" hint={meta.ai.enabled ? `AI uses ${meta.ai.model}; Auto falls back to the rule-based translator for very large projects.` : 'The AI engine is not configured on this server.'}>
                <select id="engine" value={engine} onChange={(e) => setEngine(e.target.value)}>
                  <option value="auto">Auto</option>
                  <option value="claude" disabled={!meta.ai.enabled}>
                    AI (Claude){meta.ai.enabled ? '' : ' (not configured)'}
                  </option>
                  <option value="structural">Rule-based structural translator</option>
                </select>
              </Field>
            )}
            {error && <div className="alert alert-danger">{error}</div>}
            <Button type="submit" icon={FolderPlus} loading={busy} className="btn-block">
              {runNow ? 'Create project and modernize' : 'Create project'}
            </Button>
          </Card>
        </div>
      </div>
    </form>
  );
}
