import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { homeFor, useAuth, type Role } from '@/auth/AuthProvider';
import { Button } from '@/ui/Button';
import { Spinner } from '@/ui/Feedback';
import { TextField } from '@/ui/Field';

type Method = 'choose' | 'phone' | 'email';

const ROLES: { key: Role; label: string; blurb: string }[] = [
  { key: 'customer', label: 'Customer', blurb: 'Book and track a service' },
  { key: 'mechanic', label: 'Mechanic', blurb: 'Workshop owners and staff' },
  { key: 'admin', label: 'Admin', blurb: 'ServiGo operations team' },
];

const ROLE_KEY = 'servigo-login-role';

const readRole = (): Role => {
  try {
    const v = sessionStorage.getItem(ROLE_KEY);
    if (v === 'customer' || v === 'mechanic' || v === 'admin') return v;
  } catch {
    /* storage can be blocked */
  }
  return 'customer';
};

const rememberRole = (r: Role) => {
  try {
    sessionStorage.setItem(ROLE_KEY, r);
  } catch {
    /* ignore */
  }
};

/** +91 and ten digits; accepts "98400 12345", "+91 98400 12345" and "098400 12345". */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  const ten =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

/**
 * What to tell someone who picked one role but whose account is another. The role
 * they picked changes nothing about what they can do: that comes from their profile.
 */
export function roleMismatchMessage(chosen: Role, actual: Role): string {
  const name = (r: Role) => ROLES.find((x) => x.key === r)!.label.toLowerCase();
  if (chosen === 'admin') return `This account is not an admin account. It is a ${name(actual)} account.`;
  if (chosen === 'mechanic') {
    return actual === 'admin'
      ? 'This is an admin account, not a workshop account.'
      : 'This account is not a workshop account yet. Apply as a workshop below, and an admin will approve it.';
  }
  return `This is a ${name(actual)} account. Continue to your ${name(actual)} dashboard, or sign in with a different account.`;
}

export default function SignIn() {
  const auth = useAuth();
  const loc = useLocation();
  const [role, setRole] = useState<Role>(readRole);
  const [method, setMethod] = useState<Method>('choose');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => rememberRole(role), [role]);

  // switching role resets the form so a half-typed customer sign-up cannot leak into the admin form
  const pickRole = (r: Role) => {
    setRole(r);
    setMethod('choose');
    setCreating(false);
    setCodeSent(false);
    setError(null);
  };

  if (auth.loading) return <div className="container-x py-24"><Spinner /></div>;

  if (auth.session && auth.profile) {
    const actual = auth.profile.role;
    if (actual === role) {
      const from = (loc.state as { from?: string } | null)?.from;
      return <Navigate to={from ?? homeFor(auth.profile)} replace />;
    }
    return (
      <div className="container-x max-w-md py-16 sm:py-24">
        <p className="label mb-3">Signed in</p>
        <h1 className="text-4xl">Wrong account type</h1>
        <p role="alert" className="mt-4 text-muted">{roleMismatchMessage(role, actual)}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to={homeFor(auth.profile)}
            className="inline-flex items-center bg-ink px-5 py-3 text-sm font-medium text-paper hover:opacity-90"
            onClick={() => setRole(actual)}
          >
            Go to my {actual} dashboard
          </Link>
          {role === 'mechanic' && actual === 'customer' ? (
            <Link to="/mechanic/apply" className="inline-flex items-center border border-ink px-5 py-3 text-sm font-medium hover:bg-ink hover:text-paper">
              Apply as a workshop
            </Link>
          ) : null}
          <Button variant="secondary" onClick={() => void auth.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );
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
          Set <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span>.
        </p>
      </div>
    );
  }

  const e164 = normalisePhone(phone);
  // admins are created by hand, never from this page; workshops sign up like anyone then apply
  const canCreate = role !== 'admin';
  const canGoogle = role === 'customer';
  const current = ROLES.find((r) => r.key === role)!;

  return (
    <div className="container-x max-w-md py-16 sm:py-24">
      <p className="label mb-3">Welcome to ServiGo</p>
      <h1 className="text-5xl">Sign in</h1>

      <div role="tablist" aria-label="I am a" className="mt-8 grid grid-cols-3 border border-line">
        {ROLES.map((r) => (
          <button
            key={r.key}
            role="tab"
            type="button"
            aria-selected={role === r.key}
            onClick={() => pickRole(r.key)}
            className={`px-3 py-3 text-sm transition-colors ${
              role === r.key ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
            } ${r.key !== 'customer' ? 'border-l border-line' : ''}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">{current.blurb}.</p>

      <div className="mt-8 space-y-6">
        {method === 'choose' && (
          <>
            {canGoogle ? (
              <Button className="w-full" loading={busy} onClick={() => void run(() => auth.signInWithGoogle())}>
                Continue with Google
              </Button>
            ) : null}
            {role !== 'admin' ? (
              <Button variant={canGoogle ? 'secondary' : 'primary'} className="w-full" onClick={() => setMethod('phone')}>
                Use my phone number
              </Button>
            ) : null}
            <Button
              variant={role === 'admin' ? 'primary' : 'secondary'}
              className="w-full"
              onClick={() => setMethod('email')}
            >
              {role === 'admin' ? 'Sign in with email' : 'Email and password'}
            </Button>
            {role === 'mechanic' ? (
              <p className="text-sm text-muted">
                New workshop?{' '}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => {
                    setCreating(true);
                    setMethod('email');
                  }}
                >
                  Create an account
                </button>
                , then apply with your documents. An admin approves it before you receive any jobs.
              </p>
            ) : null}
          </>
        )}

        {method === 'phone' && (
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
            <button
              type="button"
              className="text-sm text-muted underline underline-offset-4"
              onClick={() => {
                setMethod('choose');
                setCodeSent(false);
              }}
            >
              Other ways to sign in
            </button>
          </form>
        )}

        {method === 'email' && (
          <form
            className="space-y-5"
            onSubmit={(ev) => {
              ev.preventDefault();
              void run(() =>
                creating && canCreate
                  ? auth.signUpWithEmail(email, password, name)
                  : auth.signInWithEmail(email, password),
              );
            }}
          >
            {creating && canCreate ? (
              <TextField label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            ) : null}
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
              {creating && canCreate ? 'Create account' : `Sign in as ${current.label.toLowerCase()}`}
            </Button>
            <div className="flex justify-between text-sm text-muted">
              {canCreate ? (
                <button type="button" className="underline underline-offset-4" onClick={() => setCreating((c) => !c)}>
                  {creating ? 'I already have an account' : 'Create an account'}
                </button>
              ) : (
                <span>Admin accounts are created by the ServiGo team.</span>
              )}
              <button type="button" className="underline underline-offset-4" onClick={() => setMethod('choose')}>
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
