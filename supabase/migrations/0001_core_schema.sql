-- QMeet / ClassConnect core schema. Additive and safe to re-run on an empty database.
-- Requires the pgcrypto extension (Supabase ships it; gen_random_uuid() is used).

create extension if not exists pgcrypto;

do $$ begin
  create type app_role as enum ('super_admin', 'admin', 'teacher');
exception when duplicate_object then null; end $$;

do $$ begin
  create type meeting_status as enum ('scheduled', 'live', 'ended', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quiz_status as enum ('draft', 'published', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_type as enum ('multiple_choice', 'multiple_select', 'true_false', 'short_answer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type recording_status as enum ('starting', 'recording', 'stopping', 'ready', 'failed');
exception when duplicate_object then null; end $$;

-- Staff profiles. id equals the Supabase Auth user id.
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (length(full_name) between 1 and 120),
  email       text not null unique,
  role        app_role not null default 'teacher',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Students. Identified by registration number, authenticated with meeting PIN.
create table if not exists students (
  id                  uuid primary key default gen_random_uuid(),
  registration_number text not null unique check (registration_number ~ '^[A-Z0-9][A-Z0-9/._-]{1,29}$'),
  full_name           text not null check (length(full_name) between 1 and 120),
  auth_user_id        uuid unique references auth.users(id) on delete set null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists classrooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name        text not null check (length(name) between 1 and 150),
  description text,
  is_active   boolean not null default true,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists teacher_assignments (
  classroom_id uuid not null references classrooms(id) on delete cascade,
  teacher_id   uuid not null references profiles(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  primary key (classroom_id, teacher_id)
);

create table if not exists enrollments (
  classroom_id uuid not null references classrooms(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  enrolled_at  timestamptz not null default now(),
  primary key (classroom_id, student_id)
);

create table if not exists meetings (
  id               uuid primary key default gen_random_uuid(),
  classroom_id     uuid not null references classrooms(id) on delete cascade,
  title            text not null check (length(title) between 1 and 150),
  scheduled_start  timestamptz not null,
  scheduled_end    timestamptz not null,
  status           meeting_status not null default 'scheduled',
  pin_hash         text not null,            -- Argon2id hash with server pepper, never the PIN
  pin_failed_attempts integer not null default 0,
  max_participants integer not null default 400 check (max_participants between 2 and 400),
  livekit_room     text not null unique check (livekit_room ~ '^[a-z0-9-]{8,64}$'),
  started_at       timestamptz,
  ended_at         timestamptz,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);
create index if not exists meetings_classroom_start_idx on meetings (classroom_id, scheduled_start);
create index if not exists meetings_status_idx on meetings (status);

create table if not exists meeting_participants (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references meetings(id) on delete cascade,
  student_id   uuid references students(id) on delete set null,
  teacher_id   uuid references profiles(id) on delete set null,
  identity     text not null,               -- LiveKit participant identity (unique per meeting)
  display_name text not null,
  is_teacher   boolean not null default false,
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  unique (meeting_id, identity),
  check (is_teacher = (teacher_id is not null) or (is_teacher = false))
);
create index if not exists meeting_participants_meeting_idx on meeting_participants (meeting_id);
create index if not exists meeting_participants_student_idx on meeting_participants (student_id);

-- One row per connection interval. A student can have several (reconnects).
create table if not exists attendance_sessions (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meetings(id) on delete cascade,
  student_id    uuid not null references students(id) on delete cascade,
  participant_id uuid references meeting_participants(id) on delete set null,
  connected_at  timestamptz not null,
  disconnected_at timestamptz,
  webhook_event_id text unique,              -- idempotency key from LiveKit webhook
  created_at    timestamptz not null default now(),
  check (disconnected_at is null or disconnected_at >= connected_at)
);
create index if not exists attendance_sessions_meeting_student_idx on attendance_sessions (meeting_id, student_id);

create table if not exists meeting_events (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references meetings(id) on delete cascade,
  event_type  text not null,
  actor_id    uuid,
  payload     jsonb not null default '{}'::jsonb,
  event_key   text unique,                   -- dedupe key for webhooks and retries
  created_at  timestamptz not null default now()
);
create index if not exists meeting_events_meeting_idx on meeting_events (meeting_id, created_at);

create table if not exists quizzes (
  id                uuid primary key default gen_random_uuid(),
  classroom_id      uuid not null references classrooms(id) on delete cascade,
  meeting_id        uuid references meetings(id) on delete set null,
  title             text not null check (length(title) between 1 and 150),
  description       text,
  status            quiz_status not null default 'draft',
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds between 30 and 14400),
  total_marks       integer not null default 0 check (total_marks >= 0),
  pass_marks        integer not null default 0 check (pass_marks >= 0),
  starts_at         timestamptz,
  ends_at           timestamptz,
  randomize_questions boolean not null default false,
  max_attempts      integer not null default 1 check (max_attempts between 1 and 10),
  is_visible        boolean not null default true,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists quizzes_classroom_idx on quizzes (classroom_id, status);

create table if not exists questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references quizzes(id) on delete cascade,
  position    integer not null check (position >= 1),
  type        question_type not null,
  prompt      text not null check (length(prompt) between 1 and 2000),
  marks       integer not null default 1 check (marks between 0 and 100),
  unique (quiz_id, position)
);

create table if not exists question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  position    integer not null check (position >= 1),
  label       text not null check (length(label) between 1 and 500),
  is_correct  boolean not null default false,  -- never returned to students
  unique (question_id, position)
);

-- Accepted answers for short-answer questions (normalized, lowercase). Never returned to students.
create table if not exists question_accepted_answers (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  answer      text not null check (length(answer) between 1 and 500),
  unique (question_id, answer)
);

create table if not exists quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references quizzes(id) on delete cascade,
  student_id    uuid not null references students(id) on delete cascade,
  attempt_no    integer not null check (attempt_no >= 1),
  started_at    timestamptz not null default now(),
  deadline_at   timestamptz not null,
  submitted_at  timestamptz,
  score         integer,
  total_marks   integer,
  submit_key    text unique,                 -- idempotency key for submissions
  created_at    timestamptz not null default now(),
  unique (quiz_id, student_id, attempt_no),
  check (deadline_at > started_at)
);
create index if not exists quiz_attempts_quiz_idx on quiz_attempts (quiz_id);

create table if not exists quiz_answers (
  attempt_id        uuid not null references quiz_attempts(id) on delete cascade,
  question_id       uuid not null references questions(id) on delete cascade,
  selected_option_ids uuid[] not null default '{}',
  text_answer       text check (text_answer is null or length(text_answer) <= 2000),
  is_correct        boolean,
  marks_awarded     integer not null default 0,
  primary key (attempt_id, question_id)
);

create table if not exists recordings (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references meetings(id) on delete cascade,
  egress_id       text unique,
  status          recording_status not null default 'starting',
  storage_key     text,                       -- private object key, never a public URL
  size_bytes      bigint check (size_bytes is null or size_bytes >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  failure_reason  text,
  started_by      uuid references profiles(id) on delete set null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);

create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs (created_at);
