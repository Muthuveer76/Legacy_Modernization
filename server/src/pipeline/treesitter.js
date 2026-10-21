import { createRequire } from 'node:module';
import path from 'node:path';
import { Parser, Language } from 'web-tree-sitter';
import { clip } from './ir.js';

const require = createRequire(import.meta.url);
const WASM_DIR = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');

// Our language id -> grammar file name in tree-sitter-wasms/out
export const GRAMMARS = {
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  python: 'python',
  typescript: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  csharp: 'c_sharp',
  go: 'go',
  json: 'json',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
};

let initPromise = null;
const languages = new Map();

async function loadLanguage(lang) {
  if (!GRAMMARS[lang]) throw new Error(`No Tree-sitter grammar for ${lang}`);
  initPromise ||= Parser.init();
  await initPromise;
  if (!languages.has(lang)) {
    languages.set(lang, Language.load(path.join(WASM_DIR, `tree-sitter-${GRAMMARS[lang]}.wasm`)));
  }
  return languages.get(lang);
}

// Parses source and hands the tree to `use`; the WASM memory is freed afterwards.
export async function withTree(lang, source, use) {
  const language = await loadLanguage(lang);
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  try {
    return await use(tree);
  } finally {
    tree.delete();
    parser.delete();
  }
}

export function line(node) {
  return node.startPosition.row + 1;
}

export function syntaxErrors(root, source, limit = 25) {
  const errors = [];
  const lines = source.split('\n');
  const visit = (node) => {
    if (errors.length >= limit) return;
    if (node.isMissing) {
      errors.push({ line: line(node), column: node.startPosition.column + 1, message: `Missing ${node.type}`, snippet: clip(lines[node.startPosition.row] || '', 100) });
      return;
    }
    if (node.isError) {
      const row = node.startPosition.row;
      errors.push({ line: row + 1, column: node.startPosition.column + 1, message: `Unexpected syntax near "${clip(node.text, 40)}"`, snippet: clip(lines[row] || '', 100) });
      return;
    }
    if (!node.hasError) return;
    for (const child of node.children) if (child) visit(child);
  };
  visit(root);
  return errors;
}

// Compact, JSON-friendly view of the named nodes for the AST explorer.
export function treeToView(root, { maxNodes = 3000, maxDepth = 48 } = {}) {
  let count = 0;
  let truncated = false;
  const build = (node, depth, field) => {
    count += 1;
    const named = node.namedChildren.filter(Boolean);
    const nameNode = node.childForFieldName('name') || node.childForFieldName('declarator');
    let label = '';
    if (!named.length) label = clip(node.text, 60);
    else if (nameNode && nameNode.namedChildCount === 0) label = clip(nameNode.text, 60);
    const view = { type: node.type, label: field ? `${field}: ${label}`.replace(/: $/, '') : label, line: line(node), endLine: node.endPosition.row + 1, children: [] };
    if (node.isError) view.error = true;
    if (depth >= maxDepth) {
      if (named.length) truncated = true;
      return view;
    }
    for (let i = 0; i < node.namedChildCount; i += 1) {
      if (count >= maxNodes) {
        truncated = true;
        break;
      }
      const child = node.namedChild(i);
      if (!child || child.type === 'comment' || child.type === 'line_comment' || child.type === 'block_comment') continue;
      view.children.push(build(child, depth + 1, fieldNameOfNamed(node, i)));
    }
    return view;
  };
  const tree = build(root, 0, null);
  return { tree, nodeCount: count, truncated };
}

function fieldNameOfNamed(node, namedIndex) {
  try {
    return node.fieldNameForNamedChild(namedIndex) || null;
  } catch {
    return null;
  }
}

export function grammarForPath(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  return (
    {
      java: 'java',
      py: 'python',
      ts: 'typescript',
      mts: 'typescript',
      cts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      jsx: 'javascript',
      cs: 'csharp',
      go: 'go',
      c: 'c',
      h: 'cpp',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      hpp: 'cpp',
      json: 'json',
      yml: 'yaml',
      yaml: 'yaml',
    }[ext] || null
  );
}
