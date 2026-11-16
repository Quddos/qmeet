# QMeet

Video meetings with timed quizzes. Built for Vercel, with free-tier services only.

## What it does

**Meetings**
- Create a meeting and share the link (`/m/abc-defg-hij`). No cap on how many people can *request* to join.
- Waiting room with **Admit all** (or admit / deny one at a time).
- **Mute all** from the host, plus per-person mute and remove.
- Camera, microphone, **screen share**, raise hand, chat, participant list, copy link, end meeting for everyone.
- Lobby with camera and mic preview before you join.

**Quizzes (inside the meeting)**
- Host builds a quiz: title, time limit per student, questions with 2 to 6 options, one correct answer each.
- Host presses **Start now**. The quiz pops up beside the call for students, with an **Open in new tab** option.
- Students enter a registration number (and optional name), answer, and submit once.
- Timer per student, enforced on the server. Auto-submits at the deadline.
- Live counts for the host: taking now, on the page, submitted.
- Host downloads **Excel (.xlsx)** or **CSV**, or gets them **emailed**. Optional: email automatically on close.
- Optional: show students their score after they submit.

## Stack (all free tiers)

| Part | Service |
| --- | --- |
| Hosting, API routes | Vercel |
| Database, realtime signalling and presence | Supabase |
| Email for results | Resend |
| Video | WebRTC (peer to peer), STUN from Google. Optional TURN via `ICE_SERVERS`. |

No build step and no npm dependencies. The browser loads Supabase and SheetJS from jsDelivr.

## Setup (about 15 minutes)

### 1. Supabase
1. Create a free project at https://supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. Go to **Project Settings → API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only, never share it)
4. Realtime is on by default. Nothing else to configure.

### 2. Resend (only for emailed results)
1. Create a free account at https://resend.com and create an API key → `RESEND_API_KEY`.
2. For real users, verify your own domain and set `RESEND_FROM` (e.g. `QMeet <results@yourdomain.com>`).
   Without a verified domain, Resend only delivers to the email address of your Resend account.

### 3. Deploy on Vercel
1. In Vercel, click **Add New → Project** and import the GitHub repository `quddos/qmeet`.
2. Framework preset: **Other**. Build command and output directory: leave empty.
3. Add the environment variables from `.env.example` (at least the three Supabase ones).
4. Deploy. Open the URL, press **Start meeting**, and try it in a second browser window.

### 4. Run locally (optional)
```bash
npm i -g vercel
vercel dev          # reads your env vars after `vercel env pull`
```

## Pages and routes

| URL | Purpose |
| --- | --- |
| `/` | Start or join a meeting |
| `/m/<code>` | Meeting room (shareable link) |
| `/q/<quiz-id>` | Student quiz page (shareable link) |
| `/api/meetings` | Create / check meetings |
| `/api/quizzes` | Host: list, create, start, close, delete quizzes |
| `/api/quiz` | Student: quiz questions (no answer key) |
| `/api/quiz/start`, `/api/quiz/submit` | Student: start and submit |
| `/api/quiz/responses` | Host: responses for the live table and downloads |
| `/api/quiz/email` | Host: email results to the saved host address |

## Security notes

- The host is identified by a random token stored only in the host's browser (`localStorage`). Anyone with the token is the host. Don't share it.
- Tables have Row Level Security on and no public policies. Only the server (service role key) reads or writes them.
- Answer keys are never sent to students. Grading happens on the server.
- Students can submit once per registration number. Registration numbers are not authenticated, so this stops accidental double entries, not deliberate impersonation. If you need verified identity, put the quiz behind a login.

## Known limits (please read)

- **Video capacity.** Video is peer to peer (mesh). Every person connects to every other person. This works well for about **up to 8 to 10 people on video**. Larger rooms need a media server (SFU) such as LiveKit or a self-hosted Jitsi. Joining, admitting and muting work for any number of people, but video quality will drop as the room grows.
- **Connection behind strict firewalls.** Some networks block peer-to-peer traffic. Add a TURN server (for example, Metered's free TURN tier) to `ICE_SERVERS`.
- **No recording or captions.** These were not part of this version.
- **Quiz timing.** A quiz window closes `duration + 10 minutes` after the host starts it. The host can close it earlier.
- **Serverless realtime.** Chat, presence and signalling use Supabase realtime, so they keep working on Vercel's serverless functions.

## Development checks

```bash
npm run check     # syntax check of API and library files
```
