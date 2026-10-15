import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SignIn, { roleMismatchMessage } from '@/pages/SignIn';

let authState: Record<string, unknown> = {};
vi.mock('@/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/auth/AuthProvider')>('@/auth/AuthProvider');
  return { ...actual, useAuth: () => authState };
});

const base = {
  loading: false,
  configured: true,
  session: null,
  profile: null,
  signInWithGoogle: vi.fn(),
  sendPhoneOtp: vi.fn(),
  verifyPhoneOtp: vi.fn(),
  signInWithEmail: vi.fn().mockResolvedValue(undefined),
  signUpWithEmail: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn(),
};

const profile = (role: string) => ({
  id: 'u', role, full_name: 'A', phone: '+919840012345', phone_verified: true, whatsapp_opt_in: false, onboarded_at: '2026-01-01',
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/signin']}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/garage" element={<p>garage page</p>} />
        <Route path="/mechanic" element={<p>mechanic page</p>} />
        <Route path="/admin" element={<p>admin page</p>} />
        <Route path="/mechanic/apply" element={<p>apply page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  authState = { ...base };
  vi.clearAllMocks();
});

describe('role selector', () => {
  it('offers customer, mechanic and admin and defaults to customer', () => {
    renderPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Customer', 'Mechanic', 'Admin']);
    expect(screen.getByRole('tab', { name: 'Customer' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('shows Google only to customers', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Mechanic' }));
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use my phone number' })).toBeInTheDocument();
    expect(screen.getByText(/New workshop\?/)).toBeInTheDocument();
  });

  it('gives admins email sign-in only, with no way to create an account', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Admin' }));
    expect(screen.queryByRole('button', { name: 'Use my phone number' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with email' }));
    expect(screen.queryByRole('button', { name: /Create an account/ })).toBeNull();
    expect(screen.getByText(/created by the ServiGo team/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in as admin' })).toBeInTheDocument();
  });

  it('signs a mechanic in with email through the normal path', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Mechanic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Email and password' }));
    await userEvent.type(screen.getByLabelText('Email'), 'shop@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in as mechanic' }));
    await waitFor(() => expect((authState.signInWithEmail as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('shop@example.com', 'password123'));
  });

  it('lets a new workshop create an account from the mechanic tab', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Mechanic' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Ravi');
    await userEvent.type(screen.getByLabelText('Email'), 'ravi@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(authState.signUpWithEmail).toHaveBeenCalledWith('ravi@example.com', 'password123', 'Ravi'));
  });
});

describe('after sign-in', () => {
  it('sends an account to its own dashboard when the chosen role matches', async () => {
    authState = { ...base, session: {}, profile: profile('customer') };
    renderPage();
    expect(await screen.findByText('garage page')).toBeInTheDocument();
  });

  it('does not let choosing Admin open the admin area for a customer', async () => {
    sessionStorage.setItem('servigo-login-role', 'admin');
    authState = { ...base, session: {}, profile: profile('customer') };
    renderPage();
    expect(await screen.findByText('Wrong account type')).toBeInTheDocument();
    expect(screen.queryByText('admin page')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/not an admin account/);
  });

  it('offers the application when a customer picked Mechanic', async () => {
    sessionStorage.setItem('servigo-login-role', 'mechanic');
    authState = { ...base, session: {}, profile: profile('customer') };
    renderPage();
    expect(await screen.findByText('Wrong account type')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apply as a workshop' })).toHaveAttribute('href', '/mechanic/apply');
  });

  it('lets an approved mechanic through from the mechanic tab', async () => {
    sessionStorage.setItem('servigo-login-role', 'mechanic');
    authState = { ...base, session: {}, profile: profile('mechanic') };
    renderPage();
    expect(await screen.findByText('mechanic page')).toBeInTheDocument();
  });
});

describe('messages', () => {
  it('explains each mismatch without naming internals', () => {
    expect(roleMismatchMessage('admin', 'mechanic')).toMatch(/not an admin account/);
    expect(roleMismatchMessage('mechanic', 'admin')).toMatch(/admin account, not a workshop/);
    expect(roleMismatchMessage('mechanic', 'customer')).toMatch(/Apply as a workshop/);
    expect(roleMismatchMessage('customer', 'mechanic')).toMatch(/mechanic account/);
  });
});
