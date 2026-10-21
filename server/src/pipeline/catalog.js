export const LEGACY_LANGUAGES = {
  cobol: { label: 'COBOL', extensions: ['.cbl', '.cob', '.cobol', '.cpy'], parser: 'Hand-written COBOL grammar (fixed & free format)' },
  vb6: { label: 'Visual Basic 6', extensions: ['.bas', '.cls', '.frm', '.vbs'], parser: 'Hand-written VB6 grammar' },
  java: { label: 'Java (legacy)', extensions: ['.java'], parser: 'Tree-sitter Java grammar' },
  cpp: { label: 'C / C++', extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh'], parser: 'Tree-sitter C++ grammar' },
};

export const TARGETS = {
  java: {
    label: 'Java 21',
    frameworks: { plain: 'Plain Java + JUnit 5', 'spring-boot': 'Spring Boot 3 service' },
  },
  python: {
    label: 'Python 3.12',
    frameworks: { plain: 'Python package + pytest', fastapi: 'FastAPI service' },
  },
  typescript: {
    label: 'TypeScript 5 (Node.js)',
    frameworks: { plain: 'TypeScript module + Vitest', express: 'Express REST API' },
  },
  csharp: {
    label: 'C# 12 (.NET 8)',
    frameworks: { plain: '.NET class library + xUnit', aspnet: 'ASP.NET Core minimal API' },
  },
};

export const LEGACY_LANGUAGE_IDS = Object.keys(LEGACY_LANGUAGES);
export const TARGET_IDS = Object.keys(TARGETS);

export function detectLanguage(filePath, content = '') {
  const lower = filePath.toLowerCase();
  for (const [id, lang] of Object.entries(LEGACY_LANGUAGES)) {
    if (lang.extensions.some((ext) => lower.endsWith(ext))) return id;
  }
  if (/\bIDENTIFICATION\s+DIVISION\b|\bPROCEDURE\s+DIVISION\b/i.test(content)) return 'cobol';
  if (/^\s*(Public|Private)?\s*(Sub|Function)\s+\w+/im.test(content) && /\bEnd\s+(Sub|Function)\b/i.test(content)) return 'vb6';
  if (/\b(public|private)\s+class\s+\w+/.test(content)) return 'java';
  if (/#include\s*[<"]/.test(content)) return 'cpp';
  return null;
}

export function isValidFramework(target, framework) {
  return Boolean(TARGETS[target]?.frameworks[framework]);
}
