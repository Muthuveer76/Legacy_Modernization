import { Boxes, Download, FileCode, GitMerge, History, Pencil, Play, Plus, Save, Settings, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download } from '../api.js';
import { CodeEditor } from '../components/CodeEditor.jsx';
import { CodeView } from '../components/CodeView.jsx';
import { FileDropzone } from '../components/FileDropzone.jsx';
import { Badge, Button, Card, Confirm, EmptyState, Field, LangBadge, Modal, Spinner, StatusBadge, Tabs } from '../components/ui.jsx';
import { duration, plural, scoreTone, timeAgo } from '../lib/format.js';
import { useMeta } from '../lib/meta.jsx';
import { useToast } from '../lib/toast.jsx';
import { TargetPicker } from './NewProject.jsx';

export function FileTree({ files, selected, onSelect, statusOf }) {
  const groups = useMemo(() => {
    const order = ['source', 'test', 'config', 'doc'];
    const labels = { source: 'Source', test: 'Tests', config: 'Build & config', doc: 'Docs' };
    const by = new Map();
    for (const f of files) {
      const k = f.kind || 'source';
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(f);
    }
    return order.filter((k) => by.has(k)).map((k) => ({ kind: k, label: labels[k], files: by.get(k) }));
  }, [files]);
  return (
    <div className="file-tree">
      {groups.map((g) => (
        <div key={g.kind}>
          {groups.length > 1 && <div className="tree-group">{g.label}</div>}
          {g.files.map((f) => (
            <button key={f.path} type="button" className={`tree-item${selected === f.path ? ' active' : ''}`} onClick={() => onSelect(f.path)} title={f.path}>
              <FileCode size={14} />
              <span className="tree-name">{f.path.split('/').pop()}</span>
              {statusOf && statusOf(f)}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function SourcesTab({ project, reload }) {
  const meta = useMeta();
  const toast = useToast();
  const [selected, setSelected] = useState(project.files[0]?.id || null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const file = project.files.find((f) => f.id === selected) || project.files[0];

  useEffect(() => {
    if (!project.files.some((f) => f.id === selected)) setSelected(project.files[0]?.id || null);
  }, [project.files, selected]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/projects/${project.id}/files/${file.id}`, { content: editing });
      toast.success(`Saved ${file.path}`);
      setEditing(null);
      await reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (files) => {
    try {
      await api.post(`/api/projects/${project.id}/files`, { files });
      toast.success(`Added ${plural(files.length, 'file')}`);
      setAdding(false);
      await reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!project.files.length) {
    return (
      <>
        <EmptyState icon={FileCode} title="No legacy sources" action={<Button icon={Upload} onClick={() => setAdding(true)}>Add files</Button>}>
          Add COBOL, VB6, Java or C/C++ files to modernize.
        </EmptyState>
        <Modal open={adding} title="Add legacy files" onClose={() => setAdding(false)}>
          <FileDropzone onFiles={addFiles} maxKb={meta?.limits.maxFileKb} onError={(m) => toast.error(m)} />
        </Modal>
      </>
    );
  }

  return (
    <div className="split">
      <aside className="split-side">
        <div className="side-head">
          <span className="muted small">{plural(project.files.length, 'file')}</span>
          <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(true)}>
            Add
          </Button>
        </div>
        <div className="file-tree">
          {project.files.map((f) => (
            <button key={f.id} type="button" className={`tree-item${file?.id === f.id ? ' active' : ''}`} onClick={() => { setSelected(f.id); setEditing(null); }}>
              <FileCode size={14} />
              <span className="tree-name">{f.path}</span>
              <LangBadge language={f.language} label={meta?.languages[f.language]?.label} />
            </button>
          ))}
        </div>
      </aside>
      <div className="split-main">
        {file && (
          <>
            <div className="viewer-head">
              <div>
                <strong>{file.path}</strong>
                <span className="muted small"> · {file.lines} lines · {(file.size / 1024).toFixed(1)} KB · updated {timeAgo(file.updatedAt)}</span>
              </div>
              <div className="row-actions">
                {editing == null ? (
                  <>
                    <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(file.content)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleting(file)}>
                      Delete
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" icon={Save} loading={busy} onClick={save}>
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>
            {editing == null ? <CodeView code={file.content} path={file.path} maxHeight={620} /> : <CodeEditor value={editing} onChange={setEditing} path={file.path} maxHeight={620} />}
          </>
        )}
      </div>
      <Modal open={adding} title="Add legacy files" onClose={() => setAdding(false)}>
        <FileDropzone onFiles={addFiles} maxKb={meta?.limits.maxFileKb} onError={(m) => toast.error(m)} />
      </Modal>
      <Confirm
        open={Boolean(deleting)}
        title="Delete file"
        danger
        confirmLabel="Delete"
        message={`Delete ${deleting?.path}? Existing jobs keep their own snapshot of it.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/projects/${project.id}/files/${deleting.id}`);
            setDeleting(null);
            await reload();
          } catch (err) {
            toast.error(err.message);
          }
        }}
      />
    </div>
  );
}

function JobsTab({ jobs }) {
  const meta = useMeta();
  if (!jobs.length) return <EmptyState icon={History} title="No jobs yet">Run the modernization pipeline to create the first job.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Engine</th>
            <th>Target</th>
            <th>Fidelity</th>
            <th>Started</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                <Link to={`/jobs/${j.id}`} className="link">
                  #{j.number}
                </Link>
                {j.parentJob && <span className="muted small"> (regenerated)</span>}
              </td>
              <td>
                <StatusBadge status={j.status} />
              </td>
              <td>{j.engine?.used === 'claude' ? j.engine.model || 'Claude' : j.engine?.used === 'structural' ? 'Rule-based' : j.engine?.requested}</td>
              <td>{meta?.targets[j.target.language]?.label}</td>
              <td>{j.score != null ? <Badge tone={scoreTone(j.score)}>{j.score}/100</Badge> : '–'}</td>
              <td>{timeAgo(j.createdAt)}</td>
              <td>{duration(j.createdAt, j.finishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodebaseTab({ project }) {
  const toast = useToast();
  const [merged, setMerged] = useState(null);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (!project.merged) return;
    api
      .get(`/api/projects/${project.id}/merged`)
      .then((r) => {
        setMerged(r.merged);
        setSelected(r.merged.files.find((f) => f.kind === 'source')?.path || r.merged.files[0]?.path);
      })
      .catch((e) => toast.error(e.message));
  }, [project.id, project.merged, toast]);

  if (!project.merged) {
    return (
      <EmptyState icon={GitMerge} title="Nothing merged yet">
        Open a job in review, approve it, then merge it to make it this project’s modernized codebase.
      </EmptyState>
    );
  }
  if (!merged) return <Spinner />;
  const file = merged.files.find((f) => f.path === selected);
  return (
    <div className="stack">
      <div className="alert alert-success">
        <GitMerge size={16} />
        <span>
          Codebase from <Link to={`/jobs/${merged.jobId}`}>job #{merged.jobNumber}</Link>, merged {timeAgo(merged.mergedAt)} · {plural(merged.files.length, 'file')}
        </span>
        <Button
          size="sm"
          icon={Download}
          className="push-right"
          onClick={() => download(`/api/projects/${project.id}/export`, 'modernized.zip').catch((e) => toast.error(e.message))}
        >
          Export ZIP
        </Button>
      </div>
      <div className="split">
        <aside className="split-side">
          <FileTree files={merged.files} selected={selected} onSelect={setSelected} />
        </aside>
        <div className="split-main">
          {file && (
            <>
              <div className="viewer-head">
                <strong>{file.path}</strong>
              </div>
              <CodeView code={file.content} path={file.path} maxHeight={620} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const meta = useMeta();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [params, setParams] = useSearchParams();
  const tab = ['sources', 'jobs', 'codebase'].includes(params.get('tab')) ? params.get('tab') : 'sources';
  const setTab = (next) => setParams(next === 'sources' ? {} : { tab: next }, { replace: true });
  const [engine, setEngine] = useState('auto');
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get(`/api/projects/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const active = data?.jobs.some((j) => ['queued', 'running'].includes(j.status));
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [active, load]);

  if (error) return <div className="page"><div className="alert alert-danger">{error}</div></div>;
  if (!data) return <Spinner />;
  const { project, jobs } = data;

  const run = async () => {
    setRunning(true);
    try {
      const { job } = await api.post(`/api/projects/${project.id}/jobs`, { engine });
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      toast.error(err.message);
      setRunning(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/projects">Projects</Link> / <span>{project.name}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>{project.name}</h1>
          <p className="muted">{project.description || 'No description'}</p>
          <div className="project-langs">
            {project.languages.map((l) => (
              <LangBadge key={l} language={l} label={meta?.languages[l]?.label} />
            ))}
            <span className="muted">→</span>
            <Badge tone="info">
              {meta?.targets[project.target.language]?.label} · {meta?.targets[project.target.language]?.frameworks[project.target.framework]}
            </Badge>
          </div>
        </div>
        <div className="head-actions">
          <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label="Generation engine" className="select-sm">
            <option value="auto">Engine: Auto</option>
            <option value="claude" disabled={!meta?.ai.enabled}>
              Engine: AI (Claude)
            </option>
            <option value="structural">Engine: Rule-based</option>
          </select>
          <Button icon={Play} loading={running} onClick={run} disabled={!project.files.length}>
            Run modernization
          </Button>
          <Button variant="ghost" icon={Settings} onClick={() => setSettings({ name: project.name, description: project.description, target: project.target })} aria-label="Project settings" />
          <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)} aria-label="Delete project" />
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'sources', label: 'Legacy sources', icon: FileCode, count: project.files.length },
          { id: 'jobs', label: 'Jobs', icon: History, count: jobs.length },
          { id: 'codebase', label: 'Modernized codebase', icon: Boxes },
        ]}
      />
      <div className="tab-panel">
        {tab === 'sources' && <SourcesTab project={project} reload={load} />}
        {tab === 'jobs' && <JobsTab jobs={jobs} />}
        {tab === 'codebase' && <CodebaseTab project={project} />}
      </div>

      <Modal
        open={Boolean(settings)}
        title="Project settings"
        onClose={() => setSettings(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSettings(null)}>
              Cancel
            </Button>
            <Button
              icon={Save}
              onClick={async () => {
                try {
                  await api.patch(`/api/projects/${project.id}`, settings);
                  setSettings(null);
                  toast.success('Project updated');
                  load();
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {settings && (
          <div className="form">
            <Field label="Name" htmlFor="set-name">
              <input id="set-name" value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} />
            </Field>
            <Field label="Description" htmlFor="set-desc">
              <textarea id="set-desc" rows={3} value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} />
            </Field>
            <TargetPicker value={settings.target} onChange={(target) => setSettings({ ...settings, target })} />
            <p className="muted small">A new target applies to the next job; existing jobs keep theirs.</p>
          </div>
        )}
      </Modal>
      <Confirm
        open={confirmDelete}
        title="Delete project"
        danger
        confirmLabel="Delete project"
        message={`Delete “${project.name}”, its ${plural(project.files.length, 'source file')} and ${plural(jobs.length, 'job')}? This cannot be undone.`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await api.del(`/api/projects/${project.id}`);
            toast.success('Project deleted');
            navigate('/projects');
          } catch (err) {
            toast.error(err.message);
          }
        }}
      />
    </div>
  );
}
