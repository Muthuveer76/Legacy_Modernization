import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError, parseBody } from '../middleware/errors.js';
import { Job } from '../models/Job.js';
import { deleteAssetsFor } from '../models/JobAsset.js';
import { Project } from '../models/Project.js';
import { LEGACY_LANGUAGE_IDS, TARGET_IDS, detectLanguage, isValidFramework } from '../pipeline/catalog.js';
import { cancelJob, enqueueJob } from '../pipeline/runner.js';
import { loadSample } from '../samples/index.js';
import { fileSlug, zipMerged } from '../services/exporter.js';

const router = Router();
router.use(requireAuth);

const jobLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : 60,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many modernization jobs this hour; try again later' },
});

const PathSchema = z
  .string()
  .trim()
  .min(1, 'File path is required')
  .max(200)
  .regex(/^[\w\-. /]+$/, 'File paths may contain letters, digits, spaces, dash, underscore, dot and slash')
  .refine((p) => !p.split('/').some((seg) => seg === '..' || seg === '') && !p.startsWith('/'), 'Use a relative path without ".." segments');

const FileInput = z.object({
  path: PathSchema,
  content: z.string(),
  language: z.enum(LEGACY_LANGUAGE_IDS).optional(),
});

const TargetSchema = z
  .object({ language: z.enum(TARGET_IDS), framework: z.string().min(1).max(40) })
  .refine((t) => isValidFramework(t.language, t.framework), { message: 'Unsupported framework for this target language', path: ['framework'] });

const CreateSchema = z
  .object({
    name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(100),
    description: z.string().trim().max(1000).optional().default(''),
    target: TargetSchema.optional(),
    files: z.array(FileInput).max(config.limits.maxFilesPerProject).optional(),
    sampleId: z.string().max(60).optional(),
  })
  .refine((b) => (b.files && b.files.length) || b.sampleId, { message: 'Add at least one legacy source file or pick a sample', path: ['files'] });

const UpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  target: TargetSchema.optional(),
});

const StartJobSchema = z.object({
  engine: z.enum(['auto', 'claude', 'structural']).optional().default('auto'),
  feedback: z.string().trim().max(20000).optional(),
});

function assertProjectSize(files) {
  const total = files.reduce((a, f) => a + (f.size ?? Buffer.byteLength(f.content, 'utf8')), 0);
  if (total > config.limits.maxProjectBytes) {
    throw new HttpError(413, `The project's sources would total ${Math.ceil(total / 1024)} KB; the limit is ${Math.round(config.limits.maxProjectBytes / 1024)} KB. Split the code into several projects.`);
  }
}

function prepareFile(f) {
  const size = Buffer.byteLength(f.content, 'utf8');
  if (size > config.limits.maxFileBytes) throw new HttpError(413, `${f.path} is ${Math.ceil(size / 1024)} KB; the limit is ${Math.round(config.limits.maxFileBytes / 1024)} KB per file`);
  if (!f.content.trim()) throw new HttpError(400, `${f.path} is empty`);
  const language = f.language || detectLanguage(f.path, f.content);
  if (!language) throw new HttpError(400, `Cannot tell the language of ${f.path}; use a .cbl/.cob, .bas/.cls/.frm, .java or .c/.cpp extension`);
  return { path: f.path, language, content: f.content.replace(/\r\n?/g, '\n'), size };
}

async function loadProject(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Project not found');
  const project = await Project.findOne({ _id: req.params.id, owner: req.user.id });
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

function fileView(f) {
  return { id: f._id.toString(), path: f.path, language: f.language, size: f.size, lines: f.content.split('\n').length, content: f.content, updatedAt: f.updatedAt };
}

router.get('/', async (req, res) => {
  const projects = await Project.find({ owner: req.user.id }).sort({ updatedAt: -1 }).select('-merged.files.content');
  res.json({ projects: projects.map((p) => p.summary()) });
});

router.post('/', async (req, res) => {
  const body = parseBody(CreateSchema, req.body);
  let files = body.files || [];
  let target = body.target;
  if (body.sampleId) {
    const sample = loadSample(body.sampleId);
    if (!sample) throw new HttpError(400, 'Unknown sample');
    files = [...files, { path: sample.file, content: sample.content, language: sample.language }];
    target ||= sample.target;
  }
  if (!target) throw new HttpError(400, 'target: choose a target language and framework');
  const prepared = files.map(prepareFile);
  assertProjectSize(prepared);
  const paths = new Set();
  for (const f of prepared) {
    if (paths.has(f.path)) throw new HttpError(400, `Duplicate file path ${f.path}`);
    paths.add(f.path);
  }
  const project = await Project.create({ owner: req.user.id, name: body.name, description: body.description, target, files: prepared });
  res.status(201).json({ project: project.summary() });
});

router.get('/:id', async (req, res) => {
  const project = await loadProject(req);
  const jobs = await Job.find({ project: project._id }).sort({ number: -1 }).select('number status engine target stages validation.score error parentJob review.decision generation.files.path createdAt finishedAt');
  res.json({
    project: { ...project.summary(), files: project.files.map(fileView) },
    jobs: jobs.map((j) => j.summary()),
  });
});

router.patch('/:id', async (req, res) => {
  const project = await loadProject(req);
  const body = parseBody(UpdateSchema, req.body);
  Object.assign(project, body);
  await project.save();
  res.json({ project: project.summary() });
});

router.delete('/:id', async (req, res) => {
  const project = await loadProject(req);
  const jobs = await Job.find({ project: project._id }).select('_id status');
  jobs.filter((j) => ['queued', 'running'].includes(j.status)).forEach((j) => cancelJob(j._id));
  await Job.deleteMany({ project: project._id });
  await deleteAssetsFor(jobs.map((j) => j._id));
  await project.deleteOne();
  res.json({ ok: true });
});

router.post('/:id/files', async (req, res) => {
  const project = await loadProject(req);
  const { files } = parseBody(z.object({ files: z.array(FileInput).min(1).max(config.limits.maxFilesPerProject) }), req.body);
  if (project.files.length + files.length > config.limits.maxFilesPerProject) throw new HttpError(400, `A project can hold at most ${config.limits.maxFilesPerProject} files`);
  const prepared = files.map(prepareFile);
  assertProjectSize([...project.files, ...prepared]);
  for (const f of prepared) {
    if (project.files.some((x) => x.path === f.path)) throw new HttpError(409, `${f.path} already exists in this project`);
    project.files.push(f);
  }
  await project.save();
  res.status(201).json({ files: project.files.map(fileView) });
});

router.put('/:id/files/:fileId', async (req, res) => {
  const project = await loadProject(req);
  const file = project.files.id(req.params.fileId);
  if (!file) throw new HttpError(404, 'File not found');
  const body = parseBody(FileInput.partial(), req.body);
  const next = prepareFile({ path: body.path ?? file.path, content: body.content ?? file.content, language: body.language ?? file.language });
  if (next.path !== file.path && project.files.some((x) => x.path === next.path)) throw new HttpError(409, `${next.path} already exists`);
  assertProjectSize([...project.files.filter((x) => x !== file), next]);
  file.set(next);
  await project.save();
  res.json({ file: fileView(file) });
});

router.delete('/:id/files/:fileId', async (req, res) => {
  const project = await loadProject(req);
  const file = project.files.id(req.params.fileId);
  if (!file) throw new HttpError(404, 'File not found');
  file.deleteOne();
  await project.save();
  res.json({ ok: true });
});

router.get('/:id/jobs', async (req, res) => {
  const project = await loadProject(req);
  const jobs = await Job.find({ project: project._id }).sort({ number: -1 }).select('number status engine target stages validation.score error parentJob review.decision generation.files.path createdAt finishedAt');
  res.json({ jobs: jobs.map((j) => j.summary()) });
});

export async function createJob({ project, userId, engine, feedback, parentJob }) {
  if (!project.files.length) throw new HttpError(400, 'Add at least one legacy source file first');
  const active = await Job.countDocuments({ owner: userId, status: { $in: ['queued', 'running'] } });
  if (active >= config.limits.maxConcurrentJobsPerUser) throw new HttpError(429, `You already have ${active} job(s) running; wait for one to finish`);
  const updated = await Project.findOneAndUpdate({ _id: project._id }, { $inc: { jobCount: 1 } }, { returnDocument: 'after' });
  const job = await Job.create({
    project: project._id,
    owner: userId,
    number: updated.jobCount,
    engine: { requested: engine },
    target: { language: project.target.language, framework: project.target.framework },
    feedback,
    parentJob,
  });
  await Project.updateOne({ _id: project._id }, { $set: { lastJob: { id: job._id, number: job.number, status: 'queued', score: null, engine: null, at: new Date() } } });
  enqueueJob(job._id);
  return job;
}

router.post('/:id/jobs', jobLimiter, async (req, res) => {
  const project = await loadProject(req);
  const body = parseBody(StartJobSchema, req.body || {});
  const job = await createJob({ project, userId: req.user.id, engine: body.engine, feedback: body.feedback });
  res.status(202).json({ job: job.summary() });
});

router.get('/:id/merged', async (req, res) => {
  const project = await loadProject(req);
  if (!project.merged?.jobId) throw new HttpError(404, 'Nothing has been merged into this project yet');
  res.json({ merged: { jobId: project.merged.jobId, jobNumber: project.merged.jobNumber, mergedAt: project.merged.mergedAt, files: project.merged.files } });
});

router.get('/:id/export', async (req, res) => {
  const project = await loadProject(req);
  if (!project.merged?.jobId) throw new HttpError(404, 'Approve and merge a job before exporting the modernized codebase');
  const buffer = await zipMerged(project);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileSlug(project.name)}-modernized.zip"`);
  res.send(buffer);
});

export default router;
