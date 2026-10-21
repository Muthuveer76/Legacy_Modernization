import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { databaseIn, describeUri, explainConnectError } from '../src/db.js';

const ATLAS = 'mongodb+srv://lift_user:s3cr%40t@cluster0.ab1cd.mongodb.net/?retryWrites=true&w=majority&appName=LegacyLift';

describe('MongoDB connection strings', () => {
  it('finds the database named in the path, if any', () => {
    assert.equal(databaseIn(ATLAS), null);
    assert.equal(databaseIn('mongodb+srv://u:p@cluster0.ab1cd.mongodb.net/legacy_modernization?retryWrites=true'), 'legacy_modernization');
    assert.equal(databaseIn('mongodb://127.0.0.1:27017/lmp_test'), 'lmp_test');
    assert.equal(databaseIn('mongodb://127.0.0.1:27017'), null);
  });

  it('describes the host without leaking credentials', () => {
    assert.equal(describeUri(ATLAS), 'mongodb+srv://cluster0.ab1cd.mongodb.net');
    assert.doesNotMatch(describeUri(ATLAS), /s3cr|lift_user/);
    assert.equal(describeUri('mongodb://127.0.0.1:27017/x'), 'mongodb://127.0.0.1:27017');
  });

  it('explains common Atlas failures', () => {
    assert.match(explainConnectError(new Error('bad auth : Authentication failed.'), ATLAS), /Database Access/);
    assert.match(explainConnectError(new Error('querySrv ENOTFOUND _mongodb._tcp.cluster0.ab1cd.mongodb.net'), ATLAS), /could not be resolved/);
    assert.match(explainConnectError(new Error('Server selection timed out after 15000 ms'), ATLAS), /Network Access/);
    assert.match(explainConnectError(new Error('connect ECONNREFUSED 127.0.0.1:27017'), 'mongodb://127.0.0.1:27017/x'), /npm run dev:db/);
  });
});
