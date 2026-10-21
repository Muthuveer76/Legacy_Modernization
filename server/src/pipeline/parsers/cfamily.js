import { E, T, clip } from '../ir.js';
import { line } from '../treesitter.js';

// Shared lowering helpers for the Tree-sitter Java and C++ grammars.

const f = (node, name) => node?.childForFieldName(name) || null;
const named = (node) => (node ? node.namedChildren.filter(Boolean) : []);
const isComment = (n) => n.type === 'comment' || n.type === 'line_comment' || n.type === 'block_comment';

function unescapeString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/g, (_, esc) => {
    if (esc[0] === 'u') return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (esc[0] === 'x') return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (/^[0-7]+$/.test(esc)) return String.fromCharCode(Number.parseInt(esc, 8));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', 0: '\0', '"': '"', "'": "'", '\\': '\\' }[esc] ?? esc;
  });
}

function stringValue(node) {
  const text = node.text;
  if (node.type === 'raw_string_literal') return text.replace(/^R"([^(]*)\(([\s\S]*)\)\1"$/, '$2');
  if (node.type === 'concatenated_string') return named(node).map(stringValue).join('');
  return unescapeString(text.replace(/^[LuU8]*["']/, '').replace(/["']$/, ''));
}

function numberValue(text) {
  let t = text.replace(/_/g, '').replace(/[lLuUfFdD]+$/, '');
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) t = String(Number.parseInt(t, 16));
  else if (/^0[bB][01]+$/.test(t)) t = String(Number.parseInt(t.slice(2), 2));
  else if (/^0[0-7]+$/.test(t)) t = String(Number.parseInt(t, 8));
  return E.num(t);
}

function stmtText(node) {
  return clip(node.text.split('\n')[0], 90);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const JAVA_BOXED = {
  String: T.string, Integer: T.int, Short: T.int, Byte: T.int, Long: T.long, Double: T.float, Float: T.float,
  Boolean: T.bool, Character: T.string, BigDecimal: T.decimal, BigInteger: T.long, Date: T.date, LocalDate: T.date,
  LocalDateTime: T.date, StringBuffer: T.object('StringBuffer'), StringBuilder: T.object('StringBuilder'),
};

export function javaType(node) {
  if (!node) return { ...T.unknown };
  const text = node.text;
  switch (node.type) {
    case 'integral_type':
      if (text === 'long') return { ...T.long, legacy: text };
      if (text === 'char') return { ...T.string, length: 1, legacy: text };
      return { ...T.int, legacy: text };
    case 'floating_point_type':
      return { ...T.float, legacy: text };
    case 'boolean_type':
      return { ...T.bool, legacy: text };
    case 'void_type':
      return { ...T.void, legacy: 'void' };
    case 'array_type':
      return { ...T.array(javaType(f(node, 'element')), null), legacy: text };
    case 'generic_type': {
      const base = named(node)[0]?.text || text;
      return { ...T.object(base.replace(/^.*\./, '')), generic: text, legacy: text };
    }
    case 'scoped_type_identifier':
    case 'type_identifier': {
      const simple = text.replace(/^.*\./, '');
      const known = JAVA_BOXED[simple];
      return known ? { ...known, legacy: text } : { ...T.object(simple), legacy: text };
    }
    default:
      return { ...T.unknown, legacy: text };
  }
}

export function cppType(typeNode, declarator) {
  const text = typeNode?.text || 'int';
  let base;
  const clean = text.replace(/\b(const|volatile|static|unsigned|signed|struct|class|enum)\b/g, '').trim();
  if (/^(int|short|long|long long|size_t|int\d+_t|uint\d+_t|char16_t|wchar_t)$/.test(clean) || (/unsigned|signed/.test(text) && !clean)) base = /long long|int64/.test(text) ? { ...T.long } : { ...T.int };
  else if (/^(float|double|long double)$/.test(clean)) base = { ...T.float };
  else if (clean === 'bool') base = { ...T.bool };
  else if (clean === 'void') base = { ...T.void };
  else if (clean === 'char') base = { ...T.string, length: 1 };
  else if (/^(std::)?(string|wstring)$/.test(clean)) base = { ...T.string };
  else base = { ...T.object(clean.replace(/^std::/, '')) };
  base.legacy = text;
  // Walk declarator modifiers: char name[32] -> string(32); T* p -> pointer; T a[N] -> array
  let d = declarator;
  let type = base;
  while (d) {
    if (d.type === 'array_declarator') {
      const size = f(d, 'size');
      const n = size && /^\d+$/.test(size.text) ? Number(size.text) : null;
      if (type.t === 'string' && type.length === 1) type = { ...T.string, length: n, legacy: `${text}[${size?.text || ''}]` };
      else type = { ...T.array(type, n), sizeExpr: size?.text, legacy: `${text}[${size?.text || ''}]` };
      d = f(d, 'declarator');
    } else if (d.type === 'pointer_declarator') {
      if (type.t === 'string' && type.length === 1) type = { ...T.string, legacy: `${text}*` };
      else type = { ...type, pointer: true, legacy: `${text}*` };
      d = f(d, 'declarator');
    } else if (d.type === 'reference_declarator') {
      type = { ...type, reference: true };
      d = named(d)[0];
    } else if (d.type === 'init_declarator') {
      d = f(d, 'declarator');
    } else break;
  }
  return type;
}

function declaratorName(d) {
  while (d) {
    if (['identifier', 'field_identifier', 'type_identifier', 'destructor_name', 'operator_name'].includes(d.type)) return d.text;
    if (d.type === 'qualified_identifier') return d.text;
    const inner = f(d, 'declarator') || named(d)[0];
    if (!inner || inner === d) return d.text;
    d = inner;
  }
  return '?';
}

// ---------------------------------------------------------------------------
// Expressions (shared, with language-specific hooks)
// ---------------------------------------------------------------------------

const BIN_OPS = { '&&': 'and', '||': 'or', '/': 'cdiv', '%': 'mod' };

function lowerExpr(node, ctx) {
  if (!node) return E.null();
  switch (node.type) {
    case 'identifier':
    case 'field_identifier':
    case 'type_identifier':
    case 'namespace_identifier':
      return E.id(node.text);
    case 'this':
      return E.id('this');
    case 'super':
      return E.id('super');
    case 'qualified_identifier':
    case 'scoped_identifier':
      return E.id(node.text);
    case 'decimal_integer_literal':
    case 'hex_integer_literal':
    case 'octal_integer_literal':
    case 'binary_integer_literal':
    case 'decimal_floating_point_literal':
    case 'hex_floating_point_literal':
    case 'number_literal':
      return numberValue(node.text);
    case 'string_literal':
    case 'raw_string_literal':
    case 'concatenated_string':
    case 'character_literal':
    case 'char_literal':
    case 'text_block':
      return E.str(stringValue(node));
    case 'true':
      return E.bool(true);
    case 'false':
      return E.bool(false);
    case 'null_literal':
    case 'null':
    case 'nullptr':
      return E.null();
    case 'parenthesized_expression':
    case 'condition':
    case 'condition_clause':
      return lowerExpr(f(node, 'value') || named(node)[0], ctx);
    case 'binary_expression': {
      const op = f(node, 'operator')?.text || node.children.find((c) => c && !c.isNamed)?.text;
      const l = lowerExpr(f(node, 'left'), ctx);
      const r = lowerExpr(f(node, 'right'), ctx);
      return E.bin(BIN_OPS[op] || op, l, r);
    }
    case 'unary_expression': {
      const op = f(node, 'operator')?.text || node.children[0]?.text;
      const operand = lowerExpr(f(node, 'operand') || f(node, 'argument') || named(node)[0], ctx);
      if (op === '!') return E.un('not', operand);
      if (op === '-') return E.un('neg', operand);
      if (op === '+') return operand;
      return E.raw(node.text);
    }
    case 'pointer_expression':
      return lowerExpr(f(node, 'argument') || named(node)[0], ctx);
    case 'cast_expression':
      return { ...lowerExpr(f(node, 'value'), ctx), cast: f(node, 'type')?.text };
    case 'ternary_expression':
    case 'conditional_expression':
      return { k: 'cond', test: lowerExpr(f(node, 'condition'), ctx), then: lowerExpr(f(node, 'consequence'), ctx), else: lowerExpr(f(node, 'alternative'), ctx) };
    case 'method_invocation': {
      const obj = f(node, 'object');
      const name = f(node, 'name')?.text;
      const args = named(f(node, 'arguments')).map((a) => lowerExpr(a, ctx));
      return { k: 'call', fn: obj ? { k: 'member', obj: lowerExpr(obj, ctx), prop: name } : E.id(name), args };
    }
    case 'call_expression': {
      const fnNode = f(node, 'function');
      const args = named(f(node, 'arguments')).map((a) => lowerExpr(a, ctx));
      return { k: 'call', fn: lowerExpr(fnNode, ctx), args };
    }
    case 'template_function':
      return E.id(f(node, 'name')?.text || node.text);
    case 'object_creation_expression':
      return { k: 'new', type: (f(node, 'type')?.text || 'Object').replace(/<.*>$/, ''), generic: f(node, 'type')?.text, args: named(f(node, 'arguments')).map((a) => lowerExpr(a, ctx)) };
    case 'new_expression':
      return { k: 'new', type: f(node, 'type')?.text || 'Object', args: named(f(node, 'arguments')).map((a) => lowerExpr(a, ctx)), heap: true };
    case 'field_access':
      return { k: 'member', obj: lowerExpr(f(node, 'object'), ctx), prop: f(node, 'field')?.text };
    case 'field_expression':
      return { k: 'member', obj: lowerExpr(f(node, 'argument'), ctx), prop: f(node, 'field')?.text, arrow: node.text.includes('->') };
    case 'array_access':
      return { k: 'index', obj: lowerExpr(f(node, 'array'), ctx), idx: [lowerExpr(f(node, 'index'), ctx)] };
    case 'subscript_expression': {
      const idxNode = f(node, 'indices') || f(node, 'index');
      const idx = idxNode?.type === 'subscript_argument_list' ? named(idxNode).map((a) => lowerExpr(a, ctx)) : [lowerExpr(idxNode, ctx)];
      return { k: 'index', obj: lowerExpr(f(node, 'argument'), ctx), idx };
    }
    case 'assignment_expression':
    case 'update_expression':
    default:
      return E.raw(node.text.replace(/\s+/g, ' '));
  }
}

// System.out.println(x) / printf / std::cout << a << b
function printCall(expr) {
  if (expr.k !== 'call') return null;
  const fn = expr.fn;
  if (fn.k === 'member' && fn.obj.k === 'member' && fn.obj.obj.k === 'id' && fn.obj.obj.name === 'System' && (fn.obj.prop === 'out' || fn.obj.prop === 'err')) {
    if (fn.prop === 'println') return { args: expr.args, newline: true };
    if (fn.prop === 'print') return { args: expr.args, newline: false };
    if (fn.prop === 'printf' || fn.prop === 'format') return { args: expr.args, newline: false, format: true };
  }
  if (fn.k === 'member' && fn.obj.k === 'id' && fn.obj.name === 'System.out') {
    if (fn.prop === 'println') return { args: expr.args, newline: true };
    if (fn.prop === 'print') return { args: expr.args, newline: false };
    if (fn.prop === 'printf') return { args: expr.args, newline: false, format: true };
  }
  if (fn.k === 'id' && (fn.name === 'printf' || fn.name === 'std::printf')) return { args: expr.args, newline: false, format: true };
  if (fn.k === 'id' && (fn.name === 'puts' || fn.name === 'std::puts')) return { args: expr.args, newline: true };
  return null;
}

function coutChain(node) {
  // Flattens a << b << c where the leftmost operand is cout / std::cout / cerr.
  const parts = [];
  let cur = node;
  while (cur && cur.type === 'binary_expression' && f(cur, 'operator')?.text === '<<') {
    parts.unshift(f(cur, 'right'));
    cur = f(cur, 'left');
  }
  if (!cur || !/^(std::)?(cout|cerr|clog)$/.test(cur.text)) return null;
  return parts;
}

function cinChain(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type === 'binary_expression' && f(cur, 'operator')?.text === '>>') {
    parts.unshift(f(cur, 'right'));
    cur = f(cur, 'left');
  }
  if (!cur || !/^(std::)?cin$/.test(cur.text)) return null;
  return parts;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function lowerBlock(node, ctx) {
  if (!node) return [];
  if (node.type === 'block' || node.type === 'compound_statement' || node.type === 'constructor_body') {
    return named(node).filter((n) => !isComment(n)).flatMap((n) => toList(lowerStmt(n, ctx)));
  }
  return toList(lowerStmt(node, ctx));
}

function toList(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function lowerExpressionStatement(exprNode, node, ctx) {
  const base = { line: line(node), text: stmtText(node) };
  if (!exprNode) return null;
  if (exprNode.type === 'assignment_expression') {
    const op = f(exprNode, 'operator')?.text || '=';
    const target = lowerExpr(f(exprNode, 'left'), ctx);
    const right = lowerExpr(f(exprNode, 'right'), ctx);
    if (op === '=') return { k: 'assign', target, value: right, verb: 'ASSIGN', ...base };
    const binop = op.slice(0, -1);
    return { k: 'assign', target, value: E.bin(BIN_OPS[binop] || binop, target, right), compound: true, verb: 'ASSIGN', ...base };
  }
  if (exprNode.type === 'update_expression') {
    const arg = f(exprNode, 'argument') || named(exprNode)[0];
    const target = lowerExpr(arg, ctx);
    const inc = exprNode.text.includes('++');
    return { k: 'assign', target, value: E.bin(inc ? '+' : '-', target, E.num(1)), compound: true, verb: inc ? 'INCREMENT' : 'DECREMENT', ...base };
  }
  if (exprNode.type === 'binary_expression') {
    const out = coutChain(exprNode);
    if (out) {
      const args = out.map((p) => lowerExpr(p, ctx));
      let newline = false;
      const last = args[args.length - 1];
      if (last?.k === 'id' && /^(std::)?endl$/.test(last.name)) {
        args.pop();
        newline = true;
      } else if (last?.k === 'str' && last.v.endsWith('\n')) {
        args[args.length - 1] = E.str(last.v.slice(0, -1));
        if (!args[args.length - 1].v) args.pop();
        newline = true;
      }
      return { k: 'print', args, newline, verb: 'COUT', ...base };
    }
    const inp = cinChain(exprNode);
    if (inp) return inp.map((p) => ({ k: 'input', target: lowerExpr(p, ctx), source: 'CONSOLE', verb: 'CIN', ...base }));
  }
  if (exprNode.type === 'comma_expression') {
    return named(exprNode).flatMap((n) => toList(lowerExpressionStatement(n, node, ctx)));
  }
  const expr = lowerExpr(exprNode, ctx);
  const print = printCall(expr);
  if (print) {
    const args = [...print.args];
    let newline = print.newline;
    if (print.format && args[0]?.k === 'str' && args[0].v.endsWith('\n')) {
      args[0] = E.str(args[0].v.slice(0, -1));
      newline = true;
    }
    return { k: 'print', args, newline, format: Boolean(print.format), verb: 'PRINT', ...base };
  }
  if (expr.k === 'call' && expr.fn.k === 'id') {
    const name = expr.fn.name.replace(/^std::/, '');
    // C string library calls become assignments so data flow stays visible.
    if ((name === 'strcpy' || name === 'strncpy') && expr.args.length >= 2) return { k: 'assign', target: expr.args[0], value: expr.args[1], verb: name.toUpperCase(), note: `${name} copies a C string`, ...base };
    if ((name === 'strcat' || name === 'strncat') && expr.args.length >= 2) return { k: 'assign', target: expr.args[0], value: E.bin('concat', expr.args[0], expr.args[1]), compound: true, verb: name.toUpperCase(), ...base };
    if (name === 'exit') return { k: 'exit', scope: 'program', verb: 'EXIT', ...base };
    return { k: 'call', callee: expr.fn.name, args: expr.args, verb: 'CALL', ...base };
  }
  if (expr.k === 'call' && expr.fn.k === 'member' && expr.fn.obj.k === 'id' && expr.fn.obj.name === 'this') {
    return { k: 'call', callee: expr.fn.prop, args: expr.args, verb: 'CALL', ...base };
  }
  return { k: 'exprstmt', expr, verb: 'EXPR', ...base };
}

function localDeclarations(node, ctx, lang) {
  const base = { line: line(node), text: stmtText(node) };
  const typeNode = f(node, 'type');
  const out = [];
  const decls = node.childrenForFieldName('declarator').filter(Boolean);
  for (const d of decls) {
    if (lang === 'java') {
      const dims = f(d, 'dimensions');
      let type = javaType(typeNode);
      if (dims) type = T.array(type, null);
      out.push({ k: 'decl', name: f(d, 'name')?.text || d.text, type, init: f(d, 'value') ? lowerExpr(f(d, 'value'), ctx) : null, legacyType: typeNode?.text, ...base });
    } else {
      const init = d.type === 'init_declarator' ? f(d, 'value') : null;
      const type = cppType(typeNode, d);
      let value = null;
      if (init) value = init.type === 'initializer_list' || init.type === 'argument_list' ? E.raw(init.text) : lowerExpr(init, ctx);
      out.push({ k: 'decl', name: declaratorName(d), type, init: value, legacyType: type.legacy, ...base });
    }
  }
  return out;
}

function lowerSwitch(node, ctx) {
  const base = { line: line(node), text: stmtText(node) };
  const subject = lowerExpr(f(node, 'condition') || named(node)[0], ctx);
  const body = f(node, 'body') || named(node).find((n) => n.type === 'switch_block' || n.type === 'compound_statement');
  const cases = [];
  let dflt = null;
  let pendingTests = [];
  let pendingDefault = false;
  const flush = (stmts, caseLine) => {
    // A trailing break just ends the case.
    const cleaned = [...stmts];
    while (cleaned.length && cleaned[cleaned.length - 1].k === 'exit' && cleaned[cleaned.length - 1].scope === 'loop' && cleaned[cleaned.length - 1].verb === 'BREAK') cleaned.pop();
    if (pendingDefault) dflt = cleaned;
    if (pendingTests.length) cases.push({ tests: pendingTests, body: cleaned, line: caseLine });
    pendingTests = [];
    pendingDefault = false;
  };
  for (const child of named(body)) {
    if (isComment(child)) continue;
    if (child.type === 'switch_block_statement_group' || child.type === 'switch_rule') {
      const stmts = [];
      for (const c of named(child)) {
        if (c.type === 'switch_label') {
          const values = named(c);
          if (!values.length || c.text.trim().startsWith('default')) pendingDefault = true;
          for (const v of values) pendingTests.push({ kind: 'value', value: lowerExpr(v, ctx) });
        } else if (!isComment(c)) {
          if (child.type === 'switch_rule' && c.type !== 'block' && c.type !== 'throw_statement' && c.type !== 'expression_statement') stmts.push({ k: 'return', value: lowerExpr(c, ctx), line: line(c), text: stmtText(c) });
          else stmts.push(...lowerBlock(c, ctx));
        }
      }
      flush(stmts, line(child));
    } else if (child.type === 'case_statement') {
      const valueNode = f(child, 'value');
      if (valueNode) pendingTests.push({ kind: 'value', value: lowerExpr(valueNode, ctx) });
      else pendingDefault = true;
      // web-tree-sitter returns a new Node object on every access, so compare node ids.
      const stmts = named(child).filter((c) => c.id !== valueNode?.id && !isComment(c)).flatMap((c) => lowerBlock(c, ctx));
      if (stmts.length) flush(stmts, line(child));
    }
  }
  if (pendingTests.length || pendingDefault) flush([], base.line);
  return { k: 'switch', subject, cases, default: dflt, verb: 'SWITCH', ...base };
}

function lowerStmt(node, ctx) {
  if (!node || isComment(node)) return null;
  const base = { line: line(node), text: stmtText(node) };
  switch (node.type) {
    case 'block':
    case 'compound_statement':
      return lowerBlock(node, ctx);
    case 'local_variable_declaration':
      return localDeclarations(node, ctx, 'java');
    case 'declaration':
      return localDeclarations(node, ctx, 'cpp');
    case 'expression_statement':
      return lowerExpressionStatement(named(node)[0], node, ctx);
    case 'if_statement': {
      let alt = f(node, 'alternative');
      if (alt?.type === 'else_clause') alt = named(alt)[0];
      return { k: 'if', cond: lowerExpr(f(node, 'condition'), ctx), then: lowerBlock(f(node, 'consequence'), ctx), else: alt ? lowerBlock(alt, ctx) : null, verb: 'IF', ...base };
    }
    case 'while_statement':
      return { k: 'while', cond: lowerExpr(f(node, 'condition'), ctx), testAfter: false, body: lowerBlock(f(node, 'body'), ctx), verb: 'WHILE', ...base };
    case 'do_statement':
      return { k: 'while', cond: lowerExpr(f(node, 'condition'), ctx), testAfter: true, body: lowerBlock(f(node, 'body'), ctx), verb: 'DO', ...base };
    case 'for_statement': {
      const initNodes = [...node.childrenForFieldName('init'), ...node.childrenForFieldName('initializer')].filter(Boolean);
      const init = initNodes.flatMap((n) => (n.type === 'local_variable_declaration' || n.type === 'declaration' ? lowerStmt(n, ctx) : toList(lowerExpressionStatement(n, n, ctx))));
      const updates = node.childrenForFieldName('update').filter(Boolean).flatMap((n) => toList(lowerExpressionStatement(n, n, ctx)));
      const cond = f(node, 'condition');
      return { k: 'for', init, cond: cond ? lowerExpr(cond, ctx) : null, update: updates, body: lowerBlock(f(node, 'body'), ctx), verb: 'FOR', ...base };
    }
    case 'enhanced_for_statement':
      return { k: 'foreach', varName: f(node, 'name')?.text || 'item', varType: javaType(f(node, 'type')), iter: lowerExpr(f(node, 'value'), ctx), body: lowerBlock(f(node, 'body'), ctx), verb: 'FOR EACH', ...base };
    case 'for_range_loop':
      return { k: 'foreach', varName: declaratorName(f(node, 'declarator')), iter: lowerExpr(f(node, 'right'), ctx), body: lowerBlock(f(node, 'body'), ctx), verb: 'FOR RANGE', ...base };
    case 'switch_expression':
    case 'switch_statement':
      return lowerSwitch(node, ctx);
    case 'return_statement': {
      const v = named(node).find((n) => !isComment(n));
      return { k: 'return', value: v ? lowerExpr(v, ctx) : null, verb: 'RETURN', ...base };
    }
    case 'yield_statement':
      return { k: 'return', value: lowerExpr(named(node)[0], ctx), verb: 'YIELD', ...base };
    case 'break_statement':
      return { k: 'exit', scope: 'loop', verb: 'BREAK', ...base };
    case 'continue_statement':
      return { k: 'continue', verb: 'CONTINUE', ...base };
    case 'throw_statement':
      return { k: 'throw', value: lowerExpr(named(node)[0], ctx), verb: 'THROW', ...base };
    case 'goto_statement':
      return { k: 'goto', label: f(node, 'label')?.text || named(node)[0]?.text || '?', verb: 'GOTO', ...base };
    case 'labeled_statement': {
      const label = f(node, 'label')?.text || named(node)[0]?.text;
      const inner = named(node).slice(1).flatMap((n) => toList(lowerStmt(n, ctx)));
      return [{ k: 'label', name: label, ...base }, ...inner];
    }
    case 'try_statement':
    case 'try_with_resources_statement': {
      const handlers = named(node)
        .filter((n) => n.type === 'catch_clause')
        .map((c) => {
          const param = named(c).find((n) => n.type === 'catch_formal_parameter' || n.type === 'parameter_list');
          return { type: param ? clip(param.text.replace(/^\(|\)$/g, ''), 60) : 'Exception', body: lowerBlock(f(c, 'body') || named(c).find((n) => n.type === 'block' || n.type === 'compound_statement'), ctx) };
        });
      const fin = named(node).find((n) => n.type === 'finally_clause');
      return { k: 'try', body: lowerBlock(f(node, 'body'), ctx), handlers, finally: fin ? lowerBlock(named(fin)[0], ctx) : null, verb: 'TRY', ...base, ...(node.type === 'try_with_resources_statement' ? { note: 'try-with-resources closes the declared resources automatically' } : {}) };
    }
    case 'synchronized_statement':
      return { k: 'block', body: lowerBlock(f(node, 'body') || named(node).find((n) => n.type === 'block'), ctx), note: 'synchronized block (mutual exclusion)', verb: 'SYNCHRONIZED', ...base };
    case 'assert_statement':
      return { k: 'raw', verb: 'ASSERT', note: 'assertion', ...base };
    case 'empty_statement':
    case ';':
      return null;
    default:
      return { k: 'raw', verb: node.type.toUpperCase(), note: `Unhandled ${node.type}`, ...base };
  }
}

// ---------------------------------------------------------------------------
// Java modules
// ---------------------------------------------------------------------------

function modifiersOf(node) {
  const m = named(node).find((n) => n.type === 'modifiers');
  const text = m ? m.text : '';
  return {
    visibility: /\bprivate\b/.test(text) ? 'private' : /\bprotected\b/.test(text) ? 'protected' : /\bpublic\b/.test(text) ? 'public' : 'package',
    isStatic: /\bstatic\b/.test(text),
    isFinal: /\bfinal\b/.test(text),
    isSynchronized: /\bsynchronized\b/.test(text),
    isAbstract: /\babstract\b/.test(text),
    annotations: (text.match(/@\w+/g) || []),
  };
}

function uniqueId(used, base) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}#${n}`)) n += 1;
  used.add(`${base}#${n}`);
  return `${base}#${n}`;
}

function javaParams(node) {
  return named(f(node, 'parameters')).map((p) => {
    let type = javaType(f(p, 'type'));
    if (p.type === 'spread_parameter') type = T.array(type, null);
    if (f(p, 'dimensions')) type = T.array(type, null);
    const nameNode = f(p, 'name') || named(p).find((n) => n.type === 'variable_declarator' || n.type === 'identifier');
    return { name: nameNode ? (f(nameNode, 'name') || nameNode).text : '?', type, byRef: false, legacyType: f(p, 'type')?.text };
  });
}

function javaClassModule(node, fileName, prefix, modules, imports) {
  const name = `${prefix}${f(node, 'name')?.text || 'Anonymous'}`;
  const kind = node.type.replace('_declaration', '');
  const mods = modifiersOf(node);
  const mod = {
    file: fileName,
    language: 'java',
    name,
    kind,
    dataItems: [],
    types: [],
    procedures: [],
    entry: null,
    imports,
    diagnostics: [],
    meta: { superclass: f(node, 'superclass')?.text?.replace(/^extends\s+/, '') || null, interfaces: f(node, 'interfaces')?.text?.replace(/^implements\s+/, '') || null, modifiers: mods, annotations: mods.annotations },
  };
  const ctx = { lang: 'java', module: mod };
  const used = new Set();
  const body = f(node, 'body');
  const processMember = (member) => {
    if (isComment(member)) return;
    switch (member.type) {
      case 'field_declaration':
      case 'constant_declaration': {
        const m = modifiersOf(member);
        const typeNode = f(member, 'type');
        for (const d of member.childrenForFieldName('declarator').filter(Boolean)) {
          const value = f(d, 'value');
          let type = javaType(typeNode);
          if (f(d, 'dimensions')) type = T.array(type, null);
          mod.dataItems.push({
            name: f(d, 'name')?.text || d.text,
            type,
            initial: value ? lowerExpr(value, ctx) : null,
            scope: 'field',
            isConst: (m.isStatic && m.isFinal) || member.type === 'constant_declaration',
            isStatic: m.isStatic,
            visibility: m.visibility,
            legacyType: typeNode?.text,
            line: line(member),
          });
        }
        break;
      }
      case 'method_declaration':
      case 'constructor_declaration':
      case 'compact_constructor_declaration': {
        const m = modifiersOf(member);
        const isCtor = member.type !== 'method_declaration';
        const methodName = isCtor ? name.split('.').pop() : f(member, 'name')?.text;
        const returns = isCtor ? null : javaType(f(member, 'type'));
        const proc = {
          id: uniqueId(used, `${name}::${methodName}`),
          name: methodName,
          kind: isCtor ? 'constructor' : 'method',
          owner: name,
          params: javaParams(member),
          returns: returns?.t === 'void' ? null : returns,
          visibility: m.visibility,
          isStatic: m.isStatic,
          isSynchronized: m.isSynchronized,
          isAbstract: m.isAbstract || !f(member, 'body'),
          annotations: m.annotations,
          throws: named(member).find((n) => n.type === 'throws')?.text?.replace(/^throws\s+/, '') || null,
          body: lowerBlock(f(member, 'body'), ctx),
          loc: { start: line(member), end: member.endPosition.row + 1 },
        };
        mod.procedures.push(proc);
        if (methodName === 'main' && m.isStatic) mod.entry = proc.id;
        break;
      }
      case 'static_initializer':
        mod.procedures.push({ id: uniqueId(used, `${name}::<static>`), name: '<static>', kind: 'initializer', owner: name, params: [], returns: null, visibility: 'private', isStatic: true, body: lowerBlock(named(member)[0], ctx), loc: { start: line(member), end: member.endPosition.row + 1 } });
        break;
      case 'enum_constant':
        mod.dataItems.push({ name: f(member, 'name')?.text || member.text, type: { ...T.object(name) }, initial: null, scope: 'field', isConst: true, isStatic: true, enumConstant: true, line: line(member) });
        break;
      case 'enum_body_declarations':
        named(member).forEach(processMember);
        break;
      case 'class_declaration':
      case 'interface_declaration':
      case 'enum_declaration':
      case 'record_declaration':
        javaClassModule(member, fileName, `${name}.`, modules, imports);
        break;
      default:
    }
  };
  named(body).forEach(processMember);
  modules.push(mod);
  return mod;
}

export function lowerJava(root, fileName) {
  const modules = [];
  const imports = [];
  let pkg = null;
  for (const child of named(root)) {
    if (child.type === 'import_declaration') imports.push(child.text.replace(/^import\s+(static\s+)?/, '').replace(/;$/, ''));
    else if (child.type === 'package_declaration') pkg = child.text.replace(/^package\s+/, '').replace(/;$/, '');
    else if (['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'].includes(child.type)) javaClassModule(child, fileName, '', modules, imports);
  }
  for (const m of modules) m.meta.package = pkg;
  return modules;
}

// ---------------------------------------------------------------------------
// C / C++ modules
// ---------------------------------------------------------------------------

function cppParams(declarator) {
  let fd = declarator;
  while (fd && fd.type !== 'function_declarator') fd = f(fd, 'declarator');
  const list = fd ? f(fd, 'parameters') : null;
  return named(list)
    .filter((p) => p.type === 'parameter_declaration' || p.type === 'optional_parameter_declaration')
    .map((p) => {
      const d = f(p, 'declarator');
      const type = cppType(f(p, 'type'), d);
      return { name: d ? declaratorName(d) : '_', type, byRef: Boolean(type.reference || type.pointer), legacyType: clip(p.text, 60) };
    })
    .filter((p) => !(p.type.t === 'void' && p.name === '_'));
}

function functionNameOf(declarator) {
  let fd = declarator;
  while (fd && fd.type !== 'function_declarator') fd = f(fd, 'declarator');
  return fd ? declaratorName(f(fd, 'declarator')) : declaratorName(declarator);
}

export function lowerCpp(root, fileName) {
  const unitName = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const unit = { file: fileName, language: 'cpp', name: unitName, kind: 'unit', dataItems: [], types: [], procedures: [], entry: null, imports: [], diagnostics: [], meta: { macros: [], namespaces: [] } };
  const classes = new Map();
  const used = new Set();
  const ctx = { lang: 'cpp', module: unit };

  const classModule = (className) => {
    if (!classes.has(className)) {
      classes.set(className, { file: fileName, language: 'cpp', name: className, kind: 'class', dataItems: [], types: [], procedures: [], entry: null, imports: unit.imports, diagnostics: [], meta: {} });
    }
    return classes.get(className);
  };

  const addFunction = (node, ns, owner) => {
    const decl = f(node, 'declarator');
    let fullName = functionNameOf(decl);
    let className = owner;
    if (!className && fullName.includes('::')) {
      const parts = fullName.split('::');
      const candidate = parts.slice(0, -1).join('::');
      if (candidate && !/^std$/.test(candidate)) className = candidate;
      fullName = parts[parts.length - 1];
    }
    const target = className ? classModule(className) : unit;
    const returnsType = cppType(f(node, 'type'), null);
    const isStatic = named(node).some((n) => n.type === 'storage_class_specifier' && n.text === 'static');
    const proc = {
      id: uniqueId(used, `${target.name}::${ns}${fullName}`),
      name: `${ns}${fullName}`,
      kind: className ? (fullName === className.split('::').pop() ? 'constructor' : 'method') : 'function',
      owner: className || null,
      params: cppParams(decl),
      returns: returnsType.t === 'void' || !f(node, 'type') ? null : returnsType,
      visibility: isStatic ? 'private' : 'public',
      isStatic,
      body: lowerBlock(f(node, 'body'), { ...ctx, module: target }),
      loc: { start: line(node), end: node.endPosition.row + 1 },
    };
    target.procedures.push(proc);
    if (!className && fullName === 'main') unit.entry = proc.id;
  };

  const addRecord = (node, ns) => {
    const name = f(node, 'name')?.text;
    const body = f(node, 'body');
    if (!name || !body) return;
    const fields = [];
    const methods = [];
    for (const m of named(body)) {
      if (m.type === 'field_declaration') {
        const typeNode = f(m, 'type');
        for (const d of m.childrenForFieldName('declarator').filter(Boolean)) {
          if (d.type === 'function_declarator') continue;
          fields.push({ name: declaratorName(d), type: cppType(typeNode, d), legacyType: clip(m.text.replace(/;$/, ''), 60), line: line(m), scope: 'field' });
        }
      } else if (m.type === 'function_definition') methods.push(m);
    }
    const qualified = `${ns}${name}`;
    if (methods.length || node.type === 'class_specifier') {
      const cm = classModule(qualified);
      cm.dataItems.push(...fields);
      cm.meta.kind = node.type === 'class_specifier' ? 'class' : 'struct';
      for (const m of methods) addFunction(m, '', qualified);
    } else {
      unit.types.push({ name: qualified, kind: 'record', fields, line: line(node) });
    }
  };

  const walkTop = (container, ns) => {
    for (const child of named(container)) {
      if (isComment(child)) continue;
      switch (child.type) {
        case 'preproc_include':
          unit.imports.push(f(child, 'path')?.text || child.text);
          break;
        case 'preproc_def': {
          const valueText = f(child, 'value')?.text?.trim() || '';
          let initial = E.raw(valueText);
          let type = { ...T.unknown };
          if (/^-?\d+$/.test(valueText)) {
            initial = E.num(valueText);
            type = { ...T.int };
          } else if (/^-?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?[fF]?$/.test(valueText)) {
            initial = E.num(valueText.replace(/[fF]$/, ''));
            type = { ...T.float };
          } else if (/^".*"$/.test(valueText)) {
            initial = E.str(unescapeString(valueText.slice(1, -1)));
            type = { ...T.string };
          }
          unit.dataItems.push({ name: f(child, 'name')?.text, type, initial, scope: 'const', isConst: true, macro: true, legacyType: '#define', line: line(child) });
          break;
        }
        case 'preproc_function_def':
          unit.meta.macros.push({ name: f(child, 'name')?.text, text: clip(child.text, 120), line: line(child) });
          break;
        case 'preproc_ifdef':
        case 'preproc_if':
        case 'linkage_specification':
          walkTop(child.type === 'linkage_specification' ? f(child, 'body') || child : child, ns);
          break;
        case 'declaration_list':
          walkTop(child, ns);
          break;
        case 'function_definition':
          addFunction(child, ns, null);
          break;
        case 'declaration': {
          const typeNode = f(child, 'type');
          if (typeNode && (typeNode.type === 'struct_specifier' || typeNode.type === 'class_specifier') && f(typeNode, 'body')) addRecord(typeNode, ns);
          const isStatic = named(child).some((n) => n.type === 'storage_class_specifier' && n.text === 'static');
          const isConst = /\bconst\b/.test(named(child).filter((n) => n.type === 'type_qualifier').map((n) => n.text).join(' '));
          for (const d of child.childrenForFieldName('declarator').filter(Boolean)) {
            if (d.type === 'function_declarator') continue; // prototype
            const init = d.type === 'init_declarator' ? f(d, 'value') : null;
            unit.dataItems.push({
              name: `${ns}${declaratorName(d)}`,
              type: cppType(typeNode, d),
              initial: init ? (init.type === 'initializer_list' ? E.raw(init.text) : lowerExpr(init, ctx)) : null,
              scope: 'global',
              isStatic,
              isConst,
              legacyType: clip(child.text.replace(/\s*=.*$/s, '').replace(/;$/, ''), 60),
              line: line(child),
            });
          }
          break;
        }
        case 'struct_specifier':
        case 'class_specifier':
          addRecord(child, ns);
          break;
        case 'type_definition': {
          const typeNode = f(child, 'type');
          if (typeNode && (typeNode.type === 'struct_specifier' || typeNode.type === 'class_specifier') && f(typeNode, 'body')) {
            if (!f(typeNode, 'name')) {
              const alias = declaratorName(f(child, 'declarator'));
              const body = f(typeNode, 'body');
              const fields = named(body).filter((m) => m.type === 'field_declaration').flatMap((m) => m.childrenForFieldName('declarator').filter(Boolean).map((d) => ({ name: declaratorName(d), type: cppType(f(m, 'type'), d), legacyType: clip(m.text, 60), line: line(m), scope: 'field' })));
              unit.types.push({ name: alias, kind: 'record', fields, line: line(child) });
            } else addRecord(typeNode, ns);
          }
          break;
        }
        case 'enum_specifier': {
          let counter = 0;
          for (const e of named(f(child, 'body'))) {
            if (e.type !== 'enumerator') continue;
            const v = f(e, 'value');
            const value = v ? lowerExpr(v, ctx) : E.num(counter);
            counter = value.k === 'num' ? Number(value.v) + 1 : counter + 1;
            unit.dataItems.push({ name: f(e, 'name')?.text, type: { ...T.int }, initial: value, scope: 'const', isConst: true, enum: f(child, 'name')?.text || 'enum', line: line(e) });
          }
          break;
        }
        case 'namespace_definition': {
          const name = f(child, 'name')?.text;
          if (name) unit.meta.namespaces.push(name);
          walkTop(f(child, 'body'), name ? `${ns}${name}::` : ns);
          break;
        }
        case 'template_declaration':
          walkTop(child, ns);
          break;
        case 'using_declaration':
        case 'alias_declaration':
          unit.imports.push(clip(child.text.replace(/;$/, ''), 80));
          break;
        default:
      }
    }
  };
  walkTop(root, '');
  return [unit, ...classes.values()];
}
