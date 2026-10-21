import { config } from '../config.js';
import { Job } from '../models/Job.js';
import { saveAssets } from '../models/JobAsset.js';
import { Project } from '../models/Project.js';
import { analyze } from './analyzer.js';
import { GenerationError, generateWithClaude } from './generator.js';
import { isCopybook, parseSourceFile } from './parsers/index.js';
import { translate } from './translate/index.js';
import { validateGenerated } from './validator.js';

// In-process job queue. One Node process runs the pipeline; job state lives in MongoDB so the
// UI can poll it and a restart marks unfinished jobs as failed.

const MAX_CONCURRENT = 3;
const queue = [];
const running = new Map(); // jobId -> AbortController
let log = (...args) => console.log('[pipeline]', ...args);

export function setPipelineLogger(fn) {
  log = fn;
}

export function enqueueJob(jobId) {
  queue.push(String(jobId));
  pump();
}

export function cancelJob(jobId) {
  const id = String(jobId);
  const idx = queue.indexOf(id);
  if (idx >= 0) {
    queue.splice(idx, 1);
    return 'dequeued';
  }
  const ctrl = running.get(id);
  if (ctrl) {
    ctrl.abort();
    return 'aborted';
  }
  return null;
}

export function isActive(jobId) {
  return running.has(String(jobId)) || queue.includes(String(jobId));
}

function pump() {
  while (running.size < MAX_CONCURRENT && queue.length) {
    const id = queue.shift();
    const ctrl = new AbortController();
    running.set(id, ctrl);
    runJob(id, ctrl.signal)
      .catch((err) => log('job crashed', id, err))
      .finally(() => {
        running.delete(id);
        pump();
      });
  }
}

export async function recoverInterruptedJobs() {
  const res = await Job.updateMany(
    { status: { $in: ['queued', 'running'] } },
    { $set: { status: 'failed', error: { stage: null, message: 'Interrupted by a server restart. Run the job again.' }, finishedAt: new Date() } },
  );
  return res.modifiedCount || 0;
}

// Generated paths end up in ZIP exports, so strip anything that could escape the project root.
export function safeGeneratedPath(raw, index) {
  const parts = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim().replace(/[^\w\-. @+]/g, '_'))
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/').slice(0, 240) || `file-${index + 1}.txt`;
}

export function chooseEngine(requested, totalLines) {
  if (requested === 'structural') return { used: 'structural', reason: 'Rule-based structural translator selected' };
  if (!config.ai.enabled) {
    if (requested === 'claude') throw new GenerationError('The AI engine is not configured on this server (set ANTHROPIC_API_KEY).');
    return { used: 'structural', reason: 'AI engine not configured; used the rule-based structural translator' };
  }
  if (totalLines > config.limits.maxAiSourceLines) {
    if (requested === 'claude') throw new GenerationError(`The project has ${totalLines} lines; the AI engine accepts up to ${config.limits.maxAiSourceLines}. Split it into smaller projects.`);
    return { used: 'structural', reason: `Project exceeds ${config.limits.maxAiSourceLines} lines; used the rule-based structural translator` };
  }
  return { used: 'claude', reason: `AI engine (${config.ai.model}) grounded in the AST analysis` };
}

async function setStage(jobId, stage, fields) {
  const set = {};
  for (const [k, v] of Object.entries(fields)) set[`stages.${stage}.${k}`] = v;
  await Job.updateOne({ _id: jobId }, { $set: set });
}

async function runJob(jobId, signal) {
  const job = await Job.findById(jobId);
  if (!job || job.status !== 'queued') return;
  const project = await Project.findById(job.project);
  if (!project) {
    await Job.updateOne({ _id: jobId }, { $set: { status: 'failed', error: { message: 'Project no longer exists' } } });
    return;
  }
  const started = Date.now();
  await Job.updateOne({ _id: jobId }, { $set: { status: 'running', startedAt: new Date(), progress: { stage: 'parse', message: 'Parsing legacy sources' } } });
  let stage = 'parse';
  const checkCancel = () => {
    if (signal.aborted) throw new GenerationError('Job was cancelled.');
  };
  try {
    // ---- Parse ----
    await setStage(jobId, 'parse', { status: 'running', startedAt: new Date() });
    const files = project.files.map((f) => ({ path: f.path, language: f.language, content: f.content }));
    const parseTargets = files.filter((f) => !isCopybook(f) || files.every(isCopybook));
    const parsed = [];
    for (const f of parseTargets) {
      parsed.push(await parseSourceFile(f, files));
      checkCancel();
    }
    const diagnostics = parsed.reduce((a, p) => a + p.diagnostics.length, 0);
    await saveAssets(jobId, 'source', files.map((f) => ({ key: f.path, data: f })));
    await saveAssets(
      jobId,
      'ast',
      parsed.map((p) => ({ key: p.file, data: { file: p.file, kind: p.ast.kind, tree: p.ast.tree, nodeCount: p.ast.nodeCount, truncated: p.ast.truncated } })),
    );
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          parse: {
            files: parsed.map((p) => ({ file: p.file, language: p.language, lines: p.lines, parser: p.parser, ms: p.ms, nodeCount: p.ast.nodeCount, diagnostics: p.diagnostics, modules: p.modules.map((m) => ({ name: m.name, kind: m.kind, procedures: m.procedures.length, dataItems: m.dataItems.length, entry: m.entry })) })),
            copybooks: files.filter(isCopybook).map((f) => f.path),
          },
          'stages.parse.status': 'done',
          'stages.parse.finishedAt': new Date(),
          'stages.parse.message': `${parsed.length} file(s), ${parsed.reduce((a, p) => a + p.modules.length, 0)} module(s), ${diagnostics} diagnostic(s)`,
          progress: { stage: 'analyze', message: 'Building control-flow graphs and data dictionary' },
        },
      },
    );
    if (!parsed.some((p) => p.modules.some((m) => m.procedures.length))) throw new GenerationError('No procedures were found in the uploaded sources; check the language of each file.');

    // ---- Analyze ----
    stage = 'analyze';
    await setStage(jobId, 'analyze', { status: 'running', startedAt: new Date() });
    const analysis = analyze(parsed);
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          analysis,
          'stages.analyze.status': 'done',
          'stages.analyze.finishedAt': new Date(),
          'stages.analyze.message': `${analysis.summary.procedures} procedure(s), max complexity ${analysis.summary.maxComplexity}, ${analysis.findings.length} finding(s)`,
          progress: { stage: 'generate', message: 'Preparing code generation' },
        },
      },
    );
    checkCancel();

    // ---- Generate ----
    stage = 'generate';
    await setStage(jobId, 'generate', { status: 'running', startedAt: new Date() });
    const totalLines = files.reduce((a, f) => a + f.content.split('\n').length, 0);
    const engine = chooseEngine(job.engine.requested, totalLines);
    await Job.updateOne({ _id: jobId }, { $set: { 'engine.used': engine.used, 'engine.reason': engine.reason, 'engine.model': engine.used === 'claude' ? config.ai.model : 'rule-based translator' } });
    const target = { language: job.target.language, framework: job.target.framework, projectName: project.name };
    const draft = translate(parsed, analysis, target);
    let generation = draft;
    if (engine.used === 'claude') {
      let previous = null;
      if (job.parentJob) {
        const parent = await Job.findById(job.parentJob).select('generation.files');
        if (parent?.generation?.files?.length) previous = { files: parent.generation.files.map((f) => ({ path: f.path, kind: f.kind, content: f.content })) };
      }
      let lastWrite = 0;
      generation = await generateWithClaude(
        { files, analysis, draft, target: job.target.language, framework: job.target.framework, projectName: project.name, feedback: job.feedback, previous },
        {
          signal,
          onProgress: (p) => {
            const now = Date.now();
            if (now - lastWrite < 1500) return;
            lastWrite = now;
            Job.updateOne({ _id: jobId }, { $set: { progress: { stage: 'generate', ...p } } }).catch(() => {});
          },
        },
      );
    }
    const seenPaths = new Set();
    const genFiles = [];
    generation.files.forEach((f, i) => {
      let path = safeGeneratedPath(f.path, i);
      while (seenPaths.has(path)) path = path.replace(/(\.[^./]+)?$/, `-${i + 1}$1`);
      seenPaths.add(path);
      genFiles.push({ path, language: f.language, kind: f.kind, content: f.content, original: f.content, status: 'pending', legacyFile: f.legacyFile });
    });
    if (engine.used === 'claude') await saveAssets(jobId, 'baseline', [{ key: '', data: { summary: draft.summary, files: draft.files, mapping: draft.mapping, notes: draft.notes } }]);
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          generation: {
            engine: generation.engine,
            summary: generation.summary,
            model: generation.model || (engine.used === 'claude' ? config.ai.model : 'rule-based translator'),
            fellBack: Boolean(generation.fellBack),
            reasoning: generation.reasoning || '',
            usage: generation.usage || null,
            files: genFiles,
            mapping: generation.mapping,
            dataMapping: generation.dataMapping,
            notes: generation.notes,
            testPlan: generation.testPlan,
          },
          'stages.generate.status': 'done',
          'stages.generate.finishedAt': new Date(),
          'stages.generate.message': `${genFiles.length} file(s) generated by ${engine.used === 'claude' ? generation.model || config.ai.model : 'the rule-based translator'}`,
          progress: { stage: 'validate', message: 'Validating generated code' },
        },
      },
    );
    checkCancel();

    // ---- Validate ----
    stage = 'validate';
    await setStage(jobId, 'validate', { status: 'running', startedAt: new Date() });
    const validation = await validateGenerated({ ...generation, files: genFiles }, analysis, job.target.language);
    let baselineValidation = null;
    if (engine.used === 'claude') {
      const bv = await validateGenerated(draft, analysis, job.target.language);
      baselineValidation = { score: bv.score, breakdown: bv.breakdown, checks: bv.checks.map((c) => ({ id: c.id, status: c.status })) };
    }
    const finishedAt = new Date();
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          validation,
          baselineValidation,
          status: 'review',
          'stages.validate.status': 'done',
          'stages.validate.finishedAt': finishedAt,
          'stages.validate.message': `Fidelity score ${validation.score}/100`,
          progress: { stage: 'review', message: 'Ready for human review' },
          finishedAt,
        },
      },
    );
    await Project.updateOne({ _id: project._id }, { $set: { lastJob: { id: job._id, number: job.number, status: 'review', score: validation.score, engine: engine.used, at: finishedAt } } });
    log(`job ${jobId} finished in ${Date.now() - started}ms (score ${validation.score})`);
  } catch (err) {
    const cancelled = signal.aborted;
    const message = err instanceof GenerationError ? err.message : `Unexpected error during ${stage}: ${err.message}`;
    if (!(err instanceof GenerationError)) log('job error', jobId, err);
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          status: cancelled ? 'cancelled' : 'failed',
          error: { stage, message: cancelled ? 'Job was cancelled.' : message },
          [`stages.${stage}.status`]: 'failed',
          [`stages.${stage}.finishedAt`]: new Date(),
          progress: { stage, message: cancelled ? 'Cancelled' : 'Failed' },
          finishedAt: new Date(),
        },
      },
    );
    await Project.updateOne({ _id: project._id }, { $set: { lastJob: { id: job._id, number: job.number, status: cancelled ? 'cancelled' : 'failed', score: null, engine: job.engine.used, at: new Date() } } });
  }
}

// Re-runs the Validate stage on the reviewer's current file contents.
export async function revalidateJob(job) {
  const files = job.generation.files.filter((f) => f.status !== 'rejected').map((f) => ({ path: f.path, language: f.language, kind: f.kind, content: f.content }));
  return validateGenerated({ ...job.generation.toObject(), files }, job.analysis, job.target.language);
}
