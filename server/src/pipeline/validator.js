import { grammarForPath, line, syntaxErrors, withTree } from './treesitter.js';

// Validate stage: static checks on generated code. Generated code is never executed on
// the server; the characterization tests it ships run in the user's CI.

const DECISIONS = {
  java: new Set(['if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement', 'catch_clause', 'ternary_expression', 'switch_label', 'switch_rule']),
  csharp: new Set(['if_statement', 'for_statement', 'for_each_statement', 'foreach_statement', 'while_statement', 'do_statement', 'catch_clause', 'conditional_expression', 'case_switch_label', 'switch_expression_arm']),
  typescript: new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'catch_clause', 'ternary_expression', 'switch_case']),
  python: new Set(['if_statement', 'elif_clause', 'for_statement', 'while_statement', 'except_clause', 'conditional_expression', 'case_clause', 'for_in_clause', 'if_clause']),
};
DECISIONS.tsx = DECISIONS.typescript;
DECISIONS.javascript = DECISIONS.typescript;

const FUNCTION_NODES = {
  java: new Set(['method_declaration', 'constructor_declaration']),
  csharp: new Set(['method_declaration', 'constructor_declaration', 'local_function_statement']),
  typescript: new Set(['method_definition', 'function_declaration']),
  python: new Set(['function_definition']),
};
FUNCTION_NODES.tsx = FUNCTION_NODES.typescript;
FUNCTION_NODES.javascript = FUNCTION_NODES.typescript;

const CLASS_NODES = new Set(['class_declaration', 'class_definition', 'record_declaration', 'interface_declaration', 'struct_declaration', 'abstract_class_declaration', 'enum_declaration']);

function complexityOf(node, lang) {
  const decisions = DECISIONS[lang] || new Set();
  let cc = 1;
  const visit = (n) => {
    if (decisions.has(n.type)) {
      if (n.type === 'switch_label' && n.text.trim().startsWith('default')) {
        // default arm is not a decision
      } else if (n.type === 'switch_case' && n.text.trim().startsWith('default')) {
        // ditto
      } else cc += 1;
    }
    if ((n.type === 'binary_expression' || n.type === 'boolean_operator') && /^(&&|\|\||and|or|\?\?)$/.test(n.childForFieldName('operator')?.text || n.children.find((c) => c && !c.isNamed && /^(&&|\|\||and|or|\?\?)$/.test(c.text))?.text || '')) cc += 1;
    for (const c of n.namedChildren) if (c && !FUNCTION_NODES[lang]?.has(c.type)) visit(c);
  };
  const body = node.childForFieldName('body') || node;
  visit(body);
  return cc;
}

export function extractSymbols(root, lang) {
  const symbols = [];
  const classes = [];
  const walk = (node, owner) => {
    for (const child of node.namedChildren) {
      if (!child) continue;
      if (CLASS_NODES.has(child.type)) {
        const name = child.childForFieldName('name')?.text || '?';
        const qualified = owner ? `${owner}.${name}` : name;
        classes.push({ name: qualified, line: line(child) });
        walk(child, qualified);
        continue;
      }
      if (FUNCTION_NODES[lang]?.has(child.type)) {
        let name = child.childForFieldName('name')?.text;
        if (child.type === 'constructor_declaration') name = name || owner?.split('.').pop();
        if (name) symbols.push({ name, owner: owner || null, qualified: owner ? `${owner}.${name}` : name, line: line(child), endLine: child.endPosition.row + 1, complexity: complexityOf(child, lang) });
        continue;
      }
      if (child.namedChildCount) walk(child, owner);
    }
  };
  walk(root, null);
  return { symbols, classes };
}

function countTests(content, lang) {
  switch (lang) {
    case 'java':
      return (content.match(/@(Test|ParameterizedTest|RepeatedTest)\b/g) || []).length;
    case 'csharp':
      return (content.match(/\[(Fact|Theory|Test|TestMethod)\b/g) || []).length;
    case 'typescript':
    case 'tsx':
    case 'javascript':
      return (content.match(/\b(it|test)(\.\w+(\([^)]*\))?)?\s*\(/g) || []).length;
    case 'python':
      return (content.match(/^\s*(async\s+)?def test_\w+/gm) || []).length;
    default:
      return 0;
  }
}

function normalizeSymbol(s) {
  return String(s || '').replace(/\(.*\)$/, '').replace(/::/g, '.').replace(/#\d+$/, '').trim();
}

export async function validateGenerated(generated, analysis, targetLanguage) {
  const fileReports = [];
  const allSymbols = [];
  const allClasses = [];
  let testCount = 0;
  let testFiles = 0;
  let todoMarkers = 0;

  for (const file of generated.files || []) {
    const grammar = grammarForPath(file.path);
    const report = { path: file.path, kind: file.kind, language: file.language, lines: file.content.split('\n').length, checked: Boolean(grammar), errors: [], symbols: [] };
    todoMarkers += (file.content.match(/TODO\(manual\)/g) || []).length;
    if (grammar) {
      await withTree(grammar, file.content, (tree) => {
        report.errors = syntaxErrors(tree.rootNode, file.content, 20);
        if (['java', 'csharp', 'typescript', 'tsx', 'python', 'javascript'].includes(grammar)) {
          const { symbols, classes } = extractSymbols(tree.rootNode, grammar);
          report.symbols = symbols;
          if (file.kind !== 'test') {
            allSymbols.push(...symbols.map((s) => ({ ...s, file: file.path })));
            allClasses.push(...classes.map((c) => ({ ...c, file: file.path })));
          }
        }
      });
    } else if (/\.(json)$/i.test(file.path)) {
      try {
        JSON.parse(file.content);
        report.checked = true;
      } catch (e) {
        report.checked = true;
        report.errors.push({ line: 1, column: 1, message: `Invalid JSON: ${e.message}`, snippet: '' });
      }
    }
    if (file.kind === 'test') {
      testFiles += 1;
      testCount += countTests(file.content, grammar);
    }
    report.ok = report.errors.length === 0;
    fileReports.push(report);
  }

  // ---- procedure mapping ----
  const legacyProcs = analysis.procedures;
  const mapping = generated.mapping || [];
  const bySymbolName = new Map();
  for (const s of allSymbols) {
    for (const key of [s.qualified, s.name, s.qualified.split('.').slice(-2).join('.')]) {
      if (!bySymbolName.has(key)) bySymbolName.set(key, s);
    }
  }
  const findSymbol = (modernSymbol) => {
    const norm = normalizeSymbol(modernSymbol);
    if (bySymbolName.has(norm)) return bySymbolName.get(norm);
    const last2 = norm.split('.').slice(-2).join('.');
    if (bySymbolName.has(last2)) return bySymbolName.get(last2);
    const last = norm.split('.').pop();
    return bySymbolName.get(last) || null;
  };
  const procedureResults = legacyProcs.map((p) => {
    const m = mapping.find((x) => x.legacyProcedure === p.id) || mapping.find((x) => String(x.legacyProcedure).split('::').pop() === p.name && (!x.legacyFile || x.legacyFile === p.file));
    const symbol = m ? findSymbol(m.modernSymbol) : null;
    let status;
    if (!m) status = p.reachable ? 'unmapped' : 'dropped-dead';
    else if (!symbol) status = 'missing-symbol';
    else status = 'mapped';
    let parity = null;
    if (symbol) {
      const delta = symbol.complexity - p.complexity;
      parity = { legacy: p.complexity, modern: symbol.complexity, delta, flag: delta < -1 ? 'lost-branches' : delta > p.complexity + 3 ? 'added-complexity' : 'ok' };
    }
    return { id: p.id, name: p.name, file: p.file, reachable: p.reachable, modernSymbol: m?.modernSymbol || null, modernFile: symbol?.file || m?.modernFile || null, modernLine: symbol?.line || null, status, parity };
  });
  const considered = procedureResults.filter((r) => r.status !== 'dropped-dead');
  const mappedCount = considered.filter((r) => r.status === 'mapped').length;
  const procCoverage = considered.length ? mappedCount / considered.length : 1;
  const parityPairs = procedureResults.filter((r) => r.parity);
  const parityOk = parityPairs.filter((r) => r.parity.flag !== 'lost-branches').length;
  const parityScore = parityPairs.length ? parityOk / parityPairs.length : 0;

  // ---- data mapping ----
  const legacyData = analysis.dataDictionary.filter((d) => d.name !== 'FILLER' && !(d.type?.t === 'record'));
  const dataMapping = generated.dataMapping || [];
  const mappedData = new Set(dataMapping.map((d) => String(d.legacyName).toUpperCase()));
  const dataResults = legacyData.map((d) => ({ name: d.name, file: d.file, mapped: mappedData.has(d.name.toUpperCase()), unused: d.unused }));
  const dataConsidered = dataResults.filter((d) => !d.unused);
  const dataCoverage = dataConsidered.length ? dataConsidered.filter((d) => d.mapped).length / dataConsidered.length : 1;
  const precisionRisks = [];
  for (const d of analysis.dataDictionary.filter((x) => x.type?.t === 'decimal')) {
    const m = dataMapping.find((x) => String(x.legacyName).toUpperCase() === d.name.toUpperCase());
    if (m && /\b(double|float|Double|Float|number)\b/.test(m.modernType || '')) precisionRisks.push({ name: d.name, modernType: m.modernType });
  }

  // ---- totals ----
  const checkedFiles = fileReports.filter((f) => f.checked);
  const syntaxOk = checkedFiles.filter((f) => f.ok).length;
  const syntaxScore = checkedFiles.length ? syntaxOk / checkedFiles.length : 0;
  const sourceFiles = fileReports.filter((f) => f.kind === 'source');
  const testScore = testFiles && testCount ? Math.min(1, testCount / Math.max(2, sourceFiles.length)) * (fileReports.filter((f) => f.kind === 'test').every((f) => f.ok) ? 1 : 0.5) : 0;
  const score = Math.round(
    100 * (0.25 * syntaxScore + 0.25 * procCoverage + 0.2 * parityScore + 0.1 * dataCoverage + 0.15 * testScore + 0.05 * (todoMarkers === 0 ? 1 : todoMarkers < 5 ? 0.5 : 0)),
  );

  const lost = parityPairs.filter((r) => r.parity.flag === 'lost-branches');
  const unmapped = procedureResults.filter((r) => r.status === 'unmapped');
  const missing = procedureResults.filter((r) => r.status === 'missing-symbol');
  const checks = [
    {
      id: 'syntax',
      label: 'Generated code parses',
      status: syntaxOk === checkedFiles.length ? 'pass' : 'fail',
      detail: `${syntaxOk}/${checkedFiles.length} files parse cleanly with the ${targetLanguage} grammar${checkedFiles.length < fileReports.length ? ` (${fileReports.length - checkedFiles.length} non-code files not checked)` : ''}`,
    },
    {
      id: 'procedures',
      label: 'Every legacy procedure has a modern counterpart',
      status: !unmapped.length && !missing.length ? 'pass' : procCoverage >= 0.8 ? 'warn' : 'fail',
      detail: `${mappedCount}/${considered.length} mapped to symbols that exist in the generated code${unmapped.length ? `; unmapped: ${unmapped.map((r) => r.name).join(', ')}` : ''}${missing.length ? `; mapped symbol not found: ${missing.map((r) => r.modernSymbol).join(', ')}` : ''}`,
    },
    {
      id: 'parity',
      label: 'Control-flow complexity preserved',
      status: !parityPairs.length ? 'warn' : lost.length ? 'warn' : 'pass',
      detail: parityPairs.length ? (lost.length ? `Possible lost branches in ${lost.map((r) => `${r.name} (${r.parity.legacy}→${r.parity.modern})`).join(', ')}` : `${parityPairs.length} procedure(s) keep their decision structure`) : 'No mapped procedures to compare',
    },
    {
      id: 'data',
      label: 'Legacy data items mapped',
      status: dataCoverage === 1 ? 'pass' : dataCoverage >= 0.7 ? 'warn' : 'fail',
      detail: `${dataConsidered.filter((d) => d.mapped).length}/${dataConsidered.length} used data items appear in the data mapping`,
    },
    {
      id: 'precision',
      label: 'Fixed-point fields keep exact decimal types',
      status: precisionRisks.length ? 'warn' : 'pass',
      detail: precisionRisks.length ? `Binary floating point used for ${precisionRisks.map((r) => `${r.name} → ${r.modernType}`).join(', ')}` : 'No decimal field was mapped to a floating-point type',
    },
    {
      id: 'tests',
      label: 'Unit / characterization tests generated',
      status: testCount >= 2 ? 'pass' : testCount ? 'warn' : 'fail',
      detail: `${testCount} test case(s) in ${testFiles} test file(s)`,
    },
    {
      id: 'todos',
      label: 'No manual-translation markers left',
      status: todoMarkers ? 'warn' : 'pass',
      detail: todoMarkers ? `${todoMarkers} TODO(manual) marker(s) need a reviewer` : 'None',
    },
    {
      id: 'execution',
      label: 'Behavioral comparison',
      status: 'info',
      detail: 'Generated code is not executed on the platform. Run the characterization tests in CI after pasting the legacy output into EXPECTED_OUTPUT.',
    },
  ];

  return {
    score,
    checks,
    files: fileReports,
    procedures: procedureResults,
    data: { coverage: Math.round(dataCoverage * 100), results: dataResults, precisionRisks },
    tests: { files: testFiles, cases: testCount },
    todoMarkers,
    classes: allClasses,
    symbols: allSymbols.length,
    breakdown: {
      syntax: Math.round(syntaxScore * 100),
      procedures: Math.round(procCoverage * 100),
      parity: Math.round(parityScore * 100),
      data: Math.round(dataCoverage * 100),
      tests: Math.round(testScore * 100),
    },
  };
}
