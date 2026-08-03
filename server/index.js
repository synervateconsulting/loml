import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { migrate } from './db.js';
import { attachUser } from './auth.js';
import api from './routes.js';
import adminApi from './admin.js';
import { startDailyReminders } from './reminders.js';
import { backfillScores } from './scoring.js';
import { startTranscoder } from './transcode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api/admin', adminApi);
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'No such endpoint.' }));

// The built client, then the SPA fallback for every other path.
app.use(express.static(distDir));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const limit = Number(process.env.MAX_UPLOAD_MB || 60);
    return res.status(413).json({ error: `That file is too large — the limit is ${limit} MB. Videos may need trimming.` });
  }
  res.status(500).json({ error: 'Something broke on our end. Try again.' });
});

const port = process.env.PORT || 3000;

migrate()
  .then(() => backfillScores().catch((err) => console.error('Scoring backfill failed:', err)))
  .then(() => {
    app.listen(port, '0.0.0.0', () => console.log(`loml listening on ${port}`));
    startDailyReminders();
    startTranscoder().catch((err) => console.error('Transcoder failed to start:', err));
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
