import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

// Config is read at import time, so set the environment before loading the app.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-with-enough-entropy-1234567890';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

let mongo;
let app;
let mongoose;

async function waitForJob(agent, jobId, statuses = ['review', 'failed', 'cancelled']) {
  const deadline = Date.now() + 30000;
  for (;;) {
    const res = await agent.get(`/api/jobs/${jobId}/status`).expect(200);
    if (statuses.includes(res.body.status)) return res.body;
    if (Date.now() > deadline) throw new Error(`job ${jobId} stuck in ${res.body.status}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function registered(name, email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ name, email, password: 'correct horse battery' }).expect(201);
  return agent;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  mongoose = (await import('mongoose')).default;
  const { connectDb } = await import('../src/db.js');
  await connectDb(mongo.getUri('lmp_test'));
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('auth', () => {
  it('registers, reads the session, logs out and logs back in', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ name: 'Ada Lovelace', email: 'ADA@example.com', password: 'analytical-engine' }).expect(201);
    assert.equal(reg.body.user.email, 'ada@example.com');
    assert.match(reg.headers['set-cookie'][0], /lmp_token=.*HttpOnly/i);
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.name, 'Ada Lovelace');
    await agent.post('/api/auth/logout').send({}).expect(200);
    await agent.get('/api/auth/me').expect(401);
    await agent.post('/api/auth/login').send({ email: 'ada@example.com', password: 'wrong-password' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'ada@example.com', password: 'analytical-engine' }).expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  it('rejects invalid input, duplicate accounts and non-JSON writes', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'X', email: 'not-an-email', password: 'short' }).expect(400);
    assert.ok(res.body.error);
    await request(app).post('/api/auth/register').send({ name: 'Grace', email: 'grace@example.com', password: 'compilers-rock' }).expect(201);
    await request(app).post('/api/auth/register').send({ name: 'Grace', email: 'grace@example.com', password: 'compilers-rock' }).expect(409);
    await request(app).post('/api/auth/login').type('form').send('email=grace@example.com&password=compilers-rock').expect(415);
  });
});

describe('modernization workflow', () => {
  let agent;
  let projectId;
  let jobId;

  before(async () => {
    agent = await registered('Muthu', 'muthu@example.com');
  });

  it('exposes metadata and samples', async () => {
    const meta = await agent.get('/api/meta').expect(200);
    assert.equal(meta.body.ai.enabled, false);
    assert.ok(meta.body.samples.length >= 4);
    assert.ok(meta.body.targets.java.frameworks['spring-boot']);
  });

  it('creates a project from a sample and validates file input', async () => {
    const res = await agent.post('/api/projects').send({ name: 'Payroll Migration', sampleId: 'cobol-payroll', target: { language: 'java', framework: 'plain' } }).expect(201);
    projectId = res.body.project.id;
    assert.deepEqual(res.body.project.languages, ['cobol']);
    await agent.post('/api/projects').send({ name: 'Empty', target: { language: 'java', framework: 'plain' } }).expect(400);
    await agent.post('/api/projects').send({ name: 'Bad path', target: { language: 'java', framework: 'plain' }, files: [{ path: '../etc/passwd', content: 'x' }] }).expect(400);
    await agent.post('/api/projects').send({ name: 'Bad fw', target: { language: 'java', framework: 'rails' }, files: [{ path: 'a.cbl', content: 'PROCEDURE DIVISION.' }] }).expect(400);
    const unknown = await agent.post('/api/projects').send({ name: 'Unknown lang', target: { language: 'python', framework: 'plain' }, files: [{ path: 'notes.txt', content: 'hello' }] }).expect(400);
    assert.match(unknown.body.error, /Cannot tell the language/);
  });

  it('runs the pipeline to human review with the rule-based engine', async () => {
    const start = await agent.post(`/api/projects/${projectId}/jobs`).send({ engine: 'auto' }).expect(202);
    jobId = start.body.job.id;
    const status = await waitForJob(agent, jobId);
    assert.equal(status.status, 'review', JSON.stringify(status.error));
    const { body } = await agent.get(`/api/jobs/${jobId}`).expect(200);
    const { job } = body;
    assert.equal(job.engine.used, 'structural');
    assert.equal(job.analysis.summary.procedures, 6);
    assert.ok(job.validation.score >= 90);
    assert.ok(job.generation.files.some((f) => f.path.endsWith('Payroll.java')));
    assert.ok(job.stages.validate.status === 'done');
    const ast = await agent.get(`/api/jobs/${jobId}/ast`).expect(200);
    assert.equal(ast.body.ast.tree.type, 'Program');
    const sources = await agent.get(`/api/jobs/${jobId}/sources`).expect(200);
    assert.deepEqual(sources.body.sources.map((s) => s.path), ['PAYROLL.cbl']);
    await agent.get(`/api/jobs/${jobId}/baseline`).expect(404);
  });

  it('enforces the total project size limit', async () => {
    const big = `      * ${'x'.repeat(150)}\n`.repeat(1100);
    const files = Array.from({ length: 14 }, (_, i) => ({ path: `PART${i}.cbl`, content: `       PROCEDURE DIVISION.\n${big}` }));
    const res = await agent.post('/api/projects').send({ name: 'Too big', target: { language: 'java', framework: 'plain' }, files }).expect(413);
    assert.match(res.body.error, /limit is 2048 KB/);
  });

  it('lets a reviewer edit, comment, revalidate, approve, merge and export', async () => {
    const { body } = await agent.get(`/api/jobs/${jobId}`).expect(200);
    const source = body.job.generation.files.find((f) => f.kind === 'source' && f.path.endsWith('.java'));
    const edited = source.content.replace('public class Payroll', '// reviewed\npublic class Payroll');
    const patch = await agent.patch(`/api/jobs/${jobId}/files`).send({ path: source.path, content: edited }).expect(200);
    assert.equal(patch.body.file.edited, true);
    await agent.post(`/api/jobs/${jobId}/comments`).send({ file: source.path, line: 3, body: 'Confirm rounding of WS-TAX' }).expect(201);
    const reval = await agent.post(`/api/jobs/${jobId}/revalidate`).send({}).expect(200);
    assert.ok(reval.body.validation.score >= 90);
    await agent.post(`/api/jobs/${jobId}/merge`).send({}).expect(409);
    const approved = await agent.post(`/api/jobs/${jobId}/review`).send({ decision: 'approved', summary: 'Matches legacy output' }).expect(200);
    assert.equal(approved.body.job.status, 'approved');
    const merged = await agent.post(`/api/jobs/${jobId}/merge`).send({}).expect(200);
    assert.ok(merged.body.merged.fileCount >= 3);
    const zip = await agent.get(`/api/projects/${projectId}/export`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    assert.equal(zip.headers['content-type'], 'application/zip');
    assert.equal(zip.body.subarray(0, 2).toString(), 'PK');
    const report = await agent.get(`/api/jobs/${jobId}/report`).expect(200);
    assert.match(report.text, /Procedure mapping/);
    assert.match(report.text, /Confirm rounding of WS-TAX/);
  });

  it('requests changes, which starts a linked regeneration job', async () => {
    const start = await agent.post(`/api/projects/${projectId}/jobs`).send({ engine: 'structural' }).expect(202);
    await waitForJob(agent, start.body.job.id);
    const res = await agent.post(`/api/jobs/${start.body.job.id}/review`).send({ decision: 'changes-requested', summary: 'Use a service class' }).expect(200);
    assert.equal(res.body.job.status, 'rejected');
    assert.ok(res.body.newJob);
    const child = await waitForJob(agent, res.body.newJob.id);
    assert.equal(child.status, 'review');
    const { body } = await agent.get(`/api/jobs/${res.body.newJob.id}`).expect(200);
    assert.equal(body.job.feedback, 'Use a service class');
    const list = await agent.get(`/api/projects/${projectId}`).expect(200);
    assert.equal(list.body.jobs.length, 3);
    assert.equal(list.body.project.merged.jobNumber, 1);
  });

  it('refuses the AI engine when it is not configured', async () => {
    const start = await agent.post(`/api/projects/${projectId}/jobs`).send({ engine: 'claude' }).expect(202);
    const status = await waitForJob(agent, start.body.job.id);
    assert.equal(status.status, 'failed');
    assert.match(status.error.message, /ANTHROPIC_API_KEY/);
  });

  it('keeps projects private to their owner', async () => {
    const other = await registered('Mallory', 'mallory@example.com');
    await other.get(`/api/projects/${projectId}`).expect(404);
    await other.get(`/api/jobs/${jobId}`).expect(404);
    await other.post(`/api/projects/${projectId}/jobs`).send({}).expect(404);
    const mine = await other.get('/api/projects').expect(200);
    assert.equal(mine.body.projects.length, 0);
    await request(app).get('/api/projects').expect(401);
  });

  it('reports dashboard statistics', async () => {
    const stats = await agent.get('/api/stats').expect(200);
    assert.equal(stats.body.projects, 1);
    assert.ok(stats.body.jobs >= 3);
    assert.ok(stats.body.avgScore >= 90);
  });

  it('deletes a project together with its jobs and stored assets', async () => {
    const { JobAsset } = await import('../src/models/JobAsset.js');
    assert.ok((await JobAsset.countDocuments()) > 0);
    await agent.del(`/api/projects/${projectId}`).send({}).expect(200);
    await agent.get(`/api/projects/${projectId}`).expect(404);
    await agent.get(`/api/jobs/${jobId}`).expect(404);
    assert.equal(await JobAsset.countDocuments(), 0);
  });
});
