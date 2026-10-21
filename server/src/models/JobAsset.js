import mongoose from 'mongoose';

// Large, rarely-read job data (source snapshot, syntax trees, rule-based baseline) lives in
// its own collection so a Job document stays well under MongoDB's 16 MB document limit.
const jobAssetSchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    kind: { type: String, enum: ['source', 'ast', 'baseline'], required: true },
    key: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: false },
);

jobAssetSchema.index({ job: 1, kind: 1, key: 1 }, { unique: true });

export const JobAsset = mongoose.model('JobAsset', jobAssetSchema);

export async function saveAssets(jobId, kind, entries) {
  if (!entries.length) return;
  await JobAsset.bulkWrite(
    entries.map(({ key, data }) => ({
      updateOne: { filter: { job: jobId, kind, key }, update: { $set: { data } }, upsert: true },
    })),
  );
}

export async function loadAssets(jobId, kind) {
  const docs = await JobAsset.find({ job: jobId, kind }).lean();
  return docs.map((d) => ({ key: d.key, data: d.data }));
}

export async function deleteAssetsFor(jobIds) {
  await JobAsset.deleteMany({ job: { $in: jobIds } });
}
