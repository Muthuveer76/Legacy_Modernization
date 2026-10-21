import { clip, exprToText, walkStatements } from '../ir.js';
import { caseKey } from './model.js';

// Structure-preserving printers for the rule-based translator. Each printer turns one
// unit (built by model.js) into a source file for its target language.

const INT = { t: 'int' };
const LONG = { t: 'long' };
const DEC = { t: 'decimal' };
const FLT = { t: 'float' };
const STR = { t: 'string' };
const BOOL = { t: 'bool' };
const UNK = { t: 'unknown' };

const NUMERIC = new Set(['int', 'long', 'decimal', 'float']);
const isNum = (t) => NUMERIC.has(t?.t);

const LOOP_KINDS = new Set(['while', 'for', 'foreach', 'repeat']);

const PREC = { or: 1, and: 2, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, concat: 5, '+': 5, '-': 5, '*': 6, div: 6, idiv: 6, cdiv: 6, mod: 6, pow: 7 };

// Builtins by source language -> generic operation
const BUILTINS = {
  vb6: {
    LEN: 'len', LEFT: 'left', RIGHT: 'right', MID: 'mid', UCASE: 'upper', LCASE: 'lower', TRIM: 'trim', LTRIM: 'ltrim', RTRIM: 'rtrim',
    INSTR: 'indexOf1', REPLACE: 'replace', CSTR: 'toString', STR: 'toString', CINT: 'toInt', CLNG: 'toInt', CDBL: 'toFloat', CSNG: 'toFloat',
    CCUR: 'toDecimal', CDEC: 'toDecimal', VAL: 'toFloat', FORMAT: 'format', ABS: 'abs', INT: 'floor', FIX: 'trunc', ROUND: 'round', SQR: 'sqrt',
    NOW: 'now', DATE: 'today', ISNUMERIC: 'isNumeric', UBOUND: 'ubound', LBOUND: 'lbound', CHR: 'chr', ASC: 'ord', SPACE: 'spaces', DATEVALUE: 'dateValue',
  },
  cobol: {
    'UPPER-CASE': 'upper', 'LOWER-CASE': 'lower', LENGTH: 'len', 'INTEGER-PART': 'trunc', INTEGER: 'floor', MOD: 'mod', REM: 'rem', NUMVAL: 'toDecimal',
    'NUMVAL-C': 'toDecimal', MAX: 'max', MIN: 'min', SQRT: 'sqrt', ABS: 'abs', 'CURRENT-DATE': 'nowText', TRIM: 'trim', substr: 'substr1',
    isNumeric: 'isNumeric', isAlphabetic: 'isAlpha', endOfFile: 'eof', sizeError: 'sizeError',
  },
  cpp: { strlen: 'len', atoi: 'toInt', atof: 'toFloat', sqrt: 'sqrt', pow: 'pow', abs: 'abs', fabs: 'abs', toupper: 'upper', tolower: 'lower', 'std::sqrt': 'sqrt', 'std::pow': 'pow', 'std::abs': 'abs' },
  java: { 'Math.abs': 'abs', 'Math.sqrt': 'sqrt', 'Math.pow': 'pow', 'Math.max': 'max', 'Math.min': 'min', 'Math.round': 'round', 'Integer.parseInt': 'toInt', 'Double.parseDouble': 'toFloat', 'String.valueOf': 'toString' },
};

const BUILTIN_TYPES = {
  len: INT, left: STR, right: STR, mid: STR, upper: STR, lower: STR, trim: STR, ltrim: STR, rtrim: STR, indexOf1: INT, replace: STR, toString: STR,
  toInt: INT, toFloat: FLT, toDecimal: DEC, format: STR, floor: INT, trunc: INT, sqrt: FLT, now: STR, nowText: STR, today: STR, isNumeric: BOOL, isAlpha: BOOL,
  ubound: INT, lbound: INT, chr: STR, ord: INT, spaces: STR, substr1: STR, eof: BOOL, sizeError: BOOL, rem: DEC, dateValue: STR,
};

const LIST_TYPES = new Set(['Vector', 'ArrayList', 'List', 'LinkedList', 'Collection', 'Stack']);
const MAP_TYPES = new Set(['Hashtable', 'HashMap', 'Map', 'TreeMap', 'Dictionary', 'Properties']);
const SB_TYPES = new Set(['StringBuffer', 'StringBuilder']);
const ITER_TYPES = new Set(['Enumeration', 'Iterator']);

function objKind(t) {
  if (!t) return null;
  if (t.t === 'string') return 'string';
  if (t.t === 'object') {
    if (LIST_TYPES.has(t.name)) return 'list';
    if (MAP_TYPES.has(t.name)) return 'map';
    if (SB_TYPES.has(t.name)) return 'sb';
    if (ITER_TYPES.has(t.name)) return 'iter';
  }
  if (isNum(t) || t.t === 'bool') return 'boxed';
  return null;
}

function javaStr(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\u0000-\u001f\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

// Splits a legacy catch parameter ("final IOException | SQLException e", "const std::exception& e",
// "...") into its exception types and variable name.
function catchParts(raw) {
  const text = String(raw ?? '')
    .replace(/\b(final|const)\s+/g, '')
    .replace(/[&*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text === '...') return { types: [], name: 'e' };
  const m = /^(.+?)\s+([A-Za-z_$][\w$]*)$/.exec(text);
  return { types: (m ? m[1] : text).split('|').map((t) => t.trim()).filter(Boolean), name: m ? m[2] : 'e' };
}

// Legacy exception types -> .NET. 'Exception' means "catches everything".
const CS_EXCEPTIONS = {
  Exception: 'Exception', Throwable: 'Exception', Error: 'Exception', exception: 'Exception', 'std::exception': 'Exception',
  RuntimeException: 'SystemException', NumberFormatException: 'FormatException', ArithmeticException: 'ArithmeticException',
  NullPointerException: 'NullReferenceException', IllegalArgumentException: 'ArgumentException', IllegalStateException: 'InvalidOperationException',
  ArrayIndexOutOfBoundsException: 'IndexOutOfRangeException', IndexOutOfBoundsException: 'ArgumentOutOfRangeException',
  StringIndexOutOfBoundsException: 'ArgumentOutOfRangeException', ClassCastException: 'InvalidCastException',
  UnsupportedOperationException: 'NotSupportedException', CloneNotSupportedException: 'NotSupportedException',
  NoSuchElementException: 'InvalidOperationException', ConcurrentModificationException: 'InvalidOperationException',
  IOException: 'System.IO.IOException', FileNotFoundException: 'System.IO.FileNotFoundException', EOFException: 'System.IO.EndOfStreamException',
  InterruptedException: 'System.Threading.ThreadInterruptedException', SQLException: 'System.Data.Common.DbException',
  'std::out_of_range': 'ArgumentOutOfRangeException', 'std::invalid_argument': 'ArgumentException', 'std::bad_alloc': 'OutOfMemoryException',
};

function formatDecimals(fmt) {
  const m = /0\.(0+)|#\.(#+)/.exec(fmt || '');
  return m ? (m[1] || m[2]).length : /^[#0,]+$/.test(fmt || '') ? 0 : null;
}

export class BasePrinter {
  constructor(unit, ctx) {
    this.unit = unit;
    this.ctx = ctx;
    this.src = unit.language;
    this.key = caseKey(unit.language);
    this.lines = [];
    this.level = 0;
    this.helpers = new Set();
    this.imports = new Set();
    this.method = null;
    this.todos = 0;
  }

  // ---- output ----
  line(s = '') {
    this.lines.push(s === '' ? '' : `${'    '.repeat(this.level)}${s}`);
  }

  indented(fn) {
    this.level += 1;
    fn();
    this.level -= 1;
  }

  todo(text) {
    this.todos += 1;
    this.line(`${this.comment} TODO(manual): ${clip(text, 110)}`);
  }

  // COBOL AT END tests the file named by READ. File I/O is left to the reviewer, so the call goes
  // to a generated stub that fails loudly instead of guessing at end-of-file.
  eofCall(fileArg) {
    this.helpers.add('endOfFile');
    return `${this.eofName}(${this.strLit(fileArg?.name || (fileArg ? exprToText(fileArg) : 'file'))})`;
  }

  get eofName() {
    return 'endOfFile';
  }

  // ---- symbols & types ----
  lookup(name) {
    const k = this.key(name);
    if (this.method?.locals.has(k)) return this.method.locals.get(k);
    if (this.method?.returnVar && k === this.key(this.method.legacy.name)) return { kind: 'local', name: this.method.returnVar, type: this.method.returns || UNK };
    return this.unit.symbols.get(k) || this.unit.symbols.get(`proc:${k}`) || null;
  }

  record(name) {
    return this.unit.records.find((r) => r.name === name) || this.unit.recordsByName.get(this.key(name)) || null;
  }

  otherUnit(typeName) {
    const u = this.ctx.units?.find((x) => x.legacyName === typeName || x.className === typeName) || null;
    if (u && u !== this.unit) (this.refs ||= new Set()).add(u);
    return u;
  }

  builtinOp(e) {
    if (e.k !== 'call') return null;
    const fn = e.fn;
    const table = BUILTINS[this.src] || {};
    let name = null;
    if (fn.k === 'id') name = fn.name;
    else if (fn.k === 'member' && fn.obj.k === 'id') name = `${fn.obj.name}.${fn.prop}`;
    if (!name) return null;
    if (this.src === 'vb6' || this.src === 'cobol') {
      if (this.lookup(name)?.kind === 'method') return null;
      return table[name.toUpperCase()] || table[name] || null;
    }
    if (fn.k === 'id' && this.lookup(name)?.kind === 'method') return null;
    return table[name] || null;
  }

  typeOf(e) {
    if (!e) return UNK;
    switch (e.k) {
      case 'num':
        return /[.eE]/.test(e.v) ? (this.src === 'cobol' ? { ...DEC, literal: true } : { ...FLT, literal: true }) : { ...INT, literal: true };
      case 'str':
        return STR;
      case 'bool':
        return BOOL;
      case 'null':
        return { t: 'null' };
      case 'id': {
        const s = this.lookup(e.name);
        if (s?.kind === 'method') return s.returns || UNK;
        return s?.type || UNK;
      }
      case 'index': {
        if (e.obj.k === 'id') {
          // COBOL: WS-EMP-NAME(I) subscripts the enclosing OCCURS group; the field keeps its own PIC type.
          const s = this.lookup(e.obj.name);
          if (s?.path && !s.path[s.path.length - 1].occurs) return s.type || UNK;
        }
        const t = this.typeOf(e.obj);
        if (t.t === 'array') return t.elem || UNK;
        if (t.t === 'string') return STR;
        return UNK;
      }
      case 'member': {
        const t = this.typeOf(e.obj);
        if (t.t === 'record') return this.record(t.name)?.fieldMap.get(this.key(e.prop))?.type || UNK;
        if (t.t === 'object') {
          const other = this.otherUnit(t.name);
          const s = other?.symbols.get(caseKey(other.language)(e.prop));
          if (s) return s.type || UNK;
        }
        if (e.prop === 'length' && (t.t === 'array' || t.t === 'string')) return INT;
        return UNK;
      }
      case 'call': {
        const op = this.builtinOp(e);
        if (op) return BUILTIN_TYPES[op] || (['abs', 'round', 'max', 'min', 'mod'].includes(op) ? this.typeOf(e.args[0]) : UNK);
        if (e.fn.k === 'id') {
          const s = this.lookup(e.fn.name);
          if (s?.kind === 'method') return s.returns || UNK;
          if (s?.type?.t === 'array') return s.type.elem || UNK;
          return UNK;
        }
        if (e.fn.k === 'member') {
          const recvT = this.typeOf(e.fn.obj);
          const m = e.fn.prop;
          if (m === 'append' && objKind(recvT) === 'sb') return recvT;
          if (['doubleValue', 'floatValue'].includes(m)) return FLT;
          if (['intValue', 'size', 'length', 'indexOf'].includes(m)) return INT;
          if (m === 'longValue') return LONG;
          if (['toString', 'substring', 'toUpperCase', 'toLowerCase', 'trim'].includes(m)) return STR;
          if (['equals', 'hasMoreElements', 'hasNext', 'isEmpty', 'containsKey', 'contains'].includes(m)) return BOOL;
          if (recvT.t === 'object') {
            const other = this.otherUnit(recvT.name);
            const s = other?.symbols.get(`proc:${caseKey(other.language)(m)}`);
            if (s) return s.returns || UNK;
          }
          return e.cast ? this.castType(e.cast) : UNK;
        }
        return UNK;
      }
      case 'new':
        return { t: 'object', name: e.type };
      case 'bin':
        return this.binType(e);
      case 'un':
        return e.op === 'not' ? BOOL : this.typeOf(e.e);
      case 'cond':
        return this.typeOf(e.then);
      default:
        return UNK;
    }
  }

  castType(cast) {
    if (/^(Double|double|float|Float)$/.test(cast)) return FLT;
    if (/^(Integer|int|short|long|Long)$/.test(cast)) return INT;
    if (/^String$/.test(cast)) return STR;
    return UNK;
  }

  binType(e) {
    if (['==', '!=', '<', '<=', '>', '>=', 'and', 'or'].includes(e.op)) return BOOL;
    if (e.op === 'concat') return STR;
    const l = this.typeOf(e.l);
    const r = this.typeOf(e.r);
    if (e.op === '+' && (l.t === 'string' || r.t === 'string')) return STR;
    if (e.op === 'idiv') return INT;
    const ts = [l.t, r.t].filter((t) => t !== 'unknown');
    if (!ts.length) return UNK;
    if (e.op === 'div') {
      if (ts.includes('float')) return FLT;
      return this.src === 'cobol' || ts.includes('decimal') ? DEC : FLT;
    }
    if (e.op === 'cdiv' && ts.every((t) => t === 'int' || t === 'long')) return ts.includes('long') ? LONG : INT;
    if (e.op === 'pow') return ts.includes('decimal') ? DEC : FLT;
    if (ts.includes('float')) return FLT;
    if (ts.includes('decimal')) return DEC;
    if (ts.includes('long')) return LONG;
    if (ts.every((t) => t === 'int')) return INT;
    return UNK;
  }

  // ---- expressions ----
  prec(e) {
    if (e?.k === 'bin') return PREC[e.op] ?? 5;
    if (e?.k === 'cond') return 0;
    if (e?.k === 'un') return 8;
    return 10;
  }

  sub(e, parentPrec, right = false) {
    const code = this.expr(e);
    const p = this.prec(e);
    return p < parentPrec || (right && p === parentPrec && p < 10) ? `(${code})` : code;
  }

  expr(e) {
    if (!e) return this.nullLit();
    switch (e.k) {
      case 'num':
        return this.numLit(e.v, this.typeOf(e));
      case 'str':
        return this.strLit(e.v);
      case 'bool':
        return e.v ? this.trueLit : this.falseLit;
      case 'null':
        return this.nullLit();
      case 'default':
        return this.nullLit();
      case 'id':
        return this.idRef(e);
      case 'index':
        return this.indexRef(e);
      case 'member':
        return this.memberRef(e);
      case 'call':
        return this.callExpr(e);
      case 'new':
        return this.newExpr(e);
      case 'bin':
        return this.binExpr(e);
      case 'un':
        if (e.op === 'not') return this.notExpr(e.e);
        if (e.op === 'neg') return this.negExpr(e.e);
        return this.expr(e.e);
      case 'cond':
        return this.condExpr(e);
      case 'raw':
        this.rawUsed = true;
        return this.rawExpr(e.text);
      default:
        return this.rawExpr(exprToText(e));
    }
  }

  idRef(e) {
    const s = this.lookup(e.name);
    if (!s) {
      if (e.name === 'this' || e.name === 'Me') return this.selfRef;
      // VB6 allows argument-less builtins without parentheses (Now, Date, Timer).
      const op = this.src === 'vb6' ? BUILTINS.vb6[e.name.toUpperCase()] : null;
      if (op) return this.builtin(op, [], e);
      return e.name.replace(/[^A-Za-z0-9_.$]/g, '_');
    }
    if (s.kind === 'local') return s.name;
    if (s.kind === 'method') return this.methodRef(s.name);
    if (s.kind === 'group') return this.rawExpr(`group ${s.legacy.name}`);
    return this.pathRef(s, []);
  }

  // Walks a symbol path (fields / OCCURS steps) applying subscripts in order.
  pathRef(s, subs) {
    let code = null;
    let i = 0;
    s.path.forEach((step, n) => {
      code = n === 0 ? this.fieldRef(step.name, s) : `${code}.${step.name}`;
      if (step.occurs && i < subs.length) {
        code = `${code}[${this.indexExpr(subs[i], step.lower ?? 0)}]`;
        i += 1;
      }
    });
    for (; i < subs.length; i += 1) code = `${code}[${this.indexExpr(subs[i], 0)}]`;
    return code;
  }

  indexExpr(e, lower) {
    if (!lower) return this.expr(e);
    if (e.k === 'num' && /^\d+$/.test(e.v)) return String(Number(e.v) - lower);
    return `${this.sub(e, 5)} - ${lower}`;
  }

  indexRef(e) {
    if (e.obj.k === 'id') {
      const s = this.lookup(e.obj.name);
      if (s && (s.kind === 'field' || s.kind === 'const')) return this.pathRef(s, e.idx);
      if (s?.kind === 'local' && s.type?.t === 'array') return `${s.name}${e.idx.map((x) => `[${this.indexExpr(x, s.type.lower ?? 0)}]`).join('')}`;
    }
    const t = this.typeOf(e.obj);
    if (t.t === 'object' && MAP_TYPES.has(t.name)) return this.mapGet(this.expr(e.obj), this.expr(e.idx[0]));
    return `${this.sub(e.obj, 10)}${e.idx.map((x) => `[${this.expr(x)}]`).join('')}`;
  }

  memberRef(e) {
    const t = this.typeOf(e.obj);
    if (t.t === 'record') {
      const f = this.record(t.name)?.fieldMap.get(this.key(e.prop));
      return `${this.sub(e.obj, 10)}.${f ? f.name : e.prop}`;
    }
    if (e.obj.k === 'id' && (e.obj.name === 'this' || e.obj.name === 'Me')) return this.idRef({ k: 'id', name: e.prop });
    if (e.prop === 'length' && (t.t === 'array' || t.t === 'string')) return this.lenOf(this.expr(e.obj), t);
    return `${this.sub(e.obj, 10)}.${e.prop}`;
  }

  callExpr(e) {
    const op = this.builtinOp(e);
    if (op) return this.builtin(op, e.args, e);
    if (e.fn.k === 'id') {
      const s = this.lookup(e.fn.name);
      if (s?.kind === 'method') return `${this.methodRef(s.name)}(${e.args.map((a) => this.expr(a)).join(', ')})`;
      if (s && s.type?.t === 'array') return this.pathRef(s, e.args);
      return `${e.fn.name.replace(/::/g, '.')}(${e.args.map((a) => this.expr(a)).join(', ')})`;
    }
    if (e.fn.k === 'member') {
      const recvT = this.typeOf(e.fn.obj);
      const kind = objKind(recvT);
      const recv = this.sub(e.fn.obj, 10);
      const args = e.args.map((a) => this.expr(a));
      const mapped = this.libraryCall(kind, recv, e.fn.prop, args, recvT, e);
      if (mapped != null) return mapped;
      if (recvT.t === 'object') {
        const other = this.otherUnit(recvT.name);
        const s = other?.symbols.get(`proc:${caseKey(other.language)(e.fn.prop)}`);
        if (s) return `${recv}.${s.name}(${args.join(', ')})`;
      }
      if (e.fn.obj.k === 'id' && (e.fn.obj.name === 'this' || e.fn.obj.name === 'Me')) {
        const s = this.lookup(e.fn.prop);
        if (s?.kind === 'method') return `${this.methodRef(s.name)}(${args.join(', ')})`;
      }
      return `${recv}.${e.fn.prop}(${args.join(', ')})`;
    }
    return `${this.sub(e.fn, 10)}(${e.args.map((a) => this.expr(a)).join(', ')})`;
  }

  binExpr(e) {
    const p = PREC[e.op] ?? 5;
    const lt = this.typeOf(e.l);
    const rt = this.typeOf(e.r);
    const resultT = this.binType(e);
    if (['==', '!=', '<', '<=', '>', '>='].includes(e.op)) return this.compare(e.op, e.l, e.r, lt, rt);
    if (e.op === 'and' || e.op === 'or') return `${this.sub(e.l, p)} ${e.op === 'and' ? this.andOp : this.orOp} ${this.sub(e.r, p, true)}`;
    if (e.op === 'concat' || (e.op === '+' && resultT.t === 'string')) return this.concat(e.l, e.r, lt, rt);
    return this.arith(e.op, e.l, e.r, lt, rt, resultT, p);
  }

  arith(op, l, r, lt, rt, resultT, p) {
    const sym = { '+': '+', '-': '-', '*': '*', div: '/', cdiv: '/', mod: '%' }[op];
    if (op === 'idiv') return this.intDiv(this.sub(l, 6), this.sub(r, 6, true));
    if (op === 'pow') return this.power(this.expr(l), this.expr(r));
    if (!sym) return `${this.sub(l, p)} ${op} ${this.sub(r, p, true)}`;
    const lc = this.operand(l, lt, resultT, p, false);
    const rc = this.operand(r, rt, resultT, p, true);
    if (op === 'div' && resultT.t === 'float' && lt.t !== 'float' && rt.t !== 'float') return this.floatDiv(lc, rc);
    return `${lc} ${sym} ${rc}`;
  }

  operand(e, t, resultT, p, right) {
    return this.sub(e, p, right);
  }

  compare(op, l, r, lt, rt) {
    const sym = { '==': this.eqOp, '!=': this.neOp }[op] || op;
    return `${this.sub(l, 5)} ${sym} ${this.sub(r, 5, true)}`;
  }

  notExpr(e) {
    return `${this.notOp}${this.prec(e) < 8 ? `(${this.expr(e)})` : this.expr(e)}`;
  }

  negExpr(e) {
    return `-${this.prec(e) < 8 ? `(${this.expr(e)})` : this.expr(e)}`;
  }

  condExpr(e) {
    return `${this.sub(e.test, 1)} ? ${this.sub(e.then, 1)} : ${this.sub(e.else, 1)}`;
  }

  concat(l, r, lt, rt) {
    return `${this.sub(l, 5)} + ${this.sub(r, 5, true)}`;
  }

  // Converts a value of type `from` so it can be stored in a slot of type `to`.
  coerce(e, to) {
    const from = this.typeOf(e);
    if (e.k === 'default') return this.defaultValue(to);
    if (e.k === 'num' && isNum(to)) return this.numLit(e.v, to);
    return this.convert(this.expr(e), from, to, e);
  }

  convert(code) {
    return code;
  }

  // ---- COBOL storage semantics ----
  storeValue(s, targetType) {
    const legacyT = targetType;
    if (this.src === 'cobol' && legacyT?.t === 'decimal' && legacyT.scale != null) {
      const v = this.coerce(s.value, DEC);
      if (s.value.k === 'num') {
        const decimals = (s.value.v.split('.')[1] || '').length;
        if (decimals <= legacyT.scale && !s.round) return this.numLit(s.value.v, DEC);
      }
      return this.scaleCall(v, legacyT.scale, Boolean(s.round));
    }
    if (this.src === 'cobol' && (legacyT?.t === 'int' || legacyT?.t === 'long') && this.typeOf(s.value).t === 'decimal') {
      return this.toIntFromDecimal(this.scaleCall(this.coerce(s.value, DEC), 0, Boolean(s.round)));
    }
    return this.coerce(s.value, targetType || UNK);
  }

  displayArg(e) {
    const t = this.typeOf(e);
    if (this.src === 'cobol' && e.k !== 'num' && e.k !== 'str') {
      if ((t.t === 'decimal' || t.t === 'int' || t.t === 'long') && t.digits) return this.cobolNumCall(this.expr(e), t);
      if (t.t === 'string' && t.length > 1 && !t.edited) return this.padCall(this.expr(e), t.length);
    }
    return null;
  }

  printText(args, format) {
    if (format && args[0]?.k === 'str') return this.printfFormat(args[0].v, args.slice(1));
    if (!args.length) return this.strLit('');
    const parts = args.map((a) => {
      const special = this.displayArg(a);
      if (special) return { code: special, t: STR };
      return { code: null, e: a, t: this.typeOf(a) };
    });
    return this.joinText(parts);
  }

  // ---- statements (brace languages) ----
  stmts(list) {
    for (const s of list || []) this.stmt(s);
  }

  stmt(s) {
    switch (s.k) {
      case 'assign':
        return this.assignStmt(s);
      case 'decl':
        return this.declStmt(s);
      case 'if':
        return this.ifStmt(s);
      case 'while':
        return this.whileStmt(s);
      case 'for':
        return this.forStmt(s);
      case 'foreach':
        return this.foreachStmt(s);
      case 'repeat':
        return this.repeatStmt(s);
      case 'switch':
        return this.switchStmt(s);
      case 'call':
        return this.callStmt(s);
      case 'exprstmt':
        return this.exprStmt(s);
      case 'print':
        return this.line(`${this.printStmt(this.printText(s.args, s.format), s.newline)}${this.semi}`);
      case 'input':
        return this.inputStmt(s);
      case 'io':
        return this.todo(`${s.text || `${s.op} ${s.file}`} (file I/O: map to the target's file or database API)`);
      case 'return':
        return this.returnStmt(s);
      case 'exit':
        return this.exitStmt(s);
      case 'continue':
        return this.line(`continue${this.semi}`);
      case 'goto':
        return this.gotoStmt(s);
      case 'label':
        return this.line(`${this.comment} label ${s.name}:`);
      case 'try':
        return this.tryStmt(s);
      case 'throw':
        return this.line(`throw ${s.value ? this.expr(s.value) : this.newError('"error"')}${this.semi}`);
      case 'block':
        if (s.note) this.line(`${this.comment} ${s.note}`);
        return this.blockStmt(s);
      case 'noop':
        if (s.note) this.line(`${this.comment} ${s.verb}: ${s.note}`);
        return undefined;
      case 'raw':
        return this.todo(`${s.text || s.verb}${s.note ? ` — ${s.note}` : ''}`);
      default:
        return this.todo(s.text || s.k);
    }
  }

  blockStmt(s) {
    this.stmts(s.body);
  }

  targetType(target) {
    return this.typeOf(target);
  }

  lvalue(target) {
    return this.expr(target);
  }

  assignStmt(s) {
    const t = this.targetType(s.target);
    if (s.target.k === 'id' || s.target.k === 'index' || s.target.k === 'member') {
      if (s.value.k === 'default') {
        return this.line(`${this.lvalue(s.target)} = ${this.defaultValue(t)}${this.semi}`);
      }
      const value = this.storeValue(s, t);
      this.line(`${this.lvalue(s.target)} = ${value}${this.semi}`);
      return undefined;
    }
    return this.todo(`assignment to ${exprToText(s.target)}`);
  }

  callStmt(s) {
    const sym = this.lookup(s.callee);
    const args = s.args.map((a) => this.expr(a));
    if (sym?.kind === 'method') {
      if (s.thru) this.line(`${this.comment} PERFORM ${s.callee} THRU ${s.thru}`);
      this.line(`${this.methodRef(sym.name)}(${args.join(', ')})${this.semi}`);
      if (s.thru) {
        const methods = this.unit.methods;
        const from = methods.findIndex((m) => m.name === sym.name);
        const to = methods.findIndex((m) => this.key(m.legacy.name) === this.key(s.thru));
        for (let k = from + 1; k <= to && k > 0; k += 1) this.line(`${this.methodRef(methods[k].name)}()${this.semi}`);
      }
      return undefined;
    }
    if (s.external) {
      this.todo(`CALL ${s.callee}${args.length ? ` USING ${args.join(', ')}` : ''} — external program; wire to its modern counterpart`);
      return undefined;
    }
    const op = BUILTINS[this.src]?.[this.src === 'vb6' ? s.callee.toUpperCase() : s.callee];
    if (op) return this.line(`${this.builtin(op, s.args, s)}${this.semi}`);
    return this.line(`${s.callee.replace(/::/g, '.')}(${args.join(', ')})${this.semi}`);
  }

  exprStmt(s) {
    const e = s.expr;
    if (e.k === 'call' && e.fn.k === 'member') {
      const recvT = this.typeOf(e.fn.obj);
      if (objKind(recvT) === 'map' && e.fn.prop === 'put' && e.args.length === 2) {
        return this.line(`${this.mapPutStmt(this.sub(e.fn.obj, 10), this.expr(e.args[0]), this.expr(e.args[1]))}${this.semi}`);
      }
    }
    if (e.k === 'index' && e.obj.k === 'id') return this.line(`${this.comment} ${exprToText(e)}`);
    return this.line(`${this.expr(e)}${this.semi}`);
  }

  returnStmt(s) {
    if (s.verb === 'RETURN' && s.note === 'Return from GoSub') return this.todo('Return from GoSub');
    if (this.method?.returnVar && !s.value) return this.line(`return ${this.method.returnVar}${this.semi}`);
    if (!s.value) return this.line(`return${this.semi}`);
    const rt = this.method?.returns;
    return this.line(`return ${rt ? this.coerce(s.value, rt) : this.expr(s.value)}${this.semi}`);
  }

  exitStmt(s) {
    if (s.scope === 'loop') return this.line(`break${this.semi}`);
    if (s.scope === 'procedure') return this.line(this.method?.returnVar ? `return ${this.method.returnVar}${this.semi}` : `return${this.semi}`);
    // STOP RUN / GOBACK / End
    if (this.unit.usesStopRun) return this.line(`${this.throwStopRun()}${this.semi} ${this.comment} ${s.verb || 'STOP RUN'}`);
    return this.line(`return${this.semi} ${this.comment} ${s.verb || 'STOP RUN'}`);
  }

  gotoStmt(s) {
    const sym = this.lookup(s.label);
    if (sym?.kind === 'method') {
      this.line(`${this.comment} GO TO ${s.label}: approximated as call + return; restructure this control flow`);
      this.line(`${this.methodRef(sym.name)}()${this.semi}`);
      this.line(`return${this.semi}`);
      this.todos += 1;
      return undefined;
    }
    return this.todo(`GO TO ${s.label}`);
  }

  inputStmt(s) {
    if (!s.target) return this.todo('ACCEPT without target');
    if (/DATE|TIME|DAY/.test(s.source || '')) return this.line(`${this.lvalue(s.target)} = ${this.coerce({ k: 'call', fn: { k: 'id', name: 'CURRENT-DATE' }, args: [], intrinsic: true }, this.typeOf(s.target))}${this.semi} ${this.comment} ACCEPT FROM ${s.source}`);
    return this.line(`${this.lvalue(s.target)} = ${this.readLine(this.typeOf(s.target))}${this.semi}`);
  }

  // Loop helpers
  forParts(s) {
    return {
      init: s.init.map((x) => this.inlineStmt(x)).filter(Boolean).join(', '),
      cond: s.cond ? this.expr(s.cond) : this.trueLit,
      update: s.update.map((x) => this.inlineStmt(x)).filter(Boolean).join(', '),
    };
  }

  inlineStmt(x) {
    if (x.k === 'assign') return `${this.lvalue(x.target)} = ${this.storeValue(x, this.targetType(x.target))}`;
    if (x.k === 'decl') return this.inlineDecl(x);
    if (x.k === 'exprstmt') return this.expr(x.expr);
    return null;
  }

  // Emits a method body, adding the VB6 function-result variable when needed.
  body(m) {
    this.method = m;
    if (m.returnVar) this.line(this.localDecl(m.returnVar, m.returns, this.defaultValue(m.returns)));
    this.stmts(m.legacy.body);
    if (m.returnVar) this.line(`return ${m.returnVar}${this.semi}`);
    this.method = null;
  }

  fieldComment(f) {
    return f.comment ? ` ${this.comment} ${clip(f.comment, 70)}` : '';
  }
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

export class JavaPrinter extends BasePrinter {
  constructor(unit, ctx) {
    super(unit, ctx);
    this.comment = '//';
    this.semi = ';';
    this.trueLit = 'true';
    this.falseLit = 'false';
    this.andOp = '&&';
    this.orOp = '||';
    this.notOp = '!';
    this.eqOp = '==';
    this.neOp = '!=';
    this.selfRef = 'this';
    this.loops = [];
    this.loopLabels = 0;
  }

  // A legacy loop exit (VB6 Exit For/Do, COBOL EXIT PERFORM) inside a printed switch would only
  // leave the switch, so the enclosing loop gets a label to exit through.
  stmt(s) {
    if (LOOP_KINDS.has(s.k)) {
      const frame = { switches: 0, label: null };
      this.loops.push(frame);
      const start = this.lines.length;
      super.stmt(s);
      this.loops.pop();
      if (frame.label) this.labelLoop(start, frame.label);
      return undefined;
    }
    const frame = this.loops[this.loops.length - 1];
    if (s.k === 'switch' && frame && this.switchable(s)) {
      frame.switches += 1;
      super.stmt(s);
      frame.switches -= 1;
      return undefined;
    }
    return super.stmt(s);
  }

  exitStmt(s) {
    const frame = this.loops[this.loops.length - 1];
    if (s.scope === 'loop' && frame?.switches) {
      if (!frame.label) {
        this.loopLabels += 1;
        frame.label = `outerLoop${this.loopLabels}`;
      }
      return this.line(this.breakTo(frame.label));
    }
    return super.exitStmt(s);
  }

  breakTo(label) {
    return `break ${label};`;
  }

  labelLoop(start, label) {
    this.lines[start] = this.lines[start].replace(/^(\s*)/, `$1${label}: `);
  }

  nullLit() {
    return 'null';
  }

  numLit(v, t) {
    if (t?.t === 'decimal') {
      this.imports.add('java.math.BigDecimal');
      if (/^-?\d+$/.test(v)) return v === '0' ? 'BigDecimal.ZERO' : v === '1' ? 'BigDecimal.ONE' : `BigDecimal.valueOf(${v})`;
      return `new BigDecimal("${v}")`;
    }
    if (t?.t === 'long') return `${v}L`;
    if (t?.t === 'float' && /^-?\d+$/.test(v)) return `${v}.0`;
    return v;
  }

  strLit(v) {
    return javaStr(v);
  }

  rawExpr(text) {
    this.todos += 1;
    return `/* TODO: ${text.replace(/\*\//g, '* /')} */ null`;
  }

  typeName(t, boxed = false) {
    if (!t) return 'Object';
    const legacyBoxed = this.src === 'java' && /^(Double|Integer|Long|Boolean|Float|Short|Character)$/.test(t.legacy || '');
    switch (t.t) {
      case 'int':
        return legacyBoxed || boxed ? 'Integer' : 'int';
      case 'long':
        return legacyBoxed || boxed ? 'Long' : 'long';
      case 'decimal':
        this.imports.add('java.math.BigDecimal');
        return 'BigDecimal';
      case 'float':
        return legacyBoxed || boxed ? 'Double' : 'double';
      case 'string':
        return 'String';
      case 'bool':
        return legacyBoxed || boxed ? 'Boolean' : 'boolean';
      case 'date':
        this.imports.add('java.time.LocalDate');
        return 'LocalDate';
      case 'array':
        return `${this.typeName(t.elem)}[]`;
      case 'record':
        return t.name;
      case 'object': {
        const kind = objKind(t);
        if (kind === 'list') {
          this.imports.add('java.util.List');
          return 'List<Object>';
        }
        if (kind === 'map') {
          this.imports.add('java.util.Map');
          return 'Map<Object, Object>';
        }
        if (kind === 'sb') return 'StringBuilder';
        if (kind === 'iter') {
          this.imports.add('java.util.Iterator');
          return 'Iterator<Object>';
        }
        return this.otherUnit(t.name)?.className || t.name || 'Object';
      }
      default:
        return 'Object';
    }
  }

  defaultValue(t) {
    switch (t?.t) {
      case 'int':
        return '0';
      case 'long':
        return '0L';
      case 'decimal':
        this.imports.add('java.math.BigDecimal');
        return 'BigDecimal.ZERO';
      case 'float':
        return '0.0';
      case 'string':
        return '""';
      case 'bool':
        return 'false';
      case 'record':
        return `new ${t.name}()`;
      case 'array': {
        if (t.length == null) return 'null';
        const elem = t.elem;
        if (['int', 'long', 'float', 'bool'].includes(elem?.t)) return `new ${this.typeName(elem)}[${t.length}]`;
        this.imports.add('java.util.stream.Stream');
        return `Stream.generate(() -> ${this.defaultValue(elem)}).limit(${t.length}).toArray(${this.typeName(elem)}[]::new)`;
      }
      default:
        return 'null';
    }
  }

  fieldRef(name, s) {
    if (s.kind === 'const') return name;
    return name;
  }

  methodRef(name) {
    return name;
  }

  lenOf(code, t) {
    return t.t === 'array' ? `${code}.length` : `${code}.length()`;
  }

  convert(code, from, to, e) {
    if (to.t === 'decimal' && from.t !== 'decimal' && from.t !== 'unknown' && from.t !== 'null') {
      this.imports.add('java.math.BigDecimal');
      return `BigDecimal.valueOf(${code})`;
    }
    if ((to.t === 'float') && from.t === 'decimal') return `${this.wrapCall(code)}.doubleValue()`;
    if ((to.t === 'int') && from.t === 'decimal') return `${this.wrapCall(code)}.intValue()`;
    if ((to.t === 'int') && from.t === 'float') return `(int) (${code})`;
    if ((to.t === 'long') && from.t === 'decimal') return `${this.wrapCall(code)}.longValue()`;
    if (to.t === 'string' && from.t !== 'string' && from.t !== 'unknown' && from.t !== 'null') return `String.valueOf(${code})`;
    return code;
  }

  // Parenthesise unless the code is already a primary: a name followed by .member, [index] or (args).
  wrapCall(code) {
    return /^[\w$]+(?:\.[\w$]+|\[[^[\]]*\]|\((?:[^()]|\([^()]*\))*\))*$/.test(code) ? code : `(${code})`;
  }

  toBig(e) {
    this.imports.add('java.math.BigDecimal');
    const t = this.typeOf(e);
    if (e.k === 'num') return this.numLit(e.v, DEC);
    if (t.t === 'decimal') return this.expr(e);
    if (t.t === 'unknown') return `new BigDecimal(String.valueOf(${this.expr(e)}))`;
    return `BigDecimal.valueOf(${this.expr(e)})`;
  }

  arith(op, l, r, lt, rt, resultT, p) {
    if (resultT.t === 'decimal') {
      const method = { '+': 'add', '-': 'subtract', '*': 'multiply', mod: 'remainder' }[op];
      if (method) return `${this.wrapCall(this.toBig(l))}.${method}(${this.toBig(r)})`;
      if (op === 'div' || op === 'cdiv') {
        this.imports.add('java.math.MathContext');
        return `${this.wrapCall(this.toBig(l))}.divide(${this.toBig(r)}, MathContext.DECIMAL128)`;
      }
      if (op === 'pow') return `${this.wrapCall(this.toBig(l))}.pow(${this.expr(r)})`;
    }
    if (resultT.t === 'float' && (lt.t === 'decimal' || rt.t === 'decimal')) {
      const side = (e, t) => (t.t === 'decimal' ? `${this.wrapCall(this.expr(e))}.doubleValue()` : this.sub(e, PREC[op] ?? 5));
      const sym = { '+': '+', '-': '-', '*': '*', div: '/', cdiv: '/', mod: '%' }[op];
      if (sym) return `${side(l, lt)} ${sym} ${side(r, rt)}`;
    }
    return super.arith(op, l, r, lt, rt, resultT, p);
  }

  negExpr(e) {
    if (this.typeOf(e).t === 'decimal') return `${this.wrapCall(this.expr(e))}.negate()`;
    return super.negExpr(e);
  }

  compare(op, l, r, lt, rt) {
    if (lt.t === 'decimal' || rt.t === 'decimal') {
      return `${this.wrapCall(this.toBig(l))}.compareTo(${this.toBig(r)}) ${op} 0`;
    }
    if ((lt.t === 'string' || rt.t === 'string') && (op === '==' || op === '!=') && l.k !== 'null' && r.k !== 'null') {
      this.imports.add('java.util.Objects');
      return `${op === '!=' ? '!' : ''}Objects.equals(${this.expr(l)}, ${this.expr(r)})`;
    }
    return super.compare(op, l, r, lt, rt);
  }

  intDiv(l, r) {
    return `(int) (${l} / ${r})`;
  }

  floatDiv(l, r) {
    return `(double) ${l} / ${r}`;
  }

  power(l, r) {
    return `Math.pow(${l}, ${r})`;
  }

  concat(l, r) {
    return `${this.concatPart(l)} + ${this.concatPart(r, true)}`;
  }

  concatPart(e, right = false) {
    const t = this.typeOf(e);
    const code = this.sub(e, 5, right);
    if (t.t === 'decimal') return `${this.wrapCall(code)}.toPlainString()`;
    return code;
  }

  joinText(parts) {
    const codes = parts.map((p, i) => {
      if (p.code) return p.code;
      const code = this.sub(p.e, 5, i > 0);
      if (p.t.t === 'decimal') return `${this.wrapCall(code)}.toPlainString()`;
      return code;
    });
    if (parts.length === 1 && parts[0].t.t !== 'string' && !parts[0].code) return `String.valueOf(${codes[0]})`;
    if (parts[0].t.t !== 'string' && !parts[0].code && parts.length > 1) codes[0] = `"" + ${codes[0]}`;
    return codes.join(' + ');
  }

  printfFormat(fmt, args) {
    return `String.format(${javaStr(fmt)}${args.map((a) => `, ${this.expr(a)}`).join('')})`;
  }

  printStmt(text, newline) {
    return `out.${newline ? 'println' : 'print'}(${text})`;
  }

  readLine(t) {
    this.imports.add('java.util.Scanner');
    const read = 'new Scanner(System.in).nextLine()';
    if (t.t === 'int') return `Integer.parseInt(${read}.trim())`;
    if (t.t === 'decimal') return `new BigDecimal(${read}.trim())`;
    if (t.t === 'float') return `Double.parseDouble(${read}.trim())`;
    return read;
  }

  mapGet(obj, k) {
    return `${obj}.get(${k})`;
  }

  mapPutStmt(obj, k, v) {
    return `${obj}.put(${k}, ${v})`;
  }

  libraryCall(kind, recv, m, args) {
    if (kind === 'list') {
      if (m === 'addElement') return `${recv}.add(${args.join(', ')})`;
      if (m === 'elementAt') return `${recv}.get(${args[0]})`;
      if (m === 'removeElement') return `${recv}.remove(${args[0]})`;
      if (m === 'elements') return `${recv}.iterator()`;
    }
    if (kind === 'map' && m === 'elements') return `${recv}.values().iterator()`;
    if (kind === 'map' && m === 'keys') return `${recv}.keySet().iterator()`;
    if (kind === 'iter' && m === 'hasMoreElements') return `${recv}.hasNext()`;
    if (kind === 'iter' && m === 'nextElement') return `${recv}.next()`;
    return null;
  }

  newExpr(e) {
    const args = e.args.map((a) => this.expr(a));
    if (LIST_TYPES.has(e.type)) {
      this.imports.add('java.util.ArrayList');
      return 'new ArrayList<>()';
    }
    if (MAP_TYPES.has(e.type)) {
      this.imports.add('java.util.HashMap');
      return 'new HashMap<>()';
    }
    if (SB_TYPES.has(e.type)) return `new StringBuilder(${args.join(', ')})`;
    if (['Double', 'Integer', 'Long', 'Boolean', 'Float'].includes(e.type)) {
      const t = this.typeOf(e.args[0]);
      if (e.type === 'Double' && t.t === 'int' && e.args[0].k === 'num') return `Double.valueOf(${e.args[0].v}.0)`;
      return `${e.type}.valueOf(${args.join(', ')})`;
    }
    const other = this.otherUnit(e.type);
    return `new ${other?.className || this.record(e.type)?.name || e.type}(${args.join(', ')})`;
  }

  callExpr(e) {
    if (e.cast && /^[A-Z]\w*$/.test(e.cast) && this.src === 'java') return `((${e.cast}) ${super.callExpr(e)})`;
    return super.callExpr(e);
  }

  builtin(op, args, e) {
    if (op === 'eof') return this.eofCall(args[0]);
    const a = args.map((x) => this.expr(x));
    switch (op) {
      case 'len':
        return `${this.wrapCall(a[0])}.length()`;
      case 'upper':
        return `${this.wrapCall(a[0])}.toUpperCase()`;
      case 'lower':
        return `${this.wrapCall(a[0])}.toLowerCase()`;
      case 'trim':
        return `${this.wrapCall(a[0])}.strip()`;
      case 'ltrim':
        return `${this.wrapCall(a[0])}.stripLeading()`;
      case 'rtrim':
        return `${this.wrapCall(a[0])}.stripTrailing()`;
      case 'left':
        return `${this.wrapCall(a[0])}.substring(0, ${a[1]})`;
      case 'right':
        return `${this.wrapCall(a[0])}.substring(${this.wrapCall(a[0])}.length() - ${a[1]})`;
      case 'mid':
        return a[2] ? `${this.wrapCall(a[0])}.substring(${a[1]} - 1, ${a[1]} - 1 + ${a[2]})` : `${this.wrapCall(a[0])}.substring(${a[1]} - 1)`;
      case 'substr1':
        return a[2] ? `${this.wrapCall(a[0])}.substring(${a[1]} - 1, ${a[1]} - 1 + ${a[2]})` : `${this.wrapCall(a[0])}.substring(${a[1]} - 1)`;
      case 'indexOf1':
        return `${this.wrapCall(a[a.length - 1 > 1 ? 1 : 0])}.indexOf(${a[a.length - 1]}) + 1`;
      case 'replace':
        return `${this.wrapCall(a[0])}.replace(${a[1]}, ${a[2]})`;
      case 'toString':
        return `String.valueOf(${a[0]})`;
      case 'toInt':
        return this.typeOf(args[0]).t === 'string' ? `Integer.parseInt(${a[0]}.trim())` : `(int) (${a[0]})`;
      case 'toFloat':
        return this.typeOf(args[0]).t === 'string' ? `Double.parseDouble(${a[0]}.trim())` : `(double) (${a[0]})`;
      case 'toDecimal':
        this.imports.add('java.math.BigDecimal');
        return this.typeOf(args[0]).t === 'string' ? `new BigDecimal(${a[0]}.trim())` : this.toBig(args[0]);
      case 'format': {
        const d = args[1]?.k === 'str' ? formatDecimals(args[1].v) : null;
        return d != null ? `String.format("%.${d}f", ${a[0]})` : `String.valueOf(${a[0]})`;
      }
      case 'abs':
        return this.typeOf(args[0]).t === 'decimal' ? `${this.wrapCall(a[0])}.abs()` : `Math.abs(${a[0]})`;
      case 'floor':
        return `(int) Math.floor(${this.typeOf(args[0]).t === 'decimal' ? `${this.wrapCall(a[0])}.doubleValue()` : a[0]})`;
      case 'trunc':
        return this.typeOf(args[0]).t === 'decimal' ? `${this.wrapCall(a[0])}.intValue()` : `(int) (${a[0]})`;
      case 'round':
        return `Math.round(${a[0]})`;
      case 'sqrt':
        return `Math.sqrt(${a[0]})`;
      case 'pow':
        return `Math.pow(${a[0]}, ${a[1]})`;
      case 'max':
      case 'min':
        return a.slice(1).reduce((acc, x) => `Math.${op}(${acc}, ${x})`, a[0]);
      case 'mod':
      case 'rem':
        return `${this.wrapCall(this.toBig(args[0]))}.remainder(${this.toBig(args[1])})`;
      case 'now':
      case 'nowText':
      case 'today':
        this.imports.add('java.time.LocalDateTime');
        return 'LocalDateTime.now().toString()';
      case 'isNumeric':
        return `${this.wrapCall(a[0])}.toString().strip().matches("-?\\\\d+(\\\\.\\\\d+)?")`;
      case 'isAlpha':
        return `${this.wrapCall(a[0])}.matches("[A-Za-z ]*")`;
      case 'ubound':
        return `${this.wrapCall(a[0])}.length - 1`;
      case 'lbound':
        return '0';
      case 'chr':
        return `String.valueOf((char) ${a[0]})`;
      case 'ord':
        return `(int) ${this.wrapCall(a[0])}.charAt(0)`;
      case 'spaces':
        return `" ".repeat(${a[0]})`;
      case 'sizeError':
        return 'false /* ON SIZE ERROR: add an explicit range check */';
      default:
        return `${op}(${a.join(', ')})`;
    }
  }

  scaleCall(code, scale, round) {
    this.helpers.add('scale');
    return `scale(${code}, ${scale}, ${round})`;
  }

  toIntFromDecimal(code) {
    return `${code}.intValue()`;
  }

  cobolNumCall(code, t) {
    this.helpers.add('cobolNum');
    return `cobolNum(${t.t === 'decimal' ? code : `BigDecimal.valueOf(${code})`}, ${t.digits}, ${t.scale || 0})`;
  }

  padCall(code, n) {
    this.helpers.add('pad');
    return `pad(${code}, ${n})`;
  }

  throwStopRun() {
    return 'throw new StopRun()';
  }

  newError(msg) {
    return `new RuntimeException(${msg})`;
  }

  localDecl(name, type, init) {
    return `${this.typeName(type)} ${name} = ${init};`;
  }

  inlineDecl(x) {
    const s = this.method?.locals.get(this.key(x.name));
    return `${this.typeName(x.type)} ${s?.name || x.name} = ${x.init ? this.coerce(x.init, x.type) : this.defaultValue(x.type)}`;
  }

  declStmt(s) {
    const local = this.method?.locals.get(this.key(s.name));
    const name = local?.name || s.name;
    if (s.redim) return this.line(`${name} = ${this.defaultValue(s.type)};${s.preserve ? ' // TODO: ReDim Preserve keeps existing elements' : ''}`);
    const init = s.init ? this.coerce(s.init, s.type) : this.defaultValue(s.type);
    return this.line(`${s.isConst ? 'final ' : ''}${this.typeName(s.type)} ${name} = ${init};`);
  }

  ifStmt(s, elseIf = false) {
    this.line(`${elseIf ? '} else ' : ''}if (${this.expr(s.cond)}) {`);
    this.indented(() => this.stmts(s.then));
    if (s.else && s.else.length === 1 && s.else[0].k === 'if') return this.ifStmt(s.else[0], true);
    if (s.else && s.else.length) {
      this.line('} else {');
      this.indented(() => this.stmts(s.else));
    }
    return this.line('}');
  }

  whileStmt(s) {
    if (s.testAfter) {
      this.line('do {');
      this.indented(() => this.stmts(s.body));
      return this.line(`} while (${this.expr(s.cond)});`);
    }
    this.line(`while (${this.expr(s.cond)}) {`);
    this.indented(() => this.stmts(s.body));
    return this.line('}');
  }

  forStmt(s) {
    const { init, cond, update } = this.forParts(s);
    this.line(`for (${init}; ${cond}; ${update}) {`);
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }

  foreachStmt(s) {
    const local = this.method?.locals.get(this.key(s.varName));
    this.line(`for (var ${local?.name || s.varName} : ${this.expr(s.iter)}) {`);
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }

  repeatStmt(s) {
    const v = `i${this.level}`;
    this.line(`for (int ${v} = 0; ${v} < ${this.coerce(s.count, INT)}; ${v}++) {`);
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }

  switchable(s) {
    if (!s.subject) return false;
    const t = this.typeOf(s.subject);
    if (!['int', 'string'].includes(t.t)) return false;
    return s.cases.every((c) => c.tests.every((x) => x.kind === 'value' && (x.value.k === 'num' || x.value.k === 'str')));
  }

  caseCond(subject, test) {
    switch (test.kind) {
      case 'value':
        return { k: 'bin', op: '==', l: subject, r: test.value };
      case 'range':
        return { k: 'bin', op: 'and', l: { k: 'bin', op: '>=', l: subject, r: test.from }, r: { k: 'bin', op: '<=', l: subject, r: test.to } };
      case 'cmp':
        return { k: 'bin', op: test.op, l: subject, r: test.value };
      case 'cond':
        return test.cond;
      default:
        return { k: 'bool', v: true };
    }
  }

  switchToIf(s) {
    const branches = s.cases.map((c) => ({ cond: c.tests.map((t) => this.caseCond(s.subject, t)).reduce((a, b) => ({ k: 'bin', op: 'or', l: a, r: b })), body: c.body }));
    let chain = s.default && s.default.length ? s.default : null;
    for (let i = branches.length - 1; i >= 0; i -= 1) {
      chain = [{ k: 'if', cond: branches[i].cond, then: branches[i].body, else: chain, line: s.line }];
    }
    if (chain) this.stmts(chain);
  }

  switchStmt(s) {
    if (!this.switchable(s)) return this.switchToIf(s);
    this.line(`switch (${this.expr(s.subject)}) {`);
    this.indented(() => {
      for (const c of s.cases) {
        this.line(`case ${c.tests.map((t) => this.expr(t.value)).join(', ')} -> {`);
        this.indented(() => this.stmts(c.body));
        this.line('}');
      }
      if (s.default) {
        this.line('default -> {');
        this.indented(() => this.stmts(s.default));
        this.line('}');
      }
    });
    return this.line('}');
  }

  tryStmt(s) {
    this.line('try {');
    this.indented(() => this.stmts(s.body));
    for (const h of s.handlers) {
      const { types, name } = catchParts(h.type);
      // Java keeps its own (multi-)catch types; C/C++ exception types have no Java equivalent.
      const type = this.src === 'java' && types.length ? types.join(' | ') : 'Exception';
      this.line(`} catch (${type} ${name}) {`);
      this.indented(() => this.stmts(h.body));
    }
    if (s.finally) {
      this.line('} finally {');
      this.indented(() => this.stmts(s.finally));
    }
    if (!s.handlers.length && !s.finally) this.line('} finally {');
    this.line('}');
  }

  blockStmt(s) {
    if (s.verb === 'SYNCHRONIZED') {
      this.line('synchronized (this) {');
      this.indented(() => this.stmts(s.body));
      return this.line('}');
    }
    return this.stmts(s.body);
  }
}

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

export class CSharpPrinter extends JavaPrinter {
  constructor(unit, ctx) {
    super(unit, ctx);
    this.selfRef = 'this';
  }

  get eofName() {
    return 'EndOfFile';
  }

  // C# has no labeled break: jump to a label placed right after the loop.
  breakTo(label) {
    return `goto ${label}End;`;
  }

  labelLoop(start, label) {
    this.line(`${label}End: ;`);
  }

  numLit(v, t) {
    if (t?.t === 'decimal') return `${v}m`;
    if (t?.t === 'long') return `${v}L`;
    if (t?.t === 'float' && /^-?\d+$/.test(v)) return `${v}.0`;
    return v;
  }

  typeName(t) {
    if (!t) return 'object';
    const nullable = this.src === 'java' && /^(Double|Integer|Long|Boolean|Float)$/.test(t.legacy || '') ? '?' : '';
    switch (t.t) {
      case 'int':
        return `int${nullable}`;
      case 'long':
        return `long${nullable}`;
      case 'decimal':
        return 'decimal';
      case 'float':
        return `double${nullable}`;
      case 'string':
        return 'string';
      case 'bool':
        return `bool${nullable}`;
      case 'date':
        return 'DateTime';
      case 'array':
        return `${this.typeName(t.elem)}[]`;
      case 'record':
        return t.name;
      case 'object': {
        const kind = objKind(t);
        if (kind === 'list') return 'List<object>';
        if (kind === 'map') return 'Dictionary<object, object>';
        if (kind === 'sb') return 'StringBuilder';
        if (kind === 'iter') {
          this.helpers.add('enumeration');
          return 'LegacyEnumeration';
        }
        return this.otherUnit(t.name)?.className || t.name || 'object';
      }
      default:
        return 'object';
    }
  }

  defaultValue(t) {
    switch (t?.t) {
      case 'int':
        return '0';
      case 'long':
        return '0L';
      case 'decimal':
        return '0m';
      case 'float':
        return '0.0';
      case 'string':
        return '""';
      case 'bool':
        return 'false';
      case 'date':
        return 'DateTime.MinValue';
      case 'record':
        return `new ${t.name}()`;
      case 'array':
        if (t.length == null) return `Array.Empty<${this.typeName(t.elem)}>()`;
        if (['int', 'long', 'float', 'bool', 'decimal'].includes(t.elem?.t)) return `new ${this.typeName(t.elem)}[${t.length}]`;
        return `Enumerable.Range(0, ${t.length}).Select(_ => ${this.defaultValue(t.elem)}).ToArray()`;
      default:
        return 'null';
    }
  }

  rawExpr(text) {
    this.todos += 1;
    return `default /* TODO: ${text.replace(/\*\//g, '* /')} */`;
  }

  lenOf(code, t) {
    return `${code}.Length`;
  }

  convert(code, from, to) {
    if (to.t === 'decimal' && (from.t === 'float')) return `(decimal) ${this.wrapCall(code)}`;
    if (to.t === 'float' && from.t === 'decimal') return `(double) ${this.wrapCall(code)}`;
    if (to.t === 'int' && (from.t === 'decimal' || from.t === 'float')) return `(int) ${this.wrapCall(code)}`;
    if (to.t === 'long' && (from.t === 'decimal' || from.t === 'float')) return `(long) ${this.wrapCall(code)}`;
    if (to.t === 'string' && from.t !== 'string' && from.t !== 'unknown' && from.t !== 'null') return `${this.wrapCall(code)}.ToString()`;
    return code;
  }

  toBig(e) {
    const t = this.typeOf(e);
    if (e.k === 'num') return this.numLit(e.v, DEC);
    if (t.t === 'float') return `(decimal) ${this.wrapCall(this.expr(e))}`;
    return this.expr(e);
  }

  arith(op, l, r, lt, rt, resultT, p) {
    if (resultT.t === 'decimal' || resultT.t === 'float') {
      const sym = { '+': '+', '-': '-', '*': '*', div: '/', cdiv: '/', mod: '%' }[op];
      if (sym) {
        const side = (e, t, right) => {
          const code = this.sub(e, PREC[op] ?? 5, right);
          if (resultT.t === 'decimal' && t.t === 'float') return `(decimal) ${this.wrapCall(code)}`;
          if (resultT.t === 'float' && t.t === 'decimal') return `(double) ${this.wrapCall(code)}`;
          if (resultT.t === 'decimal' && e.k === 'num') return this.numLit(e.v, DEC);
          return code;
        };
        if (op === 'div' && resultT.t === 'float' && lt.t !== 'float' && rt.t !== 'float' && lt.t !== 'decimal' && rt.t !== 'decimal') return `(double) ${side(l, lt)} / ${side(r, rt, true)}`;
        return `${side(l, lt)} ${sym} ${side(r, rt, true)}`;
      }
      if (op === 'pow') return resultT.t === 'decimal' ? `(decimal) Math.Pow((double) ${this.wrapCall(this.expr(l))}, ${this.expr(r)})` : `Math.Pow(${this.expr(l)}, ${this.expr(r)})`;
    }
    return BasePrinter.prototype.arith.call(this, op, l, r, lt, rt, resultT, p);
  }

  negExpr(e) {
    return BasePrinter.prototype.negExpr.call(this, e);
  }

  compare(op, l, r, lt, rt) {
    const side = (e, t, other) => {
      if (other.t === 'decimal' && e.k === 'num') return this.numLit(e.v, DEC);
      if (other.t === 'decimal' && t.t === 'float') return `(decimal) ${this.wrapCall(this.expr(e))}`;
      return this.sub(e, 5);
    };
    const sym = { '==': '==', '!=': '!=' }[op] || op;
    return `${side(l, lt, rt)} ${sym} ${side(r, rt, lt)}`;
  }

  intDiv(l, r) {
    return `(int) (${l} / ${r})`;
  }

  floatDiv(l, r) {
    return `(double) ${l} / ${r}`;
  }

  power(l, r) {
    return `Math.Pow(${l}, ${r})`;
  }

  concat(l, r) {
    return `${this.sub(l, 5)} + ${this.sub(r, 5, true)}`;
  }

  joinText(parts) {
    const codes = parts.map((p, i) => p.code || this.sub(p.e, 5, i > 0));
    if (parts.length === 1 && parts[0].t.t !== 'string' && !parts[0].code) return `${this.wrapCall(codes[0])}.ToString()`;
    if (parts[0].t.t !== 'string' && !parts[0].code && parts.length > 1) codes[0] = `"" + ${codes[0]}`;
    return codes.join(' + ');
  }

  printfFormat(fmt, args) {
    let n = 0;
    const composite = fmt.replace(/%([-0 +#]*)(\d*)(?:\.(\d+))?([dfsxXeEgc%])/g, (m, flags, width, precision, conv) => {
      if (conv === '%') return '%';
      const idx = n;
      n += 1;
      const align = width ? `,${flags.includes('-') ? '-' : ''}${width}` : '';
      const spec = conv === 'f' ? `:F${precision ?? 6}` : conv === 'x' ? ':x' : conv === 'X' ? ':X' : conv === 'e' || conv === 'E' ? `:${conv}` : '';
      return `{${idx}${align}${spec}}`;
    });
    return `string.Format(${javaStr(composite.replace(/[{}](?![\d])/g, (c) => c + c))}${args.map((a) => `, ${this.expr(a)}`).join('')})`;
  }

  printStmt(text, newline) {
    return `_out.${newline ? 'WriteLine' : 'Write'}(${text})`;
  }

  readLine(t) {
    if (t.t === 'int') return 'int.Parse(Console.ReadLine() ?? "0")';
    if (t.t === 'decimal') return 'decimal.Parse(Console.ReadLine() ?? "0")';
    if (t.t === 'float') return 'double.Parse(Console.ReadLine() ?? "0")';
    return 'Console.ReadLine() ?? ""';
  }

  mapGet(obj, k) {
    return `${obj}.GetValueOrDefault(${k})`;
  }

  mapPutStmt(obj, k, v) {
    return `${obj}[${k}] = ${v}`;
  }

  libraryCall(kind, recv, m, args) {
    if (kind === 'list') {
      if (m === 'addElement' || m === 'add') return `${recv}.Add(${args.join(', ')})`;
      if (m === 'elementAt' || m === 'get') return `${recv}[${args[0]}]`;
      if (m === 'size') return `${recv}.Count`;
      if (m === 'elements' || m === 'iterator') {
        this.helpers.add('enumeration');
        return `new LegacyEnumeration(${recv})`;
      }
    }
    if (kind === 'map') {
      if (m === 'get') return `${recv}.GetValueOrDefault(${args[0]})`;
      if (m === 'containsKey') return `${recv}.ContainsKey(${args[0]})`;
      if (m === 'size') return `${recv}.Count`;
      if (m === 'elements' || m === 'values') {
        this.helpers.add('enumeration');
        return `new LegacyEnumeration(${recv}.Values)`;
      }
    }
    if (kind === 'iter') {
      if (m === 'hasMoreElements' || m === 'hasNext') return `${recv}.HasMoreElements()`;
      if (m === 'nextElement' || m === 'next') return `${recv}.NextElement()`;
    }
    if (kind === 'sb') {
      if (m === 'append') return `${recv}.Append(${args[0]})`;
      if (m === 'toString') return `${recv}.ToString()`;
    }
    if (kind === 'boxed' && ['doubleValue', 'intValue', 'longValue', 'floatValue'].includes(m)) return `${recv}.Value`;
    if (m === 'toString') return `${recv}.ToString()`;
    if (m === 'equals') return `Equals(${recv}, ${args[0]})`;
    if (kind === 'string') {
      if (m === 'length') return `${recv}.Length`;
      if (m === 'toUpperCase') return `${recv}.ToUpper()`;
      if (m === 'toLowerCase') return `${recv}.ToLower()`;
      if (m === 'trim') return `${recv}.Trim()`;
    }
    return null;
  }

  newExpr(e) {
    const args = e.args.map((a) => this.expr(a));
    if (LIST_TYPES.has(e.type)) return 'new List<object>()';
    if (MAP_TYPES.has(e.type)) return 'new Dictionary<object, object>()';
    if (SB_TYPES.has(e.type)) return `new StringBuilder(${args.join(', ')})`;
    if (['Double', 'Integer', 'Long', 'Boolean', 'Float'].includes(e.type)) return args[0] ?? 'default';
    const other = this.otherUnit(e.type);
    return `new ${other?.className || this.record(e.type)?.name || e.type}(${args.join(', ')})`;
  }

  callExpr(e) {
    if (e.cast && this.src === 'java' && /^(Double|Integer|Long)$/.test(e.cast)) {
      return `((${{ Double: 'double?', Integer: 'int?', Long: 'long?' }[e.cast]}) ${BasePrinter.prototype.callExpr.call(this, e)})`;
    }
    return BasePrinter.prototype.callExpr.call(this, e);
  }

  builtin(op, args, e) {
    if (op === 'eof') return this.eofCall(args[0]);
    const a = args.map((x) => this.expr(x));
    switch (op) {
      case 'len':
        return `${this.wrapCall(a[0])}.Length`;
      case 'upper':
        return `${this.wrapCall(a[0])}.ToUpper()`;
      case 'lower':
        return `${this.wrapCall(a[0])}.ToLower()`;
      case 'trim':
        return `${this.wrapCall(a[0])}.Trim()`;
      case 'ltrim':
        return `${this.wrapCall(a[0])}.TrimStart()`;
      case 'rtrim':
        return `${this.wrapCall(a[0])}.TrimEnd()`;
      case 'left':
        return `${this.wrapCall(a[0])}.Substring(0, ${a[1]})`;
      case 'right':
        return `${this.wrapCall(a[0])}[^${a[1]}..]`;
      case 'mid':
      case 'substr1':
        return a[2] ? `${this.wrapCall(a[0])}.Substring(${a[1]} - 1, ${a[2]})` : `${this.wrapCall(a[0])}.Substring(${a[1]} - 1)`;
      case 'indexOf1':
        return `${this.wrapCall(a[a.length > 2 ? 1 : 0])}.IndexOf(${a[a.length - 1]}) + 1`;
      case 'replace':
        return `${this.wrapCall(a[0])}.Replace(${a[1]}, ${a[2]})`;
      case 'toString':
        return `${this.wrapCall(a[0])}.ToString()`;
      case 'toInt':
        return this.typeOf(args[0]).t === 'string' ? `int.Parse(${a[0]})` : `(int) ${this.wrapCall(a[0])}`;
      case 'toFloat':
        return this.typeOf(args[0]).t === 'string' ? `double.Parse(${a[0]})` : `(double) ${this.wrapCall(a[0])}`;
      case 'toDecimal':
        return this.typeOf(args[0]).t === 'string' ? `decimal.Parse(${a[0]})` : `(decimal) ${this.wrapCall(a[0])}`;
      case 'format':
        return args[1]?.k === 'str' ? `${this.wrapCall(a[0])}.ToString(${a[1]})` : `${this.wrapCall(a[0])}.ToString()`;
      case 'abs':
        return `Math.Abs(${a[0]})`;
      case 'floor':
        return `(int) Math.Floor(${a[0]})`;
      case 'trunc':
        return `(int) Math.Truncate(${a[0]})`;
      case 'round':
        return `Math.Round(${a[0]})`;
      case 'sqrt':
        return `Math.Sqrt((double) ${this.wrapCall(a[0])})`;
      case 'pow':
        return `Math.Pow(${a[0]}, ${a[1]})`;
      case 'max':
      case 'min':
        return a.slice(1).reduce((acc, x) => `Math.${op === 'max' ? 'Max' : 'Min'}(${acc}, ${x})`, a[0]);
      case 'mod':
      case 'rem':
        return `${this.sub(args[0], 6)} % ${this.sub(args[1], 6, true)}`;
      case 'now':
      case 'nowText':
      case 'today':
        return 'DateTime.Now.ToString()';
      case 'isNumeric':
        return `decimal.TryParse(${this.wrapCall(a[0])}.ToString(), out _)`;
      case 'isAlpha':
        return `${this.wrapCall(a[0])}.All(c => char.IsLetter(c) || c == ' ')`;
      case 'ubound':
        return `${this.wrapCall(a[0])}.Length - 1`;
      case 'lbound':
        return '0';
      case 'chr':
        return `((char) ${this.wrapCall(a[0])}).ToString()`;
      case 'ord':
        return `(int) ${this.wrapCall(a[0])}[0]`;
      case 'spaces':
        return `new string(' ', ${a[0]})`;
      case 'sizeError':
        return 'false /* ON SIZE ERROR: add an explicit range check */';
      default:
        return `${op}(${a.join(', ')})`;
    }
  }

  scaleCall(code, scale, round) {
    this.helpers.add('scale');
    return `Scale(${code}, ${scale}, ${round})`;
  }

  toIntFromDecimal(code) {
    return `(int) ${code}`;
  }

  cobolNumCall(code, t) {
    this.helpers.add('cobolNum');
    return `CobolNum(${code}, ${t.digits}, ${t.scale || 0})`;
  }

  padCall(code, n) {
    this.helpers.add('pad');
    return `Pad(${code}, ${n})`;
  }

  throwStopRun() {
    return 'throw new StopRunException()';
  }

  newError(msg) {
    return `new InvalidOperationException(${msg})`;
  }

  localDecl(name, type, init) {
    return `${this.typeName(type)} ${name} = ${init};`;
  }

  inlineDecl(x) {
    const s = this.method?.locals.get(this.key(x.name));
    return `${this.typeName(x.type)} ${s?.name || x.name} = ${x.init ? this.coerce(x.init, x.type) : this.defaultValue(x.type)}`;
  }

  declStmt(s) {
    const local = this.method?.locals.get(this.key(s.name));
    const name = local?.name || s.name;
    if (s.redim) return this.line(`${name} = ${this.defaultValue(s.type)};`);
    const init = s.init ? this.coerce(s.init, s.type) : this.defaultValue(s.type);
    return this.line(`${s.isConst && ['int', 'string', 'decimal', 'float', 'bool'].includes(s.type?.t) ? 'const ' : ''}${this.typeName(s.type)} ${name} = ${init};`);
  }

  foreachStmt(s) {
    const local = this.method?.locals.get(this.key(s.varName));
    this.line(`foreach (var ${local?.name || s.varName} in ${this.expr(s.iter)})`);
    this.line('{');
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }

  switchStmt(s) {
    if (!this.switchable(s)) return this.switchToIf(s);
    this.line(`switch (${this.expr(s.subject)})`);
    this.line('{');
    this.indented(() => {
      for (const c of s.cases) {
        for (const t of c.tests) this.line(`case ${this.expr(t.value)}:`);
        this.indented(() => {
          this.stmts(c.body);
          this.line('break;');
        });
      }
      if (s.default) {
        this.line('default:');
        this.indented(() => {
          this.stmts(s.default);
          this.line('break;');
        });
      }
    });
    return this.line('}');
  }

  tryStmt(s) {
    this.line('try');
    this.line('{');
    this.indented(() => this.stmts(s.body));
    this.line('}');
    // Several handlers become `catch (Exception e) when (e is X)` filters: mapped .NET types can
    // coincide or be related, and unfiltered clauses in the wrong order do not compile (CS0160).
    const filtered = s.handlers.length > 1;
    let caughtAll = false;
    for (const h of s.handlers) {
      const { types, name } = catchParts(h.type);
      const legacy = types.join(' | ') || '...';
      if (caughtAll) {
        this.line(`// catch (${legacy}) is unreachable: an earlier handler catches every exception`);
        continue;
      }
      const mapped = types.map((t) => CS_EXCEPTIONS[t] || this.otherUnit(t)?.className || null);
      if (mapped.includes(null)) this.todo(`catch (${legacy}): no .NET equivalent for the legacy exception type, so this handler catches every exception`);
      const specific = [...new Set(mapped.filter((t) => t && t !== 'Exception'))];
      if (!types.length || mapped.some((t) => !t || t === 'Exception')) {
        caughtAll = true;
        this.line(`catch (Exception ${name})`);
      } else if (!filtered && specific.length === 1) this.line(`catch (${specific[0]} ${name})`);
      else this.line(`catch (Exception ${name}) when (${specific.map((t) => `${name} is ${t}`).join(' || ')})`);
      this.line('{');
      this.indented(() => this.stmts(h.body));
      this.line('}');
    }
    if (s.finally || !s.handlers.length) {
      this.line('finally');
      this.line('{');
      this.indented(() => this.stmts(s.finally || []));
      this.line('}');
    }
  }

  blockStmt(s) {
    if (s.verb === 'SYNCHRONIZED') {
      this.line('lock (this)');
      this.line('{');
      this.indented(() => this.stmts(s.body));
      return this.line('}');
    }
    return this.stmts(s.body);
  }

  ifStmt(s, elseIf = false) {
    this.line(`${elseIf ? 'else ' : ''}if (${this.expr(s.cond)})`);
    this.line('{');
    this.indented(() => this.stmts(s.then));
    this.line('}');
    if (s.else && s.else.length === 1 && s.else[0].k === 'if') return this.ifStmt(s.else[0], true);
    if (s.else && s.else.length) {
      this.line('else');
      this.line('{');
      this.indented(() => this.stmts(s.else));
      this.line('}');
    }
    return undefined;
  }

  whileStmt(s) {
    if (s.testAfter) {
      this.line('do');
      this.line('{');
      this.indented(() => this.stmts(s.body));
      return this.line(`} while (${this.expr(s.cond)});`);
    }
    this.line(`while (${this.expr(s.cond)})`);
    this.line('{');
    this.indented(() => this.stmts(s.body));
    return this.line('}');
  }

  forStmt(s) {
    const { init, cond, update } = this.forParts(s);
    this.line(`for (${init}; ${cond}; ${update})`);
    this.line('{');
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }

  repeatStmt(s) {
    const v = `i${this.level}`;
    this.line(`for (int ${v} = 0; ${v} < ${this.coerce(s.count, INT)}; ${v}++)`);
    this.line('{');
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

export class TypeScriptPrinter extends JavaPrinter {
  constructor(unit, ctx) {
    super(unit, ctx);
    this.eqOp = '===';
    this.neOp = '!==';
  }

  numLit(v) {
    return v;
  }

  typeName(t) {
    if (!t) return 'any';
    const nullable = this.src === 'java' && /^(Double|Integer|Long|Boolean|Float)$/.test(t.legacy || '') ? ' | null' : '';
    switch (t.t) {
      case 'int':
      case 'long':
      case 'decimal':
      case 'float':
        return `number${nullable}`;
      case 'string':
        return 'string';
      case 'bool':
        return `boolean${nullable}`;
      case 'date':
        return 'Date';
      case 'array': {
        const elem = this.typeName(t.elem);
        return elem.includes('|') ? `(${elem})[]` : `${elem}[]`;
      }
      case 'record':
        return t.name;
      case 'object': {
        const kind = objKind(t);
        if (kind === 'list') return 'any[]';
        if (kind === 'map') return 'Map<any, any>';
        if (kind === 'sb') {
          this.helpers.add('stringBuffer');
          return 'StringBuffer';
        }
        if (kind === 'iter') {
          this.helpers.add('enumeration');
          return 'Enumeration';
        }
        return this.otherUnit(t.name)?.className || 'any';
      }
      default:
        return 'any';
    }
  }

  defaultValue(t) {
    switch (t?.t) {
      case 'int':
      case 'long':
      case 'decimal':
      case 'float':
        return '0';
      case 'string':
        return "''";
      case 'bool':
        return 'false';
      case 'date':
        return 'new Date(0)';
      case 'record':
        return `new ${t.name}()`;
      case 'array':
        if (t.length == null) return '[]';
        return `Array.from({ length: ${t.length} }, () => ${this.defaultValue(t.elem)})`;
      case 'object':
        return this.src === 'java' && /^(Double|Integer|Long)$/.test(t.legacy || '') ? 'null' : 'null';
      default:
        return 'null';
    }
  }

  strLit(v) {
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\u0000-\u001f\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}'`;
  }

  rawExpr(text) {
    this.todos += 1;
    return `undefined /* TODO: ${text.replace(/\*\//g, '* /')} */`;
  }

  fieldRef(name, s) {
    if (s.kind === 'const' || s.isStatic) return `${this.unit.className}.${name}`;
    return `this.${name}`;
  }

  methodRef(name) {
    return `this.${name}`;
  }

  lenOf(code) {
    return `${code}.length`;
  }

  convert(code, from, to) {
    if (to.t === 'string' && from.t !== 'string' && from.t !== 'unknown' && from.t !== 'null') return `String(${code})`;
    if (to.t === 'int' && (from.t === 'decimal' || from.t === 'float')) return `Math.trunc(${code})`;
    return code;
  }

  arith(op, l, r, lt, rt, resultT, p) {
    // C/Java `/` on two integers truncates; JavaScript's `/` would keep the fraction.
    if (op === 'cdiv' && (resultT.t === 'int' || resultT.t === 'long')) return this.intDiv(this.sub(l, 6), this.sub(r, 6, true));
    return BasePrinter.prototype.arith.call(this, op, l, r, lt, rt, resultT, p);
  }

  negExpr(e) {
    return BasePrinter.prototype.negExpr.call(this, e);
  }

  compare(op, l, r, lt, rt) {
    // Loose equality so Map.get()'s undefined matches a legacy null check.
    if ((l.k === 'null' || r.k === 'null') && (op === '==' || op === '!=')) return `${this.sub(l, 5)} ${op} ${this.sub(r, 5, true)}`;
    return BasePrinter.prototype.compare.call(this, op, l, r, lt, rt);
  }

  intDiv(l, r) {
    return `Math.trunc(${l} / ${r})`;
  }

  floatDiv(l, r) {
    return `${l} / ${r}`;
  }

  power(l, r) {
    return `${l} ** ${r}`;
  }

  concat(l, r) {
    return `${this.sub(l, 5)} + ${this.sub(r, 5, true)}`;
  }

  joinText(parts) {
    const codes = parts.map((p, i) => p.code || this.sub(p.e, 5, i > 0));
    if (parts.length === 1 && parts[0].t.t !== 'string' && !parts[0].code) return `String(${codes[0]})`;
    if (parts[0].t.t !== 'string' && !parts[0].code && parts.length > 1) codes[0] = `'' + ${codes[0]}`;
    return codes.join(' + ');
  }

  printfFormat(fmt, args) {
    this.helpers.add('sprintf');
    return `sprintf(${this.strLit(fmt)}${args.map((a) => `, ${this.expr(a)}`).join('')})`;
  }

  printStmt(text, newline) {
    return `this.out(${text}${newline ? " + '\\n'" : ''})`;
  }

  readLine() {
    this.todos += 1;
    return "'' /* TODO: console input needs an async readline in Node.js */";
  }

  mapGet(obj, k) {
    return `${obj}.get(${k})`;
  }

  mapPutStmt(obj, k, v) {
    return `${obj}.set(${k}, ${v})`;
  }

  libraryCall(kind, recv, m, args) {
    if (kind === 'list') {
      if (m === 'addElement' || m === 'add') return `${recv}.push(${args.join(', ')})`;
      if (m === 'elementAt' || m === 'get') return `${recv}[${args[0]}]`;
      if (m === 'size') return `${recv}.length`;
      if (m === 'elements' || m === 'iterator') {
        this.helpers.add('enumeration');
        return `new Enumeration(${recv})`;
      }
    }
    if (kind === 'map') {
      if (m === 'get') return `${recv}.get(${args[0]})`;
      if (m === 'containsKey') return `${recv}.has(${args[0]})`;
      if (m === 'size') return `${recv}.size`;
      if (m === 'elements' || m === 'values') {
        this.helpers.add('enumeration');
        return `new Enumeration(${recv}.values())`;
      }
    }
    if (kind === 'iter') {
      if (m === 'hasMoreElements' || m === 'hasNext') return `${recv}.hasMoreElements()`;
      if (m === 'nextElement' || m === 'next') return `${recv}.nextElement()`;
    }
    if (kind === 'boxed' && ['doubleValue', 'intValue', 'longValue', 'floatValue'].includes(m)) return `(${recv} as number)`;
    if (m === 'toString' && kind !== 'sb') return `String(${recv})`;
    if (m === 'equals') return `${recv} === ${args[0]}`;
    if (kind === 'string') {
      if (m === 'length') return `${recv}.length`;
      if (m === 'toUpperCase' || m === 'toLowerCase' || m === 'trim') return `${recv}.${m}()`;
    }
    return null;
  }

  newExpr(e) {
    const args = e.args.map((a) => this.expr(a));
    if (LIST_TYPES.has(e.type)) return '[]';
    if (MAP_TYPES.has(e.type)) return 'new Map<any, any>()';
    if (SB_TYPES.has(e.type)) {
      this.helpers.add('stringBuffer');
      return `new StringBuffer(${args.join(', ')})`;
    }
    if (['Double', 'Integer', 'Long', 'Boolean', 'Float'].includes(e.type)) return args[0] ?? '0';
    const other = this.otherUnit(e.type);
    return `new ${other?.className || this.record(e.type)?.name || e.type}(${args.join(', ')})`;
  }

  callExpr(e) {
    const code = BasePrinter.prototype.callExpr.call(this, e);
    if (e.cast && this.src === 'java') {
      if (/^(Double|Integer|Long|Float|Short)$/.test(e.cast)) return `(${code} as number | null)`;
      if (e.cast === 'String') return `(${code} as string)`;
    }
    return code;
  }

  builtin(op, args) {
    if (op === 'eof') return this.eofCall(args[0]);
    const a = args.map((x) => this.expr(x));
    switch (op) {
      case 'len':
        return `${this.wrapCall(a[0])}.length`;
      case 'upper':
        return `${this.wrapCall(a[0])}.toUpperCase()`;
      case 'lower':
        return `${this.wrapCall(a[0])}.toLowerCase()`;
      case 'trim':
        return `${this.wrapCall(a[0])}.trim()`;
      case 'ltrim':
        return `${this.wrapCall(a[0])}.trimStart()`;
      case 'rtrim':
        return `${this.wrapCall(a[0])}.trimEnd()`;
      case 'left':
        return `${this.wrapCall(a[0])}.slice(0, ${a[1]})`;
      case 'right':
        return `${this.wrapCall(a[0])}.slice(-${this.wrapCall(a[1])})`;
      case 'mid':
      case 'substr1':
        return a[2] ? `${this.wrapCall(a[0])}.substr(${a[1]} - 1, ${a[2]})` : `${this.wrapCall(a[0])}.slice(${a[1]} - 1)`;
      case 'indexOf1':
        return `${this.wrapCall(a[a.length > 2 ? 1 : 0])}.indexOf(${a[a.length - 1]}) + 1`;
      case 'replace':
        return `${this.wrapCall(a[0])}.replaceAll(${a[1]}, ${a[2]})`;
      case 'toString':
        return `String(${a[0]})`;
      case 'toInt':
        return this.typeOf(args[0]).t === 'string' ? `parseInt(${a[0]}, 10)` : `Math.trunc(${a[0]})`;
      case 'toFloat':
      case 'toDecimal':
        return this.typeOf(args[0]).t === 'string' ? `parseFloat(${a[0]})` : `Number(${a[0]})`;
      case 'format': {
        const d = args[1]?.k === 'str' ? formatDecimals(args[1].v) : null;
        return d != null ? `${this.wrapCall(a[0])}.toFixed(${d})` : `String(${a[0]})`;
      }
      case 'abs':
        return `Math.abs(${a[0]})`;
      case 'floor':
        return `Math.floor(${a[0]})`;
      case 'trunc':
        return `Math.trunc(${a[0]})`;
      case 'round':
        return `Math.round(${a[0]})`;
      case 'sqrt':
        return `Math.sqrt(${a[0]})`;
      case 'pow':
        return `${this.wrapCall(a[0])} ** ${this.wrapCall(a[1])}`;
      case 'max':
      case 'min':
        return `Math.${op}(${a.join(', ')})`;
      case 'mod':
      case 'rem':
        return `${this.sub(args[0], 6)} % ${this.sub(args[1], 6, true)}`;
      case 'now':
      case 'nowText':
      case 'today':
        return 'new Date().toISOString()';
      case 'isNumeric':
        return `!Number.isNaN(Number(${a[0]}))`;
      case 'isAlpha':
        return `/^[A-Za-z ]*$/.test(String(${a[0]}))`;
      case 'ubound':
        return `${this.wrapCall(a[0])}.length - 1`;
      case 'lbound':
        return '0';
      case 'chr':
        return `String.fromCharCode(${a[0]})`;
      case 'ord':
        return `${this.wrapCall(a[0])}.charCodeAt(0)`;
      case 'spaces':
        return `' '.repeat(${a[0]})`;
      case 'sizeError':
        return 'false /* ON SIZE ERROR: add an explicit range check */';
      default:
        return `${op}(${a.join(', ')})`;
    }
  }

  scaleCall(code, scale, round) {
    this.helpers.add('scale');
    return `scale(${code}, ${scale}, ${round})`;
  }

  toIntFromDecimal(code) {
    return code;
  }

  cobolNumCall(code, t) {
    this.helpers.add('cobolNum');
    return `cobolNum(${code}, ${t.digits}, ${t.scale || 0})`;
  }

  padCall(code, n) {
    this.helpers.add('pad');
    return `pad(${code}, ${n})`;
  }

  throwStopRun() {
    return 'throw new StopRun()';
  }

  newError(msg) {
    return `new Error(${msg})`;
  }

  localDecl(name, type, init) {
    return `let ${name}: ${this.typeName(type)} = ${init};`;
  }

  inlineDecl(x) {
    const s = this.method?.locals.get(this.key(x.name));
    return `let ${s?.name || x.name} = ${x.init ? this.coerce(x.init, x.type) : this.defaultValue(x.type)}`;
  }

  declStmt(s) {
    const local = this.method?.locals.get(this.key(s.name));
    const name = local?.name || s.name;
    if (s.redim) return this.line(`${name} = ${this.defaultValue(s.type)};`);
    const init = s.init ? this.coerce(s.init, s.type) : this.defaultValue(s.type);
    return this.line(`${s.isConst ? 'const' : 'let'} ${name}: ${this.typeName(s.type)} = ${init};`);
  }

  foreachStmt(s) {
    const local = this.method?.locals.get(this.key(s.varName));
    this.line(`for (const ${local?.name || s.varName} of ${this.expr(s.iter)}) {`);
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }

  repeatStmt(s) {
    const v = `i${this.level}`;
    this.line(`for (let ${v} = 0; ${v} < ${this.expr(s.count)}; ${v}++) {`);
    this.indented(() => this.stmts(s.body));
    this.line('}');
  }

  switchStmt(s) {
    if (!this.switchable(s)) return this.switchToIf(s);
    this.line(`switch (${this.expr(s.subject)}) {`);
    this.indented(() => {
      for (const c of s.cases) {
        for (const t of c.tests) this.line(`case ${this.expr(t.value)}:`);
        this.indented(() => {
          this.line('{');
          this.indented(() => this.stmts(c.body));
          this.line('}');
          this.line('break;');
        });
      }
      if (s.default) {
        this.line('default: {');
        this.indented(() => this.stmts(s.default));
        this.line('}');
      }
    });
    return this.line('}');
  }

  tryStmt(s) {
    this.line('try {');
    this.indented(() => this.stmts(s.body));
    if (s.handlers.length) {
      this.line('} catch (e) {');
      this.indented(() => s.handlers.forEach((h) => this.stmts(h.body)));
    }
    if (s.finally || !s.handlers.length) {
      this.line('} finally {');
      this.indented(() => this.stmts(s.finally || []));
    }
    this.line('}');
  }

  blockStmt(s) {
    return this.stmts(s.body);
  }
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

export class PythonPrinter extends BasePrinter {
  constructor(unit, ctx) {
    super(unit, ctx);
    this.comment = '#';
    this.pendingNotes = [];
    this.semi = '';
    this.trueLit = 'True';
    this.falseLit = 'False';
    this.andOp = 'and';
    this.orOp = 'or';
    this.notOp = 'not ';
    this.eqOp = '==';
    this.neOp = '!=';
    this.selfRef = 'self';
  }

  nullLit() {
    return 'None';
  }

  numLit(v, t) {
    if (t?.t === 'decimal') {
      this.imports.add('decimal');
      return `Decimal("${v}")`;
    }
    if (t?.t === 'float' && /^-?\d+$/.test(v)) return `${v}.0`;
    return v;
  }

  strLit(v) {
    return JSON.stringify(String(v)).replace(/\\u([0-9a-f]{4})/gi, '\\u$1');
  }

  rawExpr(text) {
    this.todos += 1;
    this.noteBeforeLine(`TODO: ${text.replace(/\n/g, ' ')}`);
    return 'None';
  }

  get eofName() {
    return '_end_of_file';
  }

  // Python has no inline block comments: a `# ...` inside an expression would swallow the rest
  // of the line (closing brackets, the colon of an `if`), so notes go on their own line instead.
  noteBeforeLine(text) {
    this.pendingNotes.push(text);
  }

  line(s = '') {
    if (s !== '' && this.pendingNotes.length) {
      const notes = this.pendingNotes;
      this.pendingNotes = [];
      for (const n of notes) super.line(`# ${n}`);
    }
    super.line(s);
  }

  typeName(t) {
    if (!t) return 'object';
    switch (t.t) {
      case 'int':
      case 'long':
        return 'int';
      case 'decimal':
        this.imports.add('decimal');
        return 'Decimal';
      case 'float':
        return 'float';
      case 'string':
        return 'str';
      case 'bool':
        return 'bool';
      case 'date':
        return 'str';
      case 'array':
        return `list[${this.typeName(t.elem)}]`;
      case 'record':
        return t.name;
      case 'object': {
        const kind = objKind(t);
        if (kind === 'list') return 'list';
        if (kind === 'map') return 'dict';
        if (kind === 'sb') {
          this.helpers.add('stringBuffer');
          return 'StringBuffer';
        }
        if (kind === 'iter') {
          this.helpers.add('enumeration');
          return 'Enumeration';
        }
        return this.otherUnit(t.name)?.className || 'object';
      }
      default:
        return 'object';
    }
  }

  defaultValue(t) {
    switch (t?.t) {
      case 'int':
      case 'long':
        return '0';
      case 'decimal':
        this.imports.add('decimal');
        return 'Decimal("0")';
      case 'float':
        return '0.0';
      case 'string':
        return '""';
      case 'bool':
        return 'False';
      case 'record':
        return `${t.name}()`;
      case 'array':
        if (t.length == null) return '[]';
        if (t.elem?.t === 'record') return `[${t.elem.name}() for _ in range(${t.length})]`;
        return `[${this.defaultValue(t.elem)}] * ${t.length}`;
      default:
        return 'None';
    }
  }

  fieldRef(name, s) {
    // Class attributes: `self` does not exist inside a @staticmethod.
    if (s?.kind === 'const' || s?.isStatic) return `${this.unit.className}.${name}`;
    return `self.${name}`;
  }

  methodRef(name) {
    return `self.${name}`;
  }

  lenOf(code) {
    return `len(${code})`;
  }

  convert(code, from, to) {
    if (to.t === 'decimal' && from.t === 'float') {
      this.imports.add('decimal');
      return `Decimal(str(${code}))`;
    }
    if (to.t === 'decimal' && from.t === 'int') {
      this.imports.add('decimal');
      return `Decimal(${code})`;
    }
    if (to.t === 'float' && from.t === 'decimal') return `float(${code})`;
    if (to.t === 'int' && (from.t === 'decimal' || from.t === 'float')) return `int(${code})`;
    if (to.t === 'string' && from.t !== 'string' && from.t !== 'unknown' && from.t !== 'null') return `str(${code})`;
    return code;
  }

  arith(op, l, r, lt, rt, resultT, p) {
    if (resultT.t === 'decimal' && (lt.t === 'float' || rt.t === 'float')) {
      const sym = { '+': '+', '-': '-', '*': '*', div: '/', cdiv: '/', mod: '%' }[op];
      const side = (e, t, right) => (t.t === 'float' ? `Decimal(str(${this.expr(e)}))` : e.k === 'num' ? this.numLit(e.v, DEC) : this.sub(e, PREC[op] ?? 5, right));
      if (sym) return `${side(l, lt)} ${sym} ${side(r, rt, true)}`;
    }
    // COBOL divides integers into an exact decimal result; Python's int / int would be a float.
    if (resultT.t === 'decimal' && (op === 'div' || op === 'cdiv') && lt.t !== 'decimal' && rt.t !== 'decimal') {
      this.imports.add('decimal');
      return `Decimal(${this.expr(l)}) / ${this.sub(r, 6, true)}`;
    }
    if (resultT.t === 'float' && (lt.t === 'decimal' || rt.t === 'decimal')) {
      const sym = { '+': '+', '-': '-', '*': '*', div: '/', cdiv: '/', mod: '%' }[op];
      const side = (e, t, right) => (t.t === 'decimal' ? `float(${this.expr(e)})` : this.sub(e, PREC[op] ?? 5, right));
      if (sym) return `${side(l, lt)} ${sym} ${side(r, rt, true)}`;
    }
    if (op === 'cdiv' && resultT.t === 'int') return `int(${this.sub(l, 6)} / ${this.sub(r, 6, true)})`;
    return super.arith(op, l, r, lt, rt, resultT, p);
  }

  intDiv(l, r) {
    return `int(${l} / ${r})`;
  }

  floatDiv(l, r) {
    return `${l} / ${r}`;
  }

  power(l, r) {
    return `${l} ** ${r}`;
  }

  condExpr(e) {
    return `${this.sub(e.then, 1)} if ${this.sub(e.test, 1)} else ${this.sub(e.else, 1)}`;
  }

  compare(op, l, r, lt, rt) {
    if ((l.k === 'null' || r.k === 'null') && (op === '==' || op === '!=')) {
      return `${this.sub(l, 5)} ${op === '==' ? 'is' : 'is not'} ${this.sub(r, 5, true)}`;
    }
    if (lt.t === 'decimal' && rt.t === 'float') return `${this.sub(l, 5)} ${op} Decimal(str(${this.expr(r)}))`;
    if (rt.t === 'decimal' && lt.t === 'float') return `Decimal(str(${this.expr(l)})) ${op} ${this.sub(r, 5, true)}`;
    return super.compare(op, l, r, lt, rt);
  }

  concat(l, r, lt, rt) {
    const side = (e, t, right) => (t.t === 'string' ? this.sub(e, 5, right) : `str(${this.expr(e)})`);
    return `${side(l, lt)} + ${side(r, rt, true)}`;
  }

  joinText(parts) {
    const codes = parts.map((p, i) => p.code || (p.t.t === 'string' ? this.sub(p.e, 5, i > 0) : `str(${this.expr(p.e)})`));
    return codes.join(' + ');
  }

  printfFormat(fmt, args) {
    if (!args.length) return this.strLit(fmt);
    return `${this.strLit(fmt)} % (${args.map((a) => this.expr(a)).join(', ')}${args.length === 1 ? ',' : ''})`;
  }

  printStmt(text, newline) {
    return `print(${text}, ${newline ? '' : 'end="", '}file=self._out)`;
  }

  readLine(t) {
    if (t.t === 'int') return 'int(input())';
    if (t.t === 'decimal') {
      this.imports.add('decimal');
      return 'Decimal(input().strip())';
    }
    if (t.t === 'float') return 'float(input())';
    return 'input()';
  }

  mapGet(obj, k) {
    return `${obj}.get(${k})`;
  }

  mapPutStmt(obj, k, v) {
    return `${obj}[${k}] = ${v}`;
  }

  libraryCall(kind, recv, m, args) {
    if (kind === 'list') {
      if (m === 'addElement' || m === 'add') return `${recv}.append(${args.join(', ')})`;
      if (m === 'elementAt' || m === 'get') return `${recv}[${args[0]}]`;
      if (m === 'size') return `len(${recv})`;
      if (m === 'elements' || m === 'iterator') {
        this.helpers.add('enumeration');
        return `Enumeration(${recv})`;
      }
    }
    if (kind === 'map') {
      if (m === 'get') return `${recv}.get(${args[0]})`;
      if (m === 'containsKey') return `${args[0]} in ${recv}`;
      if (m === 'size') return `len(${recv})`;
      if (m === 'elements' || m === 'values') {
        this.helpers.add('enumeration');
        return `Enumeration(${recv}.values())`;
      }
    }
    if (kind === 'iter') {
      if (m === 'hasMoreElements' || m === 'hasNext') return `${recv}.has_more_elements()`;
      if (m === 'nextElement' || m === 'next') return `${recv}.next_element()`;
    }
    if (kind === 'sb') {
      if (m === 'append') return `${recv}.append(${args[0]})`;
      if (m === 'toString') return `str(${recv})`;
    }
    if (kind === 'boxed' && ['doubleValue', 'intValue', 'longValue', 'floatValue'].includes(m)) return recv;
    if (m === 'toString') return `str(${recv})`;
    if (m === 'equals') return `${recv} == ${args[0]}`;
    if (kind === 'string') {
      if (m === 'length') return `len(${recv})`;
      if (m === 'toUpperCase') return `${recv}.upper()`;
      if (m === 'toLowerCase') return `${recv}.lower()`;
      if (m === 'trim') return `${recv}.strip()`;
    }
    return null;
  }

  newExpr(e) {
    const args = e.args.map((a) => this.expr(a));
    if (LIST_TYPES.has(e.type)) return '[]';
    if (MAP_TYPES.has(e.type)) return '{}';
    if (SB_TYPES.has(e.type)) {
      this.helpers.add('stringBuffer');
      return `StringBuffer(${args.join(', ')})`;
    }
    if (['Double', 'Float'].includes(e.type)) return `float(${args[0] ?? 0})`;
    if (['Integer', 'Long'].includes(e.type)) return `int(${args[0] ?? 0})`;
    const other = this.otherUnit(e.type);
    return `${other?.className || this.record(e.type)?.name || e.type}(${args.join(', ')})`;
  }

  builtin(op, args) {
    if (op === 'eof') return this.eofCall(args[0]);
    const a = args.map((x) => this.expr(x));
    switch (op) {
      case 'len':
        return `len(${a[0]})`;
      case 'upper':
        return `${this.wrapAttr(a[0])}.upper()`;
      case 'lower':
        return `${this.wrapAttr(a[0])}.lower()`;
      case 'trim':
        return `${this.wrapAttr(a[0])}.strip()`;
      case 'ltrim':
        return `${this.wrapAttr(a[0])}.lstrip()`;
      case 'rtrim':
        return `${this.wrapAttr(a[0])}.rstrip()`;
      case 'left':
        return `${this.wrapAttr(a[0])}[:${a[1]}]`;
      case 'right':
        return `${this.wrapAttr(a[0])}[-${this.wrapAttr(a[1])}:]`;
      case 'mid':
      case 'substr1':
        return a[2] ? `${this.wrapAttr(a[0])}[${a[1]} - 1:${a[1]} - 1 + ${a[2]}]` : `${this.wrapAttr(a[0])}[${a[1]} - 1:]`;
      case 'indexOf1':
        return `${this.wrapAttr(a[a.length > 2 ? 1 : 0])}.find(${a[a.length - 1]}) + 1`;
      case 'replace':
        return `${this.wrapAttr(a[0])}.replace(${a[1]}, ${a[2]})`;
      case 'toString':
        return `str(${a[0]})`;
      case 'toInt':
        return `int(${a[0]})`;
      case 'toFloat':
        return `float(${a[0]})`;
      case 'toDecimal':
        this.imports.add('decimal');
        return `Decimal(str(${a[0]}))`;
      case 'format': {
        const d = args[1]?.k === 'str' ? formatDecimals(args[1].v) : null;
        return d != null ? `format(${a[0]}, ".${d}f")` : `str(${a[0]})`;
      }
      case 'abs':
        return `abs(${a[0]})`;
      case 'floor':
        this.imports.add('math');
        return `math.floor(${a[0]})`;
      case 'trunc':
        return `int(${a[0]})`;
      case 'round':
        return `round(${a[0]})`;
      case 'sqrt':
        this.imports.add('math');
        return `math.sqrt(${a[0]})`;
      case 'pow':
        return `${this.wrapAttr(a[0])} ** ${this.wrapAttr(a[1])}`;
      case 'max':
      case 'min':
        return `${op}(${a.join(', ')})`;
      case 'mod':
      case 'rem':
        return `${this.sub(args[0], 6)} % ${this.sub(args[1], 6, true)}`;
      case 'now':
      case 'nowText':
      case 'today':
        this.imports.add('datetime');
        return 'datetime.now().isoformat()';
      case 'isNumeric':
        return `str(${a[0]}).strip().replace(".", "", 1).isdigit()`;
      case 'isAlpha':
        return `all(c.isalpha() or c == " " for c in str(${a[0]}))`;
      case 'ubound':
        return `len(${a[0]}) - 1`;
      case 'lbound':
        return '0';
      case 'chr':
        return `chr(${a[0]})`;
      case 'ord':
        return `ord(${a[0]}[0])`;
      case 'spaces':
        return `" " * ${this.wrapAttr(a[0])}`;
      case 'sizeError':
        this.noteBeforeLine('ON SIZE ERROR: add an explicit range check');
        return 'False';
      default:
        return `${op}(${a.join(', ')})`;
    }
  }

  wrapAttr(code) {
    return /^[\w.()[\]"']+$/.test(code) ? code : `(${code})`;
  }

  scaleCall(code, scale, round) {
    this.helpers.add('scale');
    return `_scale(${code}, ${scale}, ${round ? 'True' : 'False'})`;
  }

  toIntFromDecimal(code) {
    return `int(${code})`;
  }

  cobolNumCall(code, t) {
    this.helpers.add('cobolNum');
    return `_cobol_num(${code}, ${t.digits}, ${t.scale || 0})`;
  }

  padCall(code, n) {
    this.helpers.add('pad');
    return `_pad(${code}, ${n})`;
  }

  throwStopRun() {
    return 'raise StopRun()';
  }

  newError(msg) {
    return `RuntimeError(${msg})`;
  }

  localDecl(name, type, init) {
    return `${name}: ${this.typeName(type)} = ${init}`;
  }

  declStmt(s) {
    const local = this.method?.locals.get(this.key(s.name));
    const name = local?.name || s.name;
    const init = s.init ? this.coerce(s.init, s.type) : this.defaultValue(s.type);
    return this.line(`${name} = ${init}`);
  }

  inlineDecl(x) {
    const s = this.method?.locals.get(this.key(x.name));
    return `${s?.name || x.name} = ${x.init ? this.coerce(x.init, x.type) : this.defaultValue(x.type)}`;
  }

  // Python has no block-less statements; `pass` keeps empty blocks valid.
  suite(list) {
    const before = this.lines.length;
    this.indented(() => this.stmts(list));
    if (this.lines.length === before || this.lines.slice(before).every((l) => l.trim().startsWith('#'))) this.indented(() => this.line('pass'));
  }

  ifStmt(s, elseIf = false) {
    this.line(`${elseIf ? 'elif' : 'if'} ${this.expr(s.cond)}:`);
    this.suite(s.then);
    if (s.else && s.else.length === 1 && s.else[0].k === 'if') return this.ifStmt(s.else[0], true);
    if (s.else && s.else.length) {
      this.line('else:');
      this.suite(s.else);
    }
    return undefined;
  }

  // `continue` in a loop Python must emulate with `while` would skip the update or the
  // test-after condition that the printer appends to the body, so those loops use a first-pass flag.
  hasContinue(body) {
    let found = false;
    walkStatements(body, (x) => {
      if (x.k === 'continue') found = true;
    });
    return found;
  }

  whileStmt(s) {
    if (s.testAfter && this.hasContinue(s.body)) {
      const first = `_first_pass${this.level}`;
      this.line(`${first} = True`);
      this.line(`while ${first} or (${this.expr(s.cond)}):`);
      this.indented(() => {
        this.line(`${first} = False`);
        this.stmts(s.body);
      });
      return undefined;
    }
    if (s.testAfter) {
      this.line('while True:');
      this.indented(() => {
        this.stmts(s.body);
        this.line(`if not (${this.expr(s.cond)}):`);
        this.indented(() => this.line('break'));
      });
      return undefined;
    }
    this.line(`while ${this.expr(s.cond)}:`);
    return this.suite(s.body);
  }

  // Counted loops over a local integer become range(); everything else keeps while-loop semantics.
  simpleRange(s) {
    if (s.init.length !== 1 || s.update.length !== 1 || !s.cond) return null;
    const init = s.init[0];
    const upd = s.update[0];
    const varExpr = init.k === 'decl' ? { k: 'id', name: init.name } : init.target;
    if (varExpr?.k !== 'id') return null;
    const sym = this.lookup(varExpr.name);
    if (sym?.kind !== 'local') return null;
    if (upd.k !== 'assign' || upd.target.k !== 'id' || upd.target.name !== varExpr.name || upd.value.k !== 'bin' || upd.value.op !== '+' || upd.value.r.k !== 'num' || upd.value.r.v !== '1') return null;
    let assignedInBody = false;
    walkStatements(s.body, (x) => {
      if (x.k === 'assign' && x.target.k === 'id' && x.target.name === varExpr.name) assignedInBody = true;
    });
    if (assignedInBody) return null;
    const c = s.cond;
    const from = init.k === 'decl' ? init.init : init.value;
    if (!from) return null;
    if (c.k === 'bin' && c.l.k === 'id' && c.l.name === varExpr.name && (c.op === '<' || c.op === '<=')) {
      const to = c.op === '<=' ? (c.r.k === 'num' ? String(Number(c.r.v) + 1) : `${this.sub(c.r, 5)} + 1`) : this.expr(c.r);
      return `for ${sym.name} in range(${this.expr(from)}, ${to}):`;
    }
    return null;
  }

  forStmt(s) {
    const range = this.simpleRange(s);
    if (range) {
      this.line(range);
      return this.suite(s.body);
    }
    for (const x of s.init) this.line(this.inlineStmt(x) || `${this.comment} ${x.text || ''}`);
    if (s.update.length && this.hasContinue(s.body)) {
      const updates = s.update.map((x) => this.inlineStmt(x)).filter(Boolean);
      const first = `_first_pass${this.level}`;
      this.line(`${first} = True`);
      this.line('while True:');
      this.indented(() => {
        this.line(`if not ${first}:`);
        this.indented(() => updates.forEach((u) => this.line(u)));
        this.line(`${first} = False`);
        if (s.cond) {
          this.line(`if not (${this.expr(s.cond)}):`);
          this.indented(() => this.line('break'));
        }
        this.stmts(s.body);
      });
      return undefined;
    }
    this.line(`while ${s.cond ? this.expr(s.cond) : 'True'}:`);
    this.indented(() => {
      this.stmts(s.body);
      for (const x of s.update) this.line(this.inlineStmt(x) || '');
    });
    return undefined;
  }

  foreachStmt(s) {
    const local = this.method?.locals.get(this.key(s.varName));
    this.line(`for ${local?.name || s.varName} in ${this.expr(s.iter)}:`);
    this.suite(s.body);
  }

  repeatStmt(s) {
    this.line(`for _ in range(${this.coerce(s.count, INT)}):`);
    this.suite(s.body);
  }

  switchStmt(s) {
    return JavaPrinter.prototype.switchToIf.call(this, s);
  }

  caseCond(subject, test) {
    return JavaPrinter.prototype.caseCond.call(this, subject, test);
  }

  tryStmt(s) {
    this.line('try:');
    this.suite(s.body);
    for (const h of s.handlers) {
      this.line('except Exception as e:');
      this.suite(h.body);
    }
    if (s.finally || !s.handlers.length) {
      this.line('finally:');
      this.suite(s.finally || []);
    }
  }

  blockStmt(s) {
    return this.stmts(s.body);
  }

  stmt(s) {
    if (s.k === 'continue') return this.line('continue');
    if (s.k === 'throw') return this.line(`raise ${s.value ? this.expr(s.value) : 'RuntimeError("error")'}`);
    return super.stmt(s);
  }

  returnStmt(s) {
    return super.returnStmt(s);
  }

  exitStmt(s) {
    if (s.scope === 'loop') return this.line('break');
    if (s.scope === 'procedure') return this.line(this.method?.returnVar ? `return ${this.method.returnVar}` : 'return');
    if (this.unit.usesStopRun) return this.line(`raise StopRun()  # ${s.verb || 'STOP RUN'}`);
    return this.line(`return  # ${s.verb || 'STOP RUN'}`);
  }

  body(m) {
    const before = this.lines.length;
    super.body(m);
    if (this.lines.length === before) this.line('pass');
  }
}

export const PRINTERS = { java: JavaPrinter, csharp: CSharpPrinter, typescript: TypeScriptPrinter, python: PythonPrinter };
