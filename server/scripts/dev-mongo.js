// Local MongoDB for development when no MongoDB server is installed: `npm run dev:db`.
// Data persists in server/.data/mongo between runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, '../.data/mongo');
fs.mkdirSync(dbPath, { recursive: true });

const port = Number(process.env.MONGO_PORT || 27017);
const server = await MongoMemoryServer.create({ instance: { port, dbPath, storageEngine: 'wiredTiger' } });
console.log(`MongoDB for development is running at ${server.getUri()}legacy_modernization`);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
