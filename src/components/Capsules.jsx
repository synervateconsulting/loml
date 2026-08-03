import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, UploadStatus, uploadStaged } from './Modals.jsx';
import MediaCapture from './MediaCapture.jsx';
import { Attachments } from './Media.jsx';
import { Reactions, CommentThread } from './Reactions.jsx';
import Confirm, { sendSteps, discardSteps } from './Confirm.jsx';

const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

// Days until an unlock date (for the sealed-card countdown line).
const daysUntil = (s) => {
  if (!s) return 0;
  const [y, m, d] = s.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((then - now) / 86400000);
};

const tomorrowKey = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function SealedCard({ c, onOpen, onRemove }) {
  const left = daysUntil(c.unlockOn);
  return (
    <div className={`capsule capsule--sealed ${c.openable ? 'is-ready' : ''}`}>
      <div className="capsule__lock" aria-hidden="true">{c.openable ? '🎉' : '🔒'}</div>
      <div className="capsule__body">
        <p className="capsule__title">{c.title}</p>
        <p className="capsule__meta">
          Sealed by {c.mine ? 'you' : c.creatorName}
          {c.mediaCount > 0 ? ` · ${c.mediaCount} item${c.mediaCount > 1 ? 's' : ''} inside` : ''}
        </p>
        <p className="capsule__when">
          {c.openable ? '✨ Ready to open together' : `Opens ${fmtDate(c.unlockOn)} · ${left} day${left === 1 ? '' : 's'} to go`}
        </p>
      </div>
      <div className="capsule__actions">
        {c.openable && (
          <button type="button" className="btn btn--small btn--primary" onClick={() => onOpen(c)}>
            Open together
          </button>
        )}
        {c.mine && (
          <button type="button" className="linkbtn linkbtn--danger" onClick={() => onRemove(c)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function OpenedCard({ c, meId, onChanged, onRemove }) {
  return (
    <div className="capsule capsule--open">
      <div className="capsule__head">
        <p className="capsule__title">{c.title}</p>
        {c.mine && (
          <button type="button" className="linkbtn linkbtn--danger" onClick={() => onRemove(c)}>
            Remove
          </button>
        )}
      </div>
      <p className="capsule__meta">
        Sealed by {c.mine ? 'you' : c.creatorName} · opened {fmtDate(c.unlockOn)}
      </p>
      {c.body && <p className="capsule__prose">{c.body}</p>}
      {c.attachments?.length > 0 && <Attachments items={c.attachments} />}
      <div className="capsule__social">
        <Reactions targetKind="capsule" targetId={c.id} reactions={c.reactions || []} meId={meId} canReact onChanged={onChanged} />
        <CommentThread
          comments={c.comments || []}
          meId={meId}
          onSubmit={async (body) => {
            const cm = await api.comment('capsule', c.id, body);
            onChanged();
            return cm;
          }}
          onEdit={(id, body) => api.editComment(id, body)}
        />
      </div>
    </div>
  );
}

export default function CapsulesView({ meId }) {
  const [capsules, setCapsules] = useState(null);
  const [compose, setCompose] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = () => api.capsules().then(setCapsules).catch(() => setCapsules([]));
  useEffect(() => {
    load();
  }, []);

  const open = (c) =>
    setConfirm({
      steps: sendSteps('Open this capsule?', 'Once opened, it’s revealed for both of you — you can’t reseal it.'),
      action: async () => {
        await api.openCapsule(c.id);
        await load();
      },
    });

  const remove = (c) =>
    setConfirm({
      steps: [{ title: 'Remove this capsule?', body: `“${c.title}” will be removed for both of you.`, confirm: 'Remove', tone: 'danger' }],
      action: async () => {
        await api.removeCapsule(c.id);
        await load();
      },
    });

  if (!capsules) return <p className="empty">…</p>;

  const sealed = capsules.filter((c) => !c.opened);
  const opened = capsules.filter((c) => c.opened);

  return (
    <div className="capsules">
      <div className="coupons__bar">
        <p className="decks__hint">Seal a note (and photos or video) to open together on a future day.</p>
        <button type="button" className="btn btn--small btn--primary" onClick={() => setCompose(true)}>
          ＋ New capsule
        </button>
      </div>

      <p className="games__sub">🔒 Sealed</p>
      {sealed.length === 0 ? (
        <p className="empty">No capsules waiting. Make one to open down the road.</p>
      ) : (
        sealed.map((c) => <SealedCard key={c.id} c={c} onOpen={open} onRemove={remove} />)
      )}

      {opened.length > 0 && (
        <>
          <p className="games__sub games__sub--gap">📖 Opened</p>
          {opened.map((c) => (
            <OpenedCard key={c.id} c={c} meId={meId} onChanged={load} onRemove={remove} />
          ))}
        </>
      )}

      {compose && (
        <CapsuleCompose
          onClose={() => setCompose(false)}
          onDone={async () => {
            setCompose(false);
            await load();
          }}
        />
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

function CapsuleCompose({ onClose, onDone }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [unlockOn, setUnlockOn] = useState('');
  const [staged, setStaged] = useState([]);
  const [upload, setUpload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const createdId = useRef(null); // reuse across retries so we never double-create

  const ready = Boolean(title.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(unlockOn) && !busy;
  const dirty = Boolean(title.trim() || body.trim() || unlockOn) || staged.length > 0;
  const cancel = () => (dirty && !busy ? setConfirm({ steps: discardSteps('capsule'), action: onClose }) : onClose());

  const save = () =>
    setConfirm({
      steps: sendSteps('Seal this capsule?', `It stays sealed until ${fmtDate(unlockOn)} — then you open it together.`),
      action: async () => {
        setBusy(true);
        setError('');
        try {
          if (!createdId.current) {
            const { id } = await api.createCapsule({ title: title.trim(), body: body.trim(), unlockOn });
            createdId.current = id;
          }
          if (staged.length)
            await uploadStaged({ staged, setStaged, ownerKind: 'capsule', capsuleId: createdId.current, onProgress: setUpload });
          await onDone();
        } catch (e) {
          setError(e.message);
          setBusy(false);
        }
      },
    });

  return (
    <>
      <Modal
        onScrimClick={cancel}
        eyebrow="⏳ Time capsule"
        title="Seal something for later"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={!ready}>
              Seal it
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">Title</span>
          <input className="field__input" value={title} maxLength={160} placeholder="Read on our anniversary" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Open on</span>
          <input className="field__input" type="date" value={unlockOn} min={tomorrowKey()} onChange={(e) => setUnlockOn(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Message (optional)</span>
          <textarea
            className="field__input field__input--area"
            rows={5}
            value={body}
            maxLength={5000}
            placeholder="A letter to your future selves…"
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="field">
          <span className="field__label">Photos &amp; video (optional)</span>
          <MediaCapture items={staged} onChange={setStaged} disabled={busy} />
        </div>
        <UploadStatus upload={upload} />
        {error && <p className="notice notice--error">{error}</p>}
      </Modal>
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
    </>
  );
}
