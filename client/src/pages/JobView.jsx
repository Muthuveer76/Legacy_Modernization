import { Ban, Binary, ClipboardCheck, Download, FileText, LayoutDashboard, Network, RotateCcw, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download } from '../api.js';
import { PipelineStepper } from '../components/PipelineStepper.jsx';
import { Badge, Button, Confirm, Spinner, StatusBadge, Tabs } from '../components/ui.jsx';
import { duration, timeAgo } from '../lib/format.js';
import { useMeta } from '../lib/meta.jsx';
import { useToast } from '../lib/toast.jsx';
import { AnalysisTab } from './job/AnalysisTab.jsx';
import { AstTab } from './job/AstTab.jsx';
import { CodeTab } from './job/CodeTab.jsx';
import { OverviewTab } from './job/OverviewTab.jsx';
import { ReviewTab } from './job/ReviewTab.jsx';
import { ValidationTab } from './job/ValidationTab.jsx';

const ACTIVE = ['queued', 'running'];
const STAGES = ['parse', 'analyze', 'generate', 'validate'];
const REVIEWABLE = ['review', 'approved', 'rejected', 'merged'];

export function JobView() {
  const { id } = useParams();
  const meta = useMeta();
  const navigate = useNavigate();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [sources, setSources] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const sourcesPromise = useRef(null);

  const load = useCallback(async () => {
    const res = await api.get(`/api/jobs/${id}`);
    setJob(res.job);
    return res.job;
  }, [id]);

  useEffect(() => {
    setJob(null);
    setSources(null);
    sourcesPromise.current = null;
    setTab('overview');
    load().catch((e) => setError(e.message));
  }, [load]);

  const status = job?.status;
  useEffect(() => {
    if (!status || !ACTIVE.includes(status)) return undefined;
    let done = STAGES.filter((s) => job.stages?.[s]?.status === 'done').length;
    const timer = setInterval(async () => {
      try {
        const s = await api.get(`/api/jobs/${id}/status`);
        const nowDone = STAGES.filter((st) => s.stages?.[st]?.status === 'done').length;
        if (!ACTIVE.includes(s.status) || nowDone !== done) {
          done = nowDone;
          const fresh = await load();
          if (fresh.status === 'review') toast.success(`Job #${fresh.number} is ready for review`);
          if (fresh.status === 'failed') toast.error(fresh.error?.message || 'The job failed');
        } else {
          setJob((j) => (j ? { ...j, status: s.status, stages: s.stages, progress: s.progress, error: s.error } : j));
        }
      } catch {
        // transient network error; keep polling
      }
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, id, load]);

  const getSources = useCallback(() => {
    if (!sourcesPromise.current) {
      sourcesPromise.current = api.get(`/api/jobs/${id}/sources`).then((r) => {
        setSources(r.sources);
        return r.sources;
      });
    }
    return sourcesPromise.current;
  }, [id]);

  if (error) return <div className="page"><div className="alert alert-danger">{error}</div></div>;
  if (!job) return <Spinner label="Loading job" />;

  const active = ACTIVE.includes(job.status);
  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'ast', label: 'Syntax tree', icon: Binary, disabled: job.stages?.parse?.status !== 'done' },
    { id: 'analysis', label: 'Analysis', icon: Network, disabled: !job.analysis },
    { id: 'code', label: 'Generated code', icon: Sparkles, disabled: !job.generation, count: job.generation?.files.length },
    { id: 'validation', label: 'Validation', icon: ShieldCheck, disabled: !job.validation },
    { id: 'review', label: 'Review', icon: ClipboardCheck, disabled: !REVIEWABLE.includes(job.status) || !job.generation },
  ];

  const rerun = async () => {
    setBusy(true);
    try {
      const { job: next } = await api.post(`/api/projects/${job.project.id}/jobs`, { engine: job.engine?.requested || 'auto' });
      navigate(`/jobs/${next.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const target = meta?.targets[job.target.language];

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/projects">Projects</Link> / <Link to={`/projects/${job.project?.id}`}>{job.project?.name}</Link> / <span>Job #{job.number}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>
            Job #{job.number} <StatusBadge status={job.status} />
          </h1>
          <p className="muted">
            {target?.label} · {target?.frameworks[job.target.framework]} · started {timeAgo(job.createdAt)}
            {job.finishedAt ? ` · took ${duration(job.startedAt || job.createdAt, job.finishedAt)}` : ''}
            {job.parentJob && (
              <>
                {' '}
                · regenerated from <Link to={`/jobs/${job.parentJob}`}>an earlier job</Link>
              </>
            )}
          </p>
          <div className="project-langs">
            <Badge tone={job.engine?.used === 'claude' ? 'teal' : 'neutral'}>
              {job.engine?.used === 'claude' ? <Sparkles size={12} /> : null}
              {job.engine?.used === 'claude' ? job.generation?.model || job.engine.model : job.engine?.used === 'structural' ? 'Rule-based translator' : `Engine: ${job.engine?.requested}`}
            </Badge>
            {job.generation?.fellBack && <Badge tone="warning">Served by fallback model</Badge>}
            {job.project?.mergedJobId === job.id && <Badge tone="success">Current codebase</Badge>}
          </div>
        </div>
        <div className="head-actions">
          {active && (
            <Button variant="ghost" icon={Ban} onClick={() => setConfirm('cancel')}>
              Cancel
            </Button>
          )}
          {!active && (
            <Button variant="ghost" icon={RotateCcw} loading={busy} onClick={rerun}>
              Run again
            </Button>
          )}
          {job.generation && (
            <>
              <Button variant="ghost" icon={FileText} onClick={() => download(`/api/jobs/${job.id}/report`, `job-${job.number}-report.md`).catch((e) => toast.error(e.message))}>
                Report
              </Button>
              <Button variant="secondary" icon={Download} onClick={() => download(`/api/jobs/${job.id}/export`, `job-${job.number}.zip`).catch((e) => toast.error(e.message))}>
                Export ZIP
              </Button>
            </>
          )}
          {!active && job.status !== 'merged' && <Button variant="ghost" icon={Trash2} aria-label="Delete job" onClick={() => setConfirm('delete')} />}
        </div>
      </div>

      <PipelineStepper job={job} />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="tab-panel">
        {tab === 'overview' && <OverviewTab job={job} onOpen={setTab} onRerun={rerun} />}
        {tab === 'ast' && <AstTab job={job} getSources={getSources} sources={sources} />}
        {tab === 'analysis' && <AnalysisTab job={job} getSources={getSources} sources={sources} />}
        {tab === 'code' && <CodeTab job={job} getSources={getSources} sources={sources} />}
        {tab === 'validation' && <ValidationTab job={job} setJob={setJob} />}
        {tab === 'review' && <ReviewTab job={job} setJob={setJob} reload={load} getSources={getSources} sources={sources} />}
      </div>

      <Confirm
        open={confirm === 'cancel'}
        title="Cancel job"
        message="Stop this modernization job? Work in progress is discarded."
        confirmLabel="Cancel job"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await api.post(`/api/jobs/${job.id}/cancel`);
            setConfirm(null);
            setTimeout(load, 600);
          } catch (err) {
            toast.error(err.message);
          }
        }}
      />
      <Confirm
        open={confirm === 'delete'}
        title="Delete job"
        message={`Delete job #${job.number} and its generated code and review history?`}
        confirmLabel="Delete job"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try {
            await api.del(`/api/jobs/${job.id}`);
            toast.success('Job deleted');
            navigate(`/projects/${job.project.id}`);
          } catch (err) {
            toast.error(err.message);
            setConfirm(null);
          }
        }}
      />
    </div>
  );
}
