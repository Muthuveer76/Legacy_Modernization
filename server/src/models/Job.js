import mongoose from 'mongoose';

const { Mixed, ObjectId } = mongoose.Schema.Types;

export const STAGES = ['parse', 'analyze', 'generate', 'validate'];
export const ACTIVE_STATUSES = ['queued', 'running'];

const stageSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
    startedAt: Date,
    finishedAt: Date,
    message: String,
  },
  { _id: false },
);

const generatedFileSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    language: String,
    kind: { type: String, enum: ['source', 'test', 'config', 'doc'], default: 'source' },
    content: { type: String, default: '' },
    original: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    legacyFile: String,
  },
  { _id: false },
);

const commentSchema = new mongoose.Schema(
  {
    file: String,
    line: Number,
    body: { type: String, required: true, maxlength: 4000 },
    author: { id: ObjectId, name: String },
    resolved: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const jobSchema = new mongoose.Schema(
  {
    project: { type: ObjectId, ref: 'Project', required: true, index: true },
    owner: { type: ObjectId, ref: 'User', required: true, index: true },
    number: { type: Number, required: true },
    status: { type: String, enum: ['queued', 'running', 'review', 'approved', 'rejected', 'merged', 'failed', 'cancelled'], default: 'queued', index: true },
    engine: {
      requested: { type: String, enum: ['auto', 'claude', 'structural'], default: 'auto' },
      used: { type: String, enum: ['claude', 'structural', null], default: null },
      model: String,
      reason: String,
    },
    target: { language: String, framework: String },
    feedback: { type: String, maxlength: 20000 },
    parentJob: { type: ObjectId, ref: 'Job' },
    stages: {
      parse: { type: stageSchema, default: () => ({}) },
      analyze: { type: stageSchema, default: () => ({}) },
      generate: { type: stageSchema, default: () => ({}) },
      validate: { type: stageSchema, default: () => ({}) },
    },
    progress: { type: Mixed, default: () => ({}) },
    error: { stage: String, message: String },
    parse: { type: Mixed },
    analysis: { type: Mixed },
    generation: {
      engine: String,
      summary: String,
      model: String,
      fellBack: Boolean,
      reasoning: String,
      usage: Mixed,
      files: [generatedFileSchema],
      mapping: Mixed,
      dataMapping: Mixed,
      notes: Mixed,
      testPlan: Mixed,
    },
    baselineValidation: Mixed,
    validation: Mixed,
    review: {
      decision: { type: String, enum: ['approved', 'rejected', 'changes-requested', null], default: null },
      summary: String,
      decidedAt: Date,
      decidedBy: { id: ObjectId, name: String },
      comments: [commentSchema],
    },
    mergedAt: Date,
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true },
);

jobSchema.index({ project: 1, number: -1 });

jobSchema.methods.summary = function summary() {
  return {
    id: this._id.toString(),
    number: this.number,
    status: this.status,
    engine: this.engine,
    target: this.target,
    stages: this.stages,
    score: this.validation?.score ?? null,
    error: this.error?.message ? this.error : null,
    parentJob: this.parentJob || null,
    reviewDecision: this.review?.decision || null,
    fileCount: this.generation?.files?.length || 0,
    createdAt: this.createdAt,
    finishedAt: this.finishedAt,
  };
};

export const Job = mongoose.model('Job', jobSchema);
