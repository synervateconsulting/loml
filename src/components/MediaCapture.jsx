import { useEffect, useRef, useState } from 'react';

/*
 * Staging control for outgoing media. It never talks to the server; it hands
 * the parent a list of pending items (an upload File or a recorded Blob plus
 * metadata) and the parent uploads them once the question or answer is saved
 * and an id exists to attach them to.
 *
 * A staged item:
 *   { key, file, fileName, mimeType, mediaKind, size, durationSecs, url }
 */

const MB = 1024 * 1024;

const mediaKindFor = (mime = '') => {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'file';
};

const prettySize = (bytes) => {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
};

const clock = (secs) => {
  const s = Math.floor(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// First MediaRecorder mime type the browser will actually accept.
function pickMime(candidates) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

const canRecord = () =>
  typeof navigator !== 'undefined' &&
  navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== 'undefined';

export default function MediaCapture({ items, onChange, maxBytes = 60 * MB, disabled = false }) {
  const [mode, setMode] = useState('idle'); // 'idle' | 'audio' | 'video'
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef(null);
  const previewVideoRef = useRef(null);

  // Revoke every preview URL we made when the control unmounts.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => {
      stopTracks();
      if (tickRef.current) clearInterval(tickRef.current);
      itemsRef.current.forEach((it) => it.url && URL.revokeObjectURL(it.url));
    },
    []
  );

  // Attach the live camera stream once the <video> is actually in the DOM.
  useEffect(() => {
    if (mode === 'video' && previewVideoRef.current && streamRef.current) {
      previewVideoRef.current.srcObject = streamRef.current;
    }
  }, [mode]);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  const oversize = (bytes) =>
    `That is ${prettySize(bytes)}. The limit is ${Math.round(maxBytes / MB)} MB.`;

  function makeItem(file, { fileName, mimeType, durationSecs }, salt) {
    return {
      key: `${fileName}-${file.size}-${salt}`,
      file,
      fileName,
      mimeType,
      mediaKind: mediaKindFor(mimeType),
      size: file.size,
      durationSecs: durationSecs ?? null,
      url: URL.createObjectURL(file),
    };
  }

  // Single recorded take. Reads the live list via the ref because this runs
  // from the async recorder stop, after `items` may have moved on.
  function stageOne(file, meta) {
    if (file.size > maxBytes) {
      setError(oversize(file.size));
      return;
    }
    onChange([...itemsRef.current, makeItem(file, meta, `${Date.now()}`)]);
  }

  function removeItem(key) {
    const gone = items.find((it) => it.key === key);
    if (gone?.url) URL.revokeObjectURL(gone.url);
    onChange(items.filter((it) => it.key !== key));
  }

  function onFilePicked(e) {
    setError('');
    const picked = Array.from(e.target.files || []);
    e.target.value = ''; // let the same file be picked again later
    const accepted = [];
    let rejected = null;
    picked.forEach((file, i) => {
      if (file.size > maxBytes) {
        rejected = file;
        return;
      }
      accepted.push(
        makeItem(
          file,
          { fileName: file.name, mimeType: file.type || 'application/octet-stream' },
          `${Date.now()}-${i}`
        )
      );
    });
    if (accepted.length) onChange([...items, ...accepted]);
    if (rejected) setError(oversize(rejected.size));
  }

  async function startRecording(kind) {
    setError('');
    if (!canRecord()) {
      setError('This browser cannot record. You can still upload a file.');
      return;
    }
    try {
      const constraints =
        kind === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Prefer MP4/H.264+AAC: it plays on iOS Safari as well as Chrome, and
      // (unlike MediaRecorder webm) carries duration so the scrubber works.
      // Fall back to webm on browsers that can only record that.
      const mimeType =
        kind === 'video'
          ? pickMime([
              'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
              'video/mp4;codecs=avc1,mp4a',
              'video/mp4',
              'video/webm;codecs=vp8,opus',
              'video/webm',
            ])
          : pickMime([
              'audio/mp4;codecs=mp4a.40.2',
              'audio/mp4',
              'audio/aac',
              'audio/webm;codecs=opus',
              'audio/webm',
            ]);

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunksRef.current, { type });
        const secs = (Date.now() - startedAtRef.current) / 1000;
        const ext = /mp4|avc1|mp4a|m4a/i.test(type)
          ? kind === 'video'
            ? 'mp4'
            : 'm4a'
          : /aac/i.test(type)
            ? 'aac'
            : 'webm';
        stageOne(blob, {
          fileName: `${kind}-${clock(secs).replace(':', 'm')}s.${ext}`,
          mimeType: type,
          durationSecs: secs,
        });
        stopTracks();
      };

      recorderRef.current = recorder;
      recorder.start();
      startedAtRef.current = Date.now();
      setElapsed(0);
      setMode(kind);
      tickRef.current = setInterval(
        () => setElapsed((Date.now() - startedAtRef.current) / 1000),
        200
      );
      // The <video> preview is wired up by the effect on `mode`, once mounted.
    } catch (err) {
      stopTracks();
      setError(
        err?.name === 'NotAllowedError'
          ? 'Recording needs microphone and camera permission.'
          : 'Could not start recording on this device.'
      );
    }
  }

  function finishRecording(keep) {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (!keep) recorder.onstop = () => stopTracks(); // drop the take
      recorder.stop();
    } else {
      stopTracks();
    }
    recorderRef.current = null;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    setMode('idle');
    setElapsed(0);
  }

  const recording = mode !== 'idle';

  return (
    <div className="capture">
      {recording ? (
        <div className="capture__live">
          {mode === 'video' && (
            <video
              ref={previewVideoRef}
              className="capture__preview"
              autoPlay
              muted
              playsInline
            />
          )}
          <div className="capture__liverow">
            <span className="capture__rec" aria-hidden="true" />
            <span className="capture__timer">{clock(elapsed)}</span>
            <span className="capture__label">Recording {mode}…</span>
          </div>
          <div className="capture__liveactions">
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => finishRecording(false)}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={() => finishRecording(true)}
            >
              Stop &amp; attach
            </button>
          </div>
        </div>
      ) : (
        <div className="capture__buttons">
          <button
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload file
          </button>
          <button
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => startRecording('audio')}
          >
            Record audio
          </button>
          <button
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => startRecording('video')}
          >
            Record video
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*,image/*"
            multiple
            hidden
            onChange={onFilePicked}
          />
        </div>
      )}

      {error && <p className="notice notice--error">{error}</p>}

      {items.length > 0 && (
        <ul className="staged">
          {items.map((it) => (
            <li key={it.key} className="staged__item">
              <span className="staged__kind" aria-hidden="true">
                {it.mediaKind === 'audio'
                  ? '♪'
                  : it.mediaKind === 'video'
                    ? '▷'
                    : it.mediaKind === 'image'
                      ? '▧'
                      : '⎙'}
              </span>
              {it.mediaKind === 'audio' && <audio className="staged__audio" controls src={it.url} />}
              {it.mediaKind === 'video' && (
                <video className="staged__video" controls playsInline src={it.url} />
              )}
              {it.mediaKind === 'image' && (
                <img className="staged__image" alt={it.fileName} src={it.url} />
              )}
              <div className="staged__meta">
                <span className="staged__name">{it.fileName}</span>
                <span className="staged__size">
                  {prettySize(it.size)}
                  {it.durationSecs ? ` · ${clock(it.durationSecs)}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="linkbtn linkbtn--danger"
                onClick={() => removeItem(it.key)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
