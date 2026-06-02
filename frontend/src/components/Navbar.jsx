import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { dark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  function handleLogout() {
    logout();
    navigate('/');
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <nav style={styles.nav}>
      <div className="container nav-inner-wrap">
        <Link to="/" style={styles.logo} aria-label="CrowdPay home" aria-current={pathname === '/' ? 'page' : undefined}>CrowdPay</Link>
        <div className="nav-links">
          {user ? (
            <>
              <Link to="/campaigns/new" style={styles.link} aria-current={pathname === '/campaigns/new' ? 'page' : undefined}>Start Campaign</Link>
              <span style={styles.name} aria-hidden="true">{user.name}</span>
              <button onClick={handleLogout} className="btn-secondary" style={{ padding: '0.4rem 0.9rem' }}>
                Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" style={styles.link} aria-current={pathname === '/login' ? 'page' : undefined}>Log in</Link>
              <Link to="/register" aria-current={pathname === '/register' ? 'page' : undefined}>
                <button className="btn-primary" style={{ padding: '0.4rem 0.9rem' }}>Sign up</button>
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

const styles = {
  nav: { background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10 },
  logo: { fontWeight: 800, fontSize: '1.15rem', color: 'var(--color-accent)' },
  link: { color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: '0.9rem' },
  name: { color: 'var(--color-text-secondary)', fontSize: '0.85rem', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  balance: { color: 'var(--color-text-hint)', fontSize: '0.8rem', fontFamily: 'monospace' },
  balanceLoading: { color: 'var(--color-text-muted)', fontSize: '0.8rem' },
  themeToggle: { background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: '0.4rem 0.6rem', borderRadius: '6px', transition: 'background 0.15s' },
};
