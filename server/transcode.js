// Background video transcoding for cross-platform playback. iPhones capture
// HEVC/.mov, which Android/Chrome/Windows often can't play; this produces an
// H.264 MP4 web version alongside the original (kept), served in its place once
// ready. Runs in-process, one job at a time, and is entirely optional: if
// ffmpeg or R2 isn't available it just stays off and originals are served as-is.
// (Photos are handled client-side: HEIC → JPEG before upload.)

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from './db.js';
import { r2Enabled, downloadTo, putStream } from './storage.js';

let ffmpegOk = false;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

async function hasFfmpeg() {
  try {
    await run('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

// One pending video → H.264 MP4. Returns true if it did work.
async function processOne() {
  const { rows } = await query(
    `SELECT id, storage_key FROM attachment
      WHERE storage = 'r2' AND media_kind = 'video' AND web_key IS NULL
        AND transcode_status NOT IN ('done', 'failed') AND is_removed = false AND storage_key IS NOT NULL
      ORDER BY created_at LIMIT 1`
  );
  const a = rows[0];
  if (!a) return false;

  await query("UPDATE attachment SET transcode_status = 'pending' WHERE id = $1", [a.id]);
  const dir = await mkdtemp(join(tmpdir(), 'loml-tc-'));
  const inPath = join(dir, 'in');
  const outPath = join(dir, 'out.mp4');
  try {
    await downloadTo(a.storage_key, inPath);
    await run('ffmpeg', [
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k',
      outPath,
    ]);
    const webKey = a.storage_key.replace(/\/original$/, '/web.mp4');
    await putStream(webKey, outPath, 'video/mp4');
    await query("UPDATE attachment SET web_key = $1, web_mime = 'video/mp4', transcode_status = 'done' WHERE id = $2", [
      webKey,
      a.id,
    ]);
    console.log(`Transcoded attachment ${a.id} → ${webKey}`);
  } catch (err) {
    console.error(`Transcode failed for ${a.id}: ${err.message}`);
    await query("UPDATE attachment SET transcode_status = 'failed' WHERE id = $1", [a.id]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return true;
}

export async function startTranscoder() {
  if (!r2Enabled()) return; // nothing in R2 to transcode
  ffmpegOk = await hasFfmpeg();
  if (!ffmpegOk) {
    console.warn('ffmpeg not found — video transcoding is disabled (originals served as-is).');
    return;
  }
  console.log('Video transcoder started.');
  const loop = async () => {
    let did = false;
    try {
      did = await processOne();
    } catch (err) {
      console.error('Transcoder loop error:', err.message);
    }
    setTimeout(loop, did ? 500 : 15000); // drain quickly, then idle-poll
  };
  loop();
}
