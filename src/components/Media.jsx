import { attachmentUrl } from '../api.js';

// Plain, robust player. `preload="auto"` lets the browser load enough to paint
// the first frame as a thumbnail on its own. We deliberately do NOT seek or add
// a media fragment: MediaRecorder webm has no duration in its header, so it is
// non-seekable, and forcing a seek on it breaks playback (notably in Safari).
function VideoPlayer({ src }) {
  return <video className="media__video" controls playsInline preload="auto" src={src} />;
}

// Extension fallback for rows whose stored media_kind is a generic 'file' even
// though the name clearly names a media type (mirrors the server's inference).
const EXT_KIND = {
  webm: 'video', mp4: 'video', m4v: 'video', mov: 'video', ogv: 'video',
  m4a: 'audio', mp3: 'audio', wav: 'audio', aac: 'audio', oga: 'audio', ogg: 'audio', opus: 'audio', weba: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image',
};

function kindOf(item) {
  if (item.media_kind && item.media_kind !== 'file') return item.media_kind;
  const ext = (item.file_name || '').split('.').pop()?.toLowerCase();
  return EXT_KIND[ext] || 'file';
}

function Player({ item }) {
  const src = attachmentUrl(item.id);
  const kind = kindOf(item);
  if (kind === 'audio') return <audio className="media__audio" controls preload="none" src={src} />;
  if (kind === 'video') return <VideoPlayer src={src} />;
  if (kind === 'image') return <img className="media__image" alt={item.file_name || 'Attachment'} src={src} />;
  return (
    <a className="media__file" href={src} target="_blank" rel="noreferrer">
      {item.file_name || 'Open attachment'}
    </a>
  );
}

export function Attachments({ items = [], onRemove }) {
  if (!items.length) return null;
  return (
    <div className="media">
      {items.map((item) => (
        <figure key={item.id} className="media__item">
          <Player item={item} />
          <figcaption className="media__caption">
            <span>{item.file_name || item.media_kind}</span>
            {onRemove && (
              <button type="button" className="linkbtn linkbtn--danger" onClick={() => onRemove(item)}>
                Remove
              </button>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function AttachmentBadge({ count }) {
  if (!count) return null;
  return (
    <span className="badge" title={`${count} attachment${count === 1 ? '' : 's'}`}>
      {count === 1 ? '1 attachment' : `${count} attachments`}
    </span>
  );
}
