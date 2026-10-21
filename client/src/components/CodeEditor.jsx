import { useMemo } from 'react';
import EditorModule from 'react-simple-code-editor';
import { highlight, languageFor } from '../lib/prism.js';

// The package is CommonJS with `exports.default`; depending on bundler interop the
// default import is either the component or the module object.
const Editor = EditorModule.default || EditorModule;

export function CodeEditor({ value, onChange, path = '', language, maxHeight = 560, placeholder }) {
  const lang = language || languageFor(path);
  const lines = useMemo(() => value.split('\n').length, [value]);
  return (
    <div className="code-view code-editor" style={{ maxHeight }}>
      <div className="code-grid">
        <div className="gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className="ln">
              {i + 1}
            </div>
          ))}
        </div>
        <Editor
          value={value}
          onValueChange={onChange}
          highlight={(code) => highlight(code, lang)}
          padding={10}
          tabSize={4}
          insertSpaces
          className="editor"
          textareaClassName="editor-textarea"
          preClassName="code-pre"
          placeholder={placeholder}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
