import { attachmentUrl } from '../api.js';

function Player({ item }) {
  const src = attachmentUrl(item.id);
  if (item.media_kind === 'audio') return <audio className="media__audio" controls preload="none" src={src} />;
  if (item.media_kind === 'video')
    return <video className="media__video" controls playsInline preload="metadata" src={src} />;
  if (item.media_kind === 'image') return <img className="media__image" alt={item.file_name || 'Attachment'} src={src} />;
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
