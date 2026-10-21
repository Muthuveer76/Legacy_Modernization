<!-- converted from AI_Legacy_Modernization_Platform.pptx (13 slides, no speaker notes). Text is verbatim; layout fragments are rejoined and page numbers dropped. -->

# AI-Assisted Legacy Application Modernization Platform

## Slide 1: Title

- Institution: Easwari Engineering College (Autonomous), Bharathi Salai, Ramapuram, Chennai, 600089. The slide carries the college crest ("Easwari Engineering College", "SRM", "Educate and Excel").
- Project title: AI-Assisted Legacy Application Modernization Platform
- Department: Department of Information Technology
- Subject name: Full Stack Development
- Subject code: 2311CSC503R
- Under the guidance of: G. Sai Lakshmi

## Slide 2: Contents

1. Abstract
2. Introduction
3. Literature Survey
4. Existing System and Disadvantages
5. Proposed System and Advantages
6. System Requirements
7. System Architecture
8. References

Side graphic: a code icon captioned "AST-driven AI code generation".

## Slide 3: Abstract

Modernizing legacy applications written in COBOL, PL/I, VB6, and aging Java or C++ codebases is a slow, error-prone, and expertise-dependent process. This project presents an AI-assisted platform that parses legacy source code into Abstract Syntax Trees (ASTs), extracts control-flow and data-flow semantics, and uses large language models guided by the AST to automatically generate equivalent, maintainable code in modern languages and frameworks. The platform combines static analysis, intermediate-representation mapping, and generative AI to preserve business logic while improving readability, testability, and long-term maintainability — significantly reducing the manual effort and risk involved in legacy system modernization.

Callouts:

- **60%+** potential reduction in manual rewrite effort
- **Structure-aware** translation, not line-by-line text substitution

## Slide 4: Introduction

Enterprises continue to run mission-critical operations on decades-old codebases that are costly to maintain, difficult to extend, and increasingly hard to staff for. Complete manual rewrites are expensive and risky, while simple automated transpilers often fail to capture the true intent of complex legacy logic. This project explores an AI-driven modernization pipeline that first understands legacy code structurally through AST parsing, then reasons about its semantics, and finally uses generative AI models to synthesize modern, idiomatic code — reducing dependency on scarce legacy-language experts while keeping engineering teams in control of the transformation.

Key capabilities:

- **Multi-Language** — Parses COBOL, VB6, Java and C++ through pluggable grammars
- **Semantic-Aware** — Reasons over control-flow and data-flow, not raw text
- **Human-in-the-Loop** — Every generated change is reviewable before merge

## Slide 5: Literature Survey

| Author | Year | Description | Pros | Cons |
|---|---|---|---|---|
| Chen et al. | 2021 | Trained large language models on code (Codex) to generate functions from context. | Strong code synthesis from pre-trained transformers. | Struggles with long, stateful legacy logic without structural guidance. |
| Feng et al. | 2020 | Proposed CodeBERT, a bimodal pre-trained model for code and natural language. | Improved code search, documentation and translation tasks. | Not designed for full program migration or AST-level reasoning. |
| Rodriguez et al. | 2022 | Surveyed rule-based transpilers for legacy-to-modern code migration. | Established a baseline for automated syntactic translation. | Fails on ambiguous or undocumented legacy patterns. |
| Kumar et al. | 2023 | Combined AST-based program representations with LLMs for guided refactoring. | Improved semantic accuracy over pure prompt-based generation. | Needs robust parsers per legacy language, adding overhead. |

## Slide 6: Existing System

Legacy modernization today typically relies on manual code rewriting by domain experts, rule-based transpilers, or pattern-matching migration scripts. These approaches treat source code largely as text rather than as a structured program with well-defined semantics.

- **Manual Rewriting** – Domain experts manually re-implement legacy logic in a modern language — accurate, but slow and costly.
- **Rule-Based Transpilers** – Apply fixed syntax-to-syntax mapping rules — fast, but brittle when code deviates from expected patterns.
- **Pattern-Matching Scripts** – Use regular expressions or templates to convert common code blocks, but fail on complex or undocumented logic.

## Slide 7: Disadvantages

- **High Manual Effort** – Manual rewriting demands extensive developer time and deep legacy-language expertise that is increasingly scarce.
- **Loss of Business Logic** – Rule-based transpilers often mistranslate complex control flow, risking silent functional regressions.
- **Poor Scalability** – Existing approaches do not scale efficiently across millions of lines of legacy code spanning multiple languages.
- **Limited Semantic Understanding** – Text-based tools cannot reason about program intent, data dependencies, or cross-module relationships.

## Slide 8: Proposed System

The proposed platform first parses legacy source code into an Abstract Syntax Tree (AST) to capture its exact structural and syntactic form. A semantic analysis layer then extracts control-flow, data-flow, and dependency information from the AST to build a language-agnostic intermediate representation of the program's behavior.

This structured representation is passed to an AI code generation engine, which uses large language models guided by the AST and semantic context to synthesize equivalent, idiomatic code in the target language and framework. Generated code is automatically validated through unit test generation and behavioral comparison against the original system before developer review.

Pipeline: **Parse (AST)** → **Analyze (Semantics)** → **Generate (AI/LLM)** → **Validate (Tests)**

## Slide 9: Advantages

- **Higher Translation Accuracy** – Grounding code generation in the AST preserves program structure and business logic more faithfully than text-based translation.
- **Multi-Language Scalability** – A modular parser layer lets the platform support additional legacy languages without redesigning the AI generation engine.
- **Reduced Manual Effort** – Automating structural analysis and code synthesis significantly cuts developer hours spent on migration.
- **Built-In Validation** – Automated test generation and behavioral comparison catch regressions early, increasing confidence in migrated code.

## Slide 10: System Requirements & Specifications

### Hardware specifications

| Item | Specification |
|---|---|
| Processor | 2.5 GHz Multi-core or above |
| RAM | 16 GB (Minimum) |
| Hard disk | 100 GB SSD |
| GPU | 8GB+ VRAM (optional, for local LLM inference) |
| Monitor | Minimum Resolution 1920 x 1080 |

### Software specifications

| Item | Specification |
|---|---|
| Operating system | Windows 10/11, Linux, or macOS |
| Language & version | Python, Version 3.9 or above |
| AST parsing tools | ANTLR, Tree-sitter, Javalang / Clang AST |
| AI / ML frameworks | PyTorch, Hugging Face Transformers, LLM APIs |
| Supporting libraries | LangChain, FastAPI, Docker, Git |

## Slide 11: System Architecture

Legacy Codebase → AST Parser → Semantic Analyzer (IR) → AI Code Generation (LLM) → Automated Validation & Tests → Modernized Application

The pipeline preserves semantic fidelity end-to-end: structural parsing and analysis ground the AI generation step, and automated validation closes the loop before code reaches production.

Legend (by box colour on the slide):

- **Static parsing & structure**: Legacy Codebase, AST Parser, Semantic Analyzer (IR), Automated Validation & Tests
- **Generative AI**: AI Code Generation (LLM)
- **Output**: Modernized Application

## Slide 12: References

1. M. Chen et al., “Evaluating Large Language Models Trained on Code,” arXiv preprint arXiv:2107.03374, 2021.
2. Z. Feng et al., “CodeBERT: A Pre-Trained Model for Programming and Natural Languages,” Proc. EMNLP Findings, 2020.
3. T. Parr, “The Definitive ANTLR 4 Reference,” Pragmatic Bookshelf, 2013.
4. R. C. Seacord et al., “Modernizing Legacy Systems: Software Technologies, Engineering Processes, and Business Practices,” Addison-Wesley, 2003.
5. Tree-sitter Documentation, “An Incremental Parsing System for Programming Tools.” Available online: https://tree-sitter.github.io/tree-sitter/ (accessed 2026).

## Slide 13: Closing

THANK YOU !
