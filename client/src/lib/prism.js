import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-cobol';
import 'prismjs/components/prism-visual-basic';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-markdown';

const BY_EXTENSION = {
  java: 'java',
  cs: 'csharp',
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cbl: 'cobol',
  cob: 'cobol',
  cpy: 'cobol',
  cobol: 'cobol',
  bas: 'visual-basic',
  cls: 'visual-basic',
  frm: 'visual-basic',
  vbs: 'visual-basic',
  c: 'c',
  h: 'cpp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  json: 'json',
  xml: 'markup',
  csproj: 'markup',
  toml: 'toml',
  md: 'markdown',
};

export function languageFor(path = '') {
  const ext = path.toLowerCase().split('.').pop();
  return BY_EXTENSION[ext] || 'clike';
}

export function highlight(code, language) {
  const grammar = Prism.languages[language] || Prism.languages.clike;
  return Prism.highlight(code, grammar, language);
}
