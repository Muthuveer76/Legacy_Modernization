import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

// Exercises the Claude generation path against a local stand-in for the Messages API that
// speaks the real server-sent-event format, so no API key or network access is needed.

let server;
let requests = [];
let scenario = 'ok';
let mod;

const RESULT = {
  summary: 'Modernized payroll as a Java service.',
  files: [
    { path: 'src/main/java/demo/PayrollService.java', language: 'java', kind: 'source', content: 'package demo;\n\npublic class PayrollService {\n    public int run() {\n        return 1;\n    }\n}\n' },
    { path: 'src/test/java/demo/PayrollServiceTest.java', language: 'java', kind: 'test', content: 'package demo;\n\nclass PayrollServiceTest {\n    @org.junit.jupiter.api.Test\n    void runs() {}\n}\n' },
  ],
  mapping: [{ legacyProcedure: 'PAYROLL::MAIN-PROCEDURE', modernSymbol: 'PayrollService.run', modernFile: 'src/main/java/demo/PayrollService.java', notes: '' }],
  dataMapping: [{ legacyName: 'WS-TOTAL-NET', modernName: 'PayrollService.totalNet', modernType: 'BigDecimal', notes: '' }],
  notes: [{ category: 'decision', text: 'Dropped the unreachable PRINT-AUDIT-TRAIL paragraph.' }],
  testPlan: [{ name: 'runs', covers: ['PAYROLL::MAIN-PROCEDURE'], description: 'smoke' }],
};

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

function messageEvents({ text, stopReason = 'end_turn', thinking = 'Mapping paragraphs to methods.' }) {
  const chunks = text.match(/.{1,40}/gs) || [''];
  return [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ...chunks.map((c) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: c } })),
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null, ...(stopReason === 'refusal' ? { stop_details: { type: 'refusal', category: 'cyber', explanation: 'test' } } : {}) }, usage: { output_tokens: 850 } },
    { type: 'message_stop' },
  ];
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
      if (scenario === 'unauthorized') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        return;
      }
      if (scenario === 'refusal') return sse(res, messageEvents({ text: '', stopReason: 'refusal' }));
      if (scenario === 'bad-json') return sse(res, messageEvents({ text: '{"summary": "oops"' }));
      if (scenario === 'bad-shape') return sse(res, messageEvents({ text: JSON.stringify({ summary: 'x', files: [] , mapping: [], dataMapping: [], notes: [], testPlan: [] }) }));
      return sse(res, messageEvents({ text: JSON.stringify(RESULT) }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_MODEL = 'claude-opus-5-5';
  mod = await import('../src/pipeline/generator.js');
});

after(() => {
  server.close();
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

const input = {
  files: [{ path: 'PAYROLL.cbl', language: 'cobol', content: '       PROCEDURE DIVISION.\n       MAIN-PROCEDURE.\n           STOP RUN.' }],
  analysis: {
    summary: { procedures: 1 },
    procedures: [{ id: 'PAYROLL::MAIN-PROCEDURE', name: 'MAIN-PROCEDURE', kind: 'paragraph', file: 'PAYROLL.cbl', loc: { start: 2, end: 3 }, params: [], returns: null, complexity: 1, calls: [], calledBy: [], reads: [], writes: [], reachable: true, entry: true }],
    dataDictionary: [],
    callGraph: { edges: [] },
    findings: [],
    hints: [],
  },
  draft: { files: [{ path: 'src/main/java/demo/Payroll.java', kind: 'source', content: 'class Payroll {}' }] },
  target: 'java',
  framework: 'spring-boot',
  projectName: 'Payroll',
};

describe('Claude generation engine', () => {
  it('streams a structured result and reports progress', async () => {
    requests = [];
    scenario = 'ok';
    const progress = [];
    const result = await mod.generateWithClaude({ ...input, feedback: 'Use a service class' }, { onProgress: (p) => progress.push(p) });
    assert.equal(result.engine, 'claude');
    assert.equal(result.files.length, 2);
    assert.equal(result.mapping[0].modernSymbol, 'PayrollService.run');
    assert.equal(result.reasoning, 'Mapping paragraphs to methods.');
    assert.deepEqual(result.usage, { inputTokens: 1200, outputTokens: 850, cacheReadTokens: 0, cacheWriteTokens: 900 });
    assert.ok(progress.length >= 1);

    const req = requests[0];
    assert.match(req.url, /^\/v1\/messages/);
    assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(req.body.model, 'claude-opus-5-5');
    assert.equal(req.body.fallbacks, 'default');
    assert.equal(req.body.stream, true);
    assert.deepEqual(req.body.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(req.body.output_config.format.type, 'json_schema');
    assert.equal(req.body.output_config.effort, 'high');
    const [context, instruction] = req.body.messages[0].content;
    assert.deepEqual(context.cache_control, { type: 'ephemeral' });
    assert.match(context.text, /<legacy_files>/);
    assert.match(context.text, /1 \|\s+PROCEDURE DIVISION\./);
    assert.match(instruction.text, /<reviewer_feedback>\nUse a service class/);
  });

  it('turns a refusal into a clear error', async () => {
    scenario = 'refusal';
    await assert.rejects(mod.generateWithClaude(input), (err) => err instanceof mod.GenerationError && /declined/.test(err.message) && /cyber/.test(err.message));
  });

  it('rejects malformed or incomplete output', async () => {
    scenario = 'bad-json';
    await assert.rejects(mod.generateWithClaude(input), /not valid JSON/);
    scenario = 'bad-shape';
    await assert.rejects(mod.generateWithClaude(input), /did not match the expected structure/);
  });

  it('explains authentication failures', async () => {
    scenario = 'unauthorized';
    await assert.rejects(mod.generateWithClaude(input), /API key was rejected/);
  });
});
