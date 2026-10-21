import mongoose from 'mongoose';
import { LEGACY_LANGUAGE_IDS, TARGET_IDS } from '../pipeline/catalog.js';

const sourceFileSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, trim: true, maxlength: 200 },
    language: { type: String, enum: LEGACY_LANGUAGE_IDS, required: true },
    content: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const mergedFileSchema = new mongoose.Schema(
  {
    path: String,
    language: String,
    kind: String,
    content: String,
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    target: {
      language: { type: String, enum: TARGET_IDS, required: true },
      framework: { type: String, required: true },
    },
    files: [sourceFileSchema],
    jobCount: { type: Number, default: 0 },
    lastJob: {
      id: mongoose.Schema.Types.ObjectId,
      number: Number,
      status: String,
      score: Number,
      engine: String,
      at: Date,
    },
    merged: {
      jobId: mongoose.Schema.Types.ObjectId,
      jobNumber: Number,
      mergedAt: Date,
      files: [mergedFileSchema],
    },
  },
  { timestamps: true },
);

projectSchema.virtual('languages').get(function languages() {
  return [...new Set(this.files.map((f) => f.language))];
});

projectSchema.methods.summary = function summary() {
  return {
    id: this._id.toString(),
    name: this.name,
    description: this.description,
    target: this.target,
    languages: this.languages,
    fileCount: this.files.length,
    lines: this.files.reduce((a, f) => a + (f.content ? f.content.split('\n').length : 0), 0),
    jobCount: this.jobCount,
    lastJob: this.lastJob?.id ? this.lastJob : null,
    merged: this.merged?.jobId ? { jobId: this.merged.jobId, jobNumber: this.merged.jobNumber, mergedAt: this.merged.mergedAt, fileCount: this.merged.files.length } : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Project = mongoose.model('Project', projectSchema);
