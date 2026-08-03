import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { actionLabel, isReveal, isThisThat, isPickGame, isGuess } from './shares.js';
import { missingPlayedKeys } from './playedBackfill.js';
import { pushSupported, permission, enablePush, syncBadge, clearDeliveredNotifications } from './push.js';
import { eventIcon } from './calendar.js';
import Login from './components/Login.jsx';
import QuestionSection from './components/QuestionList.jsx';
import ListsView from './components/ListsView.jsx';
import GamesView from './components/GamesView.jsx';
import ScoreBoard from './components/ScoreBoard.jsx';
import CalendarView, { EventEditor } from './components/CalendarView.jsx';
import Countdown from './components/Countdown.jsx';
import { DailyModal } from './components/Daily.jsx';
import RitualsView, { RitualsBand, GratitudeModal, CheckinModal } from './components/Rituals.jsx';
import { ShareModal, RespondModal, EditQuestionModal, ViewModal } from './components/Modals.jsx';

const firstName = (name = '') => name.split(' ')[0];

// [key, emoji, label] — emoji and label are separate so a waiting badge can be
// overlaid on the emoji (absolutely positioned) without changing the tab's
// width, which otherwise reflowed the whole grid when a dot appeared/vanished.
const NAV = [
  ['shares', '💞', 'Shares'],
  ['keepsakes', '⭐️', 'Keepsakes'],
  ['spicy', '🔥😈🔥', ''],
  ['lists', '📋', 'Lists'],
  ['rituals', '🌱', 'Rituals'],
  ['games', '🕹️', 'Games'],
];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ asked: [], received: [] });
  const [couple, setCouple] = useState(null);
  const [calendar, setCalendar] = useState({ events: [], notifications: { needsAck: [], acknowledged: [] } });
  const [usedGames, setUsedGames] = useState([]);
  const [gameScore, setGameScore] = useState(0);
  const [bondScore, setBondScore] = useState(0);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [daily, setDaily] = useState(null);
  const [gratitude, setGratitude] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [tab, setTab] = useState('theirs');
  const [view, setView] = useState('shares');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [notif, setNotif] = useState(() => permission());
  const [nudgeHidden, setNudgeHidden] = useState(false);
  const [greeting, setGreeting] = useState(null);
  const [tapped, setTapped] = useState(false);
  const [keepFilter, setKeepFilter] = useState('either'); // either | both | mine | theirs
  const [resynced, setResynced] = useState(false);
  const [spicyRevealed, setSpicyRevealed] = useState(false);
  const playedReconciled = useRef(false);

  const load = useCallback(async () => {
    try {
      const [questions, coupleState, cal, used, dailyState, gratitudeState, checkinState] = await Promise.all([
        api.questions(),
        api.couple(),
        api.calendar(),
        api.gamesUsed(),
        api.daily(),
        api.gratitude(),
        api.checkin(),
      ]);
      setData(questions);
      setCouple(coupleState);
      setCalendar(cal);
      setUsedGames(used?.keys || []);
      setGameScore(used?.gameScore || 0);
      setBondScore(used?.bondScore || 0);
      setDaily(dailyState);
      setGratitude(gratitudeState);
      setCheckin(checkinState);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then(async (s) => {
        if (s.me) {
          setSession(s);
          await load();
          api.nudges().then((n) => n.latest && setGreeting(n.latest)).catch(() => {});
        }
      })
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const waiting = data.received.filter((q) => q.status === 'open').length;
    const dailyPending = daily && !daily.iAnswered ? 1 : 0;
    const reqPending = (calendar.dateRequests || []).filter(
      (r) => r.recipientId === session?.me?.id && r.status === 'pending'
    ).length;
    syncBadge(waiting + (calendar.notifications?.needsAck?.length || 0) + dailyPending + reqPending);
  }, [data.received, calendar, daily, session]);

  // Re-cover the spicy tab every time you leave it, so it always asks again.
  useEffect(() => {
    if (view !== 'spicy') setSpicyRevealed(false);
  }, [view]);

  // One-time: tag templates that were played before the "Played" feature — match
  // existing games to their templates and register any missing keys. Self-heals:
  // once written they come back in usedGames, so there's nothing left to do.
  useEffect(() => {
    if (playedReconciled.current || !session?.me) return;
    const all = [...(data.asked || []), ...(data.received || [])];
    if (!all.length) return; // wait until games have loaded
    playedReconciled.current = true;
    const missing = missingPlayedKeys(all, usedGames);
    if (!missing.length) return;
    api
      .markPlayed(missing)
      .then((r) => {
        if (r?.added) setUsedGames((prev) => [...new Set([...prev, ...missing])]);
      })
      .catch(() => {
        playedReconciled.current = false; // allow a retry on the next load
      });
  }, [session, data, usedGames]);

  // Reconcile the badge (and clear stray notifications) whenever the app comes
  // back to the foreground — this heals a stuck badge after you've handled
  // something elsewhere or straight from the notification.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && session?.me) {
        clearDeliveredNotifications();
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, session]);

  const enableNotifications = async () => {
    await enablePush();
    setNotif(permission());
  };

  const resyncBadge = async () => {
    await clearDeliveredNotifications();
    await syncBadge(0); // clear immediately for instant feedback…
    await load(); // …then reconcile to the true waiting count
    setResynced(true);
    setTimeout(() => setResynced(false), 2000);
  };

  const thinkingOfYou = async () => {
    setTapped(true);
    try {
      await api.thinkingOfYou();
    } catch {
      /* ignore */
    }
    setTimeout(() => setTapped(false), 2500);
  };

  if (loading) return <div className="boot">…</div>;

  if (!session?.me) {
    return (
      <Login
        onSignedIn={async (s) => {
          setSession(s);
          await load();
          api.nudges().then((n) => n.latest && setGreeting(n.latest)).catch(() => {});
        }}
      />
    );
  }

  const me = session.me;
  const partner = firstName(session.partner?.name || 'them');
  // Per-user badge meta for lists (initial + a stable colour by ascending id, so
  // each person looks the same on both devices).
  const listUsers = (() => {
    const out = {};
    const people = [session.me, session.partner].filter(Boolean);
    people
      .slice()
      .sort((a, b) => a.id - b.id)
      .forEach((u, i) => {
        out[u.id] = { name: firstName(u.name), initial: (firstName(u.name)[0] || '?').toUpperCase(), color: i === 0 ? 'a' : 'b' };
      });
    return out;
  })();
  // The countdown IS a calendar event; tapping the banner edits that event (or
  // creates a new one and makes it the countdown).
  const countdownEvent = couple?.countdown?.eventId
    ? calendar.events.find((e) => e.id === couple.countdown.eventId) || null
    : null;
  const todayStr = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const close = () => setModal(null);
  const finish = async () => {
    setModal(null);
    await load();
  };

  // Spicy shares live only in the 🔥😈🔥 tab — kept out of Shares and Keepsakes.
  const receivedClean = data.received.filter((q) => !q.isSpicy);
  const askedClean = data.asked.filter((q) => !q.isSpicy);
  const receivedSpicy = data.received.filter((q) => q.isSpicy);
  const askedSpicy = data.asked.filter((q) => q.isSpicy);
  const waitingClean = receivedClean.filter((q) => q.status === 'open').length;
  const waitingSpicy = receivedSpicy.filter((q) => q.status === 'open').length;

  const meFirst = firstName(me.name);
  const allKept = [...data.asked, ...data.received].filter(
    (q) => (q.keptByMe || q.keptByPartner) && !q.isSpicy
  );
  const keepsakes = allKept.filter((q) =>
    keepFilter === 'both'
      ? q.keptByMe && q.keptByPartner
      : keepFilter === 'mine'
        ? q.keptByMe
        : keepFilter === 'theirs'
          ? q.keptByPartner
          : true
  );
  const keepFilters = [
    ['either', 'Either'],
    ['both', 'Both'],
    ['mine', meFirst],
    ['theirs', partner],
  ];

  const openView = (q, canEditAnswer) => setModal({ kind: 'view', question: q, canEditAnswer });
  // On "My shares", everything unacknowledged is editable — including a reveal
  // prompt (and your blind answer) while it's still waiting to be revealed.
  // This/That can't be edited once sent — the asker just views their locked
  // picks while waiting. Everything else opens the editor.
  const gameLike = (q) => isPickGame(q) || isGuess(q);
  const mineOpenLabel = (q) => (gameLike(q) ? 'View' : 'Edit');
  const mineOpenAction = (q) =>
    setModal(gameLike(q) ? { kind: 'view', question: q } : { kind: 'edit', question: q });

  const signOut = async () => {
    await api.logout();
    setSession(null);
    setData({ asked: [], received: [] });
    setCalendar({ events: [], notifications: { needsAck: [], acknowledged: [] } });
    setUsedGames([]);
    setGameScore(0);
    setBondScore(0);
    setDaily(null);
    setGratitude(null);
    setCheckin(null);
    setView('shares');
  };

  const usePrompt = (prompt, usedKey) =>
    setModal({ kind: 'share', initialKind: 'reveal', initialTitle: prompt, usedKey: usedKey || null, lockKind: true });

  // Start a pick-game composer (this_that / predict / wyr), optionally prefilled.
  const startPick = (initialKind, { title, items, usedKey } = {}) =>
    setModal({
      kind: 'share',
      initialKind,
      initialTitle: title || '',
      initialItems: items || null,
      usedKey: usedKey || null,
      lockKind: true,
    });
  const startThisThat = (opts) => startPick('this_that', opts);
  const startPredict = (opts) => startPick('predict', opts);
  const startWyr = (opts) => startPick('wyr', opts);
  // Start a Guess My Answer composer (open prompt + your real answer).
  const startGuess = ({ title, usedKey } = {}) =>
    setModal({ kind: 'share', initialKind: 'guess', initialTitle: title || '', usedKey: usedKey || null, lockKind: true });

  // The Theirs/Mine board, reused for both the normal and spicy tabs.
  const renderBoard = (received, asked) => {
    const theirsOpen = received.filter((q) => q.status === 'open');
    const theirsDone = received.filter((q) => q.status === 'answered');
    const mineOpen = asked.filter((q) => q.status === 'open');
    const mineDone = asked.filter((q) => q.status === 'answered');
    return (
      <>
        <nav className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'theirs'}
            className={`tab ${tab === 'theirs' ? 'is-active' : ''}`}
            onClick={() => setTab('theirs')}
          >
            {partner}’s shares
            {theirsOpen.length > 0 && <span className="dot" aria-label="waiting on you" />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mine'}
            className={`tab ${tab === 'mine' ? 'is-active' : ''}`}
            onClick={() => setTab('mine')}
          >
            My shares
          </button>
        </nav>

        {tab === 'theirs' ? (
          <>
            <QuestionSection
              heading="Waiting on you"
              seal="open"
              meId={me.id}
              onReload={load}
              count={theirsOpen.length}
              empty={`Nothing from ${partner} right now.`}
              questions={theirsOpen}
              actionLabel={actionLabel}
              onAction={(q) => setModal({ kind: 'respond', question: q })}
            />
            <QuestionSection
              heading="Acknowledged"
              seal="done"
              meId={me.id}
              onReload={load}
              count={theirsDone.length}
              empty="What you've handled collects here."
              questions={theirsDone}
              actionLabel="View"
              onAction={(q) => openView(q, true)}
            />
          </>
        ) : (
          <>
            <QuestionSection
              heading={`Waiting on ${partner}`}
              seal="pending"
              meId={me.id}
              onReload={load}
              count={mineOpen.length}
              empty="Nothing out there yet. Share something."
              questions={mineOpen}
              actionLabel={mineOpenLabel}
              onAction={mineOpenAction}
            />
            <QuestionSection
              heading="Acknowledged"
              seal="done"
              meId={me.id}
              onReload={load}
              count={mineDone.length}
              empty={`Once ${partner} responds, it lands here.`}
              questions={mineDone}
              actionLabel="View"
              onAction={(q) => openView(q, false)}
            />
          </>
        )}
      </>
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__row">
          <div className="topbar__brand">
            <h1 className="brand">loml</h1>
            <button
              type="button"
              className="scorebadge"
              onClick={() => setScoreOpen(true)}
              title="See how your scores work"
              aria-label={`Game score ${gameScore}, bond score ${bondScore} — open the score breakdown`}
            >
              <span className="scorebadge__val">{gameScore}</span> 🧠
              <span className="scorebadge__sep" aria-hidden="true">|</span>
              <span className="scorebadge__val">{bondScore}</span> ❤️
            </button>
          </div>
          <div className="topbar__actions">
            <button
              type="button"
              className={`thinking ${tapped ? 'is-sent' : ''}`}
              onClick={thinkingOfYou}
              disabled={tapped}
              title={tapped ? 'Sent 💛' : `Thinking of ${partner}`}
            >
              {tapped ? '💛 Sent' : `💭 ${partner}`}
            </button>
            {pushSupported() && notif === 'granted' && (
              <button
                type="button"
                className="iconbtn"
                onClick={resyncBadge}
                title="Resync notifications / clear the badge"
                aria-label="Resync notifications"
              >
                {resynced ? '✓' : '↺'}
              </button>
            )}
            <button type="button" className="iconbtn" onClick={signOut} title="Sign out" aria-label="Sign out">
              👋
            </button>
          </div>
        </div>
        <RitualsBand
          daily={daily}
          gratitude={gratitude}
          checkin={checkin}
          onDaily={() => setModal({ kind: 'daily' })}
          onGratitude={() => setModal({ kind: 'gratitude' })}
          onWeekly={() => setModal({ kind: 'checkin' })}
        />
        <div className="countdownrow">
          {couple?.countdown ? (
            <Countdown
              compact
              title={couple.countdown.title}
              startsAt={couple.countdown.startsAt}
              allDay={couple.countdown.allDay}
              icon={eventIcon(couple.countdown.kind)}
              onClick={() => setModal({ kind: 'countdown' })}
            />
          ) : (
            <Countdown compact empty onClick={() => setModal({ kind: 'countdown' })} />
          )}
          <button
            type="button"
            className={`calbtn ${view === 'calendar' ? 'is-active' : ''}`}
            onClick={() => setView(view === 'calendar' ? 'shares' : 'calendar')}
            aria-label="Calendar"
            aria-pressed={view === 'calendar'}
          >
            📅
            {(calendar.notifications?.needsAck?.length > 0 ||
              (calendar.dateRequests || []).some((r) => r.recipientId === me.id && r.status === 'pending')) && (
              <span className="caldot" aria-label="calendar updates" />
            )}
          </button>
        </div>
        <div className="actionbar">
          <nav className="navgrid" role="tablist">
            {NAV.map(([key, emoji, label]) => {
              const dot = (key === 'shares' && waitingClean > 0) || (key === 'spicy' && waitingSpicy > 0);
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  className={`topnav__item ${view === key ? 'is-active' : ''}`}
                  onClick={() => setView(key)}
                >
                  <span className={`topnav__emoji ${label ? '' : 'topnav__emoji--solo'}`} aria-hidden="true">
                    {emoji}
                    {dot && <span className="topnav__dot" aria-label="waiting on you" />}
                  </span>
                  {label}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            className="sharebtn"
            onClick={() => setModal({ kind: 'share', initialSpicy: view === 'spicy' })}
          >
            <span className="sharebtn__plus" aria-hidden="true">＋</span>
            {view === 'spicy' ? 'Spicy' : 'Share'}
          </button>
        </div>
      </header>

      <main className="board">
        {greeting && (
          <div className="greeting" onClick={() => setGreeting(null)}>
            <span>
              {firstName(greeting.fromName)} was thinking of you 💛
              {greeting.count > 1 ? ` (${greeting.count}×)` : ''}
            </span>
          </div>
        )}
        {pushSupported() && notif === 'default' && !nudgeHidden && (
          <div className="nudge">
            <span className="nudge__text">Get a nudge when {partner} shares something.</span>
            <div className="nudge__actions">
              <button type="button" className="linkbtn" onClick={() => setNudgeHidden(true)}>
                Not now
              </button>
              <button type="button" className="btn btn--small btn--primary" onClick={enableNotifications}>
                Turn on notifications
              </button>
            </div>
          </div>
        )}
        {error && <p className="notice notice--error">{error}</p>}

        {view === 'shares' && renderBoard(receivedClean, askedClean)}

        {view === 'calendar' && (
          <CalendarView
            events={calendar.events}
            dateRequests={calendar.dateRequests || []}
            notifications={calendar.notifications}
            countdownEventId={couple?.countdown?.eventId || null}
            meId={me.id}
            partner={partner}
            onChanged={load}
          />
        )}

        {view === 'spicy' &&
          (spicyRevealed ? (
            renderBoard(receivedSpicy, askedSpicy)
          ) : (
            <button type="button" className="spicycover" onClick={() => setSpicyRevealed(true)}>
              <span className="spicycover__emoji">🔥😈🔥</span>
              <span className="spicycover__label">Tap to reveal</span>
              <span className="spicycover__hint">Just between the two of you.</span>
            </button>
          ))}

        {view === 'keepsakes' && (
          <>
            <div className="segmented keepfilter" role="group" aria-label="Whose keepsakes">
              {keepFilters.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`segmented__opt ${keepFilter === key ? 'is-active' : ''}`}
                  aria-pressed={keepFilter === key}
                  onClick={() => setKeepFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <QuestionSection
              heading="Kept forever"
              seal="done"
              meId={me.id}
              onReload={load}
              count={keepsakes.length}
              empty={
                keepFilter === 'both'
                  ? 'Nothing you’ve both kept yet.'
                  : keepFilter === 'theirs'
                    ? `Nothing ${partner} has kept yet.`
                    : 'Star a share to keep it here.'
              }
              questions={keepsakes}
              actionLabel="View"
              onAction={(q) => openView(q, q.recipientId === me.id && q.status === 'answered')}
            />
          </>
        )}

        {view === 'lists' && <ListsView meId={me.id} users={listUsers} />}

        {view === 'rituals' && <RitualsView meId={me.id} />}

        {view === 'games' && (
          <GamesView
            meId={me.id}
            partner={partner}
            onUsePrompt={usePrompt}
            onStartThisThat={startThisThat}
            onStartPredict={startPredict}
            onStartWyr={startWyr}
            onStartGuess={startGuess}
            usedGames={usedGames}
            onChanged={load}
          />
        )}
      </main>

      {scoreOpen && <ScoreBoard onClose={() => setScoreOpen(false)} />}

      {modal?.kind === 'share' && (
        <ShareModal
          partnerName={partner}
          initialKind={modal.initialKind || 'question'}
          initialTitle={modal.initialTitle || ''}
          initialSpicy={Boolean(modal.initialSpicy)}
          initialItems={modal.initialItems || null}
          usedKey={modal.usedKey || null}
          lockKind={Boolean(modal.lockKind)}
          onClose={close}
          onDone={finish}
        />
      )}
      {modal?.kind === 'respond' && (
        <RespondModal question={modal.question} meId={me.id} onClose={close} onDone={finish} onRefresh={load} />
      )}
      {modal?.kind === 'edit' && (
        <EditQuestionModal question={modal.question} onClose={close} onDone={finish} />
      )}
      {modal?.kind === 'view' && (
        <ViewModal
          question={modal.question}
          canEditAnswer={modal.canEditAnswer}
          meId={me.id}
          onClose={close}
          onDone={finish}
          onRefresh={load}
        />
      )}
      {modal?.kind === 'countdown' && (
        <EventEditor
          event={countdownEvent}
          defaultDate={todayStr}
          partner={partner}
          isCountdown={Boolean(countdownEvent)}
          asCountdown={!countdownEvent}
          onClose={close}
          onSaved={finish}
          onRemoved={finish}
          onChanged={load}
        />
      )}
      {modal?.kind === 'daily' && <DailyModal daily={daily} meId={me.id} onClose={close} onAnswered={finish} onRefresh={load} />}
      {modal?.kind === 'gratitude' && <GratitudeModal meId={me.id} onClose={close} onChanged={load} />}
      {modal?.kind === 'checkin' && <CheckinModal meId={me.id} onClose={close} onChanged={load} />}
    </div>
  );
}
