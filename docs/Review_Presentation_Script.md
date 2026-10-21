# LegacyLift — Review Presentation Script

**Project:** AI-Assisted Legacy Application Modernization Platform (LegacyLift)
**Course:** Full Stack Development (2311CSC503R) · Department of Information Technology, Easwari Engineering College
**Guide:** G. Sai Lakshmi
**Total time:** about 15 minutes (10 minutes talk + 5 minutes live demo), followed by questions

> How to use this script: the plain paragraphs are what you say. Lines in *italics* are actions (what to show or click). The timings are guides — if the reviewer interrupts, answer and jump to the next section. The "Reviewer questions" section at the end has short, accurate answers to the questions you are most likely to get.

---

## Before the review (checklist)

- *Start MongoDB and the app 15 minutes early.* Terminal 1: `npm run dev:db`. Terminal 2: `npm run build` then `npm start`, and open `http://localhost:5000`. (If `dev:db` times out — it did once while preparing this report — just run it again, or use Docker: `docker compose up --build`.)
- *Check* `http://localhost:5000/api/health` shows `"ok": true`.
- *Sign in* with your demo account and keep the dashboard open in one tab.
- *Keep these open in other tabs:* the project report, and `server/src/samples/PAYROLL.cbl` in your editor.
- *Know your numbers:* 4 legacy languages, 4 target languages, 5 pipeline stages, 54 automated tests, all 16 sample × target translations score ≥ 90, the payroll translation scores 100/100.
- The AI engine is off unless `ANTHROPIC_API_KEY` is set in `.env`. The demo works fully without it (rule-based engine). Say so honestly if asked.

---

## 1. Opening (30 seconds)

Good morning. My project is **LegacyLift — an AI-assisted legacy application modernization platform**, built with the MERN stack: MongoDB, Express, React and Node.js.

In one sentence: you upload old code — COBOL, Visual Basic 6, old Java or C/C++ — and the platform understands its structure, rewrites it in a modern language such as Java 21, Python, TypeScript or C#, checks how faithful the new code is, and lets an engineer review and approve it before it is merged.

I will explain the problem, the design, then show it working live.

---

## 2. The problem (1 minute)

Banks, insurers and governments still run payroll, billing and accounting on code written decades ago, mostly in COBOL and VB6. That code is expensive to maintain, and the people who can read it are retiring.

Today there are three ways to modernize it, and each has a problem:

1. **Manual rewriting** — accurate, but slow, costly and dependent on scarce experts.
2. **Rule-based transpilers** — fast, but they translate text line by line and break on anything unusual.
3. **Pattern-matching scripts** — regular expressions that fail on complex or undocumented logic.

The common weakness is that they treat code as **text**, not as a **program**. So they lose business logic — for example, COBOL's money arithmetic truncates decimals in a specific way, and a naive translation to `double` silently changes the payroll result. And none of them tells you *how much* you can trust the output.

---

## 3. Objectives (45 seconds)

So my objectives were:

1. Parse four legacy languages into syntax trees and one common, language-independent representation.
2. Analyse that representation — call graphs, control-flow graphs, complexity, a data dictionary, risky constructs.
3. Generate equivalent code in four modern languages, with unit tests and build files.
4. Validate the result automatically and express its fidelity as a score from 0 to 100.
5. Keep a human in control — nothing is merged until an engineer approves it.
6. Deliver it as a secure, multi-user web application that can be deployed with Docker.

---

## 4. Proposed system and pipeline (1 minute 30 seconds)

*Show Figure 4.1 (system architecture) from the report.*

Every upload goes through a five-stage pipeline: **Parse → Analyze → Generate → Validate → Review.**

- **Parse.** COBOL and VB6 are parsed by grammars I wrote by hand, because they need fixed column formats, copybooks and level-88 conditions. Java and C/C++ use Tree-sitter grammars. All four are converted into the same **intermediate representation (IR)** — modules, procedures, typed data items and statements. Because of the IR, adding a new language only needs a new parser; the rest of the pipeline is unchanged.
- **Analyze.** From the IR the system builds the call graph — which procedure calls which, which are entry points, which are dead code — a control-flow graph for every procedure, cyclomatic complexity, which data each procedure reads and writes, and a data dictionary that suggests modern names and types. It also flags risky constructs like `GO TO`, COBOL paragraph fall-through, unsafe `strcpy`, or missing `Option Explicit`.
- **Generate.** There are two engines. The **rule-based structural translator** always runs and is deterministic: it preserves behaviour exactly — fixed-point decimals become `BigDecimal`, `decimal` or `Decimal`, COBOL truncation and `ROUNDED` are reproduced, 1-based arrays stay correct. When an Anthropic API key is configured, the **AI engine** sends Claude the legacy source, the analysis and this structural draft, and asks for idiomatic code in a strict JSON schema. So the AI is *grounded* — it refines a correct draft instead of guessing.
- **Validate.** Generated code is never executed on the server. Instead it is checked statically: does every file parse, does every legacy procedure have a modern counterpart, is the control-flow complexity preserved — a drop means a lost branch — are data items and decimal precision kept, are tests generated. These checks are combined into a **fidelity score**.
- **Review.** An engineer accepts or rejects each file, can edit it in the browser, compare it with the legacy code, add line comments, and then approve, reject, or request changes — which automatically starts a new job carrying their feedback. Approved jobs are merged and can be exported as a ZIP with a Markdown report.

---

## 5. Architecture and technology (1 minute)

*Stay on Figure 4.1.*

It is a three-tier application:

- **Front end:** React 19 single-page app built with Vite. It talks to the server only through a JSON REST API.
- **Back end:** Node.js 22 with Express 5. Every request body is validated with Zod, and every project and job query is filtered by the owner, so users can only see their own work.
- **Database:** MongoDB through Mongoose. Four collections: users, projects, jobs, and job assets. Large data — syntax trees, the source snapshot, the rule-based baseline — is stored separately in job assets so a job document stays below MongoDB's 16 MB limit.
- **Pipeline runner:** an in-process job queue that runs up to three jobs at a time, writes progress to MongoDB after every stage, supports cancellation, and marks jobs interrupted by a restart as failed so they can be re-run.

**Security:** passwords are hashed with bcrypt; sessions are JWTs in HTTP-only, SameSite cookies valid for seven days; Helmet adds security headers and a content security policy; login is rate-limited to 30 attempts per 15 minutes and job creation to 60 per hour; write requests must be JSON, which blocks cross-site form attacks; generated file paths are sanitised so a ZIP export cannot escape its folder.

*Optionally show Figure 4.2 (class diagram):* a user owns projects; a project embeds its source files and has many jobs; a job embeds its generated files and review comments.

---

## 6. Live demo (5 minutes)

*Switch to the browser, dashboard open.*

**6.1 Dashboard.** This is the dashboard: number of projects, jobs, average fidelity score and procedures analysed. The blue note says the AI engine is off, so jobs use the rule-based translator — which is also the grounding draft the AI would refine.

**6.2 Run a sample.** *Click "Modernize this sample" on "Weekly Payroll (COBOL)".*
This COBOL program calculates weekly pay with overtime, a tiered tax using `EVALUATE`, and has an unreachable audit paragraph. One click creates a project and starts the pipeline.

*Point at the pipeline stepper as it fills in.*
You can see each stage complete — parse, analyze, generate, validate — with timings. The whole pipeline takes well under a second for this program.

**6.3 Syntax tree.** *Click the "Syntax tree" tab, then click a node.*
This is the parsed tree. Clicking a node highlights the exact lines in the COBOL source, so the tree is traceable back to the code.

**6.4 Analysis.** *Click "Analysis" → "Call graph".*
`MAIN-PROCEDURE` is the entry point. `PRINT-AUDIT-TRAIL` is shown in red because nothing ever calls it — it is dead code. *Click "Control flow", then "Data dictionary".* Each procedure has its own control-flow graph, and the data dictionary shows each COBOL field with its `PIC` clause and the suggested modern name and type — for example `WS-GROSS-PAY PIC 9(6)V99` becomes a `BigDecimal` with two decimal places.

**6.5 Generated code.** *Click "Generated code".*
Three files: the Java class, a JUnit test, and a Maven `pom.xml`. *Scroll to a computation.* Notice the money fields are `BigDecimal`, and results go through a `scale` helper that truncates exactly like COBOL, or rounds half-up where the COBOL said `ROUNDED`. The chips show which legacy paragraph became which Java method.

**6.6 Validation.** *Click "Validation".*
Fidelity score 100 out of 100. The breakdown: syntax, procedure mapping, complexity parity, data coverage, tests. The checks list confirms every file parses, every procedure is mapped, no decimal field was turned into floating point. The last item is honest: behaviour comparison happens when the generated characterization tests run in CI, not on our server.

**6.7 Review and merge.** *Click "Review".*
Here the engineer accepts or rejects each file, can switch to Edit, Diff, or the Legacy view side by side, and add line comments. *Click "Approve" and confirm, then click "Merge into codebase" on the same tab. Then click the button that opens the project's codebase (it goes to the "Modernized codebase" tab).* The approved files are now the project's modernized codebase, and "Export ZIP" downloads them with a Markdown report.

*If something goes wrong in the demo, switch to the screenshots in the report's appendix (Figures A.1–A.13) and continue the explanation from them.*

---

## 7. Testing and results (45 seconds)

The project has **54 automated tests** using the Node.js test runner:

- parser and analyzer tests for all four languages;
- all **16 combinations** of the 4 samples × 4 target languages — every generated file must parse, map every procedure, and score at least 90;
- an end-to-end test that actually **runs the translated COBOL payroll in Python** and checks that it prints exactly the legacy output, down to the zero-padded amounts;
- regression tests for translator edge cases — for example Java static initializers, loop exits inside `Select Case`, `continue` inside loops, multiple `catch` clauses, integer division and VB6 `Imp`;
- the Claude integration against a mock of the streaming API;
- the REST API — authentication, access control, the full review-and-merge workflow and limits — against an in-memory MongoDB.

Results on the bundled samples: the payroll, inventory and billing samples score 100, and the Java ledger scores 95.

---

## 8. Limitations and future work (45 seconds)

Being honest about the limits:

- Rare COBOL statements such as `STRING`, `UNSTRING`, `INSPECT` and `SORT`, and VB6 `GoSub`, are flagged as `TODO(manual)` instead of guessed.
- COBOL file I/O and numeric overflow are reported for manual review, not emulated.
- Generated code is not executed on the server, for security; behaviour is confirmed by the generated tests in CI.
- The job queue runs inside the web process, so it is meant for a single instance.

Future work: move the runner to a separate worker so it scales horizontally, run the generated tests in a sandbox automatically, add languages such as PL/I, and add team roles so authors and reviewers are different people.

---

## 9. Closing (20 seconds)

To summarise: LegacyLift treats legacy code as a structured program rather than text. It parses, analyses, generates, validates and lets a human review — and it *measures* how faithful the result is. Thank you. I am happy to take questions.

---

## Reviewer questions — short answers

**Why not just paste the legacy code into ChatGPT or Claude?**
A language model alone can drop branches or change numeric behaviour without telling you. Here the model is grounded in the parsed structure and a correct rule-based draft, its output must follow a strict JSON schema, and every result is validated and scored — and the AI output is also compared with the rule-based baseline. Without an API key the platform still works fully.

**What is the difference between the AST and the IR?**
The AST is language-specific — it is exactly how COBOL or Java is written. The IR is one shared format for all languages: modules, procedures, typed data items and statements. The analyzer, translator and validator only understand the IR, so they work for every language.

**How is the fidelity score calculated?**
A weighted sum: syntax 25 %, procedure mapping 25 %, control-flow complexity parity 20 %, data coverage 10 %, generated tests 15 %, and 5 % for having no manual-translation markers left.

**How do you detect lost business logic?**
Each legacy procedure is mapped to its modern method, and their cyclomatic complexities are compared. If the modern version has fewer decision points than the legacy one (a drop of more than one), it is flagged as "possible lost branches".

**How do you keep COBOL money calculations correct?**
`PIC` clauses are parsed into exact digits and scale. Those fields become `BigDecimal` (Java), `decimal` (C#) or `Decimal` (Python), and every store goes through a helper that truncates to the field's scale or rounds half-up for `ROUNDED`, just like COBOL. A validation check warns if any decimal field is mapped to a floating-point type. (TypeScript has no built-in decimal type, so it uses `number` and this is flagged as a risk.)

**Why is the generated code not run on the server?**
Running uploaded or generated code on a shared server is a security risk. Instead the platform generates characterization tests; you paste the legacy program's real output into `EXPECTED_OUTPUT` and run them in your own CI.

**Why MongoDB?**
Analysis results, syntax trees and generated files are nested, variable-shaped documents, which fit a document database naturally. Large data is split into a separate collection to stay within the 16 MB document limit.

**How is authentication secured?**
bcrypt-hashed passwords (cost 12), a signed JWT in an HTTP-only, SameSite cookie (JavaScript cannot read it), rate limits on login and job creation, Zod validation of every request, JSON-only write requests, and Helmet security headers.

**Why hand-write the COBOL and VB6 parsers instead of using a library?**
They need fixed-format column rules, copybooks, level-88 condition names, `PERFORM VARYING`, and VB6's 1-based arrays and single-line statements, all mapped into our own IR. Java and C/C++ already have good Tree-sitter grammars, so those are used directly.

**What happens if a job fails or the server restarts?**
The failing stage is marked as failed with a clear message. Jobs that were running during a restart are marked failed at start-up, so they can simply be run again.

**What does "Request changes" do?**
It collects the review summary and all unresolved line comments as feedback, marks the job as rejected, and starts a new linked job. With the AI engine, the new job also receives the previous generation so it can apply the feedback.

**How would you add a new legacy language?**
Write a parser that produces the IR and register its file extensions. The analyzer, all four code generators and the validator then work for it without changes.

**How would this scale to many users?**
Move the in-process job queue to a separate worker with a persistent queue, then run several web instances behind a load balancer. Job state is already stored in MongoDB, so the web tier is ready for that.

**What was the hardest part?**
Preserving behaviour across languages. For example, while testing I found edge cases in the translator — a Java static initializer being dropped, a VB6 `Exit For` inside `Select Case` only leaving the switch, a Python loop with `continue` never ending — fixed each one and added a regression test, which is why there are now 54 tests.

**Which parts did you build yourself?**
*Answer this in your own words, honestly, describing what you personally designed and implemented.*
