import { FolderKanban, FolderPlus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, EmptyState, LangBadge, Spinner, StatusBadge } from '../components/ui.jsx';
import { plural, scoreTone, timeAgo } from '../lib/format.js';
import { useMeta } from '../lib/meta.jsx';
import { SampleCards } from './Dashboard.jsx';

export function Projects() {
  const meta = useMeta();
  const [projects, setProjects] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/api/projects')
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!projects) return [];
    if (!q) return projects;
    return projects.filter((p) => {
      const langs = p.languages.map((l) => `${l} ${meta?.languages[l]?.label || ''}`).join(' ');
      const target = `${p.target.language} ${meta?.targets[p.target.language]?.label || ''}`;
      return `${p.name} ${p.description} ${langs} ${target}`.toLowerCase().includes(q);
    });
  }, [projects, query, meta]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="muted">Each project holds a set of legacy sources and the history of their modernization jobs.</p>
        </div>
        <Link to="/projects/new" className="btn btn-primary">
          <FolderPlus size={16} /> New project
        </Link>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      {!projects && !error ? (
        <Spinner />
      ) : projects && !projects.length ? (
        <>
          <EmptyState icon={FolderKanban} title="No projects yet" action={<Link to="/projects/new" className="btn btn-primary">Create a project</Link>}>
            Upload COBOL, VB6, Java or C/C++ sources, or start from one of the samples below.
          </EmptyState>
          <SampleCards />
        </>
      ) : (
        <>
          <div className="toolbar">
            <div className="input-icon">
              <Search size={15} />
              <input type="search" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <span className="muted small">{plural(filtered.length, 'project')}</span>
          </div>
          {!filtered.length && <EmptyState icon={Search} title={`No projects match “${query.trim()}”`}>Try a project name, a legacy language such as COBOL, or a target such as Python.</EmptyState>}
          <div className="project-grid">
            {filtered.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="project-card">
                <div className="project-card-head">
                  <h3>{p.name}</h3>
                  {p.lastJob && <StatusBadge status={p.lastJob.status} />}
                </div>
                <p className="muted small clamp-2">{p.description || 'No description'}</p>
                <div className="project-langs">
                  {p.languages.map((l) => (
                    <LangBadge key={l} language={l} label={meta?.languages[l]?.label} />
                  ))}
                  <span className="muted">→</span>
                  <Badge tone="info">{meta?.targets[p.target.language]?.label || p.target.language}</Badge>
                </div>
                <div className="project-card-foot">
                  <span>
                    {plural(p.fileCount, 'file')} · {p.lines.toLocaleString()} lines · {plural(p.jobCount, 'job')}
                  </span>
                  {p.lastJob?.score != null && <Badge tone={scoreTone(p.lastJob.score)}>{p.lastJob.score}/100</Badge>}
                </div>
                <div className="muted small">Updated {timeAgo(p.updatedAt)}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
