import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from '../lib/types';
import { Icon } from './Icon';

interface Props {
  onUploaded: () => void;
}

function validate(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return `${file.name}: only PDF, PNG and JPEG files are supported.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is ${formatBytes(file.size)}; the limit is 10 MB.`;
  return null;
}

export function UploadDropzone({ onUploaded }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  async function upload(files: File[]) {
    const problems = files.map(validate).filter((e): e is string => e !== null);
    const valid = files.filter((f) => validate(f) === null);
    setErrors(problems);
    if (valid.length === 0) return;

    setBusy((n) => n + valid.length);
    // Two at a time, to stay inside the account's small Lambda concurrency.
    const queue = [...valid];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          await api.uploadDocument(file);
        } catch (err) {
          setErrors((prev) => [...prev, `${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`]);
        } finally {
          setBusy((n) => n - 1);
          onUploaded();
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  return (
    <section className="upload">
      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}${busy > 0 ? ' dropzone-busy' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <span className="dropzone-icon">{busy > 0 ? <span className="spinner" /> : <Icon name="upload" size={22} />}</span>
        <p className="dropzone-title">
          {busy > 0 ? `Uploading ${busy} file${busy === 1 ? '' : 's'}…` : dragging ? 'Drop to upload' : 'Drop documents here'}
        </p>
        <p className="dropzone-hint">PDF, PNG or JPEG · up to 10 MB each</p>
        <span className="button">Choose files</span>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          multiple
          hidden
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul className="upload-errors" role="alert">
          {errors.map((msg) => (
            <li key={msg}>
              <Icon name="alert" size={15} />
              {msg}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
