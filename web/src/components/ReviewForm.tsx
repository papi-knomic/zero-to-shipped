import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useSession } from '../lib/session';
import type { ConfirmedFields, DocumentRecord } from '../lib/types';
import { EmailDeliverability } from './EmailDeliverability';
import { Icon } from './Icon';

const EMAIL_KEY = 'lapse.reminderEmail';

function rememberedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Start from what the user confirmed before, else from what extraction found. */
function initialFields(doc: DocumentRecord): ConfirmedFields {
  if (doc.confirmed) return doc.confirmed;
  const x = doc.extraction;
  const date = (label: string) => x?.dates.find((d) => d.label === label)?.isoDate ?? null;
  return {
    title: x?.title ?? doc.filename.replace(/\.[^.]+$/, ''),
    documentType: x?.documentType ?? '',
    issuer: x?.issuer ?? null,
    parties: x?.parties ?? [],
    issueDate: date('issue') ?? date('effective'),
    expiryDate: date('expiry') ?? '',
  };
}

interface Props {
  doc: DocumentRecord;
  onSaved: (doc: DocumentRecord) => void;
  onCancel?: () => void;
}

export function ReviewForm({ doc, onSaved, onCancel }: Props) {
  const [fields, setFields] = useState<ConfirmedFields>(() => initialFields(doc));
  const [partiesText, setPartiesText] = useState(() => initialFields(doc).parties.join('\n'));
  const session = useSession();
  const [email, setEmail] = useState(
    () => doc.reminderEmail ?? (rememberedEmail() || (session.mode === 'user' ? session.user.email : '')),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ConfirmedFields>(key: K, value: ConfirmedFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const parties = partiesText.split('\n').map((p) => p.trim()).filter(Boolean);
    try {
      const saved = await api.confirmDocument(doc.docId, { ...fields, parties, issuer: fields.issuer || null, issueDate: fields.issueDate || null }, email.trim());
      try {
        localStorage.setItem(EMAIL_KEY, email.trim());
      } catch {
        /* storage unavailable: fine */
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const computedExpiry = doc.extraction?.dates.find((d) => d.label === 'expiry' && d.computed);

  return (
    <form className="card review" onSubmit={submit}>
      <div className="review-head">
        <h2>{doc.confirmed ? 'Edit details' : 'Review and confirm'}</h2>
        <p className="muted small">
          {doc.confirmed
            ? 'Changing the expiry date replaces every scheduled reminder.'
            : 'Check these against the document. Nothing is scheduled until you confirm.'}
        </p>
      </div>

      <div className="form-grid">
        <label className="field field-wide">
          <span>Title</span>
          <input required maxLength={200} value={fields.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field">
          <span>Document type</span>
          <input required maxLength={100} value={fields.documentType} onChange={(e) => set('documentType', e.target.value)} />
        </label>
        <label className="field">
          <span>Issuer</span>
          <input maxLength={200} value={fields.issuer ?? ''} onChange={(e) => set('issuer', e.target.value)} />
        </label>
        <label className="field">
          <span>Issue / effective date</span>
          <input type="date" value={fields.issueDate ?? ''} onChange={(e) => set('issueDate', e.target.value)} />
        </label>
        <label className="field">
          <span>
            Expiry date <em className="req">required</em>
          </span>
          <input type="date" required value={fields.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
          {computedExpiry && !doc.confirmed && <small className="hint">Calculated from the validity period. Please check it.</small>}
        </label>
        <label className="field field-wide">
          <span>Parties (one per line)</span>
          <textarea rows={2} value={partiesText} onChange={(e) => setPartiesText(e.target.value)} />
        </label>
        <label className="field field-wide">
          <span>Send reminders to</span>
          <input
            type="email"
            required
            maxLength={254}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <small className="hint">Reminders go out 60, 30 and 7 days before expiry, at 09:00 WAT.</small>
        </label>
      </div>

      <EmailDeliverability email={email.trim()} />

      {error && (
        <p className="notice notice-error">
          <Icon name="alert" size={16} />
          {error}
        </p>
      )}

      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <span className="spinner spinner-sm spinner-on-brand" /> : <Icon name="bell" size={16} />}
          {doc.confirmed ? 'Save and reschedule' : 'Confirm and schedule reminders'}
        </button>
      </div>
    </form>
  );
}
