import { moduleToTree } from '../ir.js';
import { syntaxErrors, treeToView, withTree } from '../treesitter.js';
import { lowerCpp, lowerJava } from './cfamily.js';
import { parseCobol } from './cobol.js';
import { parseVb6 } from './vb6.js';

const baseName = (p) => p.replace(/^.*[\\/]/, '');
const stem = (p) => baseName(p).replace(/\.[^.]+$/, '');

export function isCopybook(file) {
  return file.language === 'cobol' && /\.cpy$/i.test(file.path);
}

function countNodes(view) {
  let n = 0;
  const walk = (v) => {
    n += 1;
    v.children.forEach(walk);
  };
  walk(view);
  return n;
}

export async function parseSourceFile(file, projectFiles = []) {
  const started = Date.now();
  const lines = file.content.split('\n').length;
  const base = { file: file.path, language: file.language, lines };

  if (file.language === 'cobol' || file.language === 'vb6') {
    let mod;
    if (file.language === 'cobol') {
      const copybooks = new Map(projectFiles.filter((f) => f.language === 'cobol' && f.path !== file.path).map((f) => [stem(f.path).toUpperCase(), f.content]));
      mod = parseCobol(file.content, { fileName: file.path, resolveCopy: (name) => copybooks.get(name) ?? null });
    } else {
      mod = parseVb6(file.content, { fileName: file.path });
    }
    const tree = moduleToTree(mod);
    return {
      ...base,
      parser: file.language === 'cobol' ? 'COBOL recursive-descent parser' : 'VB6 recursive-descent parser',
      modules: [mod],
      ast: { tree, nodeCount: countNodes(tree), truncated: false, kind: 'ir' },
      diagnostics: mod.diagnostics,
      ms: Date.now() - started,
    };
  }

  const grammar = file.language === 'java' ? 'java' : /\.c$/i.test(file.path) ? 'c' : 'cpp';
  return withTree(grammar, file.content, (tree) => {
    const root = tree.rootNode;
    const errors = syntaxErrors(root, file.content);
    const modules = file.language === 'java' ? lowerJava(root, file.path) : lowerCpp(root, file.path);
    const view = treeToView(root);
    const diagnostics = errors.map((e) => ({ severity: 'error', line: e.line, message: `${e.message} (col ${e.column})` }));
    for (const m of modules) m.diagnostics.push(...diagnostics);
    if (!modules.length) diagnostics.push({ severity: 'warning', line: 1, message: 'No classes or functions found' });
    return {
      ...base,
      parser: `Tree-sitter ${grammar === 'java' ? 'Java' : grammar === 'c' ? 'C' : 'C++'} grammar`,
      modules,
      ast: { ...view, kind: 'cst' },
      diagnostics,
      ms: Date.now() - started,
    };
  });
}
