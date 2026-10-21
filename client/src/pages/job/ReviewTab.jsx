import { Check, CircleCheck, CircleDot, CircleX, Eye, FileCode, FileDiff, GitMerge, MessageSquare, Pencil, RotateCcw, Save, ScanSearch, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { CodeEditor } from '../../components/CodeEditor.jsx';
import { CodeView } from '../../components/CodeView.jsx';
import { DiffView } from '../../components/DiffView.jsx';
import { Badge, Button, Card, Field, Modal, StatusBadge } from '../../components/ui.jsx';
import { plural, timeAgo } from '../../lib/format.js';
import { useMeta } from '../../lib/meta.jsx';
import { useToast } from '../../lib/toast.jsx';

const FILE_ICON = { accepted: CircleCheck, rejected: CircleX, pending: CircleDot };

const DECISIONS = {
  approved: { title: 'Approve this job', label: 'Approve', variant: 'primary', text: 'Pending files are marked accepted. Rejected files are left out of the merge and the export.' },
  'changes-requested': { title: 'Request changes', label: 'Request changes and regenerate', variant: 'secondary', text: 'Your summary and every unresolved comment become feedback for a new generation job linked to this one.' },
  rejected: { title: 'Reject this job', label: 'Reject', variant: 'danger', text: 'The job is closed without merging. You can reopen it later.' },
};

export function ReviewTab({ job, setJob, reload, getSources, sources }) {
  const meta = useMeta();
  const toast = useToast();
  const navigate = useNavigate();
  const files = job.generation.files;
  const editable = job.status === 'review';
  const [selected, setSelected] = useState(() => files.find((f) => f.kind === 'source')?.path || files[0]?.path);
  const [mode, setMode] = useState('view');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState({ line: '', body: '' });
  const [decision, setDecision] = useState(null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [newJob, setNewJob] = useState(null);

  useEffect(() => {
    getSources().catch(() => {});
  }, [getSources]);

  const file = files.find((f) => f.path === selected);
  const comments = job.review?.comments || [];
  const fileComments = comments.filter((c) => c.file === selected);
  const general = comments.filter((c) => !c.file);
  const markers = useMemo(() => fileComments.reduce((acc, c) => (c.line ? { ...acc, [c.line]: (acc[c.line] || 0) + 1 } : acc), {}), [fileComments]);
  const counts = useMemo(
    () => ({
      accepted: files.filter((f) => f.status === 'accepted').length,
      rejected: files.filter((f) => f.status === 'rejected').length,
      pending: files.filter((f) => f.status === 'pending').length,
      edited: files.filter((f) => f.content !== f.original).length,
      open: comments.filter((c) => !c.resolved).length,
    }),
    [files, comments],
  );

  const legacyForFile = useMemo(() => {
    if (!file || !sources) return null;
    const mapped = (job.generation.mapping || []).filter((m) => m.modernFile && (m.modernFile === file.path || file.path.endsWith(m.modernFile)));
    const procs = job.analysis?.procedures || [];
    const legacyFile = file.legacyFile || procs.find((p) => mapped.some((m) => m.legacyProcedure === p.id))?.file || sources[0]?.path;
    return sources.find((s) => s.path === legacyFile) || null;
  }, [file, sources, job]);

  const patchFile = async (body) => {
    const res = await api.patch(`/api/jobs/${job.id}/files`, { path: selected, ...body });
    setJob((j) => ({ ...j, generation: { ...j.generation, files: j.generation.files.map((f) => (f.path === selected ? { ...f, content: res.file.content, status: res.file.status } : f)) } }));
    return res.file;
  };

  const setStatus = async (path, status) => {
    try {
      const res = await api.patch(`/api/jobs/${job.id}/files`, { path, status });
      setJob((j) => ({ ...j, generation: { ...j.generation, files: j.generation.files.map((f) => (f.path === path ? { ...f, status: res.file.status } : f)) } }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await patchFile({ content: draft });
      setDraft(null);
      setMode('diff');
      toast.success('Saved. Revalidate from the Validation tab to update the score.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addComment = async (e) => {
    e.preventDefault();
    if (!comment.body.trim()) return;
    try {
      const res = await api.post(`/api/jobs/${job.id}/comments`, { file: comment.general ? null : selected, line: comment.line ? Number(comment.line) : null, body: comment.body });
      setJob((j) => ({ ...j, review: { ...j.review, comments: res.comments } }));
      setComment({ line: '', body: '' });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleResolved = async (c) => {
    try {
      const res = await api.patch(`/api/jobs/${job.id}/comments/${c._id}`, { resolved: !c.resolved });
      setJob((j) => ({ ...j, review: { ...j.review, comments: res.comments } }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeComment = async (c) => {
    try {
      const res = await api.del(`/api/jobs/${job.id}/comments/${c._id}`);
      setJob((j) => ({ ...j, review: { ...j.review, comments: res.comments } }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const decide = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/jobs/${job.id}/review`, { decision, summary });
      setDecision(null);
      setSummary('');
      if (res.newJob) {
        setNewJob(res.newJob);
        toast.success(`Regeneration started as job #${res.newJob.number}`);
      } else toast.success(decision === 'approved' ? 'Job approved — merge it when you are ready' : 'Job rejected');
      await reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    setBusy(true);
    try {
      await api.post(`/api/jobs/${job.id}/merge`);
      toast.success('Merged into the project’s modernized codebase');
      await reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    try {
      await api.post(`/api/jobs/${job.id}/review`, { decision: 'reopen' });
      await reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const review = job.review || {};
  const edited = file && file.content !== file.original;

  return (
    <div className="stack">
      <div className="decision-bar">
        <div>
          <div className="decision-status">
            <StatusBadge status={job.status} />
            {review.decision && review.decidedBy && (
              <span className="muted small">
                {review.decision.replace('-', ' ')} by {review.decidedBy.name} {timeAgo(review.decidedAt)}
              </span>
            )}
          </div>
          <div className="muted small">
            {counts.accepted} accepted · {counts.rejected} rejected · {counts.pending} pending · {plural(counts.edited, 'edited file')} · {plural(counts.open, 'open comment')}
          </div>
          {review.summary && <p className="decision-summary">“{review.summary}”</p>}
          {newJob && (
            <p className="small">
              Regeneration running as <Link to={`/jobs/${newJob.id}`}>job #{newJob.number}</Link>.
            </p>
          )}
        </div>
        <div className="head-actions">
          {job.status === 'review' && (
            <>
              <Button variant="danger-ghost" icon={X} onClick={() => setDecision('rejected')}>
                Reject
              </Button>
              <Button variant="secondary" icon={RotateCcw} onClick={() => setDecision('changes-requested')}>
                Request changes
              </Button>
              <Button icon={Check} onClick={() => setDecision('approved')}>
                Approve
              </Button>
            </>
          )}
          {job.status === 'approved' && (
            <>
              <Button variant="ghost" icon={Undo2} loading={busy} onClick={reopen}>
                Reopen
              </Button>
              <Button icon={GitMerge} loading={busy} onClick={merge}>
                Merge into codebase
              </Button>
            </>
          )}
          {job.status === 'rejected' && (
            <Button variant="ghost" icon={Undo2} loading={busy} onClick={reopen}>
              Reopen review
            </Button>
          )}
          {job.status === 'merged' && (
            <Button variant="secondary" icon={GitMerge} onClick={() => navigate(`/projects/${job.project.id}?tab=codebase`)}>
              View project codebase
            </Button>
          )}
        </div>
      </div>

      <div className="review-layout">
        <aside className="split-side">
          <div className="side-head">
            <span className="muted small">{plural(files.length, 'file')}</span>
          </div>
          <div className="file-tree">
            {files.map((f) => {
              const Icon = FILE_ICON[f.status];
              return (
                <div key={f.path} className={`tree-item review-item${selected === f.path ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="tree-link"
                    onClick={() => {
                      setSelected(f.path);
                      setDraft(null);
                      setMode('view');
                    }}
                    title={f.path}
                  >
                    <Icon size={14} className={`status-${f.status}`} />
                    <span className="tree-name">{f.path.split('/').pop()}</span>
                    {f.content !== f.original && <Pencil size={12} className="muted" />}
                  </button>
                  {editable && (
                    <span className="tree-actions">
                      <button type="button" className={`mini${f.status === 'accepted' ? ' on-accept' : ''}`} aria-label={`Accept ${f.path}`} onClick={() => setStatus(f.path, f.status === 'accepted' ? 'pending' : 'accepted')}>
                        <Check size={13} />
                      </button>
                      <button type="button" className={`mini${f.status === 'rejected' ? ' on-reject' : ''}`} aria-label={`Reject ${f.path}`} onClick={() => setStatus(f.path, f.status === 'rejected' ? 'pending' : 'rejected')}>
                        <X size={13} />
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="split-main">
          {file && (
            <>
              <div className="viewer-head">
                <div>
                  <strong>{file.path}</strong> <Badge tone={file.status === 'accepted' ? 'success' : file.status === 'rejected' ? 'danger' : 'neutral'}>{file.status}</Badge> {edited && <Badge tone="warning">edited</Badge>}
                </div>
                <div className="segmented small">
                  <button type="button" className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>
                    <Eye size={14} /> View
                  </button>
                  <button type="button" className={mode === 'edit' ? 'active' : ''} disabled={!editable} onClick={() => { setDraft(file.content); setMode('edit'); }}>
                    <Pencil size={14} /> Edit
                  </button>
                  <button type="button" className={mode === 'diff' ? 'active' : ''} onClick={() => setMode('diff')}>
                    <FileDiff size={14} /> Diff vs AI
                  </button>
                  <button type="button" className={mode === 'legacy' ? 'active' : ''} onClick={() => setMode('legacy')}>
                    <ScanSearch size={14} /> Legacy
                  </button>
                </div>
              </div>
              {mode === 'view' && (
                <>
                  <CodeView code={file.content} path={file.path} markers={markers} onLineClick={(line) => setComment((c) => ({ ...c, line: String(line), general: false }))} maxHeight={600} />
                  <p className="muted small">Click a line number to comment on that line.</p>
                </>
              )}
              {mode === 'edit' && draft != null && (
                <>
                  <CodeEditor value={draft} onChange={setDraft} path={file.path} maxHeight={600} />
                  <div className="row-actions end">
                    <Button variant="ghost" onClick={() => { setDraft(null); setMode('view'); }}>
                      Discard
                    </Button>
                    {edited && (
                      <Button variant="ghost" icon={Undo2} onClick={() => setDraft(file.original)}>
                        Restore AI version
                      </Button>
                    )}
                    <Button icon={Save} loading={saving} onClick={saveEdit} disabled={draft === file.content}>
                      Save changes
                    </Button>
                  </div>
                </>
              )}
              {mode === 'diff' && <DiffView before={file.original} after={file.content} />}
              {mode === 'legacy' &&
                (legacyForFile ? (
                  <div className="side-by-side">
                    <div>
                      <div className="pane-title">
                        <FileCode size={14} /> {legacyForFile.path} ({meta?.languages[legacyForFile.language]?.label})
                      </div>
                      <CodeView code={legacyForFile.content} path={legacyForFile.path} maxHeight={560} />
                    </div>
                    <div>
                      <div className="pane-title">
                        <FileCode size={14} /> {file.path}
                      </div>
                      <CodeView code={file.content} path={file.path} maxHeight={560} />
                    </div>
                  </div>
                ) : (
                  <p className="muted">No legacy source is linked to this file.</p>
                ))}
            </>
          )}
        </div>

        <aside className="comments">
          <div className="comments-head">
            <MessageSquare size={16} /> Comments
          </div>
          {[...fileComments, ...general].length === 0 && <p className="muted small">No comments on this file yet.</p>}
          <ul>
            {[...fileComments, ...general].map((c) => (
              <li key={c._id} className={c.resolved ? 'resolved' : ''}>
                <div className="comment-meta">
                  <strong>{c.author?.name}</strong>
                  <span className="muted small">
                    {c.file ? (c.line ? `line ${c.line}` : 'file') : 'general'} · {timeAgo(c.createdAt)}
                  </span>
                </div>
                <p>{c.body}</p>
                <div className="comment-actions">
                  <button type="button" className="link" onClick={() => toggleResolved(c)}>
                    {c.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button type="button" className="icon-btn" aria-label="Delete comment" onClick={() => removeComment(c)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {['review', 'approved', 'rejected'].includes(job.status) && (
            <form className="comment-form" onSubmit={addComment}>
              <div className="comment-target">
                <label className="check small">
                  <input type="checkbox" checked={Boolean(comment.general)} onChange={(e) => setComment({ ...comment, general: e.target.checked, line: '' })} /> General comment
                </label>
                {!comment.general && <input type="number" min="1" placeholder="Line" value={comment.line} onChange={(e) => setComment({ ...comment, line: e.target.value })} aria-label="Line number" />}
              </div>
              <textarea rows={3} placeholder={comment.general ? 'Feedback on the whole job' : `Comment on ${file?.path.split('/').pop() || 'this file'}`} value={comment.body} onChange={(e) => setComment({ ...comment, body: e.target.value })} />
              <Button type="submit" size="sm" icon={MessageSquare} disabled={!comment.body.trim()}>
                Add comment
              </Button>
            </form>
          )}
        </aside>
      </div>

      <Modal
        open={Boolean(decision)}
        title={decision ? DECISIONS[decision].title : ''}
        onClose={() => setDecision(null)}
        footer={
          decision && (
            <>
              <Button variant="ghost" onClick={() => setDecision(null)}>
                Cancel
              </Button>
              <Button variant={DECISIONS[decision].variant} loading={busy} onClick={decide} disabled={decision === 'changes-requested' && !summary.trim() && !counts.open}>
                {DECISIONS[decision].label}
              </Button>
            </>
          )
        }
      >
        {decision && (
          <div className="form">
            <p>{DECISIONS[decision].text}</p>
            {decision === 'changes-requested' && !meta?.ai.enabled && <div className="alert alert-info">The AI engine is not configured, so the regeneration uses the rule-based translator and cannot apply free-form feedback.</div>}
            <Field label={decision === 'changes-requested' ? 'What should change?' : 'Summary (optional)'} htmlFor="decision-summary">
              <textarea id="decision-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={decision === 'changes-requested' ? 'e.g. Use BigDecimal for all money fields and split the payroll logic into a service class' : ''} />
            </Field>
            {decision === 'changes-requested' && counts.open > 0 && <p className="muted small">{plural(counts.open, 'unresolved comment')} will be included.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
