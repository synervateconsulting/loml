import { useEffect, useState } from 'react';
import { admin } from '../api.js';
import { kindLabel } from '../shares.js';
import { eventIcon, eventLabel, formatEventWhen } from '../calendar.js';
import { PREDICT_TEMPLATES, WYR_TEMPLATES, GUESS_PROMPTS, THISTHAT_TEMPLATES } from '../thisthat.js';
import { DECKS } from '../decks.js';

// Resolve a game_used key (e.g. "tt:cozy", "deck:deeper:2", "guess:pet-peeve")
// to a friendly category + title so a played tag reads plainly in the console.
const byId = (arr) => Object.fromEntries(arr.map((t) => [t.id, t]));
const TT = byId(THISTHAT_TEMPLATES);
const PT = byId(PREDICT_TEMPLATES);
const WYRT = byId(WYR_TEMPLATES);
const GUESSP = byId(GUESS_PROMPTS);
const DECKM = byId(DECKS);
function playedLabel(key) {
  const [prefix, a, b] = String(key).split(':');
  if (prefix === 'tt') return { cat: 'This / That', text: TT[a]?.name || a };
  if (prefix === 'pt') return { cat: 'Predict My Pick', text: PT[a]?.name || a };
  if (prefix === 'wyr') return { cat: 'Would You Rather', text: WYRT[a]?.name || a };
  if (prefix === 'guess') return { cat: 'Guess My Answer', text: GUESSP[a]?.text || a };
  if (prefix === 'deck') {
    const d = DECKM[a];
    return { cat: `Deck · ${d?.name || a}`, text: d?.prompts?.[Number(b)] || `Prompt ${Number(b) + 1}` };
  }
  if (prefix === 'bingo') return { cat: 'Bingo', text: a };
  return { cat: prefix || 'Game', text: key };
}

/* --------------------------------------------- app-style read-only previews */

function PickGrid({ pick }) {
  const isPredict = pick.kind === 'predict';
  return (
    <div className="ttgrid">
      {pick.items.map((it) => {
        const a = it.askerChoice;
        const r = it.recipientChoice;
        const matched = a && r && a === r;
        return (
          <div key={it.id} className={`ttrow ${matched ? 'is-match' : ''}`}>
            <div className="ttrow__sides">
              {['left', 'right'].map((side) => {
                const label = side === 'left' ? it.leftLabel : it.rightLabel;
                const icon = side === 'left' ? it.leftIcon : it.rightIcon;
                const chips = [];
                if (a === side) chips.push({ who: 'me', name: pick.askerName });
                if (r === side) chips.push({ who: 'them', name: pick.recipientName });
                return (
                  <div key={side} className={`ttopt ${chips.length ? 'is-picked' : ''}`}>
                    {icon && <span className="ttopt__emo">{icon}</span>}
                    <span className="ttopt__label">{label}</span>
                    {chips.length > 0 && (
                      <span className="ttopt__who">
                        {chips.map((c) => (
                          <span key={c.who} className={`ttchip ttchip--${c.who}`}>{c.name}</span>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {matched && <span className="ttrow__match">{isPredict ? 'nailed it ✓' : 'matched ✨'}</span>}
            {pick.kind === 'wyr' && (it.askerNote || it.recipientNote) && (
              <div className="ttwhy">
                {it.askerNote && <p className="ttwhy__line"><b>{pick.askerName}:</b> {it.askerNote}</p>}
                {it.recipientNote && <p className="ttwhy__line"><b>{pick.recipientName}:</b> {it.recipientNote}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SharePreview({ d }) {
  const eyebrow =
    d.kind === 'predict'
      ? `${d.pick?.recipientName} guessed ${d.pick?.askerName}’s picks`
      : d.kind === 'reveal'
        ? 'Answer together'
        : d.kind === 'guess'
          ? 'Guess My Answer'
          : `${kindLabel({ kind: d.kind })} · ${d.from} → ${d.to}`;
  return (
    <>
      <p className="adm__eyebrow">{eyebrow}{d.isSpicy ? ' · 🔥 spicy' : ''}{d.isRemoved ? ' · removed' : ''}</p>
      <h3 className="adm__title">{d.title}</h3>

      {d.kind === 'song' && d.artist && <p className="card__artist">{d.artist}</p>}
      {d.kind === 'song' && d.link && <p className="prose"><a href={d.link} target="_blank" rel="noreferrer">{d.link}</a></p>}

      {d.pick && <PickGrid pick={d.pick} />}

      {d.reveal && (
        <>
          <div className="reveal__pair"><p className="eyebrow">{d.reveal.askerName}</p><p className="prose prose--answer">{d.reveal.askerBody || '—'}</p></div>
          <div className="reveal__pair"><p className="eyebrow">{d.reveal.recipientName}</p><p className="prose prose--answer">{d.reveal.recipientBody || '—'}</p></div>
        </>
      )}

      {d.guess && (
        <>
          <div className="reveal__pair"><p className="eyebrow">{d.guess.truthName}’s real answer</p><p className="prose prose--answer">{d.guess.truthBody || '—'}</p></div>
          <div className="reveal__pair"><p className="eyebrow">{d.guess.guessName}’s guess</p><p className="prose prose--answer">{d.guess.guessBody || '—'}</p></div>
          {d.guess.verdict && <p className="guessverdict">Verdict: {d.guess.verdict.replace('_', ' ')}</p>}
        </>
      )}

      {!d.pick && !d.reveal && !d.guess && (
        <>
          {d.detail && <p className="prose">{d.detail}</p>}
          {d.response && (
            <div className="reveal__pair"><p className="eyebrow">{d.response.name} replied</p><p className="prose prose--answer">{d.response.body || '—'}</p></div>
          )}
        </>
      )}
    </>
  );
}

function EventPreview({ d }) {
  return (
    <>
      <p className="adm__eyebrow">{eventIcon(d.kind)} {eventLabel(d.kind)}{d.isRemoved ? ' · removed' : ''}</p>
      <h3 className="adm__title">{d.title}</h3>
      <p className="prose">{formatEventWhen(d.startsAt, d.allDay)}</p>
      {d.location && <p className="calloc">📍 {d.location}</p>}
      {d.description && <p className="prose">{d.description}</p>}
      <p className="calmeta">Added by {d.createdBy}</p>
      {d.comments.length > 0 && (
        <>
          <hr className="rule" />
          <p className="eyebrow">Comments</p>
          <ul className="comments">
            {d.comments.map((c, i) => (
              <li key={i} className="comment"><span className="comment__who">{c.name}</span><span className="comment__body">{c.body}</span><span className="comment__at">{c.at}</span></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function DailyPreview({ day }) {
  return (
    <>
      <p className="adm__eyebrow">🗓️ Daily · {day.day}</p>
      <h3 className="adm__title">{day.prompt}</h3>
      {day.answers.length === 0 && <p className="prose">No answers.</p>}
      {day.answers.map((a) => (
        <div key={a.userId} className="reveal__pair"><p className="eyebrow">{a.name}</p><p className="prose prose--answer">{a.body || '—'}</p></div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------- the console */

export default function AdminConsole() {
  const [status, setStatus] = useState(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [flash, setFlash] = useState('');
  const [preview, setPreview] = useState(null); // { kind:'share'|'event'|'daily', loading, detail, day }

  const refresh = async () => {
    const s = await admin.me().catch(() => ({ enabled: false, admin: false }));
    setStatus(s);
    if (s.admin) setData(await admin.overview().catch(() => null));
  };
  useEffect(() => { refresh(); }, []);

  const login = async () => {
    setBusy(true); setError('');
    try { await admin.login(key.trim()); setKey(''); await refresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const logout = async () => { await admin.logout().catch(() => {}); await refresh(); };

  const ask = ({ title, needle, preview: p, run }) => setConfirm({ title, needle, preview: p, run, typed: '' });
  const doConfirm = async () => {
    setBusy(true); setError('');
    try {
      const res = await confirm.run();
      setConfirm(null); setPreview(null);
      setFlash(typeof res === 'string' ? res : 'Deleted.');
      await refresh();
      setTimeout(() => setFlash(''), 3000);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const openShare = async (id) => {
    setPreview({ kind: 'share', loading: true });
    try { const { detail, counts } = await admin.sharePreview(id); setPreview({ kind: 'share', detail, counts }); }
    catch (e) { setError(e.message); setPreview(null); }
  };
  const openEvent = async (id) => {
    setPreview({ kind: 'event', loading: true });
    try { const { detail, counts } = await admin.eventPreview(id); setPreview({ kind: 'event', detail, counts }); }
    catch (e) { setError(e.message); setPreview(null); }
  };
  const openDaily = (day) => setPreview({ kind: 'daily', day });

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
        <input className="adm__input" type="password" value={key} placeholder="Admin key"
          onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key.trim() && login()} />
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
      <p className="adm__warn">⚠️ Everything here is a permanent hard delete. No undo. Tap a row to preview it first.</p>
      {flash && <p className="adm__flash">{flash}</p>}
      {error && <p className="adm__err">{error}</p>}

      {/* Daily */}
      <section className="adm__sec">
        <h2 className="adm__h2">Daily answers ({d.daily.length} days)</h2>
        {d.daily.length === 0 && <p className="adm__muted">None.</p>}
        {d.daily.map((day) => (
          <div key={day.day} className="adm__row">
            <button className="adm__rowbtn" onClick={() => openDaily(day)}>
              <span className="adm__tag">{day.day} · {day.answers.length} answer(s)</span>
              <span className="adm__q">{day.prompt}</span>
            </button>
            <button className="adm__del" onClick={() => ask({ title: `Delete the whole day ${day.day}?`, needle: 'DELETE', preview: [`${day.answers.length} answer(s) on ${day.day}`], run: () => admin.deleteDaily(day.day) })}>Delete day</button>
          </div>
        ))}
      </section>

      {/* Shares */}
      <section className="adm__sec">
        <h2 className="adm__h2">Shares ({d.shares.length})</h2>
        {d.shares.map((s) => (
          <div key={s.id} className="adm__row">
            <button className="adm__rowbtn" onClick={() => openShare(s.id)}>
              <span className="adm__tag">{s.kind}{s.isSpicy ? ' · spicy' : ''}{s.isRemoved ? ' · removed' : ''}</span>
              <span className="adm__q">{s.title}</span>
              <span className="adm__meta">{s.from} → {s.to} · {s.status}</span>
            </button>
            <button className="adm__del" onClick={() => openShare(s.id)}>View</button>
          </div>
        ))}
      </section>

      {/* Calendar */}
      <section className="adm__sec">
        <h2 className="adm__h2">Calendar events ({d.events.length})</h2>
        {d.events.map((e) => (
          <div key={e.id} className="adm__row">
            <button className="adm__rowbtn" onClick={() => openEvent(e.id)}>
              <span className="adm__tag">{e.kind}{e.isRemoved ? ' · removed' : ''}</span>
              <span className="adm__q">{e.title}</span>
            </button>
            <button className="adm__del" onClick={() => openEvent(e.id)}>View</button>
          </div>
        ))}
      </section>

      {/* Games */}
      <section className="adm__sec">
        <h2 className="adm__h2">Games data</h2>
        <p className="adm__muted">Knowing-You points: {d.games.points} (from {d.games.pointRows} games) · Played tags: {d.games.playedKeys}</p>
        <div className="adm__gamebtns">
          <button className="adm__del" onClick={() => ask({ title: 'Reset all Knowing-You points?', needle: 'RESET', preview: [`${d.games.pointRows} point rows`], run: () => admin.resetGames({ points: true }) })}>Reset points</button>
          <button className="adm__del" disabled={!d.games.playedKeys} onClick={() => ask({ title: 'Clear ALL “Played” tags?', needle: 'RESET', preview: [`${d.games.playedKeys} played tag(s)`], run: () => admin.resetGames({ played: true }) })}>Clear all played tags</button>
        </div>

        <p className="adm__muted adm__subhead">Played tags ({d.games.playedKeys}) — reset any one</p>
        {(d.games.played || []).length === 0 ? (
          <p className="adm__muted">No games tagged as played.</p>
        ) : (
          (d.games.played || []).map((g) => {
            const l = playedLabel(g.key);
            return (
              <div key={g.key} className="adm__row">
                <div className="adm__rowmain">
                  <span className="adm__tag">{l.cat}{g.usedBy ? ` · ${g.usedBy}` : ''}{g.usedAt ? ` · ${g.usedAt}` : ''}</span>
                  <span className="adm__q">{l.text}</span>
                </div>
                <button className="adm__del" onClick={() => ask({ title: 'Reset this played tag?', needle: 'RESET', preview: [`${l.cat}: ${l.text}`], run: () => admin.resetGames({ keys: [g.key] }) })}>Reset</button>
              </div>
            );
          })
        )}
      </section>

      {/* Preview panel */}
      {preview && (
        <div className="adm__panelscrim" onMouseDown={() => setPreview(null)}>
          <div className="adm__panel" onMouseDown={(e) => e.stopPropagation()}>
            <button className="adm__panelx" onClick={() => setPreview(null)} aria-label="Close">✕</button>
            <p className="adm__previewhint">Read-only preview — how it looks in the app</p>
            <div className="adm__previewbody">
              {preview.loading && <p className="adm__muted">Loading…</p>}
              {preview.kind === 'share' && preview.detail && <SharePreview d={preview.detail} />}
              {preview.kind === 'event' && preview.detail && <EventPreview d={preview.detail} />}
              {preview.kind === 'daily' && <DailyPreview day={preview.day} />}
            </div>

            {/* Delete controls for the previewed object */}
            {preview.kind === 'share' && preview.detail && (
              <div className="adm__panelfoot">
                <button className="adm__danger" onClick={() => ask({ title: `Delete share “${preview.detail.title}”?`, needle: 'DELETE', preview: Object.entries(preview.counts || {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`), run: () => admin.deleteShare(preview.detail.id) })}>Delete this share…</button>
              </div>
            )}
            {preview.kind === 'event' && preview.detail && (
              <div className="adm__panelfoot">
                <button className="adm__danger" onClick={() => ask({ title: `Delete event “${preview.detail.title}”?`, needle: 'DELETE', preview: ['event + its comments & reactions'], run: () => admin.deleteEvent(preview.detail.id) })}>Delete this event…</button>
              </div>
            )}
            {preview.kind === 'daily' && (
              <div className="adm__panelfoot adm__panelfoot--wrap">
                {preview.day.answers.map((a) => (
                  <button key={a.userId} className="adm__del" onClick={() => ask({ title: `Delete ${a.name}'s answer for ${preview.day.day}?`, needle: 'DELETE', preview: [`"${a.body}"`], run: () => admin.deleteDaily(preview.day.day, a.userId) })}>Delete {a.name}’s</button>
                ))}
                <button className="adm__danger" onClick={() => ask({ title: `Delete the whole day ${preview.day.day}?`, needle: 'DELETE', preview: [`${preview.day.answers.length} answer(s)`], run: () => admin.deleteDaily(preview.day.day) })}>Delete whole day…</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm gate (above the preview) */}
      {confirm && (
        <div className="adm__scrim" onMouseDown={() => setConfirm(null)}>
          <div className="adm__confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="adm__ch">{confirm.title}</h3>
            <p className="adm__muted">This permanently deletes:</p>
            <ul className="adm__preview">{confirm.preview.map((p, i) => <li key={i}>{p}</li>)}</ul>
            <p className="adm__muted">Type <b>{confirm.needle}</b> to confirm.</p>
            <input className="adm__input" value={confirm.typed} autoFocus placeholder={confirm.needle}
              onChange={(e) => setConfirm((c) => ({ ...c, typed: e.target.value }))} />
            <div className="adm__crow">
              <button className="adm__link" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="adm__danger" disabled={confirm.typed !== confirm.needle || busy} onClick={doConfirm}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
