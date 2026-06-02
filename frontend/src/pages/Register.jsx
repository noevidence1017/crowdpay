import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { markJustRegistered } from '../lib/onboarding';
import { isConnected as isFreighterConnected, getPublicKey, requestAccess } from '@stellar/freighter-api';

function passwordStrength(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: 'Weak', color: '#ef4444', width: '33%' };
  if (score <= 3) return { label: 'Fair', color: '#f59e0b', width: '66%' };
  return { label: 'Strong', color: '#10b981', width: '100%' };
}

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', role: 'contributor' });
  const [freighterAvailable, setFreighterAvailable] = useState(false);
  const [usingFreighter, setUsingFreighter] = useState(false);
  const [freighterPublicKey, setFreighterPublicKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  function set(field) { return (e) => setForm((f) => ({ ...f, [field]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setError('Name, email, and password are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = { ...form };
      if (usingFreighter) {
        payload.wallet_type = 'freighter';
        payload.wallet_public_key = freighterPublicKey;
      }
      const { user } = await api.register(payload);
      login(user);
      markJustRegistered();
      navigate(user.role === 'creator' ? '/dashboard' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const con = await isFreighterConnected();
        if (!active) return;
        setFreighterAvailable(Boolean(con?.isConnected));
      } catch {
        if (active) setFreighterAvailable(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function connectFreighter() {
    try {
      const access = await requestAccess();
      if (access?.error) throw new Error(access.error?.message || 'Could not connect to Freighter');
      const pk = access?.address || (await getPublicKey());
      if (!pk) throw new Error('Freighter did not return a public key');
      setFreighterPublicKey(pk);
      setUsingFreighter(true);
      setForm((f) => ({ ...f, password: f.password })); // keep same object
    } catch (err) {
      setError(err.message || 'Could not connect to Freighter');
    }
  }

  return (
    <main className="container" style={{ paddingTop: '4rem', maxWidth: '400px' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: '0.5rem' }}>Create account</h1>
      <p style={{ color: 'var(--color-text-hint)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        A Stellar wallet is created for you automatically.
      </p>
      <form noValidate onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <input placeholder="Full name" value={form.name} onChange={set('name')} required />
        <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
        <div style={{ position: 'relative' }}>
          <input
            id="reg-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
            autoComplete="new-password"
            style={{ paddingRight: '2.5rem', width: '100%' }}
          />
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((v) => !v)}
            style={{
              position: 'absolute',
              right: '0.6rem',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#888',
              padding: '0.2rem',
              minHeight: 'auto',
              fontSize: '0.85rem',
            }}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {form.password && (() => {
          const s = passwordStrength(form.password);
          return (
            <div style={{ marginTop: '-0.4rem' }}>
              <div style={{ height: '4px', borderRadius: '99px', background: '#e5e5e5', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: s.width, background: s.color, transition: 'width 0.2s, background 0.2s', borderRadius: '99px' }} />
              </div>
              <span style={{ fontSize: '0.78rem', color: s.color, fontWeight: 600 }}>{s.label}</span>
            </div>
          );
        })()}
        <div className="form-stack" style={{ position: 'relative' }}>
          <label className="label-strong" htmlFor="reg-confirm">Confirm password</label>
          <input
            id="reg-confirm"
            type={showConfirmPassword ? 'text' : 'password'}
            value={form.confirmPassword}
            onChange={set('confirmPassword')}
            required
            autoComplete="new-password"
            style={{ paddingRight: '2.5rem' }}
          />
          <button
            type="button"
            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowConfirmPassword((v) => !v)}
            style={{
              position: 'absolute',
              right: '0.6rem',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#888',
              padding: '0.2rem',
              minHeight: 'auto',
              fontSize: '0.85rem',
            }}
          >
            {showConfirmPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <select value={form.role} onChange={set('role')} aria-label="Account role">
          <option value="contributor">Contributor</option>
          <option value="creator">Creator</option>
        </select>
        {freighterAvailable && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="checkbox" checked={usingFreighter} onChange={(e) => setUsingFreighter(e.target.checked)} />
              Use Freighter (self-custody)
            </label>
            {usingFreighter ? (
              <button type="button" className="btn-secondary" onClick={connectFreighter}>
                {freighterPublicKey ? 'Connected' : 'Connect Freighter'}
              </button>
            ) : null}
          </div>
        )}
        {error && <p style={{ color: 'var(--color-status-error)', fontSize: '0.875rem' }}>{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading} style={{ padding: '0.8rem' }}>
          {loading ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
      <p style={{ marginTop: '1.25rem', color: 'var(--color-text-hint)', fontSize: '0.9rem' }}>
        Have an account? <Link to="/login" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Log in</Link>
      </p>
    </main>
  );
}
