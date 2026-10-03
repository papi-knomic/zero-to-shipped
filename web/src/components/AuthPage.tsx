import { useState, type FormEvent } from 'react';
import { ApiError, auth } from '../lib/api';
import { linkHandler, type AuthRouteName } from '../lib/router';
import type { User } from '../lib/types';
import { Icon, LogoMark } from './Icon';

type Step = AuthRouteName | 'confirm' | 'reset';

const COPY: Record<Step, { title: string; lede: string; submit: string }> = {
  signin: { title: 'Welcome back.', lede: 'Sign in to see your documents and reminders.', submit: 'Sign in' },
  signup: { title: 'Never miss a renewal.', lede: 'Create your account. Lapse reads the dates; you confirm them.', submit: 'Create account' },
  confirm: { title: 'Check your email.', lede: 'We sent a 6-digit code. Enter it to confirm your address.', submit: 'Confirm and continue' },
  forgot: { title: 'Reset your password.', lede: 'Enter your email and we’ll send you a code.', submit: 'Send code' },
  reset: { title: 'Choose a new password.', lede: 'Enter the code from the email and a new password.', submit: 'Save password and sign in' },
};

interface Props {
  route: AuthRouteName;
  onSignedIn: (user: User) => void;
}

/** Sign in, sign up (with email code) and password reset, one card that steps between them. */
export function AuthPage({ route, onSignedIn }: Props) {
  const [step, setStep] = useState<Step>(route);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // The URL drives the top-level step (links between sign in / up / forgot).
  const [lastRoute, setLastRoute] = useState(route);
  if (route !== lastRoute) {
    setLastRoute(route);
    setStep(route);
    setError(null);
    setInfo(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unconfirmed') {
        // Signed up earlier but never entered the code: send a fresh one and ask for it.
        await auth.resendCode(email).catch(() => undefined);
        setStep('confirm');
        setInfo('Your email isn’t confirmed yet. We’ve sent you a new code.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      switch (step) {
        case 'signin':
          onSignedIn(await auth.signIn(email, password));
          break;
        case 'signup': {
          const { next } = await auth.signUp(name, email, password);
          if (next === 'signin') onSignedIn(await auth.signIn(email, password));
          else setStep('confirm');
          break;
        }
        case 'confirm':
          await auth.confirm(email, code);
          // The password is still in memory from the previous step, so sign straight in.
          if (password) onSignedIn(await auth.signIn(email, password));
          else setStep('signin');
          break;
        case 'forgot':
          await auth.forgotPassword(email);
          setStep('reset');
          setInfo('If an account exists for that email, a code is on its way.');
          break;
        case 'reset':
          await auth.resetPassword(email, code, password);
          onSignedIn(await auth.signIn(email, password));
          break;
      }
    });
  }

  const copy = COPY[step];
  const needsEmail = step === 'signin' || step === 'signup' || step === 'forgot';
  const needsPassword = step === 'signin' || step === 'signup' || step === 'reset';
  const needsCode = step === 'confirm' || step === 'reset';

  return (
    <div className="auth">
      <a className="brand auth-brand" href="/" title="About Lapse">
        <LogoMark />
        <span className="wordmark">Lapse</span>
      </a>

      <form className="card auth-card" onSubmit={submit} noValidate={false}>
        <h1>{copy.title}</h1>
        <p className="muted auth-lede">{copy.lede}</p>

        {(step === 'confirm' || step === 'reset') && (
          <p className="auth-for small muted">
            For <b>{email}</b>
          </p>
        )}

        {info && (
          <p className="notice notice-brand">
            <Icon name="check" size={16} />
            {info}
          </p>
        )}

        <div className="auth-fields">
          {step === 'signup' && (
            <label className="field">
              <span>Your name</span>
              <input autoComplete="name" required maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {needsEmail && (
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                autoFocus={step !== 'signup'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {needsCode && (
            <label className="field">
              <span>Code</span>
              <input
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
          )}
          {needsPassword && (
            <label className="field">
              <span>{step === 'reset' ? 'New password' : 'Password'}</span>
              <input
                type="password"
                autoComplete={step === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={step === 'signin' ? undefined : 10}
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {step !== 'signin' && <small className="hint">At least 10 characters, with a lowercase letter and a number.</small>}
            </label>
          )}
        </div>

        {error && (
          <p className="notice notice-error">
            <Icon name="alert" size={16} />
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy && <span className="spinner spinner-sm spinner-on-brand" />}
          {copy.submit}
        </button>

        <div className="auth-links small">
          {step === 'signin' && (
            <>
              <a href="/forgot-password" onClick={linkHandler('/forgot-password')}>
                Forgot your password?
              </a>
              <span>
                New to Lapse?{' '}
                <a href="/signup" onClick={linkHandler('/signup')}>
                  Create an account
                </a>
              </span>
            </>
          )}
          {step === 'signup' && (
            <span>
              Already have an account?{' '}
              <a href="/signin" onClick={linkHandler('/signin')}>
                Sign in
              </a>
            </span>
          )}
          {step === 'confirm' && (
            <button type="button" className="link-button" disabled={busy} onClick={() => void run(async () => {
              await auth.resendCode(email);
              setInfo('A new code is on its way.');
            })}>
              Send a new code
            </button>
          )}
          {(step === 'forgot' || step === 'reset') && (
            <a href="/signin" onClick={linkHandler('/signin')}>
              Back to sign in
            </a>
          )}
        </div>
      </form>

      <p className="auth-demo small muted">
        Just looking? <a href="/demo">Try the demo</a>. No account needed.
      </p>
    </div>
  );
}
