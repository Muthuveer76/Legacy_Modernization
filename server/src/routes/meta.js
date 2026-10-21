import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { Job } from '../models/Job.js';
import { Project } from '../models/Project.js';
import { LEGACY_LANGUAGES, TARGETS } from '../pipeline/catalog.js';
import { SAMPLES, loadSample } from '../samples/index.js';

const router = Router();

router.get('/health', (req, res) => {
  const db = mongoose.connection.readyState === 1 ? 'up' : 'down';
  res.status(db === 'up' ? 200 : 503).json({ ok: db === 'up', db, uptime: Math.round(process.uptime()) });
});

router.get('/meta', (req, res) => {
  res.json({
    languages: LEGACY_LANGUAGES,
    targets: TARGETS,
    ai: { enabled: config.ai.enabled, model: config.ai.enabled ? config.ai.model : null },
    samples: SAMPLES,
    limits: {
      maxProjectKb: Math.round(config.limits.maxProjectBytes / 1024),
      maxFileKb: Math.round(config.limits.maxFileBytes / 1024),
      maxFilesPerProject: config.limits.maxFilesPerProject,
      maxAiSourceLines: config.limits.maxAiSourceLines,
    },
  });
});

router.get('/samples/:id', requireAuth, (req, res) => {
  const sample = loadSample(req.params.id);
  if (!sample) throw new HttpError(404, 'Sample not found');
  res.json({ sample });
});

router.get('/stats', requireAuth, async (req, res) => {
  const owner = new mongoose.Types.ObjectId(req.user.id);
  const [projects, jobsByStatus, scores, lines] = await Promise.all([
    Project.countDocuments({ owner }),
    Job.aggregate([{ $match: { owner } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Job.aggregate([{ $match: { owner, 'validation.score': { $type: 'number' } } }, { $group: { _id: null, avg: { $avg: '$validation.score' }, procedures: { $sum: '$analysis.summary.procedures' } } }]),
    Project.aggregate([{ $match: { owner } }, { $unwind: '$files' }, { $group: { _id: null, bytes: { $sum: '$files.size' }, files: { $sum: 1 } } }]),
  ]);
  const byStatus = Object.fromEntries(jobsByStatus.map((j) => [j._id, j.n]));
  res.json({
    projects,
    jobs: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    avgScore: scores[0]?.avg != null ? Math.round(scores[0].avg) : null,
    proceduresAnalyzed: scores[0]?.procedures || 0,
    legacyFiles: lines[0]?.files || 0,
    legacyKb: Math.round((lines[0]?.bytes || 0) / 1024),
  });
});

export default router;
