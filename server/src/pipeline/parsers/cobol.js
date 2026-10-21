import { E, T, clip, exprToText } from '../ir.js';

// ---------------------------------------------------------------------------
// Source normalisation: fixed (cols 7/8-72) vs free format, comments, COPY.
// ---------------------------------------------------------------------------

function stripInlineComment(text) {
  let quote = null;
  for (let i = 0; i < text.length - 1; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '*' && text[i + 1] === '>') {
      return text.slice(0, i);
    }
  }
  return text;
}

function detectFixed(rawLines, source) {
  if (/>>\s*SOURCE\s+(FORMAT\s+)?(IS\s+)?FREE/i.test(source)) return false;
  const nonBlank = rawLines.filter((l) => l.trim());
  if (!nonBlank.length) return true;
  const fixedLike = nonBlank.filter((l) => /^[\d ]{6}[ *\/\-Dd]/.test(l) || /^[\d ]{0,6}$/.test(l)).length;
  return fixedLike / nonBlank.length >= 0.8;
}

// Columns 73-80 of fixed-format source are an identification area (sequence tags such as
// "PAY00010"). Quotes, periods or parentheses there, or lines past column 80, mean the code
// itself runs on: treat the source as variable format (code to end of line) instead of
// silently cutting statements off at column 72.
function detectOverflow(rawLines) {
  return rawLines.findIndex((l) => {
    if (l.length <= 72 || /^[\d ]{6}[*/]/.test(l)) return false;
    return l.length > 80 || /['".()]/.test(l.slice(72, 80));
  });
}

function normalize(source, { resolveCopy, diagnostics, depth = 0, lineBase = null }) {
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
  const fixed = detectFixed(rawLines, source);
  const overflowAt = fixed ? detectOverflow(rawLines) : -1;
  const codeEnd = overflowAt >= 0 ? undefined : 72;
  if (overflowAt >= 0 && depth === 0) {
    diagnostics.push({ severity: 'info', line: overflowAt + 1, message: 'Code continues past column 72; reading the source as variable-format COBOL (columns 8 to end of line)' });
  }
  const out = [];
  const copies = [];
  rawLines.forEach((line, i) => {
    const n = lineBase ?? i + 1;
    let code;
    if (fixed) {
      const ind = line[6];
      if (ind === '*' || ind === '/' || ind === 'D' || ind === 'd') code = '';
      else if (ind === '-' && out.length) {
        const cont = line.slice(7, codeEnd);
        const q = cont.search(/["']/);
        const prev = out[out.length - 1];
        prev.text = q >= 0 ? prev.text + cont.slice(q + 1) : `${prev.text.trimEnd()} ${cont.trim()}`;
        out.push({ n, text: '' });
        return;
      } else code = line.slice(7, codeEnd);
    } else {
      code = line.trimStart().startsWith('*>') || /^\s*>>/.test(line) ? '' : line;
    }
    code = stripInlineComment(code);
    const copy = code.match(/^\s*COPY\s+["']?([A-Za-z0-9][A-Za-z0-9_-]*)["']?(?:\s+OF\s+\S+)?[^.]*\.\s*$/i);
    if (copy) {
      const name = copy[1].toUpperCase();
      copies.push(name);
      const text = depth < 5 && resolveCopy ? resolveCopy(name) : null;
      if (text == null) {
        diagnostics.push({ severity: 'warning', line: n, message: `Copybook ${name} not found in project; its fields are unknown` });
        out.push({ n, text: '' });
      } else {
        const inner = normalize(text, { resolveCopy, diagnostics, depth: depth + 1, lineBase: n });
        out.push(...inner.lines);
        copies.push(...inner.copies);
      }
      return;
    }
    out.push({ n, text: code });
  });
  return { lines: out, fixed, variable: overflowAt >= 0, copies };
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(lines) {
  const toks = [];
  const expectingPic = () => {
    const a = toks[toks.length - 1];
    const b = toks[toks.length - 2];
    if (!a || a.t !== 'word') return false;
    if (a.v === 'PIC' || a.v === 'PICTURE') return true;
    return a.v === 'IS' && b && b.t === 'word' && (b.v === 'PIC' || b.v === 'PICTURE');
  };
  for (const { n, text } of lines) {
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === ',' || c === ';') {
        i += 1;
        continue;
      }
      if (expectingPic()) {
        let j = i;
        while (j < text.length && !/\s/.test(text[j])) j += 1;
        let pic = text.slice(i, j);
        let period = false;
        if (pic.endsWith('.')) {
          pic = pic.slice(0, -1);
          period = true;
        }
        toks.push({ t: 'pic', v: pic.toUpperCase(), line: n, col: i });
        if (period) toks.push({ t: '.', v: '.', line: n, col: j - 1 });
        i = j;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        let val = '';
        while (j < text.length) {
          if (text[j] === c) {
            if (text[j + 1] === c) {
              val += c;
              j += 2;
              continue;
            }
            break;
          }
          val += text[j];
          j += 1;
        }
        toks.push({ t: 'str', v: val, line: n, col: i });
        i = j + 1;
        continue;
      }
      if (c === '.' && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
        toks.push({ t: '.', v: '.', line: n, col: i });
        i += 1;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
        let j = i;
        while (j < text.length && /[0-9A-Za-z-]/.test(text[j])) j += 1;
        let word = text.slice(i, j);
        if (/^\d*$/.test(word) && text[j] === '.' && /[0-9]/.test(text[j + 1] || '')) {
          j += 1;
          while (j < text.length && /[0-9]/.test(text[j])) j += 1;
          word = text.slice(i, j);
          toks.push({ t: 'num', v: word, line: n, col: i });
        } else if (/^\d+$/.test(word)) {
          toks.push({ t: 'num', v: word, line: n, col: i });
        } else {
          while (word.endsWith('-')) {
            word = word.slice(0, -1);
            j -= 1;
          }
          toks.push({ t: 'word', v: word.toUpperCase(), line: n, col: i });
        }
        i = j;
        continue;
      }
      if (/[A-Za-z]/.test(c)) {
        let j = i;
        while (j < text.length && /[A-Za-z0-9_-]/.test(text[j])) j += 1;
        let word = text.slice(i, j);
        while (word.endsWith('-')) {
          word = word.slice(0, -1);
          j -= 1;
        }
        // Hex / national literals: X'41', N'..', Z'..'
        if (/^[XNZ]$/i.test(word) && (text[j] === '"' || text[j] === "'")) {
          i = j;
          continue;
        }
        toks.push({ t: 'word', v: word.toUpperCase(), line: n, col: i });
        i = j;
        continue;
      }
      const two = text.slice(i, i + 2);
      if (two === '**' || two === '>=' || two === '<=' || two === '<>') {
        toks.push({ t: 'op', v: two, line: n, col: i });
        i += 2;
        continue;
      }
      if ('+-*/=()<>:&'.includes(c)) {
        toks.push({ t: 'op', v: c, line: n, col: i });
        i += 1;
        continue;
      }
      i += 1;
    }
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const VERBS = new Set([
  'ACCEPT', 'ADD', 'ALTER', 'CALL', 'CANCEL', 'CLOSE', 'COMPUTE', 'CONTINUE', 'DELETE', 'DISPLAY', 'DIVIDE',
  'EVALUATE', 'EXIT', 'GO', 'GOBACK', 'IF', 'INITIALIZE', 'INSPECT', 'INVOKE', 'MERGE', 'MOVE', 'MULTIPLY',
  'NEXT', 'OPEN', 'PERFORM', 'READ', 'RELEASE', 'RETURN', 'REWRITE', 'SEARCH', 'SET', 'SORT', 'START', 'STOP',
  'STRING', 'SUBTRACT', 'UNSTRING', 'WRITE', 'ENTRY', 'EXEC',
]);

const TERMINATORS = new Set([
  'ELSE', 'WHEN', 'END-IF', 'END-EVALUATE', 'END-PERFORM', 'END-READ', 'END-WRITE', 'END-REWRITE', 'END-DELETE',
  'END-START', 'END-COMPUTE', 'END-ADD', 'END-SUBTRACT', 'END-MULTIPLY', 'END-DIVIDE', 'END-CALL', 'END-STRING',
  'END-UNSTRING', 'END-SEARCH', 'END-ACCEPT', 'END-DISPLAY', 'END-RETURN', 'END-EXEC',
]);

const RESERVED = new Set([
  ...VERBS, ...TERMINATORS,
  'THEN', 'OTHER', 'NOT', 'AT', 'ON', 'INVALID', 'SIZE', 'ERROR', 'TO', 'FROM', 'BY', 'GIVING', 'INTO', 'REMAINDER',
  'ROUNDED', 'UNTIL', 'VARYING', 'TIMES', 'THRU', 'THROUGH', 'WITH', 'TEST', 'BEFORE', 'AFTER', 'USING', 'UPON',
  'ADVANCING', 'NO', 'AND', 'OR', 'IS', 'EQUAL', 'GREATER', 'LESS', 'THAN', 'TRUE', 'FALSE', 'ALSO', 'ANY', 'OF',
  'IN', 'END', 'DELIMITED', 'POINTER', 'TALLYING', 'REPLACING', 'CORRESPONDING', 'CORR', 'LEADING', 'FIRST',
  'CHARACTERS', 'UP', 'DOWN', 'NUMERIC', 'ALPHABETIC', 'ALPHABETIC-LOWER', 'ALPHABETIC-UPPER', 'POSITIVE',
  'NEGATIVE', 'FUNCTION', 'INPUT', 'OUTPUT', 'I-O', 'EXTEND', 'RECORD', 'KEY', 'SENTENCE', 'PARAGRAPH', 'SECTION',
  'PROGRAM', 'RUN', 'CONTENT', 'REFERENCE', 'VALUE', 'RETURNING', 'EXCEPTION', 'OVERFLOW', 'LINE', 'LINES', 'PAGE',
  'CYCLE', 'OMITTED', 'ADDRESS', 'LENGTH',
]);

const FIGURATIVE = {
  ZERO: () => ({ k: 'num', v: '0', fig: 'ZERO' }),
  ZEROS: () => ({ k: 'num', v: '0', fig: 'ZERO' }),
  ZEROES: () => ({ k: 'num', v: '0', fig: 'ZERO' }),
  SPACE: () => ({ k: 'str', v: ' ', fig: 'SPACES' }),
  SPACES: () => ({ k: 'str', v: ' ', fig: 'SPACES' }),
  'HIGH-VALUE': () => ({ k: 'str', v: '￿', fig: 'HIGH-VALUES' }),
  'HIGH-VALUES': () => ({ k: 'str', v: '￿', fig: 'HIGH-VALUES' }),
  'LOW-VALUE': () => ({ k: 'str', v: ' ', fig: 'LOW-VALUES' }),
  'LOW-VALUES': () => ({ k: 'str', v: ' ', fig: 'LOW-VALUES' }),
  QUOTE: () => ({ k: 'str', v: '"', fig: 'QUOTES' }),
  QUOTES: () => ({ k: 'str', v: '"', fig: 'QUOTES' }),
  NULL: () => ({ k: 'null' }),
  NULLS: () => ({ k: 'null' }),
};

const CLASS_CONDITIONS = new Set(['NUMERIC', 'ALPHABETIC', 'ALPHABETIC-LOWER', 'ALPHABETIC-UPPER', 'POSITIVE', 'NEGATIVE', 'ZERO', 'ZEROS', 'ZEROES']);

const NEGATE = { '==': '!=', '!=': '==', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };

// ---------------------------------------------------------------------------
// PIC clause analysis
// ---------------------------------------------------------------------------

export function analyzePic(pic, usage = '') {
  const expanded = pic.toUpperCase().replace(/(.)\((\d+)\)/g, (_, ch, n) => ch.repeat(Number(n)));
  if (usage === 'COMP-1' || usage === 'COMP-2') return { ...T.float, pic };
  if (/^S?[9PV]+$/.test(expanded)) {
    const [intPart, fracPart = ''] = expanded.replace(/^S/, '').split('V');
    const digits = (intPart.match(/[9P]/g) || []).length + (fracPart.match(/9/g) || []).length;
    const scale = (fracPart.match(/[9P]/g) || []).length;
    const signed = expanded.startsWith('S');
    const t = scale > 0 ? 'decimal' : digits > 9 ? 'long' : 'int';
    return { t, digits, scale, signed, pic };
  }
  if (/[Z*$+\-.,B0\/]|CR|DB/.test(expanded) && /[9Z*]/.test(expanded) && !/[XA]/.test(expanded)) {
    const dot = expanded.indexOf('.');
    const scale = dot >= 0 ? (expanded.slice(dot + 1).match(/[9Z*]/g) || []).length : 0;
    return { t: 'string', length: expanded.length, edited: true, scale, pic };
  }
  return { t: 'string', length: expanded.length, pic };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class CobolParser {
  constructor(toks, diagnostics) {
    this.toks = toks;
    this.i = 0;
    this.diagnostics = diagnostics;
    this.cond88 = new Map();
    this.dataNames = new Map();
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

  isWord(w, o = 0) {
    const t = this.peek(o);
    if (!t || t.t !== 'word') return false;
    return Array.isArray(w) ? w.includes(t.v) : t.v === w;
  }

  isOp(v, o = 0) {
    const t = this.peek(o);
    return Boolean(t && t.t === 'op' && (Array.isArray(v) ? v.includes(t.v) : t.v === v));
  }

  isPeriod(o = 0) {
    return this.peek(o)?.t === '.';
  }

  eatWord(w) {
    if (this.isWord(w)) {
      this.next();
      return true;
    }
    return false;
  }

  line() {
    return (this.peek() || this.toks[this.toks.length - 1] || { line: 1 }).line;
  }

  textFrom(start) {
    let out = '';
    let prev = null;
    for (const t of this.toks.slice(start, this.i)) {
      const v = t.t === 'str' ? `'${t.v}'` : t.v;
      const tight = prev && ((t.v === ')' || t.v === ':' || t.t === '.') || prev.v === '(' || prev.v === ':' || (t.v === '(' && prev.t === 'word' && !RESERVED.has(prev.v)));
      out += (out && !tight ? ' ' : '') + v;
      prev = t;
    }
    return clip(out, 90);
  }

  // Skip to the next sentence-ending period.
  skipSentence() {
    while (!this.atEnd() && !this.isPeriod()) this.next();
    if (this.isPeriod()) this.next();
  }

  // ---- data division -------------------------------------------------------

  parseLiteral() {
    const t = this.peek();
    if (!t) return null;
    if (t.t === 'op' && (t.v === '-' || t.v === '+') && this.peek(1)?.t === 'num') {
      this.next();
      const n = this.next();
      return E.num(t.v === '-' ? `-${n.v}` : n.v);
    }
    if (t.t === 'num') {
      this.next();
      return E.num(t.v);
    }
    if (t.t === 'str') {
      this.next();
      return E.str(t.v);
    }
    if (t.t === 'word' && t.v === 'ALL' && this.peek(1)?.t === 'str') {
      this.next();
      return { k: 'str', v: this.next().v, fig: 'ALL' };
    }
    if (t.t === 'word' && FIGURATIVE[t.v]) {
      this.next();
      return FIGURATIVE[t.v]();
    }
    return null;
  }

  parseDataEntry(scope) {
    const start = this.next();
    const level = Number(start.v);
    let name = 'FILLER';
    if (this.peek()?.t === 'word' && !['PIC', 'PICTURE', 'VALUE', 'VALUES', 'OCCURS', 'REDEFINES', 'USAGE', 'COMP', 'COMP-3', 'BINARY'].includes(this.peek().v)) {
      name = this.next().v;
    }
    const item = { name, level, line: start.line, scope, children: [], conditions: [] };
    let usage = '';
    const values = [];
    while (!this.atEnd() && !this.isPeriod()) {
      const t = this.peek();
      if (t.t === 'num' && /^(0?[1-9]|[1-4][0-9]|66|77|88)$/.test(t.v) && t.col <= 12 && this.toks[this.i - 1]?.line !== t.line) {
        break; // next entry started without a period
      }
      if (this.isWord(['PIC', 'PICTURE'])) {
        this.next();
        this.eatWord('IS');
        if (this.peek()?.t === 'pic') item.pic = this.next().v;
      } else if (this.isWord(['VALUE', 'VALUES'])) {
        this.next();
        this.eatWord(['IS', 'ARE']);
        while (!this.atEnd() && !this.isPeriod()) {
          const lit = this.parseLiteral();
          if (!lit) break;
          if (this.isWord(['THRU', 'THROUGH'])) {
            this.next();
            values.push({ from: lit, to: this.parseLiteral() });
          } else values.push(lit);
        }
      } else if (this.isWord('OCCURS')) {
        this.next();
        const n = this.next();
        item.occurs = Number(n?.v) || 1;
        if (this.eatWord('TO')) item.occurs = Number(this.next()?.v) || item.occurs;
        this.eatWord('TIMES');
        if (this.eatWord('DEPENDING')) {
          this.eatWord('ON');
          item.dependingOn = this.next()?.v;
        }
        while (this.isWord(['ASCENDING', 'DESCENDING', 'INDEXED'])) {
          this.next();
          this.eatWord(['KEY', 'BY']);
          this.eatWord('IS');
          while (this.peek()?.t === 'word' && !RESERVED.has(this.peek().v) && !['PIC', 'PICTURE', 'VALUE', 'USAGE', 'ASCENDING', 'DESCENDING', 'INDEXED'].includes(this.peek().v)) {
            (item.indexes ||= []).push(this.next().v);
          }
        }
      } else if (this.isWord('REDEFINES')) {
        this.next();
        item.redefines = this.next()?.v;
      } else if (this.isWord('USAGE')) {
        this.next();
        this.eatWord('IS');
        usage = this.next()?.v || '';
      } else if (this.isWord(['COMP', 'COMP-1', 'COMP-2', 'COMP-3', 'COMP-4', 'COMP-5', 'COMPUTATIONAL', 'BINARY', 'PACKED-DECIMAL', 'DISPLAY', 'INDEX', 'POINTER'])) {
        usage = this.next().v;
      } else {
        this.next();
      }
    }
    if (this.isPeriod()) this.next();
    item.usage = usage || undefined;
    if (level === 88) {
      item.values = values;
      return item;
    }
    if (values.length) item.initial = values[0].from ? values[0].from : values[0];
    if (item.pic) item.type = analyzePic(item.pic, usage);
    else if (usage === 'COMP-1' || usage === 'COMP-2') item.type = { ...T.float };
    else if (usage === 'INDEX') item.type = { ...T.int };
    item.legacyType = item.pic ? `PIC ${item.pic}${usage ? ` ${usage}` : ''}` : usage || null;
    return item;
  }

  parseDataDivision(endIndex) {
    const roots = [];
    const files = [];
    let scope = 'working-storage';
    const stack = [];
    let lastItem = null;
    while (this.i < endIndex) {
      const t = this.peek();
      if (t.t === 'word' && this.isWord('SECTION', 1)) {
        scope = t.v.toLowerCase();
        this.i += 2;
        if (this.isPeriod()) this.next();
        stack.length = 0;
        continue;
      }
      if (t.t === 'word' && (t.v === 'FD' || t.v === 'SD')) {
        this.next();
        const name = this.next()?.v;
        files.push({ name, line: t.line });
        this.skipSentence();
        stack.length = 0;
        continue;
      }
      if (t.t === 'num' && /^\d{1,2}$/.test(t.v)) {
        const item = this.parseDataEntry(scope);
        if (item.level === 88) {
          if (lastItem) {
            lastItem.conditions.push({ name: item.name, values: item.values, line: item.line });
            this.cond88.set(item.name, { parent: lastItem, values: item.values });
          }
          continue;
        }
        if (item.level === 66) continue;
        if (item.level === 1 || item.level === 77) {
          roots.push(item);
          stack.length = 0;
          stack.push(item);
        } else {
          while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
          const parent = stack[stack.length - 1];
          if (parent) {
            item.parent = parent;
            parent.children.push(item);
          } else roots.push(item);
          stack.push(item);
        }
        if (item.name !== 'FILLER') this.dataNames.set(item.name, item);
        lastItem = item;
        continue;
      }
      this.next();
    }
    const finalize = (item) => {
      item.children.forEach(finalize);
      if (!item.type) item.type = item.children.length ? T.record(item.name) : { ...T.string, length: 1 };
      if (item.occurs) item.type = T.array(item.type, item.occurs);
      if (!item.children.length) delete item.children;
      if (!item.conditions.length) delete item.conditions;
    };
    roots.forEach(finalize);
    // Drop parent back-references so the IR stays JSON-serialisable.
    const strip = (item) => {
      delete item.parent;
      (item.children || []).forEach(strip);
    };
    roots.forEach(strip);
    return { roots, files };
  }

  // ---- expressions -----------------------------------------------------------

  isOperandStart(o = 0) {
    const t = this.peek(o);
    if (!t) return false;
    if (t.t === 'num' || t.t === 'str') return true;
    if (t.t === 'op') return t.v === '(' || ((t.v === '-' || t.v === '+') && this.peek(o + 1)?.t === 'num');
    if (t.t !== 'word') return false;
    if (FIGURATIVE[t.v] || t.v === 'FUNCTION' || t.v === 'ALL' || t.v === 'LENGTH' || t.v === 'ADDRESS') return true;
    return !RESERVED.has(t.v);
  }

  parseIdentifier() {
    const t = this.next();
    let expr = E.id(t.v);
    while (this.isWord(['OF', 'IN']) && this.peek(1)?.t === 'word') {
      this.next();
      (expr.qual ||= []).push(this.next().v);
    }
    if (this.isOp('(') && !this.isOp(')', 1)) {
      this.next();
      const args = [];
      let refmod = null;
      while (!this.atEnd() && !this.isOp(')') && !this.isPeriod()) {
        if (this.isOp(':')) {
          this.next();
          refmod = { start: args.pop() || E.num(1), len: this.isOp(')') ? null : this.parseArith() };
          continue;
        }
        if (this.isWord('ALL')) {
          this.next();
          args.push(E.raw('ALL'));
          continue;
        }
        const before = this.i;
        args.push(this.parseArith());
        if (this.i === before) this.next();
      }
      if (this.isOp(')')) this.next();
      if (refmod) {
        const base = args.length ? { k: 'index', obj: expr, idx: args } : expr;
        expr = { k: 'call', fn: E.id('substr'), args: [base, refmod.start, ...(refmod.len ? [refmod.len] : [])], builtin: true };
      } else if (args.length) {
        expr = { k: 'index', obj: expr, idx: args };
      }
    }
    return expr;
  }

  parsePrimary() {
    const t = this.peek();
    if (!t) return E.raw('?');
    if (this.isOp('(')) {
      this.next();
      const e = this.parseArith();
      if (this.isOp(')')) this.next();
      return e;
    }
    if (t.t === 'word' && t.v === 'FUNCTION') {
      this.next();
      const name = this.next()?.v || 'UNKNOWN';
      const args = [];
      if (this.isOp('(')) {
        this.next();
        while (!this.atEnd() && !this.isOp(')') && !this.isPeriod()) {
          const before = this.i;
          args.push(this.parseArith());
          if (this.i === before) this.next();
        }
        if (this.isOp(')')) this.next();
      }
      return { k: 'call', fn: E.id(name), args, intrinsic: true };
    }
    if (t.t === 'word' && (t.v === 'LENGTH' || t.v === 'ADDRESS') && this.isWord('OF', 1)) {
      this.next();
      this.next();
      return { k: 'call', fn: E.id(t.v === 'LENGTH' ? 'LENGTH' : 'ADDRESS-OF'), args: [this.parseIdentifier()], intrinsic: true };
    }
    const lit = this.parseLiteral();
    if (lit) return lit;
    if (t.t === 'word') return this.parseIdentifier();
    this.next();
    return E.raw(t.v);
  }

  parseUnary() {
    if (this.isOp('-')) {
      this.next();
      return E.un('neg', this.parseUnary());
    }
    if (this.isOp('+')) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  parseFactor() {
    const base = this.parseUnary();
    if (this.isOp('**')) {
      this.next();
      return E.bin('pow', base, this.parseFactor());
    }
    return base;
  }

  parseTerm() {
    let l = this.parseFactor();
    while (this.isOp(['*', '/'])) {
      const op = this.next().v === '*' ? '*' : 'div';
      l = E.bin(op, l, this.parseFactor());
    }
    return l;
  }

  parseArith() {
    let l = this.parseTerm();
    while (this.isOp(['+', '-']) && this.isOperandStart(1)) {
      const op = this.next().v;
      l = E.bin(op, l, this.parseTerm());
    }
    return l;
  }

  relopAhead() {
    let o = 0;
    if (this.isWord('IS', o)) o += 1;
    if (this.isWord('NOT', o)) o += 1;
    return this.isOp(['>', '<', '=', '>=', '<=', '<>'], o) || this.isWord(['GREATER', 'LESS', 'EQUAL'], o);
  }

  classCondAhead() {
    let o = 0;
    if (this.isWord('IS', o)) o += 1;
    if (this.isWord('NOT', o)) o += 1;
    return this.isWord([...CLASS_CONDITIONS], o) && !this.isOp('(', o + 1);
  }

  parseRelop() {
    this.eatWord('IS');
    const not = this.eatWord('NOT');
    let op = null;
    const t = this.peek();
    if (t?.t === 'op') {
      op = { '>': '>', '<': '<', '=': '==', '>=': '>=', '<=': '<=', '<>': '!=' }[t.v] || null;
      if (op) this.next();
    } else if (this.isWord('GREATER')) {
      this.next();
      this.eatWord('THAN');
      if (this.isWord('OR') && this.isWord('EQUAL', 1)) {
        this.next();
        this.next();
        this.eatWord('TO');
        op = '>=';
      } else op = '>';
    } else if (this.isWord('LESS')) {
      this.next();
      this.eatWord('THAN');
      if (this.isWord('OR') && this.isWord('EQUAL', 1)) {
        this.next();
        this.next();
        this.eatWord('TO');
        op = '<=';
      } else op = '<';
    } else if (this.isWord('EQUAL')) {
      this.next();
      this.eatWord('TO');
      op = '==';
    }
    if (op && not) op = NEGATE[op];
    return op;
  }

  expandConditionName(expr) {
    const name = expr.k === 'index' ? expr.obj.name : expr.name;
    const info = this.cond88.get(name);
    const parentRef = expr.k === 'index' ? { k: 'index', obj: E.id(info.parent.name), idx: expr.idx } : E.id(info.parent.name);
    const tests = info.values.map((v) => (v.from ? E.bin('and', E.bin('>=', parentRef, v.from), E.bin('<=', parentRef, v.to)) : E.bin('==', parentRef, v)));
    const cond = tests.reduce((a, b) => E.bin('or', a, b));
    return { ...cond, conditionName: name };
  }

  isConditionName(expr) {
    if (expr.k === 'id') return this.cond88.has(expr.name);
    return expr.k === 'index' && expr.obj.k === 'id' && this.cond88.has(expr.obj.name);
  }

  parseCondition(ctx = {}) {
    let l = this.parseAndCond(ctx);
    while (this.isWord('OR') && !this.isWord('EQUAL', 1)) {
      this.next();
      l = E.bin('or', l, this.parseAndCond(ctx));
    }
    return l;
  }

  parseAndCond(ctx) {
    let l = this.parseNotCond(ctx);
    while (this.isWord('AND')) {
      this.next();
      l = E.bin('and', l, this.parseNotCond(ctx));
    }
    return l;
  }

  parseNotCond(ctx) {
    if (this.isWord('NOT') && !this.relopAhead()) {
      this.next();
      return E.un('not', this.parseNotCond(ctx));
    }
    return this.parseSimpleCond(ctx);
  }

  parseSimpleCond(ctx) {
    if (this.isOp('(')) {
      const save = this.i;
      this.next();
      const inner = this.parseCondition({ ...ctx });
      if (this.isOp(')') && (this.next(), !this.relopAhead() && !this.isOp(['+', '-', '*', '/', '**']))) return inner;
      this.i = save;
    }
    if (ctx.subject && this.relopAhead()) {
      const op = this.parseRelop();
      const rhs = this.parseArith();
      ctx.op = op;
      return E.bin(op, ctx.subject, rhs);
    }
    const lhs = this.parseArith();
    if (this.isConditionName(lhs) && !this.relopAhead() && !this.classCondAhead()) return this.expandConditionName(lhs);
    if (this.classCondAhead()) {
      this.eatWord('IS');
      const not = this.eatWord('NOT');
      const kind = this.next().v;
      let cond;
      if (kind === 'POSITIVE') cond = E.bin('>', lhs, E.num(0));
      else if (kind === 'NEGATIVE') cond = E.bin('<', lhs, E.num(0));
      else if (kind.startsWith('ZERO')) cond = E.bin('==', lhs, E.num(0));
      else cond = { k: 'call', fn: E.id(kind === 'NUMERIC' ? 'isNumeric' : 'isAlphabetic'), args: [lhs], builtin: true };
      return not ? E.un('not', cond) : cond;
    }
    const op = this.parseRelop();
    if (!op) {
      if (ctx.subject && ctx.op) return E.bin(ctx.op, ctx.subject, lhs);
      return lhs;
    }
    const rhs = this.parseArith();
    ctx.subject = lhs;
    ctx.op = op;
    return E.bin(op, lhs, rhs);
  }

  // ---- statements ------------------------------------------------------------

  atBlockEnd() {
    const t = this.peek();
    if (!t || t.t === '.') return true;
    if (t.t !== 'word') return false;
    if (TERMINATORS.has(t.v)) return true;
    if (t.v === 'NOT' && this.isWord(['AT', 'ON', 'INVALID', 'SIZE', 'END', 'EXCEPTION', 'OVERFLOW'], 1)) return true;
    if ((t.v === 'AT' || t.v === 'ON') && this.isWord(['END', 'SIZE', 'EXCEPTION', 'OVERFLOW', 'EOP', 'END-OF-PAGE'], 1)) return true;
    if (t.v === 'INVALID' || (t.v === 'SIZE' && this.isWord('ERROR', 1))) return true;
    return false;
  }

  parseBlock() {
    const out = [];
    while (!this.atBlockEnd()) {
      const before = this.i;
      const s = this.parseStatement();
      if (Array.isArray(s)) out.push(...s);
      else if (s) out.push(s);
      if (this.i === before) this.next();
    }
    return out;
  }

  // Parses optional [NOT] AT END / ON SIZE ERROR / INVALID KEY / ON EXCEPTION handlers.
  parseHandlers() {
    const handlers = {};
    for (;;) {
      const not = this.isWord('NOT');
      const o = not ? 1 : 0;
      let kind = null;
      if (this.isWord('AT', o) && this.isWord('END', o + 1)) kind = 'atEnd';
      else if (this.isWord('END', o) && !this.isWord('END', o + 1) && not) kind = 'atEnd';
      else if ((this.isWord('ON', o) && this.isWord('SIZE', o + 1)) || this.isWord('SIZE', o)) kind = 'sizeError';
      else if (this.isWord('INVALID', o)) kind = 'invalidKey';
      else if ((this.isWord('ON', o) && this.isWord(['EXCEPTION', 'OVERFLOW'], o + 1)) || this.isWord(['EXCEPTION', 'OVERFLOW'], o)) kind = 'exception';
      if (!kind) break;
      if (not) this.next();
      while (this.isWord(['AT', 'ON', 'END', 'SIZE', 'ERROR', 'INVALID', 'KEY', 'EXCEPTION', 'OVERFLOW'])) {
        this.next();
        if (kind === 'atEnd' && this.toks[this.i - 1].v === 'END') break;
      }
      handlers[not ? `not_${kind}` : kind] = this.parseBlock();
    }
    return handlers;
  }

  eatScopeEnd(word) {
    if (this.isWord(word)) this.next();
  }

  parseOperandList() {
    const list = [];
    while (this.isOperandStart() && !this.atBlockEnd()) {
      const before = this.i;
      list.push(this.parseArith());
      if (this.i === before) break;
    }
    return list;
  }

  parseTargets() {
    const targets = [];
    while (this.peek()?.t === 'word' && !RESERVED.has(this.peek().v) && !FIGURATIVE[this.peek().v]) {
      const target = this.parseIdentifier();
      const round = this.eatWord('ROUNDED');
      targets.push({ target, round });
    }
    return targets;
  }

  sizeErrorWrap(stmts, verbEnd) {
    const h = this.parseHandlers();
    this.eatScopeEnd(verbEnd);
    if (h.sizeError || h.not_sizeError) {
      stmts.push({
        k: 'if',
        cond: { k: 'call', fn: E.id('sizeError'), args: [], builtin: true },
        then: h.sizeError || [],
        else: h.not_sizeError || null,
        line: stmts[0]?.line,
        text: 'ON SIZE ERROR',
        note: 'COBOL size-error handler: fires when the result does not fit the receiving field',
      });
    }
    return stmts;
  }

  parseStatement() {
    const t = this.peek();
    const start = this.i;
    const line = t.line;
    const mk = (s) => ({ line, text: this.textFrom(start), ...s });
    if (t.t !== 'word') {
      this.next();
      this.diagnostics.push({ severity: 'warning', line, message: `Unexpected token '${t.v}'` });
      return null;
    }
    const verb = t.v;
    switch (verb) {
      case 'MOVE': {
        this.next();
        const corr = this.eatWord(['CORRESPONDING', 'CORR']);
        const src = this.parsePrimary();
        this.eatWord('TO');
        const targets = this.parseTargets();
        const text = this.textFrom(start);
        return targets.map(({ target }) => ({ k: 'assign', target, value: src, verb, line, text, ...(corr ? { note: 'MOVE CORRESPONDING copies same-named subordinate fields' } : {}) }));
      }
      case 'COMPUTE': {
        this.next();
        const targets = this.parseTargets();
        if (this.isOp('=') || this.isWord('EQUAL')) this.next();
        const value = this.parseArith();
        const text = this.textFrom(start);
        return this.sizeErrorWrap(targets.map(({ target, round }) => ({ k: 'assign', target, value, round, verb, line, text, arith: true })), 'END-COMPUTE');
      }
      case 'ADD':
      case 'SUBTRACT':
      case 'MULTIPLY':
      case 'DIVIDE':
        return this.parseArithmeticVerb(verb, start, line);
      case 'IF': {
        this.next();
        const cond = this.parseCondition();
        this.eatWord('THEN');
        const text = this.textFrom(start);
        const thenB = this.parseBlock();
        let elseB = null;
        if (this.isWord('ELSE')) {
          this.next();
          elseB = this.parseBlock();
        }
        this.eatScopeEnd('END-IF');
        return { k: 'if', cond, then: thenB, else: elseB, verb, line, text };
      }
      case 'EVALUATE':
        return this.parseEvaluate(start, line);
      case 'PERFORM':
        return this.parsePerform(start, line);
      case 'DISPLAY': {
        this.next();
        const args = this.parseOperandList();
        let newline = true;
        while (this.isWord(['UPON', 'WITH', 'NO', 'ADVANCING'])) {
          const w = this.next().v;
          if (w === 'UPON') this.next();
          if (w === 'NO') newline = false;
        }
        this.eatScopeEnd('END-DISPLAY');
        return mk({ k: 'print', args, newline, verb });
      }
      case 'ACCEPT': {
        this.next();
        const target = this.peek()?.t === 'word' ? this.parseIdentifier() : null;
        let source = 'CONSOLE';
        if (this.eatWord('FROM')) {
          source = this.next()?.v || 'CONSOLE';
          if (this.peek()?.t === 'word' && ['YYYYMMDD', 'YYYYDDD'].includes(this.peek().v)) source += ` ${this.next().v}`;
        }
        this.parseHandlers();
        this.eatScopeEnd('END-ACCEPT');
        return mk({ k: 'input', target, source, verb });
      }
      case 'STOP': {
        this.next();
        if (this.eatWord('RUN')) return mk({ k: 'exit', scope: 'program', verb: 'STOP RUN' });
        const lit = this.parseLiteral();
        return mk({ k: 'print', args: lit ? [lit] : [], newline: true, verb, note: 'STOP literal pauses the run unit' });
      }
      case 'GOBACK':
        this.next();
        return mk({ k: 'exit', scope: 'program', verb });
      case 'EXIT': {
        this.next();
        if (this.eatWord('PROGRAM')) return mk({ k: 'exit', scope: 'program', verb: 'EXIT PROGRAM' });
        if (this.isWord(['PARAGRAPH', 'SECTION'])) {
          this.next();
          return mk({ k: 'exit', scope: 'procedure', verb: 'EXIT PARAGRAPH' });
        }
        if (this.eatWord('PERFORM')) {
          if (this.eatWord('CYCLE')) return mk({ k: 'continue', verb: 'EXIT PERFORM CYCLE' });
          return mk({ k: 'exit', scope: 'loop', verb: 'EXIT PERFORM' });
        }
        return mk({ k: 'noop', verb: 'EXIT' });
      }
      case 'GO': {
        this.next();
        this.eatWord('TO');
        const labels = [];
        while (this.peek()?.t === 'word' && !RESERVED.has(this.peek().v)) labels.push(this.next().v);
        if (this.eatWord('DEPENDING')) {
          this.eatWord('ON');
          const selector = this.parseIdentifier();
          return mk({
            k: 'switch',
            subject: selector,
            cases: labels.map((label, idx) => ({ tests: [{ kind: 'value', value: E.num(idx + 1) }], body: [{ k: 'goto', label, line, text: `GO TO ${label}` }] })),
            default: null,
            verb: 'GO TO DEPENDING',
          });
        }
        return mk({ k: 'goto', label: labels[0] || '?', verb: 'GO TO' });
      }
      case 'CALL': {
        this.next();
        const target = this.peek();
        let callee;
        if (target?.t === 'str') callee = this.next().v;
        else callee = this.parseIdentifier().name;
        const args = [];
        if (this.eatWord('USING')) {
          while (!this.atBlockEnd() && (this.isOperandStart() || this.isWord(['BY', 'REFERENCE', 'CONTENT', 'VALUE', 'OMITTED']))) {
            if (this.isWord(['BY', 'REFERENCE', 'CONTENT', 'VALUE', 'OMITTED'])) {
              this.next();
              continue;
            }
            args.push(this.parseArith());
          }
        }
        let returning = null;
        if (this.eatWord('RETURNING')) returning = this.parseIdentifier();
        this.parseHandlers();
        this.eatScopeEnd('END-CALL');
        return mk({ k: 'call', callee: String(callee).toUpperCase(), args, external: true, returning, verb });
      }
      case 'SET':
        return this.parseSet(start, line);
      case 'INITIALIZE': {
        this.next();
        const targets = this.parseTargets();
        while (!this.atBlockEnd() && !VERBS.has(this.peek()?.v)) this.next();
        const text = this.textFrom(start);
        return targets.map(({ target }) => ({ k: 'assign', target, value: { k: 'default' }, verb, line, text }));
      }
      case 'CONTINUE':
        this.next();
        return mk({ k: 'noop', verb });
      case 'NEXT':
        this.next();
        this.eatWord('SENTENCE');
        return mk({ k: 'noop', verb: 'NEXT SENTENCE', note: 'NEXT SENTENCE jumps past the next period' });
      case 'OPEN': {
        this.next();
        const stmts = [];
        let mode = 'INPUT';
        while (!this.atBlockEnd() && (this.peek()?.t === 'word') && !VERBS.has(this.peek().v)) {
          if (this.isWord(['INPUT', 'OUTPUT', 'I-O', 'EXTEND'])) {
            mode = this.next().v;
            continue;
          }
          const file = this.next().v;
          stmts.push({ k: 'io', op: 'open', file, mode, args: [], target: null, verb, line, text: `OPEN ${mode} ${file}` });
        }
        return stmts;
      }
      case 'CLOSE': {
        this.next();
        const stmts = [];
        while (!this.atBlockEnd() && this.peek()?.t === 'word' && !VERBS.has(this.peek().v)) {
          const file = this.next().v;
          stmts.push({ k: 'io', op: 'close', file, args: [], target: null, verb, line, text: `CLOSE ${file}` });
        }
        return stmts;
      }
      case 'READ': {
        this.next();
        const file = this.next()?.v;
        this.eatWord(['NEXT', 'PREVIOUS']);
        this.eatWord('RECORD');
        let target = null;
        if (this.eatWord('INTO')) target = this.parseIdentifier();
        if (this.eatWord('KEY')) {
          this.eatWord('IS');
          this.parseIdentifier();
        }
        const text = this.textFrom(start);
        const h = this.parseHandlers();
        this.eatScopeEnd('END-READ');
        const out = [{ k: 'io', op: 'read', file, target, args: [], verb, line, text }];
        if (h.atEnd || h.not_atEnd || h.invalidKey || h.not_invalidKey) {
          const onEnd = h.atEnd || h.invalidKey || [];
          const notEnd = h.not_atEnd || h.not_invalidKey || null;
          out.push({ k: 'if', cond: { k: 'call', fn: E.id('endOfFile'), args: [E.id(file)], builtin: true }, then: onEnd, else: notEnd, verb: 'AT END', line, text: `AT END (${file})` });
        }
        return out;
      }
      case 'WRITE':
      case 'REWRITE':
      case 'DELETE':
      case 'START': {
        this.next();
        const record = this.peek()?.t === 'word' ? this.next().v : '?';
        let target = null;
        if (this.eatWord('FROM')) target = this.parseIdentifier();
        while (!this.atBlockEnd() && !VERBS.has(this.peek()?.v)) this.next();
        const text = this.textFrom(start);
        this.parseHandlers();
        this.eatScopeEnd(`END-${verb}`);
        return { k: 'io', op: verb.toLowerCase(), file: record, target, args: [], verb, line, text };
      }
      default:
        return this.parseRaw(verb, start, line);
    }
  }

  parseArithmeticVerb(verb, start, line) {
    this.next();
    if (this.isWord(['CORRESPONDING', 'CORR'])) return this.parseRaw(verb, start, line);
    const operands = this.parseOperandList();
    const sum = (list) => list.reduce((a, b) => E.bin('+', a, b));
    const product = (list) => list.reduce((a, b) => E.bin('*', a, b));
    let assigns = [];
    const done = (list) => {
      const text = this.textFrom(start);
      return this.sizeErrorWrap(list.map((a) => ({ k: 'assign', verb, line, text, arith: true, ...a })), `END-${verb}`);
    };
    if (verb === 'ADD') {
      if (this.eatWord('TO')) {
        const targets = this.parseTargets();
        if (this.eatWord('GIVING')) {
          const giving = this.parseTargets();
          const value = sum([...operands, ...targets.map((x) => x.target)]);
          assigns = giving.map(({ target, round }) => ({ target, value, round }));
        } else {
          assigns = targets.map(({ target, round }) => ({ target, value: E.bin('+', target, sum(operands)), round, compound: true }));
        }
      } else if (this.eatWord('GIVING')) {
        const giving = this.parseTargets();
        assigns = giving.map(({ target, round }) => ({ target, value: sum(operands), round }));
      }
      return done(assigns);
    }
    if (verb === 'SUBTRACT') {
      this.eatWord('FROM');
      const minuends = this.parseTargets();
      const subtrahend = sum(operands);
      if (this.eatWord('GIVING')) {
        const giving = this.parseTargets();
        assigns = giving.map(({ target, round }) => ({ target, value: E.bin('-', minuends[0]?.target || E.num(0), subtrahend), round }));
      } else {
        assigns = minuends.map(({ target, round }) => ({ target, value: E.bin('-', target, subtrahend), round, compound: true }));
      }
      return done(assigns);
    }
    if (verb === 'MULTIPLY') {
      this.eatWord('BY');
      const targets = this.parseTargets();
      const literalRhs = !targets.length ? this.parseOperandList() : [];
      if (this.eatWord('GIVING')) {
        const giving = this.parseTargets();
        const rhs = targets[0]?.target || literalRhs[0] || E.num(1);
        assigns = giving.map(({ target, round }) => ({ target, value: product([operands[0], rhs]), round }));
      } else {
        assigns = targets.map(({ target, round }) => ({ target, value: E.bin('*', target, operands[0]), round, compound: true }));
      }
      return done(assigns);
    }
    // DIVIDE
    const into = this.eatWord('INTO');
    const by = !into && this.eatWord('BY');
    const targets = this.parseTargets();
    const literalRhs = !targets.length ? this.parseOperandList() : [];
    const second = targets[0]?.target || literalRhs[0] || E.num(1);
    if (this.eatWord('GIVING')) {
      const giving = this.parseTargets();
      const quotient = into ? E.bin('div', second, operands[0]) : E.bin('div', operands[0], second);
      assigns = giving.map(({ target, round }) => ({ target, value: quotient, round }));
      if (this.eatWord('REMAINDER')) {
        const rem = this.parseIdentifier();
        const [dividend, divisor] = into ? [second, operands[0]] : [operands[0], second];
        assigns.push({ target: rem, value: E.bin('mod', dividend, divisor), note: 'REMAINDER = dividend - (truncated quotient * divisor)' });
      }
    } else if (into || by) {
      assigns = targets.map(({ target, round }) => ({ target, value: E.bin('div', target, operands[0]), round, compound: true }));
    }
    return done(assigns);
  }

  parseEvaluate(start, line) {
    this.next();
    const subjects = [];
    const parseSubject = () => {
      if (this.isWord(['TRUE', 'FALSE'])) return { kind: this.next().v === 'TRUE' ? 'true' : 'false' };
      return { kind: 'expr', expr: this.parseArith() };
    };
    subjects.push(parseSubject());
    while (this.eatWord('ALSO')) subjects.push(parseSubject());
    const text = this.textFrom(start);
    const cases = [];
    let dflt = null;
    const parseObject = (subject) => {
      const not = this.eatWord('NOT');
      let test;
      if (this.isWord('ANY')) {
        this.next();
        test = { kind: 'cond', cond: E.bool(true) };
      } else if (subject.kind !== 'expr') {
        if (this.isWord(['TRUE', 'FALSE'])) {
          const v = this.next().v === 'TRUE';
          test = { kind: 'cond', cond: E.bool(v) };
        } else {
          const cond = this.parseCondition();
          test = { kind: 'cond', cond: subject.kind === 'false' ? E.un('not', cond) : cond };
        }
      } else {
        const v = this.parseArith();
        if (this.isWord(['THRU', 'THROUGH'])) {
          this.next();
          test = { kind: 'range', from: v, to: this.parseArith() };
        } else test = { kind: 'value', value: v };
      }
      return not ? { kind: 'not', test } : test;
    };
    while (this.isWord('WHEN')) {
      const whenLine = this.peek().line;
      this.next();
      if (this.isWord('OTHER')) {
        this.next();
        dflt = this.parseBlock();
        continue;
      }
      const tests = [];
      for (;;) {
        const objs = subjects.map((subject, idx) => {
          if (idx > 0) this.eatWord('ALSO');
          return parseObject(subject);
        });
        tests.push(objs.length === 1 ? objs[0] : { kind: 'all', tests: objs });
        if (this.isWord('WHEN') && !this.isWord('OTHER', 1)) {
          // Stacked WHEN clauses share one statement list.
          const save = this.i;
          this.next();
          if (this.atBlockEnd()) {
            this.i = save;
            break;
          }
          continue;
        }
        break;
      }
      cases.push({ tests, body: this.parseBlock(), line: whenLine });
    }
    this.eatScopeEnd('END-EVALUATE');
    const single = subjects.length === 1 ? subjects[0] : null;
    const allSimple = single?.kind === 'expr' && cases.every((c) => c.tests.every((x) => x.kind === 'value' || x.kind === 'range'));
    if (allSimple) return { k: 'switch', subject: single.expr, cases, default: dflt, verb: 'EVALUATE', line, text };
    // Lower multi-subject / boolean EVALUATE to a condition switch (if / else-if chain).
    const toCond = (test, subjectIdx = 0) => {
      const subject = subjects[subjectIdx];
      switch (test.kind) {
        case 'cond':
          return test.cond;
        case 'value':
          return E.bin('==', subject.expr, test.value);
        case 'range':
          return E.bin('and', E.bin('>=', subject.expr, test.from), E.bin('<=', subject.expr, test.to));
        case 'not':
          return E.un('not', toCond(test.test, subjectIdx));
        case 'all':
          return test.tests.map((x, idx) => toCond(x, idx)).reduce((a, b) => E.bin('and', a, b));
        default:
          return E.bool(true);
      }
    };
    return {
      k: 'switch',
      subject: null,
      cases: cases.map((c) => ({ ...c, tests: [{ kind: 'cond', cond: c.tests.map((x) => toCond(x)).reduce((a, b) => E.bin('or', a, b)) }] })),
      default: dflt,
      verb: 'EVALUATE',
      line,
      text,
    };
  }

  parseLoopPhrase() {
    let testAfter = false;
    if (this.isWord('WITH') || this.isWord('TEST')) {
      this.eatWord('WITH');
      this.eatWord('TEST');
      testAfter = this.next()?.v === 'AFTER';
    }
    if (this.eatWord('UNTIL')) return { kind: 'until', cond: this.parseCondition(), testAfter };
    if (this.eatWord('VARYING')) {
      const clauses = [];
      const parseClause = () => {
        const variable = this.parseIdentifier();
        this.eatWord('FROM');
        const from = this.parseArith();
        this.eatWord('BY');
        const by = this.parseArith();
        this.eatWord('UNTIL');
        const cond = this.parseCondition();
        clauses.push({ variable, from, by, cond });
      };
      parseClause();
      while (this.eatWord('AFTER')) parseClause();
      return { kind: 'varying', clauses, testAfter };
    }
    if (this.isOperandStart() && this.isWord('TIMES', 1)) {
      const count = this.parsePrimary();
      this.eatWord('TIMES');
      return { kind: 'times', count };
    }
    return null;
  }

  wrapLoop(phrase, body, line, text) {
    if (!phrase) return body;
    if (phrase.kind === 'times') return [{ k: 'repeat', count: phrase.count, body, verb: 'PERFORM TIMES', line, text }];
    if (phrase.kind === 'until') return [{ k: 'while', cond: E.un('not', phrase.cond), testAfter: phrase.testAfter, body, verb: 'PERFORM UNTIL', line, text }];
    let inner = body;
    for (const c of [...phrase.clauses].reverse()) {
      const upd = E.bin('+', c.variable, c.by);
      inner = [
        {
          k: 'for',
          init: [{ k: 'assign', target: c.variable, value: c.from, line, text: `${exprToText(c.variable)} = ${exprToText(c.from)}` }],
          cond: E.un('not', c.cond),
          update: [{ k: 'assign', target: c.variable, value: upd, line, text: `${exprToText(c.variable)} = ${exprToText(upd)}`, compound: true }],
          body: inner,
          verb: 'PERFORM VARYING',
          line,
          text,
        },
      ];
    }
    return inner;
  }

  parsePerform(start, line) {
    this.next();
    const t = this.peek();
    const outOfLine = t?.t === 'word' && !RESERVED.has(t.v) && this.procNames.has(t.v) && !this.isWord('TIMES', 1);
    if (outOfLine) {
      const callee = this.next().v;
      let thru = null;
      if (this.isWord(['THRU', 'THROUGH'])) {
        this.next();
        thru = this.next()?.v || null;
      }
      const phrase = this.parseLoopPhrase();
      const text = this.textFrom(start);
      const call = { k: 'call', callee, thru, args: [], verb: 'PERFORM', perform: true, line, text };
      const out = this.wrapLoop(phrase, [call], line, text);
      return out.length === 1 ? out[0] : out;
    }
    const phrase = this.parseLoopPhrase();
    const text = this.textFrom(start);
    const body = this.parseBlock();
    this.eatScopeEnd('END-PERFORM');
    if (!phrase) return { k: 'block', body, note: 'Inline PERFORM', verb: 'PERFORM', line, text };
    const out = this.wrapLoop(phrase, body, line, text);
    return out.length === 1 ? out[0] : out;
  }

  parseSet(start, line) {
    this.next();
    const targets = [];
    while (this.peek()?.t === 'word' && !RESERVED.has(this.peek().v)) targets.push(this.parseIdentifier());
    const text = () => this.textFrom(start);
    if (this.eatWord('TO')) {
      if (this.isWord(['TRUE', 'FALSE'])) {
        const truth = this.next().v === 'TRUE';
        return targets.map((target) => {
          const name = target.k === 'index' ? target.obj.name : target.name;
          const info = this.cond88.get(name);
          if (!info || !truth) return { k: 'raw', line, text: text(), note: truth ? `SET ${name} TO TRUE: unknown condition name` : 'SET condition TO FALSE' };
          const v = info.values[0];
          const parentRef = target.k === 'index' ? { k: 'index', obj: E.id(info.parent.name), idx: target.idx } : E.id(info.parent.name);
          return { k: 'assign', target: parentRef, value: v.from || v, verb: 'SET', line, text: text(), conditionName: name };
        });
      }
      const value = this.parseArith();
      return targets.map((target) => ({ k: 'assign', target, value, verb: 'SET', line, text: text() }));
    }
    if (this.isWord(['UP', 'DOWN'])) {
      const op = this.next().v === 'UP' ? '+' : '-';
      this.eatWord('BY');
      const by = this.parseArith();
      return targets.map((target) => ({ k: 'assign', target, value: E.bin(op, target, by), verb: 'SET', line, text: text(), compound: true }));
    }
    return this.parseRaw('SET', start, line);
  }

  parseRaw(verb, start, line) {
    this.next();
    const endWord = `END-${verb}`;
    let lookahead = this.i;
    let hasEnd = false;
    while (lookahead < this.toks.length && this.toks[lookahead].t !== '.') {
      if (this.toks[lookahead].v === endWord) {
        hasEnd = true;
        break;
      }
      lookahead += 1;
    }
    if (hasEnd) {
      this.i = lookahead + 1;
    } else {
      while (!this.atEnd() && !this.isPeriod() && !TERMINATORS.has(this.peek().v) && !(this.peek().t === 'word' && VERBS.has(this.peek().v))) this.next();
    }
    const known = ['STRING', 'UNSTRING', 'INSPECT', 'SEARCH', 'SORT', 'MERGE', 'RELEASE', 'RETURN', 'ALTER', 'CANCEL', 'ENTRY', 'EXEC', 'INVOKE'];
    const note = known.includes(verb) ? `${verb} is kept as-is; review its translation manually` : `Unrecognised statement '${verb}'`;
    if (!known.includes(verb)) this.diagnostics.push({ severity: 'warning', line, message: note });
    return { k: 'raw', verb, line, text: this.textFrom(start), note };
  }

  // ---- procedure division ------------------------------------------------------

  isHeaderAt(idx, sentenceStart) {
    const t = this.toks[idx];
    if (!t || t.t !== 'word' || !sentenceStart) return null;
    const n1 = this.toks[idx + 1];
    const n2 = this.toks[idx + 2];
    if (n1?.v === 'SECTION' && n2?.t === '.') return { kind: 'section', name: t.v, len: 3 };
    if (n1?.t === '.' && !VERBS.has(t.v) && !RESERVED.has(t.v)) return { kind: 'paragraph', name: t.v, len: 2 };
    return null;
  }

  parseProcedureDivision(startIdx, modName) {
    // Pass 1: locate paragraph / section headers.
    const headers = [];
    let sentenceStart = true;
    for (let idx = startIdx; idx < this.toks.length; idx += 1) {
      const h = this.isHeaderAt(idx, sentenceStart);
      if (h) {
        headers.push({ ...h, idx, line: this.toks[idx].line });
        idx += h.len - 1;
        sentenceStart = true;
        continue;
      }
      sentenceStart = this.toks[idx].t === '.';
    }
    headers.forEach((h) => this.procNames.add(h.name));
    const procs = [];
    const makeProc = (name, kind, from, to, line) => {
      this.i = from;
      const body = [];
      while (this.i < to) {
        if (this.isPeriod()) {
          this.next();
          continue;
        }
        const before = this.i;
        const block = this.parseBlock();
        body.push(...block);
        if (this.i < to && this.peek()?.t === 'word' && TERMINATORS.has(this.peek().v)) {
          this.diagnostics.push({ severity: 'warning', line: this.peek().line, message: `Unmatched ${this.peek().v}` });
          this.next();
        }
        if (this.i === before) this.next();
      }
      const endLine = this.toks[Math.max(from, to - 1)]?.line || line;
      procs.push({ id: `${modName}::${name}`, name, kind, params: [], returns: null, visibility: 'public', body, loc: { start: line, end: endLine }, order: procs.length });
    };
    const firstIdx = headers.length ? headers[0].idx : this.toks.length;
    if (firstIdx > startIdx) makeProc('MAIN', 'paragraph', startIdx, firstIdx, this.toks[startIdx]?.line || 1);
    let section = null;
    headers.forEach((h, n) => {
      const bodyStart = h.idx + h.len;
      const bodyEnd = n + 1 < headers.length ? headers[n + 1].idx : this.toks.length;
      makeProc(h.name, h.kind, bodyStart, bodyEnd, h.line);
      const proc = procs[procs.length - 1];
      if (h.kind === 'section') {
        section = proc;
        proc.paragraphs = [];
      } else if (section) {
        section.paragraphs.push(h.name);
        proc.section = section.name;
      }
    });
    // A PERFORM of a section runs each of its paragraphs in order.
    for (const p of procs) {
      if (p.kind === 'section' && p.paragraphs?.length) {
        p.loc.end = procs.find((q) => q.name === p.paragraphs[p.paragraphs.length - 1])?.loc.end ?? p.loc.end;
        p.body.push(...p.paragraphs.map((name) => ({ k: 'call', callee: name, args: [], perform: true, implicit: true, line: p.loc.start, text: `(falls into ${name})` })));
      }
    }
    return procs;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function findSeq(toks, words, from = 0) {
  for (let i = from; i < toks.length; i += 1) {
    if (words.every((w, j) => toks[i + j]?.t === 'word' && toks[i + j].v === w)) return i;
  }
  return -1;
}

export function parseCobol(source, { fileName = 'PROGRAM.cbl', resolveCopy } = {}) {
  const diagnostics = [];
  const { lines, fixed, variable, copies } = normalize(source, { resolveCopy, diagnostics });
  const toks = tokenize(lines);
  const p = new CobolParser(toks, diagnostics);

  let programId = null;
  const pid = findSeq(toks, ['PROGRAM-ID']);
  if (pid >= 0) {
    let j = pid + 1;
    if (toks[j]?.t === '.') j += 1;
    if (toks[j] && (toks[j].t === 'word' || toks[j].t === 'str')) programId = String(toks[j].v).toUpperCase();
  }
  const modName = programId || fileName.replace(/\.[^.]+$/, '').toUpperCase();

  const procIdx = findSeq(toks, ['PROCEDURE', 'DIVISION']);
  const dataIdx = findSeq(toks, ['DATA', 'DIVISION']);
  let dataItems = [];
  let files = [];
  if (dataIdx >= 0) {
    p.i = dataIdx + 2;
    if (p.isPeriod()) p.next();
    const res = p.parseDataDivision(procIdx >= 0 ? procIdx : toks.length);
    dataItems = res.roots;
    files = res.files;
  } else if (procIdx < 0) {
    diagnostics.push({ severity: 'error', line: 1, message: 'No DATA DIVISION or PROCEDURE DIVISION found — is this COBOL source?' });
  }

  let procedures = [];
  let usingParams = [];
  if (procIdx >= 0) {
    let j = procIdx + 2;
    if (toks[j]?.v === 'USING') {
      j += 1;
      while (toks[j] && toks[j].t === 'word') {
        if (!['BY', 'REFERENCE', 'VALUE'].includes(toks[j].v)) usingParams.push(toks[j].v);
        j += 1;
      }
    }
    while (toks[j] && toks[j].t !== '.') j += 1;
    procedures = p.parseProcedureDivision(j + 1, modName);
  } else {
    diagnostics.push({ severity: 'error', line: 1, message: 'PROCEDURE DIVISION not found' });
  }

  const mod = {
    file: fileName,
    language: 'cobol',
    name: modName,
    kind: 'program',
    dataItems,
    types: [],
    procedures,
    entry: procedures[0]?.id || null,
    imports: copies,
    diagnostics,
    meta: { format: variable ? 'variable' : fixed ? 'fixed' : 'free', files, usingParams, tokens: toks.length },
  };
  return mod;
}
