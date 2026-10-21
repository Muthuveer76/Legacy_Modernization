import { E, T, clip, exprToText, walkExpr, walkStatements } from '../ir.js';

// ---------------------------------------------------------------------------
// Tokenizer: logical lines (with " _" continuations) -> flat token stream with EOL markers.
// ---------------------------------------------------------------------------

function stripFormDesigner(lines) {
  const firstCode = lines.findIndex((l) => l.trim());
  if (firstCode < 0 || !/^\s*VERSION\s+\d/i.test(lines[firstCode])) return { start: 0, controls: [] };
  const controls = [];
  let attr = lines.findIndex((l) => /^\s*Attribute\s+VB_/i.test(l));
  if (attr < 0) attr = 0;
  for (let i = 0; i < attr; i += 1) {
    const m = lines[i].match(/^\s*Begin\s+([\w.]+)\s+(\w+)/i);
    if (m) controls.push({ type: m[1], name: m[2], line: i + 1 });
  }
  return { start: attr, controls };
}

function tokenizeVb(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const { start, controls } = stripFormDesigner(lines);
  const toks = [];
  const attributes = {};
  let pendingContinuation = false;
  for (let li = start; li < lines.length; li += 1) {
    const n = li + 1;
    const line = lines[li];
    if (!pendingContinuation) {
      const attr = line.match(/^\s*Attribute\s+(\w+)\s*=\s*"?([^"]*)"?/i);
      if (attr) {
        attributes[attr[1]] = attr[2];
        continue;
      }
    }
    let i = 0;
    let lineHasTokens = false;
    let continued = false;
    while (i < line.length) {
      const c = line[i];
      if (c === ' ' || c === '\t') {
        i += 1;
        continue;
      }
      if (c === "'") break;
      if (c === '_' && /^_\s*$/.test(line.slice(i)) && (i === 0 || /\s/.test(line[i - 1]))) {
        continued = true;
        break;
      }
      if (c === '"') {
        let j = i + 1;
        let val = '';
        while (j < line.length) {
          if (line[j] === '"') {
            if (line[j + 1] === '"') {
              val += '"';
              j += 2;
              continue;
            }
            break;
          }
          val += line[j];
          j += 1;
        }
        toks.push({ t: 'str', v: val, line: n });
        lineHasTokens = true;
        i = j + 1;
        continue;
      }
      const dateLit = c === '#' && line.slice(i).match(/^#(\d{1,4}[/-]\d{1,2}[/-]\d{1,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?|\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?|[A-Za-z]+\s+\d{1,2},?\s+\d{4})#/i);
      if (dateLit) {
        toks.push({ t: 'date', v: dateLit[1], line: n });
        lineHasTokens = true;
        i += dateLit[0].length;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(line[i + 1] || '')) || (c === '&' && /[HhOo]/.test(line[i + 1] || '') && /[0-9A-Fa-f]/.test(line[i + 2] || ''))) {
        const m = line.slice(i).match(/^(&[Hh][0-9A-Fa-f]+|&[Oo][0-7]+|\d*\.?\d+(?:[eE][+-]?\d+)?)[%&!#@]?/);
        let v = m[1];
        if (/^&[Hh]/.test(v)) v = String(Number.parseInt(v.slice(2), 16));
        else if (/^&[Oo]/.test(v)) v = String(Number.parseInt(v.slice(2), 8));
        toks.push({ t: 'num', v, line: n });
        lineHasTokens = true;
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = line.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*[$%&!#@]?/);
        let word = m[0];
        // A trailing & ! # is an operator (concat, bang, file number) when more name characters follow.
        if (/[&!#]$/.test(word) && /[A-Za-z0-9_("]/.test(line[i + word.length] || '')) word = word.slice(0, -1);
        if (word.toUpperCase() === 'REM' && !lineHasTokens) break;
        const bare = word.replace(/[$%&!#@]$/, '');
        toks.push({ t: 'id', v: bare, u: bare.toUpperCase(), suffix: word.match(/[$%&!#@]$/)?.[0], line: n });
        lineHasTokens = true;
        i += word.length;
        continue;
      }
      if (c === '[') {
        const j = line.indexOf(']', i);
        const name = line.slice(i + 1, j > i ? j : line.length);
        toks.push({ t: 'id', v: name, u: name.toUpperCase(), line: n });
        lineHasTokens = true;
        i = j > i ? j + 1 : line.length;
        continue;
      }
      const two = line.slice(i, i + 2);
      if (['<>', '<=', '>=', ':='].includes(two)) {
        toks.push({ t: 'op', v: two, line: n });
        lineHasTokens = true;
        i += 2;
        continue;
      }
      if ('+-*/\\^&=<>(),.!:;#'.includes(c)) {
        toks.push({ t: 'op', v: c, line: n });
        lineHasTokens = true;
        i += 1;
        continue;
      }
      i += 1;
    }
    pendingContinuation = continued;
    if (!continued && lineHasTokens && toks[toks.length - 1]?.t !== 'eol') toks.push({ t: 'eol', v: '\n', line: n });
    else if (!continued && !lineHasTokens && toks.length && toks[toks.length - 1].t !== 'eol') toks.push({ t: 'eol', v: '\n', line: n });
  }
  if (toks.length && toks[toks.length - 1].t !== 'eol') toks.push({ t: 'eol', v: '\n', line: lines.length });
  return { toks, attributes, controls };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VB_TYPES = {
  INTEGER: () => ({ ...T.int, legacy: 'Integer' }),
  LONG: () => ({ ...T.int, legacy: 'Long' }),
  LONGLONG: () => ({ ...T.long, legacy: 'LongLong' }),
  BYTE: () => ({ ...T.int, legacy: 'Byte' }),
  SINGLE: () => ({ ...T.float, legacy: 'Single' }),
  DOUBLE: () => ({ ...T.float, legacy: 'Double' }),
  CURRENCY: () => ({ ...T.decimal, scale: 4, legacy: 'Currency' }),
  DECIMAL: () => ({ ...T.decimal, legacy: 'Decimal' }),
  STRING: () => ({ ...T.string, legacy: 'String' }),
  BOOLEAN: () => ({ ...T.bool, legacy: 'Boolean' }),
  DATE: () => ({ ...T.date, legacy: 'Date' }),
  VARIANT: () => ({ ...T.unknown, legacy: 'Variant' }),
  OBJECT: () => ({ ...T.object('Object'), legacy: 'Object' }),
};

const SUFFIX_TYPES = { $: 'STRING', '%': 'INTEGER', '&': 'LONG', '!': 'SINGLE', '#': 'DOUBLE', '@': 'CURRENCY' };

function vbType(name, suffix) {
  if (name) {
    const f = VB_TYPES[name.toUpperCase()];
    return f ? f() : { ...T.object(name), legacy: name };
  }
  if (suffix && SUFFIX_TYPES[suffix]) return VB_TYPES[SUFFIX_TYPES[suffix]]();
  return { ...T.unknown, legacy: 'Variant' };
}

const EVENT_HANDLER = /^(Form|UserControl|Class|MDIForm|\w+)_(Load|Unload|Initialize|Terminate|Click|DblClick|Change|KeyPress|KeyDown|KeyUp|GotFocus|LostFocus|Timer|Activate|Resize|MouseDown|MouseUp|MouseMove|Validate|QueryUnload)$/;

const BLOCK_END_WORDS = new Set(['ELSE', 'ELSEIF', 'END', 'CASE', 'NEXT', 'LOOP', 'WEND']);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class VbParser {
  constructor(toks, diagnostics) {
    this.toks = toks;
    this.i = 0;
    this.diagnostics = diagnostics;
    this.procNames = new Set();
  }

  peek(o = 0) {
    return this.toks[this.i + o];
  }

  next() {
    const t = this.toks[this.i];
    this.i += 1;
    return t;
  }

  atEnd() {
    return this.i >= this.toks.length;
  }

  isKw(w, o = 0) {
    const t = this.peek(o);
    if (!t || t.t !== 'id') return false;
    return Array.isArray(w) ? w.includes(t.u) : t.u === w;
  }

  isOp(v, o = 0) {
    const t = this.peek(o);
    return Boolean(t && t.t === 'op' && (Array.isArray(v) ? v.includes(t.v) : t.v === v));
  }

  eatKw(w) {
    if (this.isKw(w)) {
      this.next();
      return true;
    }
    return false;
  }

  eatOp(v) {
    if (this.isOp(v)) {
      this.next();
      return true;
    }
    return false;
  }

  atStmtEnd() {
    const t = this.peek();
    return !t || t.t === 'eol' || (t.t === 'op' && t.v === ':');
  }

  skipToEol() {
    while (!this.atEnd() && this.peek().t !== 'eol') this.next();
    if (!this.atEnd()) this.next();
  }

  skipSeparators() {
    while (!this.atEnd() && (this.peek().t === 'eol' || this.isOp(':'))) this.next();
  }

  textFrom(start) {
    let out = '';
    let prev = null;
    for (const t of this.toks.slice(start, this.i)) {
      if (t.t === 'eol') break;
      const v = t.t === 'str' ? `"${t.v}"` : t.t === 'date' ? `#${t.v}#` : t.v;
      const tight = prev && (t.v === ')' || t.v === ',' || t.v === '.' || prev.v === '(' || prev.v === '.' || (t.v === '(' && prev.t === 'id'));
      out += (out && !tight ? ' ' : '') + v;
      prev = t;
    }
    return clip(out, 90);
  }

  // ---- expressions -----------------------------------------------------------

  parseExpr() {
    return this.parseImp();
  }

  binLoop(nextFn, ops) {
    let l = nextFn();
    for (;;) {
      const t = this.peek();
      const key = t?.t === 'id' ? t.u : t?.t === 'op' ? t.v : null;
      if (!key || !(key in ops)) return l;
      this.next();
      l = E.bin(ops[key], l, nextFn());
    }
  }

  // a Imp b is material implication: (Not a) Or b.
  parseImp() {
    let l = this.parseEqv();
    while (this.eatKw('IMP')) l = E.bin('or', E.un('not', l), this.parseEqv());
    return l;
  }

  parseEqv() {
    return this.binLoop(() => this.parseXor(), { EQV: '==' });
  }

  parseXor() {
    return this.binLoop(() => this.parseOr(), { XOR: '!=' });
  }

  parseOr() {
    return this.binLoop(() => this.parseAnd(), { OR: 'or' });
  }

  parseAnd() {
    return this.binLoop(() => this.parseNot(), { AND: 'and' });
  }

  parseNot() {
    if (this.eatKw('NOT')) return E.un('not', this.parseNot());
    return this.parseCmp();
  }

  parseCmp() {
    let l = this.parseConcat();
    for (;;) {
      const t = this.peek();
      if (t?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        this.next();
        const op = { '=': '==', '<>': '!=' }[t.v] || t.v;
        l = E.bin(op, l, this.parseConcat());
      } else if (this.isKw('LIKE')) {
        this.next();
        l = { k: 'call', fn: E.id('Like'), args: [l, this.parseConcat()], builtin: true };
      } else if (this.isKw('IS') && !this.isOp(['<', '>', '=', '<=', '>=', '<>'], 1)) {
        this.next();
        l = E.bin('==', l, this.parseConcat());
      } else return l;
    }
  }

  parseConcat() {
    return this.binLoop(() => this.parseAdd(), { '&': 'concat' });
  }

  parseAdd() {
    return this.binLoop(() => this.parseMod(), { '+': '+', '-': '-' });
  }

  parseMod() {
    return this.binLoop(() => this.parseIdiv(), { MOD: 'mod' });
  }

  parseIdiv() {
    return this.binLoop(() => this.parseMul(), { '\\': 'idiv' });
  }

  parseMul() {
    return this.binLoop(() => this.parseNeg(), { '*': '*', '/': 'div' });
  }

  parseNeg() {
    if (this.eatOp('-')) return E.un('neg', this.parseNeg());
    if (this.eatOp('+')) return this.parseNeg();
    return this.parsePow();
  }

  parsePow() {
    const base = this.parsePostfix();
    if (this.eatOp('^')) return E.bin('pow', base, this.parseNeg());
    return base;
  }

  parseArgs() {
    const args = [];
    if (this.eatOp(')')) return args;
    for (;;) {
      if (this.isOp(',')) {
        args.push(E.null());
      } else {
        this.eatKw(['BYVAL', 'BYREF']);
        if (this.peek()?.t === 'id' && this.isOp(':=', 1)) {
          this.next();
          this.next();
        }
        args.push(this.parseExpr());
      }
      if (this.eatOp(',')) continue;
      break;
    }
    this.eatOp(')');
    return args;
  }

  parsePostfix(allowParenArgs = true) {
    let e = this.parsePrimary();
    for (;;) {
      if (allowParenArgs && this.isOp('(')) {
        this.next();
        const args = this.parseArgs();
        e = { k: 'call', fn: e, args };
      } else if (this.isOp('.') && this.peek(1)?.t === 'id') {
        this.next();
        e = { k: 'member', obj: e, prop: this.next().v };
      } else if (this.isOp('!') && this.peek(1)?.t === 'id') {
        this.next();
        e = { k: 'index', obj: e, idx: [E.str(this.next().v)] };
      } else return e;
    }
  }

  parsePrimary() {
    const t = this.peek();
    if (!t || t.t === 'eol') return E.raw('');
    if (t.t === 'num') {
      this.next();
      return E.num(t.v);
    }
    if (t.t === 'str') {
      this.next();
      return E.str(t.v);
    }
    if (t.t === 'date') {
      this.next();
      return { k: 'call', fn: E.id('DateValue'), args: [E.str(t.v)], builtin: true };
    }
    if (this.isOp('(')) {
      this.next();
      const e = this.parseExpr();
      this.eatOp(')');
      return e;
    }
    if (this.isOp('.')) {
      this.next();
      const prop = this.next()?.v || '?';
      return { k: 'member', obj: E.id(this.withStack?.[this.withStack.length - 1] || 'With'), prop };
    }
    if (t.t === 'id') {
      this.next();
      switch (t.u) {
        case 'TRUE':
          return E.bool(true);
        case 'FALSE':
          return E.bool(false);
        case 'NOTHING':
        case 'NULL':
        case 'EMPTY':
          return E.null();
        case 'NEW': {
          const type = this.next()?.v || 'Object';
          return { k: 'new', type, args: [] };
        }
        case 'ME':
          return E.id('Me');
        default:
          return E.id(t.v);
      }
    }
    this.next();
    return E.raw(t.v);
  }

  // ---- declarations -------------------------------------------------------------

  // name[(bounds)] [As [New] Type] [= value]  — used by Dim/Private/Public/Const/Static/ReDim
  parseDeclarator(scope, isConst) {
    const nameTok = this.next();
    if (!nameTok || nameTok.t !== 'id') return null;
    const item = { name: nameTok.v, line: nameTok.line, scope, isConst };
    let dims = null;
    if (this.eatOp('(')) {
      dims = [];
      while (!this.atEnd() && !this.isOp(')') && !this.atStmtEnd()) {
        const lo = this.parseExpr();
        if (this.eatKw('TO')) dims.push({ lower: lo, upper: this.parseExpr() });
        else dims.push({ lower: E.num(0), upper: lo });
        this.eatOp(',');
      }
      this.eatOp(')');
    }
    let typeName = null;
    let isNew = false;
    if (this.eatKw('AS')) {
      isNew = this.eatKw('NEW');
      typeName = this.next()?.v;
      while (this.isOp('.') && this.peek(1)?.t === 'id') {
        this.next();
        typeName += `.${this.next().v}`;
      }
      if (this.isOp('*')) {
        this.next();
        this.next();
      }
    }
    let type = vbType(typeName, nameTok.suffix);
    item.legacyType = typeName || (nameTok.suffix ? `${nameTok.suffix} suffix` : 'Variant');
    if (dims) {
      const d0 = dims[0];
      let length = null;
      let lower = 0;
      if (d0 && d0.lower.k === 'num' && d0.upper.k === 'num') {
        lower = Number(d0.lower.v);
        length = Number(d0.upper.v) - lower + 1;
      }
      type = { ...T.array(type, length), lower, dims: dims.length };
      item.dims = dims;
      item.legacyType = `${typeName || 'Variant'}()`;
    }
    item.type = type;
    if (isNew) item.initial = { k: 'new', type: typeName, args: [] };
    if (this.eatOp('=')) item.initial = this.parseExpr();
    return item;
  }

  parseDeclList(scope, isConst) {
    const items = [];
    for (;;) {
      this.eatKw('WITHEVENTS');
      const item = this.parseDeclarator(scope, isConst);
      if (item) items.push(item);
      if (!this.eatOp(',')) break;
    }
    return items;
  }

  parseParams() {
    const params = [];
    if (!this.eatOp('(')) return params;
    while (!this.atEnd() && !this.isOp(')') && !this.atStmtEnd()) {
      let byRef = true;
      let optional = false;
      for (;;) {
        if (this.eatKw('OPTIONAL')) optional = true;
        else if (this.eatKw('BYVAL')) byRef = false;
        else if (this.eatKw('BYREF')) byRef = true;
        else if (this.eatKw('PARAMARRAY')) optional = true;
        else break;
      }
      const nameTok = this.next();
      let isArray = false;
      if (this.isOp('(') && this.isOp(')', 1)) {
        this.next();
        this.next();
        isArray = true;
      }
      let typeName = null;
      if (this.eatKw('AS')) typeName = this.next()?.v;
      let def = null;
      if (this.eatOp('=')) def = this.parseExpr();
      let type = vbType(typeName, nameTok?.suffix);
      if (isArray) type = T.array(type, null);
      params.push({ name: nameTok?.v || '?', type, byRef, optional, default: def, legacyType: typeName || 'Variant' });
      this.eatOp(',');
    }
    this.eatOp(')');
    return params;
  }

  // ---- statements ---------------------------------------------------------------

  // Stops at block terminators (Else, ElseIf, End X, Case, Next, Loop, Wend).
  parseBlock(stopWhen) {
    const out = [];
    for (;;) {
      this.skipSeparators();
      if (this.atEnd()) break;
      const t = this.peek();
      if (t.t === 'id' && BLOCK_END_WORDS.has(t.u) && stopWhen(t, this.peek(1))) break;
      const before = this.i;
      const s = this.parseStatement();
      if (Array.isArray(s)) out.push(...s);
      else if (s) out.push(s);
      if (this.i === before) this.next();
    }
    return out;
  }

  // Statements on the rest of the current line (single-line If).
  parseInline(stopWords) {
    const out = [];
    for (;;) {
      while (this.isOp(':')) this.next();
      const t = this.peek();
      if (!t || t.t === 'eol') break;
      if (t.t === 'id' && stopWords.includes(t.u)) break;
      const before = this.i;
      const s = this.parseStatement(true);
      if (Array.isArray(s)) out.push(...s);
      else if (s) out.push(s);
      if (this.i === before) this.next();
    }
    return out;
  }

  parseStatement(inline = false) {
    const start = this.i;
    const t = this.peek();
    const line = t.line;
    const mk = (s) => ({ line, text: this.textFrom(start), ...s });
    // Labels / line numbers at the start of a line
    const prevTok = this.toks[start - 1];
    const lineStart = !prevTok || prevTok.t === 'eol';
    if (lineStart && t.t === 'id' && this.isOp(':', 1) && !this.isOp(':=', 1) && !BLOCK_END_WORDS.has(t.u)) {
      this.next();
      this.next();
      return { k: 'label', name: t.v, line, text: `${t.v}:` };
    }
    if (lineStart && t.t === 'num') {
      this.next();
      return { k: 'label', name: t.v, line, text: t.v };
    }
    if (t.t !== 'id') {
      if (this.isOp('.')) return this.parseAssignOrCall(start, line, inline);
      this.next();
      return null;
    }
    switch (t.u) {
      case 'DIM':
      case 'STATIC':
      case 'PRIVATE':
      case 'PUBLIC': {
        this.next();
        const isConst = this.eatKw('CONST');
        const items = this.parseDeclList('local', isConst);
        const text = this.textFrom(start);
        return items.map((d) => ({ k: 'decl', name: d.name, type: d.type, init: d.initial || null, legacyType: d.legacyType, isConst, dims: d.dims, line: d.line, text }));
      }
      case 'CONST': {
        this.next();
        const items = this.parseDeclList('local', true);
        const text = this.textFrom(start);
        return items.map((d) => ({ k: 'decl', name: d.name, type: d.type, init: d.initial || null, isConst: true, line: d.line, text }));
      }
      case 'REDIM': {
        this.next();
        const preserve = this.eatKw('PRESERVE');
        const items = this.parseDeclList('local', false);
        const text = this.textFrom(start);
        return items.map((d) => ({ k: 'decl', name: d.name, type: d.type, init: null, redim: true, preserve, dims: d.dims, line, text, note: preserve ? 'ReDim Preserve resizes while keeping existing elements' : 'ReDim reallocates the array' }));
      }
      case 'SET':
      case 'LET':
        this.next();
        return this.parseAssignOrCall(start, line, inline);
      case 'IF':
        return this.parseIf(start, line);
      case 'SELECT':
        return this.parseSelect(start, line);
      case 'FOR':
        return this.parseFor(start, line);
      case 'DO':
        return this.parseDo(start, line);
      case 'WHILE': {
        this.next();
        const cond = this.parseExpr();
        const text = this.textFrom(start);
        const body = this.parseBlock((w) => w.u === 'WEND');
        this.eatKw('WEND');
        return { k: 'while', cond, testAfter: false, body, verb: 'WHILE', line, text };
      }
      case 'WITH': {
        this.next();
        const obj = this.parseExpr();
        const text = this.textFrom(start);
        this.withStack = [...(this.withStack || []), obj.k === 'id' ? obj.name : 'With'];
        const body = this.parseBlock((w, n) => w.u === 'END' && n?.u === 'WITH');
        this.withStack.pop();
        this.next();
        this.next();
        return { k: 'block', body, note: `With ${obj.k === 'id' ? obj.name : 'block'}`, verb: 'WITH', line, text };
      }
      case 'EXIT': {
        this.next();
        const what = this.next()?.u;
        const scope = what === 'FOR' || what === 'DO' ? 'loop' : 'procedure';
        return mk({ k: 'exit', scope, verb: `EXIT ${what || ''}`.trim() });
      }
      case 'END': {
        if (this.peek(1)?.t === 'eol' || this.isOp(':', 1) || !this.peek(1)) {
          this.next();
          return mk({ k: 'exit', scope: 'program', verb: 'END' });
        }
        this.diagnostics.push({ severity: 'warning', line, message: `Unexpected End ${this.peek(1)?.v || ''}` });
        this.next();
        this.next();
        return null;
      }
      case 'CALL': {
        this.next();
        const e = this.parsePostfix();
        return this.callStatement(e, mk);
      }
      case 'GOTO':
        this.next();
        return mk({ k: 'goto', label: this.next()?.v || '?', verb: 'GOTO' });
      case 'GOSUB':
        this.next();
        return mk({ k: 'call', callee: this.next()?.v || '?', args: [], gosub: true, verb: 'GOSUB', note: 'GoSub jumps to a label inside the procedure and Return comes back' });
      case 'RETURN':
        this.next();
        return mk({ k: 'return', value: null, verb: 'RETURN', note: 'Return from GoSub' });
      case 'ON': {
        this.next();
        if (this.eatKw('ERROR')) {
          let mode;
          if (this.eatKw('RESUME')) {
            this.eatKw('NEXT');
            mode = 'resume-next';
          } else if (this.eatKw('GOTO')) {
            const target = this.next()?.v;
            mode = target === '0' ? 'reset' : `goto ${target}`;
          }
          return mk({ k: 'raw', verb: 'ON ERROR', errorMode: mode, note: 'VB6 unstructured error handling; map to try/catch' });
        }
        while (!this.atStmtEnd()) this.next();
        return mk({ k: 'raw', verb: 'ON GOTO', note: 'Computed GoTo' });
      }
      case 'RESUME':
        this.next();
        while (!this.atStmtEnd()) this.next();
        return mk({ k: 'raw', verb: 'RESUME', note: 'Resume after error' });
      case 'ERASE':
        this.next();
        while (!this.atStmtEnd()) this.next();
        return mk({ k: 'raw', verb: 'ERASE', note: 'Erase clears array contents' });
      case 'STOP':
        this.next();
        return mk({ k: 'raw', verb: 'STOP', note: 'Debugger breakpoint' });
      case 'RAISEEVENT':
        this.next();
        while (!this.atStmtEnd()) this.next();
        return mk({ k: 'raw', verb: 'RAISEEVENT', note: 'Raises a class event' });
      case 'OPEN':
      case 'CLOSE':
      case 'GET':
      case 'PUT':
      case 'WRITE':
      case 'INPUT':
        if (t.u === 'INPUT' || t.u === 'WRITE' || t.u === 'GET' || t.u === 'PUT' ? this.isOp('#', 1) : true) return this.parseFileIo(start, line, t.u);
        break;
      case 'LINE':
        if (this.isKw('INPUT', 1)) return this.parseFileIo(start, line, 'LINE INPUT');
        break;
      case 'PRINT':
        if (this.isOp('#', 1)) return this.parseFileIo(start, line, 'PRINT');
        break;
      case 'MSGBOX': {
        if (this.isOp('=', 1)) break;
        this.next();
        const args = this.isOp('(') ? (this.next(), this.parseArgs()) : this.parseBareArgs();
        return mk({ k: 'print', args: args.slice(0, 1), newline: true, verb: 'MSGBOX', dialog: true });
      }
      case 'DEBUG':
        if (this.isOp('.', 1) && this.isKw('PRINT', 2)) {
          this.next();
          this.next();
          this.next();
          const { args, newline } = this.parsePrintList();
          return mk({ k: 'print', args, newline, verb: 'DEBUG.PRINT' });
        }
        break;
      default:
    }
    return this.parseAssignOrCall(start, line, inline);
  }

  parsePrintList() {
    const args = [];
    let newline = true;
    while (!this.atStmtEnd() && !this.isKw('ELSE')) {
      if (this.isOp(';') || this.isOp(',')) {
        this.next();
        newline = !this.atStmtEnd() ? newline : false;
        continue;
      }
      if (this.isKw(['SPC', 'TAB']) && this.isOp('(', 1)) {
        this.next();
        this.next();
        this.parseArgs();
        args.push(E.str(' '));
        continue;
      }
      args.push(this.parseExpr());
      newline = true;
    }
    return { args, newline };
  }

  parseBareArgs() {
    const args = [];
    while (!this.atStmtEnd() && !this.isKw('ELSE')) {
      if (this.isOp(',')) {
        this.next();
        if (this.isOp(',') || this.atStmtEnd()) args.push(E.null());
        continue;
      }
      if (this.peek()?.t === 'id' && this.isOp(':=', 1)) {
        this.next();
        this.next();
      }
      args.push(this.parseExpr());
    }
    return args;
  }

  parseFileIo(start, line, verb) {
    this.next();
    if (verb === 'LINE INPUT') this.next();
    const args = [];
    let file = null;
    if (verb === 'OPEN') {
      const path = this.parseExpr();
      let mode = 'Random';
      if (this.eatKw('FOR')) mode = this.next()?.v || mode;
      while (!this.atStmtEnd() && !this.isKw('AS')) this.next();
      if (this.eatKw('AS')) {
        this.eatOp('#');
        file = this.parseExpr();
      }
      while (!this.atStmtEnd()) this.next();
      return { k: 'io', op: 'open', file: file ? this.exprLabel(file) : '?', mode, args: [path], target: null, verb: 'OPEN', line, text: this.textFrom(start) };
    }
    if (this.eatOp('#')) file = this.parsePostfix();
    if (verb === 'CLOSE') {
      while (!this.atStmtEnd()) this.next();
      return { k: 'io', op: 'close', file: file ? this.exprLabel(file) : 'all', args: [], target: null, verb, line, text: this.textFrom(start) };
    }
    this.eatOp(',');
    while (!this.atStmtEnd()) {
      if (this.isOp(',') || this.isOp(';')) {
        this.next();
        continue;
      }
      args.push(this.parseExpr());
    }
    const read = verb === 'INPUT' || verb === 'LINE INPUT' || verb === 'GET';
    return { k: 'io', op: read ? 'read' : 'write', file: file ? this.exprLabel(file) : '?', target: read ? args[0] || null : null, args: read ? args.slice(1) : args, verb, line, text: this.textFrom(start) };
  }

  exprLabel(e) {
    return e.k === 'num' ? `#${e.v}` : e.k === 'id' ? e.name : 'file';
  }

  callStatement(e, mk) {
    if (e.k === 'id') return mk({ k: 'call', callee: e.name, args: [], verb: 'CALL' });
    if (e.k === 'call' && e.fn.k === 'id') return mk({ k: 'call', callee: e.fn.name, args: e.args, verb: 'CALL' });
    return mk({ k: 'exprstmt', expr: e, verb: 'CALL' });
  }

  parseAssignOrCall(start, line, inline) {
    const mk = (s) => ({ line, text: this.textFrom(start), ...s });
    const target = this.parsePostfix();
    if (this.isOp('=')) {
      this.next();
      const value = this.parseExpr();
      return mk({ k: 'assign', target, value, verb: 'ASSIGN' });
    }
    // Sub call without parentheses: Name arg1, arg2   |   obj.Method arg
    if (!this.atStmtEnd() && !(inline && this.isKw('ELSE'))) {
      const args = this.parseBareArgs();
      if (target.k === 'id') return mk({ k: 'call', callee: target.name, args, verb: 'CALL' });
      if (target.k === 'member') return mk({ k: 'exprstmt', expr: { k: 'call', fn: target, args }, verb: 'CALL' });
      if (target.k === 'call') return mk({ k: 'exprstmt', expr: { ...target, args: [...target.args, ...args] }, verb: 'CALL' });
    }
    if (target.k === 'id') return mk({ k: 'call', callee: target.name, args: [], verb: 'CALL' });
    if (target.k === 'call' && target.fn.k === 'id') return mk({ k: 'call', callee: target.fn.name, args: target.args, verb: 'CALL' });
    if (target.k === 'raw' && !target.text) return null;
    return mk({ k: 'exprstmt', expr: target, verb: 'CALL' });
  }

  parseIf(start, line) {
    this.next();
    const cond = this.parseExpr();
    this.eatKw('THEN');
    const text = this.textFrom(start);
    if (!this.atStmtEnd() || this.isOp(':')) {
      if (this.peek()?.t !== 'eol') {
        // Single-line If: If c Then a: b Else d
        const thenB = this.parseInline(['ELSE']);
        let elseB = null;
        if (this.eatKw('ELSE')) elseB = this.parseInline([]);
        return { k: 'if', cond, then: thenB, else: elseB, verb: 'IF', line, text, singleLine: true };
      }
    }
    const thenB = this.parseBlock((w, n) => w.u === 'ELSE' || w.u === 'ELSEIF' || (w.u === 'END' && n?.u === 'IF'));
    let elseB = null;
    if (this.isKw('ELSEIF')) {
      const s2 = this.i;
      const l2 = this.peek().line;
      elseB = [this.parseIf(s2, l2)];
      return { k: 'if', cond, then: thenB, else: elseB, verb: 'IF', line, text };
    }
    if (this.eatKw('ELSE')) {
      elseB = this.parseBlock((w, n) => w.u === 'END' && n?.u === 'IF');
    }
    if (this.isKw('END') && this.isKw('IF', 1)) {
      this.next();
      this.next();
    }
    return { k: 'if', cond, then: thenB, else: elseB, verb: 'IF', line, text };
  }

  parseSelect(start, line) {
    this.next();
    this.eatKw('CASE');
    const subject = this.parseExpr();
    const text = this.textFrom(start);
    const cases = [];
    let dflt = null;
    const stop = (w, n) => w.u === 'CASE' || (w.u === 'END' && n?.u === 'SELECT');
    this.skipSeparators();
    while (this.isKw('CASE')) {
      const caseLine = this.peek().line;
      this.next();
      if (this.eatKw('ELSE')) {
        dflt = this.parseBlock(stop);
        continue;
      }
      const tests = [];
      while (!this.atStmtEnd()) {
        if (this.eatKw('IS')) {
          const opTok = this.next();
          const op = { '=': '==', '<>': '!=' }[opTok?.v] || opTok?.v;
          tests.push({ kind: 'cmp', op, value: this.parseExpr() });
        } else {
          const v = this.parseExpr();
          if (this.eatKw('TO')) tests.push({ kind: 'range', from: v, to: this.parseExpr() });
          else tests.push({ kind: 'value', value: v });
        }
        if (!this.eatOp(',')) break;
      }
      cases.push({ tests, body: this.parseBlock(stop), line: caseLine });
      this.skipSeparators();
    }
    if (this.isKw('END') && this.isKw('SELECT', 1)) {
      this.next();
      this.next();
    }
    return { k: 'switch', subject, cases, default: dflt, verb: 'SELECT CASE', line, text };
  }

  parseFor(start, line) {
    this.next();
    if (this.eatKw('EACH')) {
      const varName = this.next()?.v || 'item';
      this.eatKw('IN');
      const iter = this.parseExpr();
      const text = this.textFrom(start);
      const body = this.parseBlock((w) => w.u === 'NEXT');
      this.eatNext();
      return { k: 'foreach', varName, iter, body, verb: 'FOR EACH', line, text };
    }
    const variable = this.parsePostfix(false);
    this.eatOp('=');
    const from = this.parseExpr();
    this.eatKw('TO');
    const to = this.parseExpr();
    let step = E.num(1);
    if (this.eatKw('STEP')) step = this.parseExpr();
    const text = this.textFrom(start);
    const body = this.parseBlock((w) => w.u === 'NEXT');
    this.eatNext();
    const negative = (step.k === 'un' && step.op === 'neg') || (step.k === 'num' && step.v.startsWith('-'));
    const next = E.bin('+', variable, step);
    return {
      k: 'for',
      init: [{ k: 'assign', target: variable, value: from, line, text: `${exprToText(variable)} = ${exprToText(from)}` }],
      cond: E.bin(negative ? '>=' : '<=', variable, to),
      update: [{ k: 'assign', target: variable, value: next, line, text: `${exprToText(variable)} = ${exprToText(next)}`, compound: true }],
      body,
      verb: 'FOR',
      line,
      text,
    };
  }

  eatNext() {
    if (this.eatKw('NEXT')) {
      // "Next i" or "Next i, j" closes one or more loops; only the first is ours.
      if (this.peek()?.t === 'id' && !this.isOp(',', 1)) this.next();
    }
  }

  parseDo(start, line) {
    this.next();
    let cond = null;
    let testAfter = false;
    if (this.isKw(['WHILE', 'UNTIL'])) {
      const until = this.next().u === 'UNTIL';
      const c = this.parseExpr();
      cond = until ? E.un('not', c) : c;
    }
    const text = this.textFrom(start);
    const body = this.parseBlock((w) => w.u === 'LOOP');
    this.eatKw('LOOP');
    if (!cond && this.isKw(['WHILE', 'UNTIL'])) {
      const until = this.next().u === 'UNTIL';
      const c = this.parseExpr();
      cond = until ? E.un('not', c) : c;
      testAfter = true;
    }
    return { k: 'while', cond: cond || E.bool(true), testAfter, body, verb: 'DO LOOP', line, text, infinite: !cond };
  }

  // ---- module ---------------------------------------------------------------------

  parseModule(modName) {
    const dataItems = [];
    const types = [];
    const procedures = [];
    const imports = [];
    const options = [];
    // Pre-scan procedure names so bare-word calls can be told apart from variables.
    for (let j = 0; j < this.toks.length; j += 1) {
      const t = this.toks[j];
      if (t.t === 'id' && (t.u === 'SUB' || t.u === 'FUNCTION') && this.toks[j + 1]?.t === 'id' && this.toks[j - 1]?.u !== 'END' && this.toks[j - 1]?.u !== 'EXIT' && this.toks[j - 1]?.u !== 'DECLARE') {
        this.procNames.add(this.toks[j + 1].u);
      }
    }
    while (!this.atEnd()) {
      this.skipSeparators();
      if (this.atEnd()) break;
      const start = this.i;
      const t = this.peek();
      if (t.t !== 'id') {
        this.skipToEol();
        continue;
      }
      if (t.u === 'OPTION') {
        this.next();
        const words = [];
        while (!this.atEnd() && this.peek().t !== 'eol') words.push(this.next().v);
        options.push(words.join(' '));
        continue;
      }
      if (t.u === 'IMPLEMENTS') {
        this.next();
        imports.push(this.next()?.v);
        this.skipToEol();
        continue;
      }
      let visibility = 'public';
      let isStatic = false;
      let j = 0;
      while (this.isKw(['PUBLIC', 'PRIVATE', 'FRIEND', 'GLOBAL', 'STATIC'], j)) {
        const w = this.peek(j).u;
        if (w === 'PRIVATE') visibility = 'private';
        if (w === 'STATIC') isStatic = true;
        j += 1;
      }
      const head = this.peek(j);
      const headU = head?.t === 'id' ? head.u : null;
      if (headU === 'SUB' || headU === 'FUNCTION' || headU === 'PROPERTY') {
        this.i += j;
        procedures.push(this.parseProcedure(modName, visibility, isStatic));
        continue;
      }
      if (headU === 'DECLARE') {
        this.i += j + 1;
        this.eatKw('PTRSAFE');
        const kind = this.next()?.v;
        const name = this.next()?.v;
        let lib = null;
        if (this.eatKw('LIB')) lib = this.peek()?.t === 'str' ? this.next().v : null;
        imports.push(`${name} (${kind} in ${lib || 'external library'})`);
        this.skipToEol();
        continue;
      }
      if (headU === 'TYPE') {
        this.i += j + 1;
        const name = this.next()?.v || 'Record';
        const fields = [];
        this.skipSeparators();
        while (!this.atEnd() && !(this.isKw('END') && this.isKw('TYPE', 1))) {
          const f = this.parseDeclarator('field', false);
          if (f) fields.push(f);
          this.skipToEol();
        }
        this.i += 2;
        types.push({ name, kind: 'record', fields, line: t.line });
        continue;
      }
      if (headU === 'ENUM') {
        this.i += j + 1;
        const name = this.next()?.v || 'Enum';
        let counter = 0;
        this.skipSeparators();
        const members = [];
        while (!this.atEnd() && !(this.isKw('END') && this.isKw('ENUM', 1))) {
          const m = this.next();
          let value = E.num(counter);
          if (this.eatOp('=')) value = this.parseExpr();
          if (value.k === 'num') counter = Number(value.v) + 1;
          else counter += 1;
          if (m?.t === 'id') members.push({ name: m.v, value });
          this.skipToEol();
        }
        this.i += 2;
        types.push({ name, kind: 'enum', members, line: t.line });
        for (const m of members) dataItems.push({ name: m.name, type: { ...T.int }, initial: m.value, scope: 'const', isConst: true, enum: name, line: t.line, legacyType: `${name} (Enum)` });
        continue;
      }
      if (headU === 'EVENT') {
        this.skipToEol();
        continue;
      }
      if (headU === 'DIM' || headU === 'CONST' || j > 0) {
        this.i += j;
        if (this.isKw('DIM')) this.next();
        const isConst = this.eatKw('CONST');
        const items = this.parseDeclList(isConst ? 'const' : 'module', isConst);
        for (const d of items) dataItems.push({ ...d, visibility });
        this.skipToEol();
        continue;
      }
      this.diagnostics.push({ severity: 'warning', line: t.line, message: `Statement outside a procedure: ${this.textFrom(start) || t.v}` });
      this.skipToEol();
    }
    return { dataItems, types, procedures, imports, options };
  }

  parseProcedure(modName, visibility, isStatic) {
    const headTok = this.next();
    let kind = headTok.u.toLowerCase();
    if (kind === 'property') kind = `property-${(this.next()?.v || 'get').toLowerCase()}`;
    const nameTok = this.next();
    const name = nameTok?.v || 'Anonymous';
    const params = this.parseParams();
    let returns = null;
    if (this.eatKw('AS')) returns = vbType(this.next()?.v);
    else if (kind === 'function' || kind === 'property-get') returns = vbType(null, nameTok?.suffix);
    const endWord = headTok.u;
    const body = this.parseBlock((w, n) => w.u === 'END' && n?.u === endWord);
    const endTok = this.peek();
    if (this.isKw('END') && this.isKw(endWord, 1)) {
      this.next();
      this.next();
    } else {
      this.diagnostics.push({ severity: 'error', line: headTok.line, message: `Missing End ${headTok.v} for ${name}` });
    }
    const id = `${modName}::${name}${kind.startsWith('property-') && kind !== 'property-get' ? `::${kind.slice(9)}` : ''}`;
    return {
      id,
      name,
      kind,
      params,
      returns,
      visibility,
      isStatic,
      body,
      loc: { start: headTok.line, end: endTok?.line || headTok.line },
      isEventHandler: EVENT_HANDLER.test(name),
    };
  }
}

// Post-pass: name(args) is an array index when name is a declared array; assignments to the
// function name are return values.
function resolveSemantics(mod, parser) {
  const moduleArrays = new Set(mod.dataItems.filter((d) => d.type?.t === 'array').map((d) => d.name.toUpperCase()));
  const procNames = new Set(mod.procedures.map((p) => p.name.toUpperCase()));
  const fixExpr = (e, arrays) => {
    walkExpr(e, (x) => {
      if (x.k === 'call' && x.fn?.k === 'id' && arrays.has(x.fn.name.toUpperCase())) {
        x.k = 'index';
        x.obj = x.fn;
        x.idx = x.args;
        delete x.fn;
        delete x.args;
      }
    });
    return e;
  };
  for (const p of mod.procedures) {
    const arrays = new Set(moduleArrays);
    for (const prm of p.params) if (prm.type?.t === 'array') arrays.add(prm.name.toUpperCase());
    walkStatements(p.body, (s) => {
      if (s.k === 'decl' && s.type?.t === 'array') arrays.add(s.name.toUpperCase());
    });
    walkStatements(p.body, (s) => {
      for (const key of ['target', 'value', 'cond', 'subject', 'iter', 'count', 'expr', 'init']) {
        if (s[key] && typeof s[key] === 'object' && s[key].k) fixExpr(s[key], arrays);
      }
      for (const key of ['args']) if (Array.isArray(s[key])) s[key].forEach((a) => fixExpr(a, arrays));
      if (s.k === 'switch') for (const c of s.cases) for (const t of c.tests) ['value', 'from', 'to'].forEach((f) => t[f] && fixExpr(t[f], arrays));
      if (s.k === 'call' && arrays.has(s.callee.toUpperCase()) && s.args.length) {
        // "arr(i)" alone on a line is not a call — keep as expression statement
        s.k = 'exprstmt';
        s.expr = { k: 'index', obj: E.id(s.callee), idx: s.args };
      }
      if (s.k === 'assign' && s.target.k === 'id' && s.target.name.toUpperCase() === p.name.toUpperCase() && (p.kind === 'function' || p.kind === 'property-get')) {
        s.returnValue = true;
      }
      if (s.k === 'call' && !procNames.has(s.callee.toUpperCase()) && !parser.procNames.has(s.callee.toUpperCase())) {
        s.external = true;
      }
    });
  }
  for (const d of mod.dataItems) if (d.initial) fixExpr(d.initial, moduleArrays);
}

export function parseVb6(source, { fileName = 'Module1.bas' } = {}) {
  const diagnostics = [];
  const { toks, attributes, controls } = tokenizeVb(source);
  const parser = new VbParser(toks, diagnostics);
  const baseName = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const modName = attributes.VB_Name || baseName;
  const res = parser.parseModule(modName);
  const ext = fileName.toLowerCase().split('.').pop();
  const kind = ext === 'cls' ? 'class' : ext === 'frm' ? 'form' : 'module';
  const entry =
    res.procedures.find((p) => p.name.toUpperCase() === 'MAIN') ||
    res.procedures.find((p) => /^(Form|MDIForm)_Load$/i.test(p.name)) ||
    res.procedures.find((p) => /^Class_Initialize$/i.test(p.name)) ||
    null;
  const mod = {
    file: fileName,
    language: 'vb6',
    name: modName,
    kind,
    dataItems: res.dataItems.map((d) => ({ ...d, scope: d.isConst ? 'const' : 'module' })),
    types: res.types,
    procedures: res.procedures,
    entry: entry?.id || null,
    imports: res.imports,
    diagnostics,
    meta: { options: res.options, controls, attributes, tokens: toks.length },
  };
  resolveSemantics(mod, parser);
  return mod;
}
