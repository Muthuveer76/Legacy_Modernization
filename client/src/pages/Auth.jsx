import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Brand } from '../components/Layout.jsx';
import { Button, Field } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';

function AuthFrame({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <Brand light />
        </Link>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
        <p className="auth-footer">{footer}</p>
      </div>
      <div className="auth-aside" aria-hidden="true">
        <div>
          <h2>Parse → Analyze → Generate → Validate → Review</h2>
          <p>Structure-aware translation of legacy code, not line-by-line text substitution.</p>
        </div>
      </div>
    </div>
  );
}

function useNext() {
  const [params] = useSearchParams();
  const next = params.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form.email, form.password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to continue modernizing your legacy code." footer={<>New here? <Link to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="form" noValidate>
        <Field label="Email" htmlFor="email">
          <input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password">
          <input id="password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error && <div className="alert alert-danger">{error}</div>}
        <Button type="submit" loading={busy} className="btn-block">
          Sign in
        </Button>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await register(form.name, form.email, form.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Create your account" subtitle="Projects and review history are private to your account." footer={<>Already registered? <Link to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="form" noValidate>
        <Field label="Full name" htmlFor="name">
          <input id="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="email">
          <input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters">
          <input id="password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error && <div className="alert alert-danger">{error}</div>}
        <Button type="submit" loading={busy} className="btn-block">
          Create account
        </Button>
      </form>
    </AuthFrame>
  );
}
