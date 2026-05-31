import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('cp_user');
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (!parsed.role) {
        parsed.role = parsed.is_admin ? 'admin' : 'contributor';
      }
      return parsed;
    } catch {
      localStorage.removeItem('cp_user');
      return null;
    }
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const data = await api.refresh();
        if (!active) return;
        if (data.user) {
          setUser(data.user);
          localStorage.setItem('cp_user', JSON.stringify(data.user));
        } else {
          setUser(null);
          localStorage.removeItem('cp_user');
        }
      } catch {
        if (!active) return;
        setUser(null);
        localStorage.removeItem('cp_user');
      } finally {
        if (active) {
          setReady(true);
        }
      }
    }

    restoreSession();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (userData) => {
    const normalized = { ...userData, role: userData.role || (userData.is_admin ? 'admin' : 'contributor') };
    setUser(normalized);
    localStorage.setItem('cp_user', JSON.stringify(normalized));
    setReady(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
    }
    setUser(null);
    localStorage.removeItem('cp_user');
    setReady(true);
  }, []);

  const updateUser = useCallback((userData) => {
    setUser(userData);
    localStorage.setItem('cp_user', JSON.stringify(userData));
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
