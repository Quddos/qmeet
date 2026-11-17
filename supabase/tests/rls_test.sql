-- Authorization tests for QMeet RLS. Run after migrations on a disposable database:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Each check raises an exception on failure, so a clean run means every check passed.
begin;

-- Fixture: two classrooms, two teachers, two students, one admin, one super admin.
insert into auth.users(id) values
  ('00000000-0000-0000-0000-00000000000a'),  -- teacher T1 (classroom C1)
  ('00000000-0000-0000-0000-00000000000b'),  -- teacher T2 (classroom C2)
  ('00000000-0000-0000-0000-00000000000c'),  -- admin
  ('00000000-0000-0000-0000-00000000000d'),  -- super admin
  ('00000000-0000-0000-0000-0000000000e1'),  -- student S1 (classroom C1)
  ('00000000-0000-0000-0000-0000000000e2');  -- student S2 (classroom C2)

insert into profiles(id, full_name, email, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Teacher One', 't1@example.edu', 'teacher'),
  ('00000000-0000-0000-0000-00000000000b', 'Teacher Two', 't2@example.edu', 'teacher'),
  ('00000000-0000-0000-0000-00000000000c', 'Admin', 'admin@example.edu', 'admin'),
  ('00000000-0000-0000-0000-00000000000d', 'Super', 'super@example.edu', 'super_admin');

insert into students(id, registration_number, full_name, auth_user_id) values
  ('10000000-0000-0000-0000-000000000001', 'REG001', 'Student One', '00000000-0000-0000-0000-0000000000e1'),
  ('10000000-0000-0000-0000-000000000002', 'REG002', 'Student Two', '00000000-0000-0000-0000-0000000000e2');

insert into classrooms(id, code, name) values
  ('20000000-0000-0000-0000-000000000001', 'C1', 'Classroom One'),
  ('20000000-0000-0000-0000-000000000002', 'C2', 'Classroom Two');

insert into teacher_assignments(classroom_id, teacher_id) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b');

insert into enrollments(classroom_id, student_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');

insert into meetings(id, classroom_id, title, scheduled_start, scheduled_end, pin_hash, livekit_room) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Lecture 1',
   now(), now() + interval '1 hour', 'hash-c1', 'room-c1-lecture1'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Lecture 2',
   now(), now() + interval '1 hour', 'hash-c2', 'room-c2-lecture2');

insert into quizzes(id, classroom_id, title, status) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Published C1', 'published'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Draft C1', 'draft'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'Published C2', 'published');

insert into questions(id, quiz_id, position, type, prompt) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'multiple_choice', '2+2?');
insert into question_options(question_id, position, label, is_correct) values
  ('50000000-0000-0000-0000-000000000001', 1, '3', false),
  ('50000000-0000-0000-0000-000000000001', 2, '4', true);

insert into quiz_attempts(id, quiz_id, student_id, attempt_no, deadline_at) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 1, now() + interval '30 minutes'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000002', 1, now() + interval '30 minutes');

insert into recordings(meeting_id, egress_id, status, storage_key) values
  ('30000000-0000-0000-0000-000000000001', 'EG_1', 'ready', 'private/c1/lecture1.mp4');

-- Helpers: run a query as an authenticated user and return the row count it sees.
create or replace function pg_temp.as_user(uid text, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
  execute 'select count(*) from (' || q || ') s' into n;
  execute 'reset role';
  return n;
end $$;

create or replace function pg_temp.expect_denied(uid text, q text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
  begin
    execute q;
  exception when insufficient_privilege then
    execute 'reset role';
    return true;
  end;
  execute 'reset role';
  return false;
end $$;

create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin
  if not ok then raise exception 'RLS TEST FAILED: %', name; end if;
  raise notice 'ok - %', name;
end $$;

do $$
declare
  T1 text := '00000000-0000-0000-0000-00000000000a';
  T2 text := '00000000-0000-0000-0000-00000000000b';
  ADM text := '00000000-0000-0000-0000-00000000000c';
  S1 text := '00000000-0000-0000-0000-0000000000e1';
  S2 text := '00000000-0000-0000-0000-0000000000e2';
begin
  -- Students
  perform pg_temp.check('student sees only own student row',
    pg_temp.as_user(S1, 'select * from students') = 1);
  perform pg_temp.check('student cannot read the answer key',
    pg_temp.as_user(S1, 'select * from question_options') = 0);
  perform pg_temp.check('student cannot read quiz answers table',
    pg_temp.as_user(S1, 'select * from quiz_answers') = 0);
  perform pg_temp.check('student sees only published quizzes of own classroom',
    pg_temp.as_user(S1, 'select * from quizzes') = 1);
  perform pg_temp.check('student cannot read another student attempt',
    pg_temp.as_user(S1, 'select * from quiz_attempts') = 1);
  perform pg_temp.check('student cannot read meeting PIN hash',
    pg_temp.expect_denied(S1, 'select pin_hash from meetings'));
  perform pg_temp.check('student cannot read meetings with SELECT *',
    pg_temp.expect_denied(S1, 'select * from meetings'));
  perform pg_temp.check('teacher cannot read meeting PIN hash',
    pg_temp.expect_denied(T1, 'select pin_hash from meetings'));
  perform pg_temp.check('student sees only own classroom meetings',
    pg_temp.as_user(S1, 'select id, classroom_id, title from meetings') = 1);
  perform pg_temp.check('student cannot write attendance rows directly',
    pg_temp.expect_denied(S1, $q$insert into attendance_sessions(meeting_id, student_id, connected_at)
      values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001', now())$q$));
  perform pg_temp.check('student cannot read recordings',
    pg_temp.as_user(S1, 'select * from recordings') = 0);
  perform pg_temp.check('student cannot read audit logs',
    pg_temp.as_user(S1, 'select * from audit_logs') = 0);

  -- Teachers
  perform pg_temp.check('teacher T1 sees only classroom C1',
    pg_temp.as_user(T1, 'select * from classrooms') = 1);
  perform pg_temp.check('teacher T1 sees only C1 meetings',
    pg_temp.as_user(T1, 'select id, classroom_id, title from meetings') = 1);
  perform pg_temp.check('teacher T1 sees draft quizzes of own classroom',
    pg_temp.as_user(T1, 'select * from quizzes') = 2);
  perform pg_temp.check('teacher T1 reads C1 answer key',
    pg_temp.as_user(T1, 'select * from question_options') = 2);
  perform pg_temp.check('teacher T1 cannot read C2 quiz questions',
    pg_temp.as_user(T1, 'select * from quizzes where classroom_id = ''20000000-0000-0000-0000-000000000002''') = 0);
  perform pg_temp.check('teacher T2 sees only C2 recordings',
    pg_temp.as_user(T2, 'select * from recordings') = 0);
  perform pg_temp.check('teacher T1 sees C1 recordings',
    pg_temp.as_user(T1, 'select * from recordings') = 1);
  perform pg_temp.check('teacher cannot write recordings directly',
    pg_temp.expect_denied(T1, $q$update recordings set storage_key = 'public/x.mp4'$q$));

  -- Admins
  perform pg_temp.check('admin sees all classrooms',
    pg_temp.as_user(ADM, 'select * from classrooms') = 2);
  perform pg_temp.check('admin can read audit logs (empty fixture)',
    pg_temp.as_user(ADM, 'select * from audit_logs') = 0);
  perform pg_temp.check('admin sees the C1 recording (one row)',
    pg_temp.as_user(ADM, 'select * from recordings') = 1);

  -- Role escalation
  -- RLS filters the update to zero rows instead of raising, so verify the stored role afterwards.
  perform set_config('request.jwt.claim.sub', T1, true);
  execute 'set local role authenticated';
  update profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
  execute 'reset role';
  perform pg_temp.check('teacher cannot change own role to admin',
    (select role from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'teacher');
  perform pg_temp.check('teacher cannot create super admin',
    pg_temp.expect_denied(T1, $q$insert into profiles(id, full_name, email, role)
      values ('00000000-0000-0000-0000-0000000000f1','x','x@example.edu','super_admin')$q$));
  perform pg_temp.check('teacher cannot create a profile at all',
    pg_temp.expect_denied(T1, $q$insert into profiles(id, full_name, email, role)
      values ('00000000-0000-0000-0000-0000000000f2','y','y@example.edu','teacher')$q$));
  perform set_config('request.jwt.claim.sub', ADM, true);
  execute 'set local role authenticated';
  begin
    update profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-00000000000a';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  perform pg_temp.check('admin cannot promote a user to super admin',
    (select role from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'teacher');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
  execute 'set local role authenticated';
  update profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
  execute 'reset role';
  perform pg_temp.check('super admin can promote a teacher to admin',
    (select role from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'admin');

  -- Anonymous role has no access at all
  begin
    set local role anon;
    perform 1 from students;
    raise exception 'RLS TEST FAILED: anon could read students';
  exception when insufficient_privilege then
    raise notice 'ok - anonymous role is denied';
  end;
  reset role;
end $$;

rollback;
\echo 'All RLS checks passed.'
