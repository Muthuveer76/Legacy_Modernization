import JSZip from 'jszip';
import { LEGACY_LANGUAGES, TARGETS } from '../pipeline/catalog.js';

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function fileSlug(name) {
  return (
    String(name)
      .replace(/[^\w.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .toLowerCase() || 'project'
  );
}

export function buildReport(project, job) {
  const a = job.analysis || {};
  const v = job.validation || {};
  const g = job.generation || {};
  const target = TARGETS[job.target.language];
  const lines = [];
  lines.push(`# Modernization report: ${project.name} (job #${job.number})`, '');
  lines.push(`- **Legacy sources:** ${project.files.map((f) => `${f.path} (${LEGACY_LANGUAGES[f.language]?.label || f.language})`).join(', ')}`);
  lines.push(`- **Target:** ${target?.label || job.target.language}, ${target?.frameworks[job.target.framework] || job.target.framework}`);
  lines.push(`- **Engine:** ${job.engine.used === 'claude' ? `Claude (${g.model || job.engine.model})` : 'Rule-based structural translator'}${job.engine.reason ? ` (${job.engine.reason})` : ''}`);
  lines.push(`- **Fidelity score:** ${v.score ?? 'n/a'}/100`);
  if (job.baselineValidation) lines.push(`- **Rule-based baseline score:** ${job.baselineValidation.score}/100`);
  lines.push(`- **Status:** ${job.status}${job.review?.decision ? ` (review: ${job.review.decision})` : ''}`, '');
  if (g.summary) lines.push('## Summary', '', g.summary, '');

  if (a.summary) {
    const s = a.summary;
    lines.push('## Legacy code analysis', '');
    lines.push(`${s.files} file(s), ${s.lines} lines, ${s.procedures} procedure(s), ${s.dataItems} data item(s). Average cyclomatic complexity ${s.avgComplexity}, maximum ${s.maxComplexity}.`, '');
    if (a.findings?.length) {
      lines.push('| Severity | Rule | Finding | Location |', '|---|---|---|---|');
      for (const f of a.findings) lines.push(`| ${f.severity} | ${f.rule} | ${cell(f.message)} | ${cell(f.file)}:${f.line ?? ''} |`);
      lines.push('');
    }
  }
  if (v.checks) {
    lines.push('## Validation', '', '| Check | Status | Detail |', '|---|---|---|');
    for (const c of v.checks) lines.push(`| ${cell(c.label)} | ${c.status} | ${cell(c.detail)} |`);
    lines.push('');
  }
  if (v.procedures?.length) {
    lines.push('## Procedure mapping', '', '| Legacy procedure | Modern symbol | Complexity (legacy → modern) | Status |', '|---|---|---|---|');
    for (const p of v.procedures) lines.push(`| ${cell(p.name)} (${cell(p.file)}) | ${cell(p.modernSymbol || '-')} | ${p.parity ? `${p.parity.legacy} → ${p.parity.modern}` : '-'} | ${p.status} |`);
    lines.push('');
  }
  if (g.dataMapping?.length) {
    lines.push('## Data mapping', '', '| Legacy item | Modern name | Modern type | Notes |', '|---|---|---|---|');
    for (const d of g.dataMapping) lines.push(`| ${cell(d.legacyName)} | ${cell(d.modernName)} | ${cell(d.modernType)} | ${cell(d.notes)} |`);
    lines.push('');
  }
  if (g.notes?.length) {
    lines.push('## Notes', '');
    for (const n of g.notes) lines.push(`- **${n.category}:** ${n.text}`);
    lines.push('');
  }
  const review = job.review || {};
  if (review.decision || review.comments?.length) {
    lines.push('## Human review', '');
    if (review.decision) lines.push(`Decision: **${review.decision}**${review.decidedBy?.name ? ` by ${review.decidedBy.name}` : ''}${review.decidedAt ? ` on ${new Date(review.decidedAt).toISOString().slice(0, 10)}` : ''}.`, '');
    if (review.summary) lines.push(review.summary, '');
    for (const c of review.comments || []) lines.push(`- ${c.resolved ? '~~' : ''}${c.file ? `\`${c.file}${c.line ? `:${c.line}` : ''}\`` : 'General'}: ${c.body} (${c.author?.name || 'reviewer'})${c.resolved ? '~~' : ''}`);
    lines.push('');
  }
  lines.push('## Files', '', '| File | Kind | Review status |', '|---|---|---|');
  for (const f of g.files || []) lines.push(`| ${cell(f.path)} | ${f.kind} | ${f.status}${f.content !== f.original ? ' (edited by reviewer)' : ''} |`);
  lines.push('');
  return lines.join('\n');
}

export async function zipJob(project, job) {
  const zip = new JSZip();
  const root = zip.folder(`${fileSlug(project.name)}-job-${job.number}`);
  for (const f of job.generation.files) {
    if (f.status === 'rejected') continue;
    root.file(f.path, f.content);
  }
  root.file('MODERNIZATION_REPORT.md', buildReport(project, job));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function zipMerged(project) {
  const zip = new JSZip();
  const root = zip.folder(`${fileSlug(project.name)}-modernized`);
  for (const f of project.merged.files) root.file(f.path, f.content);
  const legacy = root.folder('legacy');
  for (const f of project.files) legacy.file(f.path, f.content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
