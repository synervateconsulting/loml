import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';
import { Reactions, CommentThread } from './Reactions.jsx';
import { DailyHistory } from './Daily.jsx';
import Confirm, { sendSteps } from './Confirm.jsx';

const fmtDay = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/* ------------------------------------------------------------ home band */

// One compact strip for the daily question, gratitude and weekly check-in.
// Each cell shows its state dot + a 🔥 streak, and opens that ritual on tap.
export function RitualsBand({ daily, gratitude, checkin, onDaily, onGratitude, onWeekly }) {
  const dailyState = !daily ? null : !daily.iAnswered ? ['todo', 'tap to answer'] : !daily.revealed ? ['wait', 'waiting'] : ['done', 'revealed'];
  const gratState = !gratitude ? null : gratitude.addedToday ? ['done', 'added'] : ['todo', 'add one'];
  const weekState = !checkin ? null : checkin.revealed ? ['done', 'done'] : checkin.iSubmitted ? ['wait', 'waiting'] : ['todo', 'your turn'];

  const cell = (emo, label, st, streak, onClick) => (
    <button type="button" className="rcell" onClick={onClick}>
      <span className="rcell__emo" aria-hidden="true">{emo}</span>
      <span className="rcell__label">{label}</span>
      {st && (
        <span className="rcell__state">
          <span className={`dot dot--${st[0]}`} aria-hidden="true" />
          {st[1]}
        </span>
      )}
      <span className="rcell__streak">{streak > 0 ? `🔥 ${streak}` : ' '}</span>
    </button>
  );

  return (
    <div className="rband">
      {cell('🗓️', "Today's ?", dailyState, daily?.streak || 0, onDaily)}
      <span className="rcell__sep" aria-hidden="true" />
      {cell('🌷', 'Gratitude', gratState, gratitude?.streak || 0, onGratitude)}
      <span className="rcell__sep" aria-hidden="true" />
      {cell('🫶', 'Weekly', weekState, checkin?.streak || 0, onWeekly)}
    </div>
  );
}

/* ------------------------------------------------------------ gratitude */

export function GratitudeWall({ meId, onChanged }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.gratitude().then(setData).catch(() => setData({ wall: [], partnerName: 'them' }));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const b = text.trim();
    if (!b || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.addGratitude(b);
      setText('');
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="empty">…</p>;
  return (
    <div className="gratitude">
      <div className="gratitude__compose">
        <input
          className="field__input"
          value={text}
          maxLength={500}
          placeholder={`One thing you appreciate about ${data.partnerName}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn--small btn--primary" disabled={!text.trim() || busy} onClick={add}>
          Add
        </button>
      </div>
      {data.streak > 0 && <p className="hint">🔥 {data.streak}-day gratitude streak</p>}
      {error && <p className="notice notice--error">{error}</p>}
      {data.wall.length === 0 ? (
        <p className="empty">No appreciations yet — add the first.</p>
      ) : (
        data.wall.map((g) => (
          <div key={g.id} className="gcard">
            <p className="gcard__body">{g.body}</p>
            <p className="gcard__meta">
              {g.fromId === meId ? 'You' : g.fromName} → {g.toId === meId ? 'you' : g.toName} · {fmtDay(g.day)}
            </p>
            <Reactions targetKind="gratitude" targetId={g.id} reactions={g.reactions || []} meId={meId} canReact onChanged={load} />
            <CommentThread
              comments={g.comments || []}
              meId={meId}
              onSubmit={async (body) => {
                const c = await api.comment('gratitude', g.id, body);
                load();
                return c;
              }}
              onEdit={(id, body) => api.editComment(id, body)}
            />
          </div>
        ))
      )}
    </div>
  );
}

/* --------------------------------------------------------- weekly check-in */

export function CheckinView({ meId, onChanged, history = false }) {
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [past, setPast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = () =>
    api
      .checkin()
      .then((d) => {
        setData(d);
        setAnswers(d.mine || {});
      })
      .catch(() => {});
  useEffect(() => {
    load();
    if (history) api.checkinHistory().then(setPast).catch(() => {});
  }, []);

  if (!data) return <p className="empty">…</p>;
  const canSubmit = data.prompts.every((p) => (answers[p.key] || '').trim()) && !busy && !data.revealed;

  const submit = () =>
    setConfirm({
      steps: sendSteps(
        data.iSubmitted ? 'Save your check-in?' : 'Submit your check-in?',
        data.partnerSubmitted
          ? 'You’re the last one in — it reveals for both of you.'
          : `${data.partnerName} only sees that you’ve done it until they finish too.`
      ),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          await api.submitCheckin(data.prompts.map((p) => ({ promptKey: p.key, body: (answers[p.key] || '').trim() })));
          await load();
          onChanged?.();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      },
    });

  return (
    <div className="checkin">
      <p className="hint">This week{data.streak > 0 ? ` · 🔥 ${data.streak}-week streak` : ''}</p>

      {data.revealed ? (
        <>
          {data.prompts.map((p) => (
            <div key={p.key} className="reveal__pair">
              <p className="eyebrow">{p.label}</p>
              <p className="prose prose--answer"><b>You:</b> {data.mine[p.key] || '—'}</p>
              <p className="prose prose--answer"><b>{data.partnerName}:</b> {data.theirs?.[p.key] || '—'}</p>
            </div>
          ))}
          {data.id && (
            <>
              <hr className="rule" />
              <Reactions targetKind="checkin" targetId={data.id} reactions={data.reactions || []} meId={meId} canReact onChanged={load} />
              <CommentThread
                comments={data.comments || []}
                meId={meId}
                onSubmit={async (b) => {
                  const c = await api.comment('checkin', data.id, b);
                  load();
                  return c;
                }}
                onEdit={(id, b) => api.editComment(id, b)}
              />
            </>
          )}
        </>
      ) : (
        <>
          {data.iSubmitted && (
            <p className="hint">Locked in — waiting on {data.partnerName}. You can still edit until they finish.</p>
          )}
          {data.prompts.map((p) => (
            <label key={p.key} className="field">
              <span className="field__label">{p.label}</span>
              <textarea
                className="field__input field__input--area"
                rows={3}
                value={answers[p.key] || ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [p.key]: e.target.value }))}
              />
            </label>
          ))}
          <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={submit}>
            {data.iSubmitted ? 'Save' : 'Submit'}
          </button>
          {error && <p className="notice notice--error">{error}</p>}
        </>
      )}

      {history && past?.weeks?.length > 0 && (
        <>
          <hr className="rule" />
          <p className="eyebrow">Past check-ins</p>
          {past.weeks.map((w) => (
            <div key={w.id} className="checkin__past">
              <p className="checkin__pastweek">Week of {fmtDay(w.weekStart)}</p>
              {w.prompts.map((p) => (
                <p key={p.key} className="checkin__pastline">
                  <b>{p.label}</b>
                  <br />
                  You: {w.mine[p.key] || '—'} · {w.partnerName}: {w.theirs[p.key] || '—'}
                </p>
              ))}
            </div>
          ))}
        </>
      )}

      {confirm && (
        <Confirm
          steps={confirm.steps}
          onResolve={(ok) => {
            const { action } = confirm;
            setConfirm(null);
            if (ok) action();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ modals + tab */

export function GratitudeModal({ meId, onClose, onChanged }) {
  return (
    <Modal onScrimClick={onClose} eyebrow="🌷 Gratitude" title="Appreciations" footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}>
      <GratitudeWall meId={meId} onChanged={onChanged} />
    </Modal>
  );
}

export function CheckinModal({ meId, onClose, onChanged }) {
  return (
    <Modal onScrimClick={onClose} eyebrow="🫶 Weekly check-in" title="This week" footer={<button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>}>
      <CheckinView meId={meId} onChanged={onChanged} />
    </Modal>
  );
}

export default function RitualsView({ meId }) {
  const [pane, setPane] = useState('today');
  const tabs = [
    ['today', 'Today’s ?', '📅'],
    ['gratitude', 'Gratitude', '🌷'],
    ['weekly', 'Weekly', '🫶'],
  ];
  return (
    <div className="games">
      <div className="games__head">
        <div className="calpanes" role="group" aria-label="Rituals">
          {tabs.map(([key, label, emo]) => (
            <button
              key={key}
              type="button"
              className={`topnav__item ${pane === key ? 'is-active' : ''}`}
              aria-pressed={pane === key}
              onClick={() => setPane(key)}
            >
              <span className="topnav__emoji" aria-hidden="true">{emo}</span>
              {label}
            </button>
          ))}
        </div>
      </div>
      {pane === 'today' && <DailyHistory meId={meId} />}
      {pane === 'gratitude' && <GratitudeWall meId={meId} />}
      {pane === 'weekly' && <CheckinView meId={meId} history />}
    </div>
  );
}
