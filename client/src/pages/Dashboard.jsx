import { ArrowRight, FileCode, FolderKanban, FolderPlus, Gauge, GitBranch, Play, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, Button, Card, EmptyState, LangBadge, Spinner, Stat, StatusBadge } from '../components/ui.jsx';
import { launchSample } from '../lib/actions.js';
import { useAuth } from '../lib/auth.jsx';
import { scoreTone, timeAgo } from '../lib/format.js';
import { useMeta } from '../lib/meta.jsx';
import { useToast } from '../lib/toast.jsx';

export function SampleCards({ compact }) {
  const meta = useMeta();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  if (!meta) return null;
  return (
    <div className={`sample-grid${compact ? ' compact' : ''}`}>
      {meta.samples.map((s) => (
        <div key={s.id} className="sample-card">
          <div className="sample-head">
            <LangBadge language={s.language} label={meta.languages[s.language]?.label} />
            <ArrowRight size={14} className="muted" />
            <Badge tone="info">{meta.targets[s.target.language]?.label}</Badge>
          </div>
          <h4>{s.name}</h4>
          <p className="muted small">{s.description}</p>
          <Button
            variant="secondary"
            size="sm"
            icon={Play}
            loading={busy === s.id}
            onClick={async () => {
              setBusy(s.id);
              try {
                const { job } = await launchSample(s);
                navigate(`/jobs/${job.id}`);
              } catch (err) {
                toast.error(err.message);
                setBusy(null);
              }
            }}
          >
            Modernize this sample
          </Button>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const meta = useMeta();
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState(null);

  useEffect(() => {
    api.get('/api/stats').then(setStats).catch(() => setStats({}));
    api.get('/api/projects').then((r) => setProjects(r.projects)).catch(() => setProjects([]));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Hello, {user?.name?.split(' ')[0]}</h1>
          <p className="muted">Modernize legacy code with an auditable Parse → Analyze → Generate → Validate → Review pipeline.</p>
        </div>
        <Link to="/projects/new" className="btn btn-primary">
          <FolderPlus size={16} /> New project
        </Link>
      </div>

      {!stats ? (
        <Spinner />
      ) : (
        <div className="stat-grid">
          <Stat icon={FolderKanban} label="Projects" value={stats.projects ?? 0} hint={`${stats.legacyFiles ?? 0} legacy files · ${stats.legacyKb ?? 0} KB`} />
          <Stat icon={GitBranch} label="Modernization jobs" value={stats.jobs ?? 0} hint={`${stats.byStatus?.merged ?? 0} merged · ${stats.byStatus?.review ?? 0} in review`} />
          <Stat icon={Gauge} label="Average fidelity" value={stats.avgScore != null ? `${stats.avgScore}/100` : '–'} tone={scoreTone(stats.avgScore)} hint="Validation score across jobs" />
          <Stat icon={FileCode} label="Procedures analysed" value={stats.proceduresAnalyzed ?? 0} hint="Paragraphs, subs, functions and methods" />
        </div>
      )}

      {meta && !meta.ai.enabled && (
        <div className="alert alert-info">
          <Sparkles size={16} />
          <span>
            The AI engine is off because <code>ANTHROPIC_API_KEY</code> is not set on the server. Jobs use the rule-based structural translator, which is also the grounding
            draft the AI engine refines.
          </span>
        </div>
      )}

      <div className="grid-2">
        <Card title="Recent projects" actions={<Link to="/projects" className="link">View all</Link>}>
          {!projects ? (
            <Spinner />
          ) : !projects.length ? (
            <EmptyState icon={FolderKanban} title="No projects yet">
              Start with a sample on the right or upload your own legacy sources.
            </EmptyState>
          ) : (
            <ul className="list">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="list-row">
                    <div>
                      <div className="list-title">{p.name}</div>
                      <div className="muted small">
                        {p.languages.map((l) => meta?.languages[l]?.label || l).join(', ')} → {meta?.targets[p.target.language]?.label} · updated {timeAgo(p.updatedAt)}
                      </div>
                    </div>
                    <div className="list-side">
                      {p.lastJob?.score != null && <Badge tone={scoreTone(p.lastJob.score)}>{p.lastJob.score}/100</Badge>}
                      {p.lastJob && <StatusBadge status={p.lastJob.status} />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Try a sample" subtitle="One click creates a project and runs the full pipeline.">
          <SampleCards compact />
        </Card>
      </div>
    </div>
  );
}
