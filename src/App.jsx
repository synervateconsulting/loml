import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { actionLabel } from './shares.js';
import Login from './components/Login.jsx';
import QuestionSection from './components/QuestionList.jsx';
import { ShareModal, RespondModal, EditQuestionModal, ViewModal } from './components/Modals.jsx';

const firstName = (name = '') => name.split(' ')[0];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ asked: [], received: [] });
  const [tab, setTab] = useState('theirs'); // 'theirs' is the landing tab
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const questions = await api.questions();
      setData(questions);
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
        }
      })
      .finally(() => setLoading(false));
  }, [load]);

  if (loading) return <div className="boot">…</div>;

  if (!session?.me) {
    return (
      <Login
        onSignedIn={async (s) => {
          setSession(s);
          await load();
        }}
      />
    );
  }

  const partner = firstName(session.partner?.name || 'them');
  const close = () => setModal(null);
  const finish = async () => {
    setModal(null);
    await load();
  };

  const theirsOpen = data.received.filter((q) => q.status === 'open');
  const theirsDone = data.received.filter((q) => q.status === 'answered');
  const mineOpen = data.asked.filter((q) => q.status === 'open');
  const mineDone = data.asked.filter((q) => q.status === 'answered');

  const signOut = async () => {
    await api.logout();
    setSession(null);
    setData({ asked: [], received: [] });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__row">
          <h1 className="brand">loml</h1>
          <button type="button" className="linkbtn" onClick={signOut}>
            Sign out
          </button>
        </div>
        <button type="button" className="btn btn--primary btn--wide" onClick={() => setModal({ kind: 'share' })}>
          Share something
        </button>
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
      </header>

      <main className="board">
        {error && <p className="notice notice--error">{error}</p>}

        {tab === 'theirs' ? (
          <>
            <QuestionSection
              heading="Waiting on you"
              seal="open"
              count={theirsOpen.length}
              empty={`Nothing from ${partner} right now.`}
              questions={theirsOpen}
              actionLabel={actionLabel}
              onAction={(q) => setModal({ kind: 'respond', question: q })}
            />
            <QuestionSection
              heading="Acknowledged"
              seal="done"
              count={theirsDone.length}
              empty="What you've handled collects here."
              questions={theirsDone}
              actionLabel="View"
              onAction={(q) => setModal({ kind: 'view', question: q, canEditAnswer: true })}
            />
          </>
        ) : (
          <>
            <QuestionSection
              heading={`Waiting on ${partner}`}
              seal="pending"
              count={mineOpen.length}
              empty="Nothing out there yet. Share something."
              questions={mineOpen}
              actionLabel="Edit"
              onAction={(q) => setModal({ kind: 'edit', question: q })}
            />
            <QuestionSection
              heading="Acknowledged"
              seal="done"
              count={mineDone.length}
              empty={`Once ${partner} responds, it lands here.`}
              questions={mineDone}
              actionLabel="View"
              onAction={(q) => setModal({ kind: 'view', question: q, canEditAnswer: false })}
            />
          </>
        )}
      </main>

      {modal?.kind === 'share' && <ShareModal partnerName={partner} onClose={close} onDone={finish} />}
      {modal?.kind === 'respond' && (
        <RespondModal question={modal.question} onClose={close} onDone={finish} />
      )}
      {modal?.kind === 'edit' && (
        <EditQuestionModal question={modal.question} onClose={close} onDone={finish} />
      )}
      {modal?.kind === 'view' && (
        <ViewModal
          question={modal.question}
          canEditAnswer={modal.canEditAnswer}
          onClose={close}
          onDone={finish}
        />
      )}
    </div>
  );
}
