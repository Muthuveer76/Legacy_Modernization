import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { TARGETS } from './catalog.js';

// AI code generation engine (Claude). The prompt grounds the model in the legacy source,
// the platform's AST/IR analysis and the structure-preserving draft from the rule-based translator.

export class GenerationError extends Error {
  constructor(message, { retryable = false, cause } = {}) {
    super(message);
    this.retryable = retryable;
    this.cause = cause;
  }
}

const SYSTEM_PROMPT = `You are the code-generation engine of an AST-driven legacy modernization platform.

For each job you receive:
1. The legacy source files, with line numbers.
2. The platform's static analysis of that code: every procedure (paragraph, sub, function or method) with its id, line range, cyclomatic complexity, callers, callees and the module-level data it reads and writes; a data dictionary with legacy and suggested modern types; and findings such as dead code, GO TO and paragraph fall-through.
3. A structure-preserving draft from the platform's rule-based translator. It is mechanically faithful (control flow, fixed-point arithmetic, 1-based indexing, output formats) but not idiomatic.
4. The target language and framework, and reviewer feedback when this is a regeneration.

Produce a maintainable, idiomatic implementation in the target stack that behaves exactly like the legacy program.

Behavioural fidelity comes first:
- Keep every business rule, boundary condition and branch. The platform compares cyclomatic complexity per procedure, so decisions that disappear are reported as lost business logic.
- Preserve numeric semantics. Fixed-point fields (COBOL PIC with an implied decimal point, VB6 Currency) need exact decimal types (BigDecimal, decimal, Decimal); keep the receiving field's scale and the difference between truncation and ROUNDED. Never use binary floating point for money.
- Preserve observable output (console lines, formatting, ordering) unless the reviewer asks otherwise; record any deliberate change in notes.
- Translate 1-based indexing, COBOL paragraph fall-through, GO TO and function-name return assignments into equivalent structured code.
- Procedures the analysis marks unreachable may be dropped. If you drop one, say so in a "decision" note and leave it out of the mapping.

Idiomatic design second: meaningful names, small cohesive classes, the target framework's conventions (for example @Service plus a @RestController for Spring Boot, a FastAPI app for fastapi, an Express router for express, minimal APIs for aspnet), no global mutable state where a field or parameter will do, and an injectable output writer so tests can capture console output.

Response content:
- files: complete, compilable source files, the build file for the stack (pom.xml, pyproject.toml, package.json with tsconfig.json, or .csproj files) and unit tests. Never truncate or elide code.
- Tests use the stack's standard framework (JUnit 5, pytest, Vitest, xUnit) and assert concrete expected values computed from the legacy logic; show the derivation in a short comment.
- mapping: one entry per legacy procedure id you kept, naming the modern symbol ("ClassName.methodName") and file that implement it.
- dataMapping: one entry per legacy data item you kept.
- notes: decisions, risks, assumptions and TODOs a reviewer must know about.
- testPlan: which legacy procedure ids each test covers.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'files', 'mapping', 'dataMapping', 'notes', 'testPlan'],
  properties: {
    summary: { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'language', 'kind', 'content'],
        properties: {
          path: { type: 'string' },
          language: { type: 'string' },
          kind: { type: 'string', enum: ['source', 'test', 'config', 'doc'] },
          content: { type: 'string' },
        },
      },
    },
    mapping: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['legacyProcedure', 'modernSymbol', 'modernFile', 'notes'],
        properties: { legacyProcedure: { type: 'string' }, modernSymbol: { type: 'string' }, modernFile: { type: 'string' }, notes: { type: 'string' } },
      },
    },
    dataMapping: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['legacyName', 'modernName', 'modernType', 'notes'],
        properties: { legacyName: { type: 'string' }, modernName: { type: 'string' }, modernType: { type: 'string' }, notes: { type: 'string' } },
      },
    },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'text'],
        properties: { category: { type: 'string', enum: ['decision', 'risk', 'assumption', 'todo'] }, text: { type: 'string' } },
      },
    },
    testPlan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'covers', 'description'],
        properties: { name: { type: 'string' }, covers: { type: 'array', items: { type: 'string' } }, description: { type: 'string' } },
      },
    },
  },
};

const ResultSchema = z.object({
  summary: z.string(),
  files: z.array(z.object({ path: z.string().min(1), language: z.string(), kind: z.enum(['source', 'test', 'config', 'doc']), content: z.string() })).min(1),
  mapping: z.array(z.object({ legacyProcedure: z.string(), modernSymbol: z.string(), modernFile: z.string(), notes: z.string() })),
  dataMapping: z.array(z.object({ legacyName: z.string(), modernName: z.string(), modernType: z.string(), notes: z.string() })),
  notes: z.array(z.object({ category: z.enum(['decision', 'risk', 'assumption', 'todo']), text: z.string() })),
  testPlan: z.array(z.object({ name: z.string(), covers: z.array(z.string()), description: z.string() })),
});

let client = null;
function getClient() {
  client ||= new Anthropic({ timeout: 20 * 60 * 1000, maxRetries: 2 });
  return client;
}

function numbered(content) {
  const lines = content.split('\n');
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width, ' ')} | ${l}`).join('\n');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function compactAnalysis(analysis) {
  return {
    summary: analysis.summary,
    procedures: analysis.procedures.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      file: p.file,
      lines: `${p.loc.start}-${p.loc.end}`,
      params: p.params,
      returns: p.returns,
      complexity: p.complexity,
      calls: p.calls,
      calledBy: p.calledBy,
      reads: p.reads,
      writes: p.writes,
      reachable: p.reachable,
      entry: p.entry,
    })),
    dataDictionary: analysis.dataDictionary.map((d) => ({
      name: d.name,
      path: d.path,
      legacyType: d.legacyType,
      initial: d.initial,
      conditions: d.conditions.length ? d.conditions : undefined,
      suggestedName: d.suggestedName,
      suggestedType: d.suggestedType,
      readBy: d.readBy,
      writtenBy: d.writtenBy,
      unused: d.unused || undefined,
    })),
    callGraph: analysis.callGraph.edges.map((e) => `${e.from} -> ${e.to} (${e.kind})`),
    findings: analysis.findings.map((f) => `[${f.severity}] ${f.rule}: ${f.message} (${f.file}:${f.line})`),
    hints: analysis.hints,
  };
}

export function buildPrompt({ files, analysis, draft, target, framework, projectName, feedback, previous }) {
  const targetLabel = TARGETS[target]?.label || target;
  const frameworkLabel = TARGETS[target]?.frameworks[framework] || framework;
  const legacy = files.map((f) => `<file path="${escapeAttr(f.path)}" language="${f.language}">\n${numbered(f.content)}\n</file>`).join('\n');
  const draftText = draft.files
    .filter((f) => f.kind === 'source')
    .map((f) => `<file path="${escapeAttr(f.path)}">\n${f.content}\n</file>`)
    .join('\n');
  const context = [
    `<target>\nlanguage: ${targetLabel} (${target})\nframework: ${frameworkLabel} (${framework})\nproject: ${projectName}\n</target>`,
    `<legacy_files>\n${legacy}\n</legacy_files>`,
    `<analysis>\n${JSON.stringify(compactAnalysis(analysis), null, 1)}\n</analysis>`,
    `<structural_draft>\n${draftText}\n</structural_draft>`,
  ].join('\n\n');
  const blocks = [{ type: 'text', text: context, cache_control: { type: 'ephemeral' } }];
  if (previous) {
    const prevFiles = previous.files.map((f) => `<file path="${escapeAttr(f.path)}" kind="${f.kind}">\n${f.content}\n</file>`).join('\n');
    blocks.push({ type: 'text', text: `<previous_generation>\n${prevFiles}\n</previous_generation>` });
  }
  const instruction = feedback
    ? `<reviewer_feedback>\n${feedback}\n</reviewer_feedback>\n\nRegenerate the modernized project, addressing every point of the reviewer feedback while keeping the behaviour of the legacy code.`
    : 'Generate the modernized project.';
  blocks.push({ type: 'text', text: instruction });
  return { system: SYSTEM_PROMPT, messages: [{ role: 'user', content: blocks }] };
}

function describeApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new GenerationError('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.', { cause: err });
  if (err instanceof Anthropic.PermissionDeniedError) return new GenerationError('The API key is not allowed to use this model.', { cause: err });
  if (err instanceof Anthropic.NotFoundError) return new GenerationError(`Model "${config.ai.model}" was not found. Check ANTHROPIC_MODEL.`, { cause: err });
  if (err instanceof Anthropic.RateLimitError) return new GenerationError('Claude rate limit reached. Retry the job in a minute.', { retryable: true, cause: err });
  if (err instanceof Anthropic.BadRequestError) return new GenerationError(`Claude rejected the request: ${err.message}`, { cause: err });
  if (err instanceof Anthropic.InternalServerError) return new GenerationError('Claude is temporarily unavailable. Retry the job shortly.', { retryable: true, cause: err });
  if (err instanceof Anthropic.APIConnectionError) return new GenerationError('Could not reach the Anthropic API (network error or timeout).', { retryable: true, cause: err });
  if (err instanceof Anthropic.APIError) return new GenerationError(`Anthropic API error ${err.status ?? ''}: ${err.message}`, { cause: err });
  return null;
}

// Streams one generation. `onProgress` receives {message, outputChars, currentFile, thinking}.
export async function generateWithClaude(input, { onProgress = () => {}, signal } = {}) {
  const { system, messages } = buildPrompt(input);
  let text = '';
  let thinking = '';
  let lastEmit = 0;
  let currentFile = null;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 1200) return;
    lastEmit = now;
    const paths = [...text.matchAll(/"path"\s*:\s*"([^"]+)"/g)];
    currentFile = paths.length ? paths[paths.length - 1][1] : null;
    onProgress({
      message: currentFile ? `Writing ${currentFile}` : thinking ? 'Reasoning about the legacy logic' : 'Waiting for the model',
      outputChars: text.length,
      currentFile,
      thinking: thinking.slice(-4000),
    });
  };

  let message;
  try {
    const stream = getClient().beta.messages.stream(
      {
        model: config.ai.model,
        max_tokens: config.ai.maxTokens,
        ...(config.ai.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: config.ai.effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        system,
        messages,
      },
      { signal },
    );
    stream.on('text', (delta) => {
      text += delta;
      emit();
    });
    stream.on('thinking', (delta) => {
      thinking += delta;
      emit();
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (signal?.aborted) throw new GenerationError('Generation was cancelled.');
    throw describeApiError(err) || err;
  }
  emit(true);

  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category ? ` (${message.stop_details.category})` : '';
    throw new GenerationError(`Claude declined to generate code for this input${category}.`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new GenerationError(`The generated project exceeded the ${config.ai.maxTokens}-token output limit. Split the legacy code into smaller projects or raise ANTHROPIC_MAX_TOKENS.`);
  }
  // A mid-stream fallback continues the declined partial, so the answer is every text block in order.
  const answer = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let json;
  try {
    json = JSON.parse(answer);
  } catch {
    throw new GenerationError('Claude returned output that is not valid JSON; retry the job.', { retryable: true });
  }
  const parsed = ResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new GenerationError(`Claude's output did not match the expected structure: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, { retryable: true });
  }
  const iterations = message.usage?.iterations || [];
  const reasoning = message.content.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('\n\n') || thinking;
  return {
    engine: 'claude',
    ...parsed.data,
    model: message.model,
    fellBack: iterations.some((it) => it.type === 'fallback_message'),
    reasoning: reasoning.slice(0, 20000),
    usage: {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}
