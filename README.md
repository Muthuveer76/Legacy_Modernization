# LegacyLift — AI-Assisted Legacy Application Modernization Platform

A MERN (MongoDB, Express, React, Node.js) web application that modernizes legacy code through the pipeline described in the project deck:

**Parse (AST) → Analyze (Semantics) → Generate (AI/LLM) → Validate (Tests) → Review (Human)**

Upload COBOL, Visual Basic 6, legacy Java or C/C++ sources. The platform parses them into syntax trees, builds a language-agnostic intermediate representation (IR), analyses control flow, data flow and call structure, generates modern Java 21, Python 3.12, TypeScript or C# 12 code (with unit/characterization tests and build files), validates the result, and lets engineers edit, comment on, approve and merge it.

## Features

| Stage | What it does |
|---|---|
| **Parse** | Hand-written recursive-descent grammars for COBOL (fixed, free and variable format, copybooks, level-88 conditions, `PERFORM VARYING`, `EVALUATE`) and VB6 (modules, classes, forms, `Select Case`, 1-based arrays); Tree-sitter grammars for Java and C/C++. Interactive syntax-tree explorer linked to the source. |
| **Analyze** | Call graph with entry points and dead code, per-procedure control-flow graphs, cyclomatic complexity, nesting, read/write sets, a data dictionary with suggested modern names and types, and findings such as `GO TO`, paragraph fall-through, unsafe `strcpy`, raw `Hashtable`/`Vector` and missing `Option Explicit`. |
| **Generate** | Two engines. The **rule-based structural translator** always runs and preserves behaviour exactly (fixed-point `BigDecimal`/`decimal`/`Decimal` arithmetic with COBOL truncation and `ROUNDED`, 1-based indexing, zero-padded `DISPLAY` output). When an Anthropic API key is set, the **AI engine** (Claude, default `claude-opus-5-5`) refines it into idiomatic code, grounded in the source, the analysis and the structural draft, with streamed progress and structured JSON output. |
| **Validate** | Tree-sitter syntax checks of every generated file, legacy-procedure-to-symbol mapping, complexity parity (catches lost branches), data-item coverage, fixed-point precision checks and generated test counts, combined into a 0–100 fidelity score. AI jobs are also compared with the rule-based baseline. |
| **Review** | Accept or reject each file, edit in the browser, diff against the generated version, compare side by side with the legacy source, add line comments, then approve, reject or request changes (which starts a linked regeneration job with your feedback). Approved jobs merge into the project's modernized codebase, exportable as a ZIP with a Markdown report. |

Four bundled samples (COBOL payroll, VB6 inventory, Java 1.4 ledger, C-style C++ billing) run the whole pipeline in one click.

## Quick start (local)

Requirements: **Node.js 22+** and a **MongoDB Atlas** cluster (the free M0 tier is enough).

```bash
npm install
cp .env.example .env          # then set MONGODB_URI (Atlas) and JWT_SECRET (a long random string)
npm run dev                   # API on :5000 and the Vite dev server on http://localhost:5173
```

### Connecting to MongoDB Atlas

1. In [Atlas](https://cloud.mongodb.com), create a cluster, then a database user under **Database Access**.
2. Under **Network Access**, add your current IP address (for a cloud host such as Render, `0.0.0.0/0`).
3. Open your cluster → **Connect** → **Drivers**, copy the `mongodb+srv://…` string, put in the user's password (URL-encode characters such as `@`, `:`, `/` or `#`), and set it as `MONGODB_URI` in `.env`. If the string has no database name, the app uses `MONGODB_DB` (`legacy_modernization`).
4. Start the app. The log shows `MongoDB connected: mongodb+srv://<your-cluster> (database "legacy_modernization")`, and `GET /api/health` returns `"db": "up"`. If the connection fails, the error says whether to fix the password, the host or the IP access list.

Collections and indexes are created automatically on first use. To work offline instead, run `npm run dev:db` (a local MongoDB on 127.0.0.1:27017, data in `server/.data`) and set `MONGODB_URI=mongodb://127.0.0.1:27017/legacy_modernization`.

Production-style run (Express serves the built client on one port):

```bash
npm run build
npm start                     # http://localhost:5000
```

### Enabling the AI engine

Set `ANTHROPIC_API_KEY` in `.env` (or the host's environment) and restart. Without a key, every job uses the rule-based translator, and the UI says so. Jobs larger than `MAX_AI_SOURCE_LINES` use the rule-based translator automatically when the engine is set to *Auto*. Requests use adaptive thinking, the `effort` from `ANTHROPIC_EFFORT`, JSON-schema structured output, and Anthropic's server-side refusal fallback (`fallbacks: "default"`); set `ANTHROPIC_FALLBACKS=off` if your account or model rejects that option.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/legacy_modernization` (development only) | MongoDB Atlas connection string (`mongodb+srv://…`); **required in production** |
| `MONGODB_DB` | `legacy_modernization` | Database used when `MONGODB_URI` names none |
| `JWT_SECRET` | random per start in development | **Required in production** (16+ characters); signs session cookies |
| `PORT` | `5000` | HTTP port |
| `NODE_ENV` | `development` | `production` enables secure cookies and hides internal error details |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy or load balancer (Render, Railway, Nginx) |
| `ANTHROPIC_API_KEY` | — | Enables the AI generation engine |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude model id |
| `ANTHROPIC_EFFORT` | `high` | `low` · `medium` · `high` · `xhigh` · `max` |
| `ANTHROPIC_FALLBACKS` | `default` | `off` disables the server-side refusal fallback |
| `ANTHROPIC_MAX_TOKENS` | `64000` | Output limit per generation |
| `MAX_PROJECT_KB` / `MAX_FILE_KB` / `MAX_FILES_PER_PROJECT` | `2048` / `200` / `25` | Upload limits |
| `MAX_AI_SOURCE_LINES` | `3000` | Largest project sent to the AI engine |
| `MAX_CONCURRENT_JOBS_PER_USER` | `2` | Running jobs per account |

## Deployment

**Docker Compose** (app connected to Atlas):

```bash
docker compose up --build     # reads MONGODB_URI, JWT_SECRET and ANTHROPIC_API_KEY from .env; open http://localhost:5000
```

To run a MongoDB container alongside instead of Atlas: `MONGODB_URI=mongodb://mongo:27017/legacy_modernization docker compose --profile local-db up --build`.

**Render** (free tier with MongoDB Atlas): push the repository to GitHub, create a *Blueprint* from `render.yaml`, and enter `MONGODB_URI` (an Atlas connection string) and optionally `ANTHROPIC_API_KEY`. `JWT_SECRET` is generated for you.

**Any Node host or VM:** set the environment variables, then run `npm ci && npm run build && npm start`. Health check: `GET /api/health` (returns 503 when the database is unreachable).

The pipeline runs inside the web process with a small in-memory queue; job state is stored in MongoDB, and jobs interrupted by a restart are marked failed so they can be re-run. Run a single instance, or move the runner to a worker process before scaling out horizontally.

## Tests

```bash
npm test
```

54 tests cover the parsers, analyzer, all 16 sample × target translations (every generated file must parse, map every procedure and score ≥ 90), an end-to-end run of the translated COBOL payroll in Python that checks the exact legacy output, regression tests for translator edge cases (loop exits, `continue`, static initializers, exception handlers, integer division, `Imp`, `AT END`), the Claude integration against a local mock of the streaming API, and the REST API (auth, access control, the full review/merge workflow, limits) against an in-memory MongoDB. The first run downloads a MongoDB binary (~800 MB) for the in-memory database.

## Project structure

```
server/src
  pipeline/parsers/   COBOL + VB6 grammars, Tree-sitter lowering for Java and C/C++ → IR
  pipeline/analyzer   call graph, CFGs, metrics, data dictionary, findings
  pipeline/translate/ rule-based translator (Java, C#, TypeScript, Python printers)
  pipeline/generator  Claude generation engine (streaming, structured output)
  pipeline/validator  syntax, mapping, parity, coverage and test checks → fidelity score
  pipeline/runner     job queue that runs the four stages
  routes/             REST API: auth, projects, jobs (review, merge, export), meta
  models/             User, Project, Job, JobAsset (Mongoose)
client/src
  pages/              landing, auth, dashboard, projects, new project, job workspace
  pages/job/          overview, syntax tree, analysis, generated code, validation, review tabs
  components/         code viewer/editor, diff, graph (dagre), syntax tree, pipeline stepper
docs/                 the project deck converted to Markdown
graphify-out/         knowledge graph of the deck (graph.html, GRAPH_REPORT.md)
```

## API overview

All endpoints are under `/api` and use an HTTP-only session cookie. Write requests must be JSON.

- `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`
- `GET /meta` (languages, targets, samples, limits, AI status) · `GET /stats` · `GET /health`
- `GET|POST /projects` · `GET|PATCH|DELETE /projects/:id` · `POST /projects/:id/files` · `PUT|DELETE /projects/:id/files/:fileId`
- `POST /projects/:id/jobs` (`{ engine: "auto" | "claude" | "structural" }`) · `GET /projects/:id/merged` · `GET /projects/:id/export`
- `GET /jobs/:id` · `GET /jobs/:id/status` · `GET /jobs/:id/ast?file=` · `GET /jobs/:id/sources` · `GET /jobs/:id/baseline`
- `PATCH /jobs/:id/files` · `POST /jobs/:id/revalidate` · `POST|PATCH|DELETE /jobs/:id/comments[/:commentId]`
- `POST /jobs/:id/review` (`approved` · `rejected` · `changes-requested` · `reopen`) · `POST /jobs/:id/merge` · `POST /jobs/:id/cancel`
- `GET /jobs/:id/report` (Markdown) · `GET /jobs/:id/export` (ZIP) · `DELETE /jobs/:id`

## Scope and limitations

- The grammars cover the constructs common in business code. Rare statements (`STRING`, `UNSTRING`, `INSPECT`, `SEARCH`, `SORT`, VB6 `GoSub`/`Resume`) are flagged and emitted as `TODO(manual)` markers rather than guessed.
- Generated code is never executed on the server. Behavioural comparison happens in the generated characterization tests: paste the legacy program's console output into `EXPECTED_OUTPUT` and run them in CI.
- COBOL numeric overflow (high-order truncation into a smaller `PIC`) and file I/O are reported for manual review, not emulated.

---

AI-Assisted Legacy Application Modernization Platform · Full Stack Development (2311CSC503R) · Department of Information Technology, Easwari Engineering College
