import { useState } from 'react';
import { loadSampleDocuments, type SampleProgress } from '../lib/samples';
import { Icon } from './Icon';

const PHASE_LABEL: Record<SampleProgress['phase'], string> = {
  uploading: 'Uploading',
  reading: 'Textract is reading',
  done: 'Done',
};

/** Demo mode: one click loads five realistic documents through the real pipeline. */
export function SampleLoader({ onChange, compact = false }: { onChange: () => void; compact?: boolean }) {
  const [progress, setProgress] = useState<SampleProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress.phase !== 'done';

  async function load() {
    setError(null);
    try {
      await loadSampleDocuments((p) => {
        setProgress(p);
        onChange();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the samples.');
      setProgress(null);
    }
  }

  const label = busy ? `${PHASE_LABEL[progress.phase]} ${progress.done}/${progress.total}…` : 'Load sample documents';
  const button = (
    <button type="button" className={`btn ${compact ? 'btn-ghost btn-sm' : 'btn-primary'}`} onClick={load} disabled={busy}>
      {busy ? <span className={`spinner spinner-sm${compact ? '' : ' spinner-on-brand'}`} /> : <Icon name="stack" size={16} />}
      {label}
    </button>
  );

  if (compact) return button;

  return (
    <div className="card samples">
      <div>
        <p className="samples-title">New here? Try it with sample documents.</p>
        <p className="muted small">
          Five realistic Nigerian business documents (a fire safety certificate, an insurance policy, a tax clearance
          certificate, a premises permit and a tenancy agreement) go through the real pipeline: upload to S3, then Amazon
          Textract reads them.
        </p>
        {error && <p className="deliver-error small">{error}</p>}
      </div>
      {button}
    </div>
  );
}
