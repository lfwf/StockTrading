import { useState } from 'react';

export type LocalAccount = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

const ACCOUNT_KEY = 'stock-trading-account';

function readAccount(): LocalAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? JSON.parse(raw) as LocalAccount : null;
  } catch {
    localStorage.removeItem(ACCOUNT_KEY);
    return null;
  }
}

export function useLocalAccount() {
  const [account, setAccount] = useState<LocalAccount | null>(() => readAccount());

  function signIn(email: string, name?: string) {
    const safeEmail = email.trim().toLowerCase();
    if (!safeEmail) return;
    const next: LocalAccount = {
      id: `local-${Date.now()}`,
      name: name?.trim() || safeEmail.split('@')[0] || '训练用户',
      email: safeEmail,
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
    setAccount(next);
  }

  function signOut() {
    localStorage.removeItem(ACCOUNT_KEY);
    setAccount(null);
  }

  return {
    account,
    isSignedIn: Boolean(account),
    signIn,
    signOut,
  };
}
