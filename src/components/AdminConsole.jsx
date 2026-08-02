import { useEffect, useState } from 'react';
import { admin } from '../api.js';

// A deliberately plain, hidden maintenance console at /admin. Hard deletes with
// preview + type-to-confirm. Only reachable with the admin key.
export default function AdminConsole() {
  const [status, setStatus] = useState(null); // { enabled, admin }
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, needle, preview, run }
  const [flash, setFlash] = useState('');

  const refresh = async () => {
    const s = await admin.me().catch(() => ({ enabled: false, admin: false }));
    setStatus(s);
    if (s.admin) setData(await admin.overview().catch(() => null));
  };
  useEffect(() => {
    refresh();
  }, []);

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      await admin.login(key.trim());
      setKey('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await admin.logout().catch(() => {});
    await refresh();
  };

  // Open the confirm gate. `needle` is what you must type. `run` performs it.
  const ask = ({ title, needle, preview, run }) =>
    setConfirm({ title, needle, preview, run, typed: '' });

  const doConfirm = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await confirm.run();
      setConfirm(null);
      setFlash(typeof res === 'string' ? res : 'Deleted.');
      await refresh();
      setTimeout(() => setFlash(''), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className="adm adm--boot">…</div>;

  if (!status.enabled) {
    return (
      <div className="adm">
        <h1 className="adm__h1">Admin</h1>
        <p className="adm__note">Admin is disabled — set <code>ADMIN_ACCESS_KEY</code> on the server to enable it.</p>
      </div>
    );
  }

  if (!status.admin) {
    return (
      <div className="adm adm--login">
        <h1 className="adm__h1">Admin</h1>
        <p className="adm__note">Maintenance console. Enter the admin key.</p>
        <input
          className="adm__input"
          type="password"
          value={key}
          placeholder="Admin key"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && login()}
        />
        <button className="adm__btn" disabled={!key.trim() || busy} onClick={login}>Enter</button>
        {error && <p className="adm__err">{error}</p>}
      </div>
    );
  }

  const d = data || { shares: [], events: [], daily: [], games: {}, users: [] };

  return (
    <div className="adm">
      <div className="adm__top">
        <h1 className="adm__h1">Admin · cleanup</h1>
        <button className="adm__link" onClick={logout}>Sign out</button>
      </div>
      <p className="adm__warn">⚠️ Everything here is a permanent hard delete. No undo.</p>
      {flash && <p className="adm__flash">{flash}</p>}
      {error && <p className="adm__err">{error}</p>}

      {/* Daily */}
      <section className="adm__sec">
        <h2 className="adm__h2">Daily answers ({d.daily.length} days)</h2>
        {d.daily.length === 0 && <p className="adm__muted">None.</p>}
        {d.daily.map((day) => (
          <div key={day.day} className="adm__row">
            <div className="adm__rowmain">
              <span className="adm__tag">{day.day}</span>
              <span className="adm__q">{day.prompt}</span>
              <div className="adm__answers">
                {day.answers.map((a) => (
                  <span key={a.userId} className="adm__ans">
                    <b>{a.name}:</b> {a.body}
                    <button
                      className="adm__x"
                      title={`Delete ${a.name}'s answer`}
                      onClick={() =>
                        ask({
                          title: `Delete ${a.name}'s answer for ${day.day}?`,
                          needle: 'DELETE',
                          preview: [`"${a.body}"`],
                          run: () => admin.deleteDaily(day.day, a.userId),
                        })
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <button
              className="adm__del"
              onClick={() =>
                ask({
                  title: `Delete the whole day ${day.day}?`,
                  needle: 'DELETE',
                  preview: [`${day.answers.length} answer(s) on ${day.day}`],
                  run: () => admin.deleteDaily(day.day),
                })
              }
            >
              Delete day
            </button>
          </div>
        ))}
      </section>

      {/* Shares */}
      <section className="adm__sec">
        <h2 className="adm__h2">Shares ({d.shares.length})</h2>
        {d.shares.map((s) => (
          <div key={s.id} className="adm__row">
            <div className="adm__rowmain">
              <span className="adm__tag">{s.kind}{s.isSpicy ? ' · spicy' : ''}{s.isRemoved ? ' · removed' : ''}</span>
              <span className="adm__q">{s.title}</span>
              <span className="adm__meta">{s.from} → {s.to} · {s.status}</span>
            </div>
            <button
              className="adm__del"
              onClick={async () => {
                let counts = null;
                try {
                  counts = (await admin.sharePreview(s.id)).counts;
                } catch {
                  /* preview optional */
                }
                ask({
                  title: `Delete share “${s.title}”?`,
                  needle: 'DELETE',
                  preview: counts
                    ? Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`)
                    : ['this share + all its data'],
                  run: () => admin.deleteShare(s.id),
                });
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </section>

      {/* Calendar */}
      <section className="adm__sec">
        <h2 className="adm__h2">Calendar events ({d.events.length})</h2>
        {d.events.map((e) => (
          <div key={e.id} className="adm__row">
            <div className="adm__rowmain">
              <span className="adm__tag">{e.kind}{e.isRemoved ? ' · removed' : ''}</span>
              <span className="adm__q">{e.title}</span>
              <span className="adm__meta">{e.startsAt}{e.allDay ? ' · all day' : ''}</span>
            </div>
            <button
              className="adm__del"
              onClick={() =>
                ask({
                  title: `Delete event “${e.title}”?`,
                  needle: 'DELETE',
                  preview: ['event + its comments & reactions'],
                  run: () => admin.deleteEvent(e.id),
                })
              }
            >
              Delete
            </button>
          </div>
        ))}
      </section>

      {/* Games */}
      <section className="adm__sec">
        <h2 className="adm__h2">Games data</h2>
        <p className="adm__muted">
          Knowing-You points: {d.games.points} (from {d.games.pointRows} games) · Played tags: {d.games.playedKeys}
        </p>
        <div className="adm__gamebtns">
          <button
            className="adm__del"
            onClick={() =>
              ask({
                title: 'Reset all Knowing-You points?',
                needle: 'RESET',
                preview: [`${d.games.pointRows} point rows`],
                run: () => admin.resetGames({ points: true }),
              })
            }
          >
            Reset points
          </button>
          <button
            className="adm__del"
            onClick={() =>
              ask({
                title: 'Clear all “Played” tags?',
                needle: 'RESET',
                preview: [`${d.games.playedKeys} played keys`],
                run: () => admin.resetGames({ played: true }),
              })
            }
          >
            Clear played tags
          </button>
        </div>
      </section>

      {confirm && (
        <div className="adm__scrim" onMouseDown={() => setConfirm(null)}>
          <div className="adm__confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="adm__ch">{confirm.title}</h3>
            <p className="adm__muted">This permanently deletes:</p>
            <ul className="adm__preview">
              {confirm.preview.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
            <p className="adm__muted">Type <b>{confirm.needle}</b> to confirm.</p>
            <input
              className="adm__input"
              value={confirm.typed}
              autoFocus
              placeholder={confirm.needle}
              onChange={(e) => setConfirm((c) => ({ ...c, typed: e.target.value }))}
            />
            <div className="adm__crow">
              <button className="adm__link" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className="adm__danger"
                disabled={confirm.typed !== confirm.needle || busy}
                onClick={doConfirm}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
