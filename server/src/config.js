import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const isProd = env.NODE_ENV === 'production';

function int(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

const jwtSecret = env.JWT_SECRET || (isProd ? '' : crypto.randomBytes(32).toString('hex'));
if (isProd && jwtSecret.length < 16) {
  throw new Error('JWT_SECRET must be set (16+ characters) in production');
}
if (isProd && !env.MONGODB_URI) {
  throw new Error('MONGODB_URI must be set in production (for example a MongoDB Atlas mongodb+srv:// connection string)');
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: int('PORT', 5000),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/legacy_modernization',
  // Used when the connection string names no database (Atlas copies usually end in "/?...").
  mongoDbName: env.MONGODB_DB || 'legacy_modernization',
  jwtSecret,
  jwtSecretIsEphemeral: !env.JWT_SECRET,
  tokenTtlSeconds: 7 * 24 * 3600,
  trustProxy: int('TRUST_PROXY', 0),
  clientDist: env.CLIENT_DIST || path.resolve(here, '../../client/dist'),
  ai: {
    enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    effort: env.ANTHROPIC_EFFORT || 'high',
    maxTokens: int('ANTHROPIC_MAX_TOKENS', 64000),
    // Server-side refusal fallback; set ANTHROPIC_FALLBACKS=off for models or platforms that reject it.
    fallbacks: (env.ANTHROPIC_FALLBACKS || 'default') !== 'off',
  },
  limits: {
    maxProjectBytes: int('MAX_PROJECT_KB', 2048) * 1024,
    maxFileBytes: int('MAX_FILE_KB', 200) * 1024,
    maxFilesPerProject: int('MAX_FILES_PER_PROJECT', 25),
    maxAiSourceLines: int('MAX_AI_SOURCE_LINES', 3000),
    maxConcurrentJobsPerUser: int('MAX_CONCURRENT_JOBS_PER_USER', 2),
  },
};
