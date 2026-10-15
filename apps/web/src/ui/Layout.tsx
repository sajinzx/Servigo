import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';

const NAV: Record<string, { to: string; label: string }[]> = {
  customer: [
    { to: '/garage', label: 'Garage' },
    { to: '/book', label: 'Book' },
    { to: '/trips', label: 'Trips' },
    { to: '/history', label: 'History' },
  ],
  mechanic: [
    { to: '/mechanic', label: 'Today' },
    { to: '/mechanic/payments', label: 'Payments' },
    { to: '/mechanic/insights', label: 'Insights' },
  ],
  admin: [
    { to: '/admin', label: 'Operations' },
    { to: '/admin/kpis', label: 'KPIs' },
    { to: '/admin/review', label: 'Review' },
    { to: '/admin/cases', label: 'Cases' },
    { to: '/admin/finance', label: 'Finance' },
    { to: '/admin/models', label: 'Models' },
  ],
};

const THEME_KEY = 'servigo-theme';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      /* storage can be blocked; fall through to the system preference */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const;
}

export function Layout() {
  const { profile, session, signOut } = useAuth();
  const [theme, toggle] = useTheme();
  const items = profile ? NAV[profile.role] ?? [] : [];

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="container-x flex h-16 items-center justify-between gap-4">
          <Link to="/" className="text-sm font-semibold uppercase tracking-[0.28em]">
            ServiGo
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 sm:flex">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/mechanic' || i.to === '/admin'}
                className={({ isActive }) =>
                  `text-sm tracking-wide ${isActive ? 'text-ink underline underline-offset-8' : 'text-muted hover:text-ink'}`
                }
              >
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-4 text-sm">
            <button type="button" onClick={toggle} className="text-muted hover:text-ink" aria-label="Toggle dark mode">
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            {session ? (
              <button type="button" onClick={() => void signOut()} className="text-muted hover:text-ink">
                Sign out
              </button>
            ) : (
              <Link to="/signin" className="hover:underline">
                Sign in
              </Link>
            )}
          </div>
        </div>
        {items.length > 0 ? (
          <nav aria-label="Main (mobile)" className="container-x flex gap-5 overflow-x-auto pb-3 sm:hidden">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/mechanic' || i.to === '/admin'}
                className={({ isActive }) => `whitespace-nowrap text-sm ${isActive ? 'text-ink underline underline-offset-8' : 'text-muted'}`}
              >
                {i.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line py-8">
        <div className="container-x flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>© ServiGo</span>
          <span>
            Map data ©{' '}
            <a className="underline" href="https://www.openstreetmap.org/copyright">
              OpenStreetMap contributors
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
