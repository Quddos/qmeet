-- Row Level Security for every QMeet table. Default deny: anon has no access, and each
-- authenticated policy below grants the narrowest access that a role needs.
-- Writes that involve secrets, attendance, grading or webhooks happen only on the server
-- (service_role bypasses RLS), so clients get no write policy for those tables.

-- ---------- Helper functions (security definer, fixed search_path) ----------
create or replace function current_app_role() returns app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select p.role from profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(current_app_role() in ('super_admin', 'admin'), false)
$$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(current_app_role() = 'super_admin', false)
$$;

create or replace function is_teacher_of(p_classroom uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_admin() or exists (
    select 1 from teacher_assignments ta
    join profiles p on p.id = ta.teacher_id
    where ta.classroom_id = p_classroom and ta.teacher_id = auth.uid() and p.is_active
  )
$$;

create or replace function current_student_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id from students s where s.auth_user_id = auth.uid() and s.is_active
$$;

create or replace function is_enrolled_in(p_classroom uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from enrollments e
    join classrooms c on c.id = e.classroom_id
    where e.classroom_id = p_classroom and e.student_id = current_student_id() and c.is_active
  )
$$;

create or replace function classroom_of_meeting(p_meeting uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select classroom_id from meetings where id = p_meeting
$$;

create or replace function classroom_of_quiz(p_quiz uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select classroom_id from quizzes where id = p_quiz
$$;

revoke all on function current_app_role(), is_admin(), is_super_admin(), is_teacher_of(uuid),
  current_student_id(), is_enrolled_in(uuid), classroom_of_meeting(uuid), classroom_of_quiz(uuid) from public;
grant execute on function current_app_role(), is_admin(), is_super_admin(), is_teacher_of(uuid),
  current_student_id(), is_enrolled_in(uuid), classroom_of_meeting(uuid), classroom_of_quiz(uuid) to authenticated;

-- ---------- Enable RLS and drop anon access everywhere ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','students','classrooms','teacher_assignments','enrollments',
    'meetings','meeting_participants','attendance_sessions','meeting_events','quizzes','questions',
    'question_options','question_accepted_answers','quiz_attempts','quiz_answers','recordings','audit_logs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke all on %I from authenticated', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- Secrets are never readable by client roles, even through a permitted row. A table-level
-- grant overrides column revokes in Postgres, so grant the safe columns explicitly instead.
revoke select on meetings from authenticated;
grant select (id, classroom_id, title, scheduled_start, scheduled_end, status, max_participants,
  livekit_room, started_at, ended_at, created_by, created_at, updated_at) on meetings to authenticated;
grant insert, update, delete on meetings to authenticated;

-- ---------- profiles ----------
create policy profiles_read_self_or_admin on profiles for select to authenticated
  using (id = auth.uid() or is_admin());
create policy profiles_admin_write on profiles for all to authenticated
  using (is_admin()) with check (is_admin());

-- Only a super admin may create or promote anyone to super_admin.
create or replace function guard_profile_role() returns trigger language plpgsql as $$
begin
  -- Migrations and the service role (no end-user identity) may manage roles; client roles may not.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (new.role = 'super_admin' or (tg_op = 'UPDATE' and old.role = 'super_admin')) and not is_super_admin() then
    raise exception 'only a super administrator can grant or change the super administrator role'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard_role before insert or update on profiles
  for each row execute function guard_profile_role();

-- ---------- students ----------
create policy students_read on students for select to authenticated
  using (
    is_admin()
    or auth_user_id = auth.uid()
    or exists (
      select 1 from enrollments e
      where e.student_id = students.id and is_teacher_of(e.classroom_id)
    )
  );
create policy students_admin_write on students for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- classrooms ----------
create policy classrooms_read on classrooms for select to authenticated
  using (is_teacher_of(id) or is_enrolled_in(id));
create policy classrooms_admin_write on classrooms for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- teacher_assignments / enrollments ----------
create policy assignments_read on teacher_assignments for select to authenticated
  using (is_admin() or teacher_id = auth.uid());
create policy assignments_admin_write on teacher_assignments for all to authenticated
  using (is_admin()) with check (is_admin());

create policy enrollments_read on enrollments for select to authenticated
  using (is_teacher_of(classroom_id) or student_id = current_student_id());
create policy enrollments_admin_write on enrollments for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- meetings ----------
create policy meetings_read on meetings for select to authenticated
  using (is_teacher_of(classroom_id) or (is_enrolled_in(classroom_id) and status <> 'cancelled'));
create policy meetings_staff_write on meetings for all to authenticated
  using (is_teacher_of(classroom_id)) with check (is_teacher_of(classroom_id));

-- ---------- meeting_participants / attendance / events (server writes only) ----------
create policy participants_read on meeting_participants for select to authenticated
  using (is_teacher_of(classroom_of_meeting(meeting_id)) or student_id = current_student_id());

create policy attendance_read on attendance_sessions for select to authenticated
  using (is_teacher_of(classroom_of_meeting(meeting_id)) or student_id = current_student_id());

create policy meeting_events_read on meeting_events for select to authenticated
  using (is_teacher_of(classroom_of_meeting(meeting_id)));

-- ---------- quizzes ----------
create policy quizzes_staff_read on quizzes for select to authenticated
  using (is_teacher_of(classroom_id));
create policy quizzes_student_read on quizzes for select to authenticated
  using (is_enrolled_in(classroom_id) and status in ('published', 'closed') and is_visible);
create policy quizzes_staff_write on quizzes for all to authenticated
  using (is_teacher_of(classroom_id)) with check (is_teacher_of(classroom_id));

-- Questions, options and accepted answers hold the answer key. Staff only.
create policy questions_staff on questions for all to authenticated
  using (is_teacher_of(classroom_of_quiz(quiz_id))) with check (is_teacher_of(classroom_of_quiz(quiz_id)));
create policy options_staff on question_options for all to authenticated
  using (is_teacher_of(classroom_of_quiz((select q.quiz_id from questions q where q.id = question_id))))
  with check (is_teacher_of(classroom_of_quiz((select q.quiz_id from questions q where q.id = question_id))));
create policy accepted_staff on question_accepted_answers for all to authenticated
  using (is_teacher_of(classroom_of_quiz((select q.quiz_id from questions q where q.id = question_id))))
  with check (is_teacher_of(classroom_of_quiz((select q.quiz_id from questions q where q.id = question_id))));

-- ---------- attempts and answers ----------
create policy attempts_read on quiz_attempts for select to authenticated
  using (is_teacher_of(classroom_of_quiz(quiz_id)) or student_id = current_student_id());
create policy answers_staff_read on quiz_answers for select to authenticated
  using (is_teacher_of(classroom_of_quiz((select a.quiz_id from quiz_attempts a where a.id = attempt_id))));

-- ---------- recordings (private; never public URLs) ----------
create policy recordings_staff_read on recordings for select to authenticated
  using (is_teacher_of(classroom_of_meeting(meeting_id)));

-- ---------- audit logs (admins read, server writes) ----------
create policy audit_admin_read on audit_logs for select to authenticated
  using (is_admin());

-- Client roles cannot write to tables that represent facts recorded by the server.
revoke insert, update, delete on meeting_participants, attendance_sessions, meeting_events,
  quiz_attempts, quiz_answers, recordings, audit_logs from authenticated;
grant select on meeting_participants, attendance_sessions, meeting_events, quiz_attempts,
  quiz_answers, audit_logs, recordings to authenticated;
