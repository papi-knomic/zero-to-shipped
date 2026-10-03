import { useEffect, useState } from 'react';
import { ApiError, auth, existingDemoWorkspaceId } from '../lib/api';
import { isInFlight } from '../lib/format';
import { linkHandler } from '../lib/router';
import { Icon } from './Icon';

const DISMISSED_KEY = 'lapse.claimDismissed';

/** Demo mode: everything here is temporary, and an account keeps it. */
export function DemoBanner() {
  return (
    <div className="banner banner-demo" role="note">
      <Icon name="clock" size={16} />
      <span>
        <b>Demo workspace.</b> Everything here is deleted after 7 days.
      </span>
      <a className="btn btn-primary btn-sm" href="/signup" onClick={linkHandler('/signup')}>
        Create a free account to keep it
      </a>
    </div>
  );
}

function dismissed(demoId: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === demoId;
  } catch {
    return false;
  }
}

/**
 * Signed in, with documents still in this browser's demo workspace: offer to move them into the
 * account (files, reviewed details, scheduled reminders and activity all come along).
 */
export function ClaimDemoBanner({ onMoved }: { onMoved: () => void }) {
  const [demoId] = useState(existingDemoWorkspaceId);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!demoId || dismissed(demoId)) return;
    let cancelled = false;
    auth
      .demoDocuments()
      .then((docs) => !cancelled && setCount(docs.filter((d) => !isInFlight(d.status)).length))
      .catch(() => undefined); // the offer is best-effort
    return () => {
      cancelled = true;
    };
  }, [demoId]);

  if (!demoId || (count === 0 && !result)) return null;

  async function move() {
    setBusy(true);
    try {
      const { moved } = await auth.claimDemo(demoId!);
      setResult({ kind: 'ok', text: `Moved ${moved} document${moved === 1 ? '' : 's'} into your account.` });
      setCount(0);
      onMoved();
    } catch (err) {
      setResult({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not move the documents. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  function leave() {
    try {
      localStorage.setItem(DISMISSED_KEY, demoId!);
    } catch {
      /* fine: the offer just comes back next time */
    }
    setCount(0);
  }

  if (result) {
    return (
      <p className={`notice ${result.kind === 'ok' ? 'notice-brand' : 'notice-error'}`}>
        <Icon name={result.kind === 'ok' ? 'check' : 'alert'} size={16} />
        {result.text}
      </p>
    );
  }

  return (
    <div className="banner banner-claim" role="region" aria-label="Demo documents">
      <Icon name="stack" size={16} />
      <span>
        You have <b>{count} document{count === 1 ? '' : 's'}</b> in the demo on this browser. Move{' '}
        {count === 1 ? 'it' : 'them'} into your account?
      </span>
      <span className="banner-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={leave} disabled={busy}>
          Leave {count === 1 ? 'it' : 'them'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={move} disabled={busy}>
          {busy && <span className="spinner spinner-sm spinner-on-brand" />}
          Move {count === 1 ? 'it' : 'them'}
        </button>
      </span>
    </div>
  );
}
