'use client';
import { useState } from 'react';
import { ArrowRight, Sprout } from 'lucide-react';
export default function Login() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <main className="login"><form className="login-box" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    const form = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) });
      const result = await r.json(); if (!r.ok) throw new Error(result.error);
      window.location.assign('/');
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }}><div className="brand login-brand"><Sprout size={30} /> CAY G<span className="brand-dot" /></div><h1>Đăng nhập</h1><p className="muted">Truy cập không gian làm việc của bạn.</p><label>Email<input name="email" type="email" autoComplete="username" required autoFocus /></label><label>Mật khẩu<input name="password" type="password" autoComplete="current-password" required /></label>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}<ArrowRight size={18} /></button></form></main>;
}
