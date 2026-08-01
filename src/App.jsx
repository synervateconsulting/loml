import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { actionLabel, isReveal } from './shares.js';
import { pushSupported, permission, enablePush, syncBadge, clearDeliveredNotifications } from './push.js';
import Login from './components/Login.jsx';
import QuestionSection from './components/QuestionList.jsx';
import ListsView from './components/ListsView.jsx';
import DecksView from './components/DecksView.jsx';
import Countdown from './components/Countdown.jsx';
import {
  ShareModal,
  RespondModal,
  EditQuestionModal,
  ViewModal,
  CountdownModal,
} from './components/Modals.jsx';

const firstName = (name = '') => name.split(' ')[0];

const NAV = [
  ['shares', 'Shares'],
  ['keepsakes', 'Keepsakes'],
  ['lists', 'Lists'],
  ['decks', 'Decks'],
  ['spicy', '🔥😈🔥'],
];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ asked: [], received: [] });
  const [couple, setCouple] = useState(null);
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

  const load = useCallback(async () => {
    try {
      const [questions, coupleState] = await Promise.all([api.questions(), api.couple()]);
      setData(questions);
      setCouple(coupleState);
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
    syncBadge(data.received.filter((q) => q.status === 'open').length);
  }, [data.received]);

  // Re-cover the spicy tab every time you leave it, so it always asks again.
  useEffect(() => {
    if (view !== 'spicy') setSpicyRevealed(false);
  }, [view]);

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
  // On "My shares", a reveal you've already answered opens read-only; anything
  // else is still editable while it waits.
  const mineOpenLabel = (q) => (isReveal(q) ? 'View' : 'Edit');
  const mineOpenAction = (q) => (isReveal(q) ? openView(q, false) : setModal({ kind: 'edit', question: q }));

  const signOut = async () => {
    await api.logout();
    setSession(null);
    setData({ asked: [], received: [] });
    setView('shares');
  };

  const usePrompt = (prompt) =>
    setModal({ kind: 'share', initialKind: 'reveal', initialTitle: prompt, lockKind: true });

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
          <h1 className="brand">loml</h1>
          <div className="topbar__actions">
            <button
              type="button"
              className={`thinking ${tapped ? 'is-sent' : ''}`}
              onClick={thinkingOfYou}
              disabled={tapped}
            >
              {tapped ? 'Sent 💛' : `Thinking of ${partner}`}
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
            <button type="button" className="linkbtn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--wide"
          onClick={() => setModal({ kind: 'share', initialSpicy: view === 'spicy' })}
        >
          {view === 'spicy' ? 'Share something spicy' : 'Share something'}
        </button>
        <nav className="topnav" role="tablist">
          {NAV.map(([key, label]) => {
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
                {label}
                {dot && <span className="dot" aria-label="waiting on you" />}
              </button>
            );
          })}
        </nav>
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

        {view === 'shares' && (
          <>
            <Countdown countdown={couple} onEdit={() => setModal({ kind: 'countdown' })} />
            {renderBoard(receivedClean, askedClean)}
          </>
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

        {view === 'lists' && <ListsView />}

        {view === 'decks' && <DecksView onUsePrompt={usePrompt} />}
      </main>

      {modal?.kind === 'share' && (
        <ShareModal
          partnerName={partner}
          initialKind={modal.initialKind || 'question'}
          initialTitle={modal.initialTitle || ''}
          initialSpicy={Boolean(modal.initialSpicy)}
          lockKind={Boolean(modal.lockKind)}
          onClose={close}
          onDone={finish}
        />
      )}
      {modal?.kind === 'respond' && (
        <RespondModal question={modal.question} meId={me.id} onClose={close} onDone={finish} />
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
        />
      )}
      {modal?.kind === 'countdown' && (
        <CountdownModal countdown={couple} onClose={close} onDone={finish} />
      )}
    </div>
  );
}
