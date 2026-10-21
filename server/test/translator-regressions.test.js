import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { analyze } from '../src/pipeline/analyzer.js';
import { walkStatements } from '../src/pipeline/ir.js';
import { parseSourceFile } from '../src/pipeline/parsers/index.js';
import { translate } from '../src/pipeline/translate/index.js';
import { grammarForPath, syntaxErrors, withTree } from '../src/pipeline/treesitter.js';

// Regression tests for rule-based translator bugs: each snippet once produced code that did not
// parse or compile, looped forever, or silently computed a different result than the legacy code.

const COBOL_SIZE_AND_CYCLE = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. CYCLE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A PIC 9(3) VALUE 999.
       01 WS-B PIC 9(3) VALUE 5.
       01 WS-I PIC 9(3) VALUE 0.
       01 WS-T PIC 9(5) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ADD WS-A TO WS-B
               ON SIZE ERROR DISPLAY "OVERFLOW"
           END-ADD.
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 5
               IF WS-I = 3
                   EXIT PERFORM CYCLE
               END-IF
               ADD WS-I TO WS-T
           END-PERFORM.
           DISPLAY WS-T.
           STOP RUN.
`;

const COBOL_AT_END = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. READER.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO "in.dat".
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC PIC X(10).
       WORKING-STORAGE SECTION.
       01 WS-EOF PIC X VALUE "N".
       PROCEDURE DIVISION.
       MAIN-PARA.
           READ IN-FILE AT END MOVE "Y" TO WS-EOF END-READ.
           DISPLAY WS-EOF.
           STOP RUN.
`;

const JAVA = `public class Legacy {
  static int BASE;
  static { BASE = 42; }
  public static int parse(String s) {
    try { return Integer.parseInt(s); }
    catch (NumberFormatException e) { return -1; }
    catch (RuntimeException e) { return -2; }
  }
  public static int total(int n) {
    int t = 0;
    for (int i = 0; i < n; i++) { t += i; }
    return t + BASE;
  }
  public static int skips(int n) {
    int i = 0; int t = 0;
    do { i++; if (i == 2) continue; t += i; } while (i < n);
    for (int k = 0; k < n; k += 2) { if (k == 2) continue; t += k; }
    try { t += 1; } catch (final IllegalStateException | ArithmeticException e) { t = -3; }
    return t;
  }
}`;

const CPP = `#include <stdio.h>
int classify(int x) {
  int r = 0;
  switch (x) {
    case 1: r = 10; break;
    case 2: r = 20; break;
    default: r = 0;
  }
  return r;
}
int half(int a, int b) { int q = a / b; return q; }
int main() { printf("%d %d\\n", classify(2), half(7, 2)); return 0; }
`;

const VB6 = `Attribute VB_Name = "Rules"
Option Explicit
Public Function SumUntilThree(ByVal n As Integer) As Integer
  Dim i As Integer, t As Integer
  For i = 1 To n
    Select Case i
      Case 3
        Exit For
      Case Else
        t = t + i
    End Select
  Next i
  SumUntilThree = t
End Function
Public Function Implies(ByVal a As Boolean, ByVal b As Boolean) As Boolean
  Implies = a Imp b
End Function
`;

async function generate(file, language, content, target) {
  const f = { path: file, language, content };
  const parsed = [await parseSourceFile(f, [f])];
  const analysis = analyze(parsed);
  const generated = translate(parsed, analysis, { language: target, framework: 'plain', projectName: 'Repro' });
  return { parsed, generated };
}

const source = (generated) => generated.files.find((f) => f.kind === 'source').content;

async function assertParses(generated) {
  for (const out of generated.files) {
    const grammar = grammarForPath(out.path);
    if (!grammar) continue;
    const errors = await withTree(grammar, out.content, (tree) => syntaxErrors(tree.rootNode, out.content));
    assert.deepEqual(errors, [], `${out.path} has syntax errors:\n${out.content}`);
  }
}

let python;
function findPython() {
  if (python !== undefined) return python;
  python = null;
  for (const cmd of ['python3', 'python']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
      python = cmd;
      break;
    } catch {
      // try the next interpreter name
    }
  }
  return python;
}

// Writes the generated Python project to a temp dir and runs `code` against the `repro` package.
function runPython(t, generated, code) {
  if (!findPython()) {
    t.skip('python is not installed');
    return null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmp-reg-'));
  try {
    for (const f of generated.files) {
      fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      fs.writeFileSync(path.join(dir, f.path), f.content);
    }
    return execFileSync(python, ['-c', code], { cwd: path.join(dir, 'src'), encoding: 'utf8', timeout: 15000 }).replace(/\r\n/g, '\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('translator regressions', () => {
  it('Python: ON SIZE ERROR keeps the if statement parseable', async () => {
    const { generated } = await generate('CYCLE.cbl', 'cobol', COBOL_SIZE_AND_CYCLE, 'python');
    await assertParses(generated);
    const py = source(generated);
    assert.match(py, /^\s*# ON SIZE ERROR: add an explicit range check\n\s*if False:$/m);
  });

  it('Python: continue in a PERFORM VARYING still advances the counter', async (t) => {
    const { generated } = await generate('CYCLE.cbl', 'cobol', COBOL_SIZE_AND_CYCLE, 'python');
    await assertParses(generated);
    // 1 + 2 + 4 + 5 (3 is skipped), shown as PIC 9(5); this used to loop forever at WS-I = 3.
    const out = runPython(t, generated, 'from repro.cycle import Cycle\nCycle().run()');
    if (out !== null) assert.equal(out, '00012\n');
  });

  it('Python: continue in a do-while and a stepped for loop still runs the update and the test', async (t) => {
    const { generated } = await generate('Legacy.java', 'java', JAVA, 'python');
    await assertParses(generated);
    // do-while: 1 + 3 + 4 = 8; for k = 0, 2 (skipped): + 0; try: + 1.
    const out = runPython(t, generated, 'from repro.legacy import Legacy\nprint(Legacy.skips(4))');
    if (out !== null) assert.equal(out, '9\n');
  });

  it('keeps Java static initializers in every target', async (t) => {
    const expected = { java: /static \{\n\s*base = 42;/, csharp: /static Legacy\(\)\n\s*\{\n\s*baseValue = 42;/, typescript: /static \{\n\s*Legacy\.base = 42;/, python: /def _static_init\(\) -> None:[\s\S]*Legacy\.base = 42[\s\S]*\nLegacy\._static_init\(\)\n/ };
    for (const [target, pattern] of Object.entries(expected)) {
      const { generated } = await generate('Legacy.java', 'java', JAVA, target);
      await assertParses(generated);
      assert.match(generated.files.filter((f) => f.kind === 'source').map((f) => f.content).join('\n'), pattern, target);
    }
    const { generated } = await generate('Legacy.java', 'java', JAVA, 'python');
    // 0 + 1 + 2 + 3 + 4 + BASE; static fields are class attributes, so the @staticmethod can read them.
    const out = runPython(t, generated, 'from repro.legacy import Legacy\nprint(Legacy.total(5))');
    if (out !== null) assert.equal(out, '52\n');
  });

  it('Exit For inside Select Case leaves the loop, not just the switch', async (t) => {
    const java = source((await generate('Rules.bas', 'vb6', VB6, 'java')).generated);
    assert.match(java, /outerLoop1: for \(/);
    assert.match(java, /case 3 -> \{\n\s*break outerLoop1;/);
    const cs = await generate('Rules.bas', 'vb6', VB6, 'csharp');
    await assertParses(cs.generated);
    assert.match(source(cs.generated), /case 3:\n\s*goto outerLoop1End;/);
    assert.match(source(cs.generated), /\n\s*outerLoop1End: ;\n/);
    const { generated } = await generate('Rules.bas', 'vb6', VB6, 'python');
    const out = runPython(t, generated, 'from repro.rules import Rules\nprint(Rules().sum_until_three(5))');
    if (out !== null) assert.equal(out, '3\n');
  });

  it('C#: several catch clauses compile as exception filters', async () => {
    const { generated } = await generate('Legacy.java', 'java', JAVA, 'csharp');
    await assertParses(generated);
    const cs = source(generated);
    assert.match(cs, /catch \(Exception e\) when \(e is FormatException\)/);
    assert.match(cs, /catch \(Exception e\) when \(e is SystemException\)/);
    assert.match(cs, /catch \(Exception e\) when \(e is InvalidOperationException \|\| e is ArithmeticException\)/);
    // Two unfiltered catch-alls in one try is error CS0160.
    assert.doesNotMatch(cs, /catch \(Exception e\)\n\s*\{[^}]*\}\n\s*catch \(Exception e\)\n/);
    const java = source((await generate('Legacy.java', 'java', JAVA, 'java')).generated);
    assert.match(java, /catch \(IllegalStateException \| ArithmeticException e\)/);
  });

  it('TypeScript: C integer division truncates', async () => {
    const { generated } = await generate('calc.cpp', 'cpp', CPP, 'typescript');
    await assertParses(generated);
    assert.match(source(generated), /let q: number = Math\.trunc\(a \/ b\);/);
  });

  it('VB6: a Imp b means (Not a) Or b', async (t) => {
    const { generated } = await generate('Rules.bas', 'vb6', VB6, 'csharp');
    assert.match(source(generated), /result = !a \|\| b;/);
    const py = await generate('Rules.bas', 'vb6', VB6, 'python');
    const out = runPython(t, py.generated, 'from repro.rules import Rules\nr = Rules()\nprint([r.implies(a, b) for a in (False, True) for b in (False, True)])');
    if (out !== null) assert.equal(out, '[True, True, False, True]\n');
  });

  it('COBOL AT END calls a helper that every target defines', async () => {
    const expected = {
      java: [/if \(endOfFile\("IN-FILE"\)\)/, /private static boolean endOfFile\(String file\)/],
      csharp: [/if \(EndOfFile\("IN-FILE"\)\)/, /private static bool EndOfFile\(string file\)/],
      typescript: [/if \(endOfFile\('IN-FILE'\)\)/, /function endOfFile\(file: string\): boolean/],
      python: [/if _end_of_file\("IN-FILE"\):/, /def _end_of_file\(file: str\) -> bool:/],
    };
    for (const [target, patterns] of Object.entries(expected)) {
      const { generated } = await generate('READER.cbl', 'cobol', COBOL_AT_END, target);
      await assertParses(generated);
      for (const p of patterns) assert.match(source(generated), p, target);
    }
  });

  it('C++ case labels are not lowered as unhandled statements', async () => {
    const { parsed, generated } = await generate('calc.cpp', 'cpp', CPP, 'java');
    const raws = [];
    for (const m of parsed[0].modules) for (const p of m.procedures) walkStatements(p.body, (s) => s.k === 'raw' && raws.push(s.note || s.text));
    assert.deepEqual(raws, []);
    assert.doesNotMatch(source(generated), /TODO\(manual\)/);
  });
});
