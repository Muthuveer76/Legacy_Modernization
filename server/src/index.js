import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb, describeUri, disconnectDb, explainConnectError } from './db.js';
import { recoverInterruptedJobs } from './pipeline/runner.js';

async function main() {
  try {
    const conn = await connectDb(config.mongoUri, { dbName: config.mongoDbName });
    console.log(`[startup] MongoDB connected: ${describeUri(config.mongoUri)} (database "${conn.name}")`);
  } catch (err) {
    throw new Error(`could not connect to ${describeUri(config.mongoUri)}: ${explainConnectError(err, config.mongoUri)}`);
  }
  const recovered = await recoverInterruptedJobs();
  if (recovered) console.log(`[startup] marked ${recovered} interrupted job(s) as failed`);
  if (config.jwtSecretIsEphemeral) console.warn('[startup] JWT_SECRET is not set; using a random secret (sessions reset on restart)');
  console.log(`[startup] AI engine: ${config.ai.enabled ? `${config.ai.model} (effort ${config.ai.effort})` : 'not configured; the rule-based translator will be used'}`);

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[startup] Legacy Modernization Platform listening on http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    console.log(`[shutdown] ${signal} received`);
    server.close(async () => {
      await disconnectDb().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[startup] failed:', err.message);
  process.exit(1);
});
