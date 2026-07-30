import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onSignedIn }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const session = await api.login(key);
      onSignedIn(session);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login__mark" aria-hidden="true" />
      <h1 className="login__title">loml</h1>
      <p className="login__sub">Two people, one long conversation.</p>

      <label className="field">
        <span className="field__label">Access key</span>
        <input
          className="field__input"
          type="password"
          inputMode="text"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          value={key}
          placeholder="your key"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>

      {error && <p className="notice notice--error">{error}</p>}

      <button type="button" className="btn btn--primary btn--wide" onClick={submit} disabled={busy}>
        {busy ? 'Checking…' : 'Let me in'}
      </button>
    </main>
  );
}
