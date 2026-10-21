import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';

export const LEGACY_ACCEPT = '.cbl,.cob,.cobol,.cpy,.bas,.cls,.frm,.vbs,.java,.c,.cpp,.cc,.cxx,.h,.hpp,.hh';

export function FileDropzone({ onFiles, maxKb = 200, onError }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const read = async (fileList) => {
    const files = [];
    for (const file of Array.from(fileList)) {
      if (file.size > maxKb * 1024) {
        onError?.(`${file.name} is larger than ${maxKb} KB`);
        continue;
      }
      files.push({ path: file.name.replace(/[^\w\-. ]+/g, '_'), content: await file.text() });
    }
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        read(e.dataTransfer.files);
      }}
    >
      <FileUp size={26} />
      <div>
        <strong>Drop legacy source files here</strong> or click to browse
        <div className="muted small">COBOL (.cbl .cob .cpy), VB6 (.bas .cls .frm), Java, C/C++ · up to {maxKb} KB each</div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={LEGACY_ACCEPT}
        onChange={(e) => {
          read(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
