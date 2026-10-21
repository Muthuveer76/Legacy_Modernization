import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/pipeline/analyzer.js';
import { exprToText, walkStatements } from '../src/pipeline/ir.js';
import { parseCobol } from '../src/pipeline/parsers/cobol.js';
import { parseSourceFile } from '../src/pipeline/parsers/index.js';
import { parseVb6 } from '../src/pipeline/parsers/vb6.js';
import { safeGeneratedPath } from '../src/pipeline/runner.js';
import { translate } from '../src/pipeline/translate/index.js';
import { grammarForPath, syntaxErrors, withTree } from '../src/pipeline/treesitter.js';
import { validateGenerated } from '../src/pipeline/validator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = (name) => fs.readFileSync(path.join(here, '../src/samples', name), 'utf8');
const SAMPLES = [
  ['PAYROLL.cbl', 'cobol'],
  ['InventoryModule.bas', 'vb6'],
  ['LegacyAccountService.java', 'java'],
  ['billing.cpp', 'cpp'],
];

async function pipeline(file, language) {
  const f = { path: file, language, content: sample(file) };
  const parsed = [await parseSourceFile(f, [f])];
  return { parsed, analysis: analyze(parsed) };
}

function stmts(proc) {
  const out = [];
  walkStatements(proc.body, (s) => out.push(s));
  return out;
}

describe('COBOL parser', () => {
  const mod = parseCobol(sample('PAYROLL.cbl'), { fileName: 'PAYROLL.cbl' });

  it('reads the program id, paragraphs and data division', () => {
    assert.equal(mod.name, 'PAYROLL');
    assert.deepEqual(mod.procedures.map((p) => p.name), ['MAIN-PROCEDURE', 'LOAD-EMPLOYEES', 'PROCESS-EMPLOYEE', 'COMPUTE-GROSS-PAY', 'COMPUTE-TAX', 'PRINT-AUDIT-TRAIL']);
    assert.equal(mod.diagnostics.length, 0);
    const gross = mod.dataItems.find((d) => d.name === 'WS-GROSS-PAY');
    assert.deepEqual({ t: gross.type.t, digits: gross.type.digits, scale: gross.type.scale }, { t: 'decimal', digits: 8, scale: 2 });
    const table = mod.dataItems.find((d) => d.name === 'WS-EMPLOYEE-TABLE');
    assert.equal(table.children[0].type.t, 'array');
    assert.equal(table.children[0].type.length, 4);
  });

  it('expands level-88 condition names into comparisons', () => {
    const proc = mod.procedures.find((p) => p.name === 'PROCESS-EMPLOYEE');
    const ifStmt = stmts(proc).find((s) => s.k === 'if');
    assert.equal(exprToText(ifStmt.cond), 'WS-OVERTIME-FLAG == "Y"');
    const setStmt = stmts(mod.procedures.find((p) => p.name === 'COMPUTE-GROSS-PAY')).find((s) => s.conditionName === 'OVERTIME-WORKED');
    assert.equal(exprToText(setStmt.target), 'WS-OVERTIME-FLAG');
  });

  it('lowers PERFORM VARYING, EVALUATE TRUE and COMPUTE ROUNDED', () => {
    const main = stmts(mod.procedures[0]);
    const loop = main.find((s) => s.k === 'for');
    assert.equal(exprToText(loop.cond), 'NOT (WS-INDEX > WS-EMPLOYEE-COUNT)');
    const tax = stmts(mod.procedures.find((p) => p.name === 'COMPUTE-TAX'));
    assert.equal(tax.find((s) => s.k === 'switch').cases.length, 2);
    assert.equal(tax.find((s) => s.k === 'assign' && s.round).target.name, 'WS-TAX');
  });

  it('handles free-format source, nested IF without END-IF and GO TO', () => {
    const src = [
      'IDENTIFICATION DIVISION.',
      'PROGRAM-ID. FREEFMT.',
      'DATA DIVISION.',
      'WORKING-STORAGE SECTION.',
      '01 A PIC 9(3) VALUE 5.',
      '01 B PIC 9(3) VALUE 7.',
      'PROCEDURE DIVISION.',
      'START-HERE.',
      '    IF A > 1 IF B > 2 DISPLAY "BOTH" ELSE DISPLAY "A ONLY" ELSE DISPLAY "NONE".',
      '    IF A GREATER THAN OR EQUAL TO 5 AND < 10 MOVE 1 TO B.',
      '    GO TO FINISH.',
      'FINISH.',
      '    STOP RUN.',
    ].join('\n');
    const m = parseCobol(src, { fileName: 'FREE.cob' });
    assert.equal(m.meta.format, 'free');
    const outer = m.procedures[0].body[0];
    assert.equal(outer.k, 'if');
    assert.equal(outer.then[0].k, 'if');
    assert.equal(outer.then[0].else.length, 1);
    assert.equal(outer.else.length, 1);
    assert.equal(exprToText(m.procedures[0].body[1].cond), '(A >= 5) AND (A < 10)');
    assert.equal(m.procedures[0].body[2].k, 'goto');
  });

  it('reads code that runs past column 72 instead of truncating it', () => {
    const src = [
      '       PROCEDURE DIVISION.',
      '       MAIN-LOGIC.',
      "           DISPLAY 'PAID OFF IN ' WS-YEARS ' YEARS ' WS-LEFTOVER ' MONTHS'.",
      '       FINISH.',
      '           STOP RUN.',
    ].join('\n');
    const m = parseCobol(src, { fileName: 'WIDE.cbl' });
    assert.equal(m.meta.format, 'variable');
    assert.deepEqual(m.procedures.map((p) => p.name), ['MAIN-LOGIC', 'FINISH']);
    assert.equal(m.procedures[0].body[0].args[4].v, ' MONTHS');
    // Genuine sequence numbers in columns 73-80 are still ignored.
    const tagged = parseCobol(`${'       PROCEDURE DIVISION.'.padEnd(72)}PAY00010\n${'       P1.'.padEnd(72)}PAY00020\n${"           DISPLAY 'HI'.".padEnd(72)}PAY00030`, { fileName: 'TAGGED.cbl' });
    assert.equal(tagged.meta.format, 'fixed');
    assert.equal(tagged.procedures[0].body[0].args[0].v, 'HI');
  });
});

describe('VB6 parser', () => {
  const mod = parseVb6(sample('InventoryModule.bas'), { fileName: 'InventoryModule.bas' });

  it('reads module variables, 1-based arrays and procedures', () => {
    assert.equal(mod.name, 'InventoryModule');
    assert.equal(mod.entry, 'InventoryModule::Main');
    const names = mod.dataItems.find((d) => d.name === 'mItemNames');
    assert.equal(names.type.t, 'array');
    assert.equal(names.type.lower, 1);
    assert.equal(names.type.length, 5);
  });

  it('turns name(i) into array indexing and function-name assignment into a return', () => {
    const load = stmts(mod.procedures.find((p) => p.name === 'LoadInventory'));
    assert.equal(load.filter((s) => s.k === 'assign').length, 16);
    assert.equal(load[1].target.k, 'index');
    const discount = stmts(mod.procedures.find((p) => p.name === 'GetDiscount'));
    assert.ok(discount.filter((s) => s.k === 'assign').every((s) => s.returnValue));
    const select = discount.find((s) => s.k === 'switch');
    assert.deepEqual(select.cases.map((c) => c.tests[0].kind), ['cmp', 'range']);
  });
});

describe('analyzer', () => {
  it('finds dead code, call edges and fixed-point hints in the COBOL sample', async () => {
    const { analysis } = await pipeline('PAYROLL.cbl', 'cobol');
    assert.deepEqual(analysis.summary.deadProcedures, ['PAYROLL::PRINT-AUDIT-TRAIL']);
    assert.equal(analysis.callGraph.edges.length, 4);
    assert.ok(analysis.hints.some((h) => h.includes('fixed-point')));
    const tax = analysis.procedures.find((p) => p.name === 'COMPUTE-TAX');
    assert.equal(tax.complexity, 3);
    assert.deepEqual(tax.writes, ['WS-TAX', 'WS-TAX-RATE']);
    const cfg = analysis.cfgs.find((c) => c.procedure === 'PAYROLL::MAIN-PROCEDURE');
    assert.ok(cfg.nodes.some((n) => n.kind === 'loop'));
  });

  it('reports legacy-API and safety findings for Java and C++', async () => {
    const java = (await pipeline('LegacyAccountService.java', 'java')).analysis;
    assert.ok(java.findings.some((f) => f.rule === 'legacy-collection' && f.message.includes('Hashtable')));
    assert.ok(java.callGraph.edges.some((e) => e.from.endsWith('::main') && e.to.endsWith('::deposit')));
    const cpp = (await pipeline('billing.cpp', 'cpp')).analysis;
    assert.ok(cpp.findings.some((f) => f.rule === 'unsafe-string'));
    assert.equal(cpp.summary.entryPoints[0], 'billing::main');
  });

  it('flags COBOL paragraph fall-through', async () => {
    const src = ['PROCEDURE DIVISION.', 'FIRST-PARA.', '    DISPLAY "ONE".', 'SECOND-PARA.', '    DISPLAY "TWO".', '    STOP RUN.'].join('\n');
    const f = { path: 'FALL.cob', language: 'cobol', content: src };
    const analysis = analyze([await parseSourceFile(f, [f])]);
    assert.ok(analysis.findings.some((x) => x.rule === 'fall-through'));
    assert.equal(analysis.summary.deadProcedures.length, 0);
  });
});

describe('generated file paths', () => {
  it('cannot escape the project root', () => {
    assert.equal(safeGeneratedPath('../../etc/passwd', 0), 'etc/passwd');
    assert.equal(safeGeneratedPath('/abs/src/App.java', 0), 'abs/src/App.java');
    assert.equal(safeGeneratedPath('C:\\x\\..\\y.java', 0), 'C_/x/y.java');
    assert.equal(safeGeneratedPath('src/./main/Pay roll$.py', 0), 'src/main/Pay roll_.py');
    assert.equal(safeGeneratedPath('..', 3), 'file-4.txt');
  });
});

describe('structural translator', () => {
  for (const [file, language] of SAMPLES) {
    for (const target of ['java', 'python', 'typescript', 'csharp']) {
      it(`${file} -> ${target} produces parseable code that maps every procedure`, async () => {
        const { parsed, analysis } = await pipeline(file, language);
        const generated = translate(parsed, analysis, { language: target, framework: 'plain', projectName: 'Test' });
        for (const out of generated.files) {
          const grammar = grammarForPath(out.path);
          if (!grammar) continue;
          const errors = await withTree(grammar, out.content, (tree) => syntaxErrors(tree.rootNode, out.content));
          assert.deepEqual(errors, [], `${out.path} has syntax errors`);
        }
        const validation = await validateGenerated(generated, analysis, target);
        assert.equal(validation.breakdown.procedures, 100);
        assert.equal(validation.breakdown.syntax, 100);
        assert.ok(validation.score >= 90, `score ${validation.score}`);
      });
    }
  }

  it('reproduces COBOL fixed-point results when the Python translation runs', async (t) => {
    let python = null;
    for (const cmd of ['python3', 'python']) {
      try {
        execFileSync(cmd, ['--version'], { stdio: 'ignore' });
        python = cmd;
        break;
      } catch {
        // try the next interpreter name
      }
    }
    if (!python) return t.skip('python is not installed');
    const { parsed, analysis } = await pipeline('PAYROLL.cbl', 'cobol');
    const generated = translate(parsed, analysis, { language: 'python', framework: 'plain', projectName: 'Payroll Check' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmp-'));
    for (const f of generated.files) {
      fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      fs.writeFileSync(path.join(dir, f.path), f.content);
    }
    const out = execFileSync(python, ['-m', 'payrollcheck.payroll'], { cwd: path.join(dir, 'src'), encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    // Hand-derived from the COBOL: 42.5h x 28.75 with 1.5x overtime = 1257.8125 -> truncated 1257.81;
    // tax 20% = 251.562 -> ROUNDED 251.56; net 1006.25 shown as PIC 9(6)V99 "00100625".
    assert.equal(
      out.replace(/\r\n/g, '\n'),
      [
        'ALICE JOHNSON        NET: 00100625 (OVERTIME)',
        'BOB MARTINEZ         NET: 00094848',
        'CAROL NGUYEN         NET: 00173250 (OVERTIME)',
        'DAVID OKAFOR         NET: 00033300',
        'TOTAL NET PAYROLL: 000402023',
        '',
      ].join('\n'),
    );
  });
});
