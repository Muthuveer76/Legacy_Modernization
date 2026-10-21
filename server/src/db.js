import mongoose from 'mongoose';

// Database named in the connection string's path, e.g. ".../legacy_modernization?retryWrites=true".
export function databaseIn(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(uri);
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

// Host list without credentials, safe to log.
export function describeUri(uri) {
  const m = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  return m ? `${m[1]}://${m[2]}` : 'MongoDB';
}

export async function connectDb(uri, { dbName } = {}) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    appName: 'LegacyLift',
    // An Atlas string copied from the dashboard usually has no database name; without one
    // Mongoose would silently use "test".
    ...(dbName && !databaseIn(uri) ? { dbName } : {}),
  });
  return mongoose.connection;
}

// Turns the usual Atlas connection failures into an actionable message.
export function explainConnectError(err, uri) {
  const text = `${err?.message || err}`;
  if (/bad auth|Authentication failed|auth failed/i.test(text)) return `${text}\n  → Check the database user name and password in MONGODB_URI (Atlas → Database Access). Special characters in the password must be URL-encoded.`;
  if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(text)) return `${text}\n  → The cluster host in MONGODB_URI could not be resolved. Copy the connection string again from Atlas → Connect → Drivers, and check your internet connection.`;
  if (/Server selection timed out|ETIMEDOUT|ECONNREFUSED|whitelist|IP that isn't|IP address/i.test(text) && uri.startsWith('mongodb+srv://')) return `${text}\n  → Atlas did not accept the connection. Add this machine's IP address in Atlas → Network Access (or 0.0.0.0/0 for a cloud host such as Render).`;
  if (/ECONNREFUSED/.test(text)) return `${text}\n  → No MongoDB server is listening at ${describeUri(uri)}. Set MONGODB_URI to your Atlas connection string, or start a local server with \`npm run dev:db\`.`;
  return text;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
