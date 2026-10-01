import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import type { RecipientStatus } from '../lib/types';
import { Icon } from './Icon';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SES sandbox fallback, made visible: reminders only reach verified addresses until production
 * access is granted. Shows whether this address can receive them and offers AWS's
 * verification link if not. Renders nothing once delivery is possible without verification.
 */
export function EmailDeliverability({ email }: { email: string }) {
  const [state, setState] = useState<RecipientStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(null);
    setError(null);
    if (!EMAIL.test(email)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .emailStatus(email)
        .then((s) => !cancelled && setState(s))
        .catch(() => !cancelled && setState(null));
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [email]);

  if (!state) return null;
  if (state.status === 'deliverable') {
    return state.sandbox ? (
      <p className="deliver deliver-ok">
        <Icon name="check" size={15} />
        Verified. Reminders will be delivered to this address.
      </p>
    ) : null;
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      setState(await api.verifyEmail(email));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the verification email.');
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    setBusy(true);
    try {
      setState(await api.emailStatus(email));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deliver deliver-warn" role="status">
      <Icon name="alert" size={15} />
      <div>
        {state.status === 'pending' ? (
          <>
            <p>
              Check <b>{email}</b> for a verification email from Amazon Web Services and click the link.
              Reminders appear in Reminder activity either way.
            </p>
            <button type="button" className="link-button" onClick={recheck} disabled={busy}>
              I’ve clicked it, check again
            </button>
          </>
        ) : (
          <>
            <p>
              Email sending is in the AWS SES sandbox, so reminders can only be delivered to verified addresses.
              They’ll still appear in Reminder activity.
            </p>
            <button type="button" className="link-button" onClick={verify} disabled={busy}>
              {busy ? 'Sending…' : 'Send me a verification email'}
            </button>
          </>
        )}
        {error && <p className="deliver-error">{error}</p>}
      </div>
    </div>
  );
}
