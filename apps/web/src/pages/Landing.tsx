import { Link, Navigate } from 'react-router-dom';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { LinkButton } from '@/ui/Button';

const STEPS = [
  { n: '01', title: 'Describe it', body: 'Tell us what is wrong in your own words. We suggest the right service.' },
  { n: '02', title: 'See the price', body: 'A price range and a time estimate before you commit. GST included.' },
  { n: '03', title: 'Get matched', body: 'The best nearby verified workshop, usually within a minute.' },
];

export default function Landing() {
  const { session, profile } = useAuth();
  // a signed-in user goes straight to their own home
  if (session && profile) return <Navigate to={homeFor(profile)} replace />;

  return (
    <>
      <section className="bg-ink text-paper">
        <div className="container-x flex min-h-[78vh] flex-col justify-end pb-16 pt-24 sm:pb-24">
          <p className="mb-6 text-[11px] font-medium uppercase tracking-[0.28em] text-paper/60">
            Vehicle service, on your terms
          </p>
          <h1 className="max-w-4xl text-6xl sm:text-8xl">Service that comes to a decision, not a queue.</h1>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to="/book"
              className="inline-flex items-center bg-paper px-6 py-3.5 text-sm font-medium tracking-wide text-ink hover:opacity-90"
            >
              Book a service
            </Link>
            <Link to="/mechanic/apply" className="text-sm text-paper/70 underline-offset-4 hover:text-paper hover:underline">
              Own a workshop? Join ServiGo
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container-x">
          <p className="label mb-10">How it works</p>
          <ol className="grid gap-10 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="border-t border-ink pt-4">
                <span className="mono text-sm text-muted">{s.n}</span>
                <h2 className="mt-2 text-3xl">{s.title}</h2>
                <p className="mt-3 text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-line bg-paper-2 py-16">
        <div className="container-x grid gap-8 sm:grid-cols-3">
          <div>
            <p className="label">Verified workshops</p>
            <p className="mt-2 text-muted">
              Every workshop passes document checks and a review before it sees a single job, then starts on a
              probation period.
            </p>
          </div>
          <div>
            <p className="label">Honest prices</p>
            <p className="mt-2 text-muted">
              The server prices every booking. If the final bill runs well over the quote, you approve it first.
            </p>
          </div>
          <div>
            <p className="label">Pay your way</p>
            <p className="mt-2 text-muted">UPI link, scan a QR, or card. You get a GST invoice every time.</p>
          </div>
        </div>
        <div className="container-x mt-12">
          <LinkButton to="/signin" variant="secondary">
            Sign in
          </LinkButton>
        </div>
      </section>
    </>
  );
}
