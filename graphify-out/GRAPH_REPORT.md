# Graph Report - .  (2026-09-22)

## Corpus Check
- Corpus is ~1,211 words - fits in a single context window. You may not need a graph.

## Summary
- 56 nodes · 107 edges · 9 communities detected
- Extraction: 69% EXTRACTED · 29% INFERRED · 2% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.81)
- Token cost: 175,812 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_AI Generation & Tooling|AI Generation & Tooling]]
- [[_COMMUNITY_Project & References|Project & References]]
- [[_COMMUNITY_Legacy Languages & Parsing|Legacy Languages & Parsing]]
- [[_COMMUNITY_Validation & Human Review|Validation & Human Review]]
- [[_COMMUNITY_AST Semantic Analysis|AST Semantic Analysis]]
- [[_COMMUNITY_Rule-Based Transpiler Risk|Rule-Based Transpiler Risk]]
- [[_COMMUNITY_Manual Rewrite Effort|Manual Rewrite Effort]]
- [[_COMMUNITY_IR & Multi-Language Scale|IR & Multi-Language Scale]]
- [[_COMMUNITY_Text-Based Legacy Tooling|Text-Based Legacy Tooling]]

## God Nodes (most connected - your core abstractions)
1. `AI-Assisted Legacy Application Modernization Platform` - 17 edges
2. `AST Parser` - 15 edges
3. `System Requirements & Specifications` - 13 edges
4. `AI Code Generation Engine (LLM)` - 12 edges
5. `Semantic Analyzer (IR)` - 8 edges
6. `Existing Legacy Modernization Approaches` - 8 edges
7. `Structure- and Semantic-Aware Translation` - 7 edges
8. `Legacy Codebase` - 7 edges
9. `Automated Validation & Tests (Built-In Validation)` - 7 edges
10. `Kumar et al. 2023 - AST Representations with LLMs for Guided Refactoring` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Loss of Business Logic` --rationale_for--> `Control-Flow Analysis`  [INFERRED]
  docs/AI_Legacy_Modernization_Platform.md → docs/AI_Legacy_Modernization_Platform.md  _Bridges community 4 → community 5_
- `Semantic Analyzer (IR)` --implements--> `Static Analysis`  [INFERRED]
  docs/AI_Legacy_Modernization_Platform.md → docs/AI_Legacy_Modernization_Platform.md  _Bridges community 3 → community 4_
- `AST Parser` --implements--> `Static Analysis`  [INFERRED]
  docs/AI_Legacy_Modernization_Platform.md → docs/AI_Legacy_Modernization_Platform.md  _Bridges community 3 → community 2_
- `Feng et al. 2020 - CodeBERT` --rationale_for--> `Structure- and Semantic-Aware Translation`  [INFERRED]
  docs/AI_Legacy_Modernization_Platform.md → docs/AI_Legacy_Modernization_Platform.md  _Bridges community 4 → community 0_
- `Limited Semantic Understanding` --rationale_for--> `Structure- and Semantic-Aware Translation`  [INFERRED]
  docs/AI_Legacy_Modernization_Platform.md → docs/AI_Legacy_Modernization_Platform.md  _Bridges community 4 → community 8_

## Hyperedges (group relationships)
- **Parse-Analyze-Generate-Validate Modernization Pipeline** — ai_legacy_modernization_platform_legacy_codebase, ai_legacy_modernization_platform_ast_parser, ai_legacy_modernization_platform_semantic_analyzer, ai_legacy_modernization_platform_ai_code_generation_engine, ai_legacy_modernization_platform_automated_validation, ai_legacy_modernization_platform_modernized_application [EXTRACTED 1.00]
- **Hybrid Approach: Static Analysis + IR Mapping + Generative AI** — ai_legacy_modernization_platform_static_analysis, ai_legacy_modernization_platform_intermediate_representation, ai_legacy_modernization_platform_large_language_models [EXTRACTED 1.00]
- **Pre-Merge Verification Gate (generated tests, behavioral comparison, developer review)** — ai_legacy_modernization_platform_unit_test_generation, ai_legacy_modernization_platform_behavioral_comparison, ai_legacy_modernization_platform_human_in_the_loop_review [EXTRACTED 1.00]

## Communities (9 total, 0 thin omitted)

### Community 0 - "AI Generation & Tooling"
Cohesion: 0.23
Nodes (13): AI Code Generation Engine (LLM), Chen et al. 2021 - Evaluating Large Language Models Trained on Code (Codex), Docker, FastAPI, Feng et al. 2020 - CodeBERT, Higher Translation Accuracy, Hugging Face Transformers, Kumar et al. 2023 - AST Representations with LLMs for Guided Refactoring (+5 more)

### Community 1 - "Project & References"
Cohesion: 0.2
Nodes (10): ANTLR, Easwari Engineering College, Full Stack Development (2311CSC503R), G. Sai Lakshmi, Muthuveer M, Parr 2013 - The Definitive ANTLR 4 Reference, AI-Assisted Legacy Application Modernization Platform, Seacord et al. 2003 - Modernizing Legacy Systems (+2 more)

### Community 2 - "Legacy Languages & Parsing"
Cohesion: 0.42
Nodes (9): AST Parser, Clang AST, COBOL, C++, Java, Javalang, Legacy Codebase, PL/I (+1 more)

### Community 3 - "Validation & Human Review"
Cohesion: 0.33
Nodes (7): Automated Validation & Tests (Built-In Validation), Behavioral Comparison Against Original System, Git, Human-in-the-Loop Review, Modernized Application, Static Analysis, Automated Unit Test Generation

### Community 4 - "AST Semantic Analysis"
Cohesion: 0.6
Nodes (5): Abstract Syntax Tree (AST), Control-Flow Analysis, Data-Flow Analysis, Semantic Analyzer (IR), Structure- and Semantic-Aware Translation

### Community 5 - "Rule-Based Transpiler Risk"
Cohesion: 0.67
Nodes (3): Loss of Business Logic, Rodriguez et al. 2022 - Survey of Rule-Based Transpilers, Rule-Based Transpilers

### Community 6 - "Manual Rewrite Effort"
Cohesion: 0.67
Nodes (3): High Manual Effort, Manual Rewriting, Reduced Manual Effort

### Community 7 - "IR & Multi-Language Scale"
Cohesion: 0.67
Nodes (3): Language-Agnostic Intermediate Representation (IR), Multi-Language Scalability, Poor Scalability

### Community 8 - "Text-Based Legacy Tooling"
Cohesion: 1.0
Nodes (3): Existing Legacy Modernization Approaches, Limited Semantic Understanding, Pattern-Matching Migration Scripts

## Ambiguous Edges - Review These
- `PL/I` → `AST Parser`  [AMBIGUOUS]
  docs/AI_Legacy_Modernization_Platform.md · relation: references
- `Static Analysis` → `Automated Validation & Tests (Built-In Validation)`  [AMBIGUOUS]
  docs/AI_Legacy_Modernization_Platform.md · relation: conceptually_related_to

## Knowledge Gaps
- **7 isolated node(s):** `Easwari Engineering College`, `Muthuveer M`, `G. Sai Lakshmi`, `Automated Unit Test Generation`, `Python` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `PL/I` and `AST Parser`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Static Analysis` and `Automated Validation & Tests (Built-In Validation)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `AI-Assisted Legacy Application Modernization Platform` connect `Project & References` to `AI Generation & Tooling`, `Validation & Human Review`, `AST Semantic Analysis`, `Rule-Based Transpiler Risk`, `Manual Rewrite Effort`, `IR & Multi-Language Scale`, `Text-Based Legacy Tooling`?**
  _High betweenness centrality (0.414) - this node is a cross-community bridge._
- **Why does `System Requirements & Specifications` connect `AI Generation & Tooling` to `Project & References`, `Legacy Languages & Parsing`, `Validation & Human Review`?**
  _High betweenness centrality (0.234) - this node is a cross-community bridge._
- **Why does `AST Parser` connect `Legacy Languages & Parsing` to `AI Generation & Tooling`, `Project & References`, `Validation & Human Review`, `AST Semantic Analysis`, `IR & Multi-Language Scale`?**
  _High betweenness centrality (0.232) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `AST Parser` (e.g. with `Static Analysis` and `Kumar et al. 2023 - AST Representations with LLMs for Guided Refactoring`) actually correct?**
  _`AST Parser` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `AI Code Generation Engine (LLM)` (e.g. with `Chen et al. 2021 - Evaluating Large Language Models Trained on Code (Codex)` and `Kumar et al. 2023 - AST Representations with LLMs for Guided Refactoring`) actually correct?**
  _`AI Code Generation Engine (LLM)` has 5 INFERRED edges - model-reasoned connections that need verification._