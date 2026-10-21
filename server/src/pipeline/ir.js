// Language-agnostic intermediate representation (IR) shared by every parser.
//
// Module    { file, language, name, kind, dataItems, types, procedures, entry, imports, diagnostics }
// Procedure { id, name, kind, owner, params, returns, visibility, isStatic, body, loc:{start,end} }
// DataItem  { name, type, level, pic, occurs, initial, children, conditions, scope, line, isConst }
// Type      { t: int|long|decimal|float|string|bool|date|object|record|void|unknown, name, elem, digits, scale, signed, length }
//
// Statements carry { k, line, text } plus kind-specific fields (see STATEMENT_BLOCKS).
// Expressions: num str bool null id index member call new bin un cond raw.

export const T = {
  int: { t: 'int' },
  long: { t: 'long' },
  decimal: { t: 'decimal' },
  float: { t: 'float' },
  string: { t: 'string' },
  bool: { t: 'bool' },
  date: { t: 'date' },
  void: { t: 'void' },
  unknown: { t: 'unknown' },
  object: (name) => ({ t: 'object', name }),
  array: (elem, length) => ({ t: 'array', elem, length }),
  record: (name) => ({ t: 'record', name }),
};

export const E = {
  num: (v) => ({ k: 'num', v: String(v) }),
  str: (v) => ({ k: 'str', v }),
  bool: (v) => ({ k: 'bool', v }),
  null: () => ({ k: 'null' }),
  id: (name) => ({ k: 'id', name }),
  bin: (op, l, r) => ({ k: 'bin', op, l, r }),
  un: (op, e) => ({ k: 'un', op, e }),
  call: (fn, args = []) => ({ k: 'call', fn: typeof fn === 'string' ? { k: 'id', name: fn } : fn, args }),
  raw: (text) => ({ k: 'raw', text }),
};

export const ARITH_OPS = new Set(['+', '-', '*', 'div', 'idiv', 'cdiv', 'mod', 'pow']);
export const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
export const LOGIC_OPS = new Set(['and', 'or']);

// Nested statement lists for each statement kind, as [label, statements] pairs.
export function childBlocks(stmt) {
  switch (stmt.k) {
    case 'if':
      return [['then', stmt.then], ['else', stmt.else]].filter(([, b]) => b);
    case 'switch':
      return [
        ...stmt.cases.map((c, i) => [`case ${i + 1}`, c.body]),
        ...(stmt.default ? [['default', stmt.default]] : []),
      ];
    case 'while':
    case 'foreach':
    case 'repeat':
    case 'block':
      return [['body', stmt.body]];
    case 'for':
      return [['init', stmt.init], ['body', stmt.body], ['update', stmt.update]];
    case 'try':
      return [
        ['try', stmt.body],
        ...stmt.handlers.map((h) => [`catch ${h.type || ''}`.trim(), h.body]),
        ...(stmt.finally ? [['finally', stmt.finally]] : []),
      ];
    default:
      return [];
  }
}

export function walkStatements(stmts, visit, depth = 0, parent = null) {
  for (const s of stmts || []) {
    if (visit(s, depth, parent) === false) continue;
    for (const [, block] of childBlocks(s)) walkStatements(block, visit, depth + 1, s);
  }
}

export function walkExpr(expr, visit) {
  if (!expr || typeof expr !== 'object') return;
  visit(expr);
  switch (expr.k) {
    case 'index':
      walkExpr(expr.obj, visit);
      expr.idx.forEach((e) => walkExpr(e, visit));
      break;
    case 'member':
      walkExpr(expr.obj, visit);
      break;
    case 'call':
      walkExpr(expr.fn, visit);
      expr.args.forEach((e) => walkExpr(e, visit));
      break;
    case 'new':
      expr.args.forEach((e) => walkExpr(e, visit));
      break;
    case 'bin':
      walkExpr(expr.l, visit);
      walkExpr(expr.r, visit);
      break;
    case 'un':
      walkExpr(expr.e, visit);
      break;
    case 'cond':
      walkExpr(expr.test, visit);
      walkExpr(expr.then, visit);
      walkExpr(expr.else, visit);
      break;
    default:
  }
}

// Root variable of an lvalue: WS-X(1) -> WS-X, items[i].name -> items, this.count -> count.
export function rootName(expr) {
  if (!expr) return null;
  switch (expr.k) {
    case 'id':
      return expr.name;
    case 'index':
      return rootName(expr.obj);
    case 'member':
      if (expr.obj?.k === 'id' && SELF_NAMES.has(expr.obj.name)) return expr.prop;
      return rootName(expr.obj);
    default:
      return null;
  }
}

const SELF_NAMES = new Set(['this', 'Me', 'self']);

export function exprReads(expr, out = []) {
  if (!expr || typeof expr !== 'object') return out;
  switch (expr.k) {
    case 'id':
      if (!SELF_NAMES.has(expr.name)) out.push(expr.name);
      break;
    case 'index':
      exprReads(expr.obj, out);
      expr.idx.forEach((e) => exprReads(e, out));
      break;
    case 'member':
      if (expr.obj?.k === 'id' && SELF_NAMES.has(expr.obj.name)) out.push(expr.prop);
      else exprReads(expr.obj, out);
      break;
    case 'call':
      // A bare function name is not a variable read; a receiver object is.
      if (expr.fn?.k !== 'id') exprReads(expr.fn, out);
      expr.args.forEach((e) => exprReads(e, out));
      break;
    case 'new':
      expr.args.forEach((e) => exprReads(e, out));
      break;
    case 'bin':
      exprReads(expr.l, out);
      exprReads(expr.r, out);
      break;
    case 'un':
      exprReads(expr.e, out);
      break;
    case 'cond':
      exprReads(expr.test, out);
      exprReads(expr.then, out);
      exprReads(expr.else, out);
      break;
    default:
  }
  return out;
}

// Names read inside an lvalue (subscripts), excluding the root being written.
function lvalueReads(expr) {
  if (!expr) return [];
  if (expr.k === 'index') return [...lvalueReads(expr.obj), ...expr.idx.flatMap((e) => exprReads(e))];
  if (expr.k === 'member') return lvalueReads(expr.obj);
  return [];
}

export function stmtDefsUses(s) {
  const defs = [];
  const uses = [];
  const use = (e) => uses.push(...exprReads(e));
  switch (s.k) {
    case 'assign':
      defs.push(rootName(s.target));
      uses.push(...lvalueReads(s.target));
      use(s.value);
      if (s.compound) uses.push(rootName(s.target));
      break;
    case 'decl':
      defs.push(s.name);
      use(s.init);
      break;
    case 'if':
    case 'while':
      use(s.cond);
      break;
    case 'switch':
      use(s.subject);
      for (const c of s.cases) {
        for (const t of c.tests) {
          use(t.value);
          use(t.from);
          use(t.to);
          use(t.cond);
        }
      }
      break;
    case 'for':
      use(s.cond);
      break;
    case 'foreach':
      defs.push(s.varName);
      use(s.iter);
      break;
    case 'repeat':
      use(s.count);
      break;
    case 'call':
      s.args.forEach(use);
      break;
    case 'exprstmt':
      use(s.expr);
      break;
    case 'print':
      s.args.forEach(use);
      break;
    case 'input':
      if (s.target) defs.push(rootName(s.target));
      break;
    case 'io':
      s.args.forEach(use);
      if (s.target && s.op === 'read') {
        defs.push(rootName(s.target));
        uses.push(...lvalueReads(s.target));
      } else if (s.target) {
        use(s.target);
      }
      break;
    case 'return':
    case 'throw':
      use(s.value);
      break;
    default:
  }
  return { defs: defs.filter(Boolean), uses: uses.filter(Boolean) };
}

const OP_TEXT = {
  div: '/', idiv: '\\', cdiv: '/', mod: '%', pow: '**', concat: '&', and: 'AND', or: 'OR',
};

export function exprToText(e) {
  if (!e) return '';
  switch (e.k) {
    case 'num':
      return e.v;
    case 'str':
      return e.fig ? e.fig : JSON.stringify(e.v);
    case 'bool':
      return e.v ? 'TRUE' : 'FALSE';
    case 'null':
      return 'NULL';
    case 'id':
      return e.name;
    case 'index':
      return `${exprToText(e.obj)}(${e.idx.map(exprToText).join(', ')})`;
    case 'member':
      return `${exprToText(e.obj)}.${e.prop}`;
    case 'call':
      return `${exprToText(e.fn)}(${e.args.map(exprToText).join(', ')})`;
    case 'new':
      return `new ${e.type}(${e.args.map(exprToText).join(', ')})`;
    case 'bin':
      return `${wrap(e.l)} ${OP_TEXT[e.op] || e.op} ${wrap(e.r)}`;
    case 'un':
      return e.op === 'not' ? `NOT ${wrap(e.e)}` : `${e.op === 'neg' ? '-' : '+'}${wrap(e.e)}`;
    case 'cond':
      return `${wrap(e.test)} ? ${wrap(e.then)} : ${wrap(e.else)}`;
    case 'raw':
      return e.text;
    default:
      return '?';
  }
}

function wrap(e) {
  const t = exprToText(e);
  return e && (e.k === 'bin' || e.k === 'cond') ? `(${t})` : t;
}

export function clip(text, max = 72) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function countStatements(stmts) {
  let n = 0;
  walkStatements(stmts, () => {
    n += 1;
  });
  return n;
}

// Syntax-tree view for languages whose parser builds the IR directly (COBOL, VB6).
export function moduleToTree(mod) {
  const dataNode = (d) => ({
    type: d.children?.length ? 'GroupItem' : 'DataItem',
    label: [d.level ? String(d.level).padStart(2, '0') : null, d.name, d.pic ? `PIC ${d.pic}` : d.legacyType || null, d.occurs ? `OCCURS ${d.occurs}` : null]
      .filter(Boolean)
      .join(' '),
    line: d.line,
    children: [
      ...(d.children || []).map(dataNode),
      ...(d.conditions || []).map((c) => ({ type: 'ConditionName', label: `88 ${c.name}`, line: c.line, children: [] })),
    ],
  });
  const stmtNode = (s) => ({
    type: s.verb ? `${s.verb[0]}${s.verb.slice(1).toLowerCase()}Statement`.replace(/[\s-]+(\w)/g, (_, c) => c.toUpperCase()) : `${s.k[0].toUpperCase()}${s.k.slice(1)}Statement`,
    label: clip(s.text || exprToText(s.cond) || s.k, 90),
    line: s.line,
    children: childBlocks(s)
      .filter(([, b]) => b && b.length)
      .map(([label, b]) => ({ type: 'Block', label, line: b[0]?.line, children: b.map(stmtNode) })),
  });
  return {
    type: mod.kind === 'program' ? 'Program' : 'Module',
    label: mod.name,
    line: 1,
    children: [
      {
        type: mod.language === 'cobol' ? 'DataDivision' : 'Declarations',
        label: `${mod.dataItems.length} items`,
        line: mod.dataItems[0]?.line,
        children: mod.dataItems.map(dataNode),
      },
      {
        type: mod.language === 'cobol' ? 'ProcedureDivision' : 'Procedures',
        label: `${mod.procedures.length} ${mod.language === 'cobol' ? 'paragraphs' : 'procedures'}`,
        line: mod.procedures[0]?.loc.start,
        children: mod.procedures.map((p) => ({
          type: p.kind[0].toUpperCase() + p.kind.slice(1),
          label: p.params?.length ? `${p.name}(${p.params.map((x) => x.name).join(', ')})` : p.name,
          line: p.loc.start,
          endLine: p.loc.end,
          children: p.body.map(stmtNode),
        })),
      },
    ],
  };
}
