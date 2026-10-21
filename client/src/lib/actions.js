import { api } from '../api.js';

// Creates a project from a bundled sample and immediately starts a modernization job.
export async function launchSample(sample) {
  const { project } = await api.post('/api/projects', {
    name: sample.name,
    description: sample.description,
    sampleId: sample.id,
    target: sample.target,
  });
  const { job } = await api.post(`/api/projects/${project.id}/jobs`, { engine: 'auto' });
  return { project, job };
}

// Mirrors the server's language detection so the upload list can show it before saving.
export function guessLanguage(path, content = '') {
  const lower = path.toLowerCase();
  if (/\.(cbl|cob|cobol|cpy)$/.test(lower)) return 'cobol';
  if (/\.(bas|cls|frm|vbs)$/.test(lower)) return 'vb6';
  if (/\.java$/.test(lower)) return 'java';
  if (/\.(c|cpp|cc|cxx|h|hpp|hh)$/.test(lower)) return 'cpp';
  if (/\bIDENTIFICATION\s+DIVISION\b|\bPROCEDURE\s+DIVISION\b/i.test(content)) return 'cobol';
  if (/^\s*(Public|Private)?\s*(Sub|Function)\s+\w+/im.test(content) && /\bEnd\s+(Sub|Function)\b/i.test(content)) return 'vb6';
  if (/\b(public|private)\s+class\s+\w+/.test(content)) return 'java';
  if (/#include\s*[<"]/.test(content)) return 'cpp';
  return null;
}
