# loml

A private question-and-answer app for two people. One of you asks, the other
answers, and the whole exchange stays in one place.

Text, plus audio, video, image and file attachments. Media can be uploaded or
recorded in the browser (`MediaRecorder`) and attached to a question or an
answer; it stores as `bytea` in Postgres and streams back from
`/api/attachments/:id`.

## Stack

- Node 20 + Express (API and static host)
- React 18 + Vite (client)
- Postgres (data **and** uploaded files, stored as `bytea`)
- One Railway service, deployed from GitHub

## Nothing is ever deleted

- Removing a question sets `is_removed`. The row stays.
- Removing an attachment sets `is_removed`. The bytes stay and the file is
  still downloadable at `/api/attachments/:id`, and restorable via
  `POST /api/attachments/:id/restore`.
- Every save writes a new row to `question_version` or `response_version`,
  including the original. Nothing overwrites history.
- `activity_log` records every sign-in, ask, answer, edit and removal.

## Deploy to Railway

1. **Push this folder to a new GitHub repo.**
   ```bash
   cd loml
   git init
   git add .
   git commit -m "loml: first version"
   gh repo create loml --private --source=. --push
   ```
   Without the `gh` CLI: create an empty private repo named `loml` on
   github.com, then
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/loml.git
   git branch -M main
   git push -u origin main
   ```

2. **Create the Railway project.** New Project → Deploy from GitHub repo →
   pick `loml`.

3. **Add the database.** In that project: New → Database → Add PostgreSQL.

4. **Set variables** on the `loml` service (Variables tab):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `SESSION_SECRET` | the long hex string from the handoff notes |
   | `USER_A_NAME` | `Zak` |
   | `USER_A_ACCESS_KEY` | your key |
   | `USER_B_NAME` | `Freddie` |
   | `USER_B_ACCESS_KEY` | Freddie's key |
   | `NODE_ENV` | `production` |

5. **Generate a domain.** Settings → Networking → Generate Domain. Open it on
   your phone and add it to the home screen; it runs full-screen.

Tables are created and the two profiles are seeded on every boot, so there is
no migration step. Changing an access key variable and redeploying updates
that profile's key.

## Running it locally

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and the keys
node --env-file=.env server/index.js   # API on :3000
npm run dev:client                     # UI on :5173, proxies to :3000
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/login` | `{ accessKey }`, sets a 30-day cookie |
| GET | `/api/me` | current profile and partner |
| GET | `/api/questions` | everything you can see, both directions |
| POST | `/api/questions` | `{ title, detail }` |
| PATCH | `/api/questions/:id` | asker only, unanswered only |
| POST | `/api/questions/:id/response` | recipient only |
| PATCH | `/api/responses/:id` | responder only |
| GET | `/api/questions/:id/history` | every version, plus removed attachments |
| POST | `/api/attachments` | multipart `file` + `ownerKind` (ready for phase 2) |
| GET | `/api/attachments/:id` | streams the file |
| POST | `/api/attachments/:id/remove` | flags it, keeps it |

## Media capture

`src/components/MediaCapture.jsx` stages outgoing media — an uploaded file or a
`MediaRecorder` take — and the modals in `src/components/Modals.jsx` upload each
staged item to `/api/attachments` once the question or answer is saved and has
an id. Playback lives in `src/components/Media.jsx`. The upload cap is
`MAX_UPLOAD_MB` (default 60).

Media attaches to a question in the **Ask** and **Edit** modals, and to an
answer in the **Respond** modal and when viewing your own answer. Question
attachments lock once the question is answered, matching the API.
