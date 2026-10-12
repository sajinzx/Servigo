import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { Button } from '@/ui/Button';
import { TextField } from '@/ui/Field';
import { Spinner } from '@/ui/Feedback';

type Mode = 'choose' | 'phone' | 'email';

/** +91 and ten digits; accepts "98400 12345", "+91 98400 12345" and "098400 12345". */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

export default function SignIn() {
  const auth = useAuth();
  const loc = useLocation();
  const [mode, setMode] = useState<Mode>('choose');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.loading) return <div className="container-x py-24"><Spinner /></div>;
  if (auth.session && auth.profile) {
    const from = (loc.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? homeFor(auth.profile)} replace />;
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign you in');
    } finally {
      setBusy(false);
    }
  };

  if (!auth.configured) {
    return (
      <div className="container-x max-w-xl py-24">
        <h1 className="text-4xl">Not configured</h1>
        <p className="mt-3 text-muted">
          Set <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span>{' '}
          in <span className="mono">apps/web/.env</span>.
        </p>
      </div>
    );
  }

  const e164 = normalisePhone(phone);

  return (
    <div className="container-x max-w-md py-16 sm:py-24">
      <p className="label mb-3">Welcome</p>
      <h1 className="text-5xl">Sign in</h1>

      <div className="mt-10 space-y-6">
        {mode === 'choose' && (
          <>
            <Button className="w-full" loading={busy} onClick={() => void run(() => auth.signInWithGoogle())}>
              Continue with Google
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setMode('phone')}>
              Use my phone number
            </Button>
            <button type="button" className="text-sm text-muted underline underline-offset-4" onClick={() => setMode('email')}>
              Email and password
            </button>
          </>
        )}

        {mode === 'phone' && (
          <form
            className="space-y-5"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!e164) return setError('Enter a 10 digit Indian mobile number');
              void run(async () => {
                if (!codeSent) {
                  await auth.sendPhoneOtp(e164);
                  setCodeSent(true);
                } else {
                  await auth.verifyPhoneOtp(e164, code.trim());
                }
              });
            }}
          >
            <TextField
              label="Mobile number"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98400 12345"
              value={phone}
              disabled={codeSent}
              onChange={(e) => setPhone(e.target.value)}
              hint="We will text you a 6 digit code."
            />
            {codeSent ? (
              <TextField
                label="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            ) : null}
            <Button type="submit" className="w-full" loading={busy}>
              {codeSent ? 'Verify and continue' : 'Send code'}
            </Button>
            <button type="button" className="text-sm text-muted underline underline-offset-4" onClick={() => { setMode('choose'); setCodeSent(false); }}>
              Other ways to sign in
            </button>
          </form>
        )}

        {mode === 'email' && (
          <form
            className="space-y-5"
            onSubmit={(ev) => {
              ev.preventDefault();
              void run(() =>
                creating ? auth.signUpWithEmail(email, password, name) : auth.signInWithEmail(email, password),
              );
            }}
          >
            {creating ? <TextField label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required /> : null}
            <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <TextField
              label="Password"
              type="password"
              autoComplete={creating ? 'new-password' : 'current-password'}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" className="w-full" loading={busy}>
              {creating ? 'Create account' : 'Sign in'}
            </Button>
            <div className="flex justify-between text-sm text-muted">
              <button type="button" className="underline underline-offset-4" onClick={() => setCreating((c) => !c)}>
                {creating ? 'I already have an account' : 'Create an account'}
              </button>
              <button type="button" className="underline underline-offset-4" onClick={() => setMode('choose')}>
                Back
              </button>
            </div>
          </form>
        )}

        {error ? (
          <p role="alert" className="text-sm text-crit">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
