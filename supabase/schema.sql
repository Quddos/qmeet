-- QMeet database schema.
-- Run once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.

create extension if not exists pgcrypto;

create table if not exists meetings (
  code        text primary key,               -- e.g. abc-defg-hij
  host_token  text not null,                  -- secret; only the host's browser has it
  title       text,
  created_at  timestamptz not null default now()
);

create table if not exists quizzes (
  id               uuid primary key default gen_random_uuid(),
  meeting_code     text not null references meetings(code) on delete cascade,
  title            text not null,
  questions        jsonb not null,            -- [{ "q": "...", "options": ["..."], "answer": 0 }]
  duration_minutes int  not null default 10,
  status           text not null default 'draft'
                   check (status in ('draft', 'open', 'closed')),
  show_score       boolean not null default false,
  host_email       text,
  auto_email       boolean not null default false,
  opened_at        timestamptz,
  closes_at        timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists quizzes_meeting_idx on quizzes (meeting_code);

create table if not exists quiz_responses (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references quizzes(id) on delete cascade,
  reg_number    text not null,
  name          text,
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  answers       jsonb,                        -- chosen option index per question, -1 = none
  score         int,
  total         int,
  unique (quiz_id, reg_number)
);

-- Lock the tables down. Only the server (service_role key) can touch them.
-- The browser never reads these tables directly; it uses the API routes and realtime channels.
alter table meetings        enable row level security;
alter table quizzes         enable row level security;
alter table quiz_responses  enable row level security;
