-- 学生管理系统初始 schema
-- 约定：所有时间点存 timestamptz（UTC），周期班级存墨尔本本地的"星期几 + 时刻"。
-- 只有数据库能可靠表达、并且需要在并发下成立的规则，才放在这里做约束（见 DESIGN.md 第 4 部分）。

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ───────────── 用户与会话 ─────────────
CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'teacher')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         text PRIMARY KEY,               -- 会话 token 的 sha256，数据库泄露也拿不到可用 token
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- ───────────── 学生、家长 ─────────────
CREATE TABLE guardians (
  id     serial PRIMARY KEY,
  name   text NOT NULL,
  phone  text,
  wechat text
);

CREATE TABLE students (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  grade          text,
  status         text NOT NULL DEFAULT 'lead'
                 CHECK (status IN ('lead', 'trial', 'enrolled', 'paused', 'churned')),
  owner_admin_id int NOT NULL REFERENCES users(id),
  notes          text,
  lost_reason    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX students_owner_idx ON students(owner_admin_id);

CREATE TABLE student_guardians (
  student_id  int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id int NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relation    text,
  is_primary  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (student_id, guardian_id)
);

CREATE TABLE student_owner_history (
  id         serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_admin int REFERENCES users(id),
  to_admin   int NOT NULL REFERENCES users(id),
  reason     text,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE student_subjects (
  student_id   int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject      text NOT NULL,
  target_level text,
  status       text NOT NULL DEFAULT 'inquiry'
               CHECK (status IN ('inquiry', 'trial', 'active', 'stopped')),
  PRIMARY KEY (student_id, subject)
);

CREATE TABLE student_availability (
  id         serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- ISO：1=周一 … 7=周日
  from_time  time NOT NULL,
  to_time    time NOT NULL,
  CHECK (from_time < to_time)
);

-- ───────────── 班级、课次、报名 ─────────────
CREATE TABLE classes (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  subject    text NOT NULL,
  level      text NOT NULL,
  teacher_id int NOT NULL REFERENCES users(id),
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time   time NOT NULL,
  capacity   int NOT NULL CHECK (capacity > 0),
  starts_on  date NOT NULL,
  ends_on    date,
  CHECK (start_time < end_time),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  -- 规则 1：同一老师、同一星期几、时间段重叠、学期重叠 → 拒绝。
  -- 单表规则，数据库原生表达，并发下也成立。
  CONSTRAINT classes_teacher_no_overlap EXCLUDE USING gist (
    teacher_id WITH =,
    weekday WITH =,
    tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time) WITH &&,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);

CREATE TABLE class_sessions (
  id                    serial PRIMARY KEY,
  class_id              int NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  status                text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'cancelled', 'done')),
  substitute_teacher_id int REFERENCES users(id),
  UNIQUE (class_id, starts_at),
  CHECK (starts_at < ends_at)
);
CREATE INDEX class_sessions_starts_idx ON class_sessions(starts_at);

CREATE TABLE enrollments (
  id         serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id   int NOT NULL REFERENCES classes(id),
  start_date date NOT NULL,
  end_date   date,
  created_by int NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
-- 同一个班同时只能有一条进行中的报名
CREATE UNIQUE INDEX enrollments_one_open_per_class
  ON enrollments(student_id, class_id) WHERE end_date IS NULL;
CREATE INDEX enrollments_class_idx ON enrollments(class_id);

-- ───────────── 课时：课时包、流水、余额 ─────────────
CREATE TABLE lesson_packages (
  id             serial PRIMARY KEY,
  student_id     int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  hours          int NOT NULL CHECK (hours > 0),
  price_cents    int NOT NULL CHECK (price_cents >= 0),
  payment_method text NOT NULL,
  payment_ref    text NOT NULL,
  purchased_at   timestamptz NOT NULL DEFAULT now(),
  created_by     int NOT NULL REFERENCES users(id),
  -- 规则 10：同一笔付款不能录两次
  CONSTRAINT lesson_packages_payment_ref_unique UNIQUE (payment_ref)
);

CREATE TABLE attendance (
  id              serial PRIMARY KEY,
  session_id      int NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id      int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('present', 'late', 'excused', 'absent')),
  billing         text NOT NULL CHECK (billing IN ('charged', 'free', 'owed', 'settled')),
  feedback_raw    text,
  feedback_json   jsonb,
  llm_status      text NOT NULL DEFAULT 'none' CHECK (llm_status IN ('none', 'ok', 'failed')),
  needs_follow_up boolean NOT NULL DEFAULT false,
  marked_by       int NOT NULL REFERENCES users(id),
  marked_at       timestamptz NOT NULL DEFAULT now(),
  -- 规则 5：同一学生同一节课只有一条出勤 → 只扣一次课时
  CONSTRAINT attendance_once_per_session UNIQUE (session_id, student_id)
);

CREATE TABLE lesson_ledger (
  id            serial PRIMARY KEY,
  student_id    int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  package_id    int REFERENCES lesson_packages(id),
  delta         int NOT NULL CHECK (delta <> 0),
  reason        text NOT NULL CHECK (reason IN ('purchase', 'attendance', 'refund', 'adjustment')),
  attendance_id int REFERENCES attendance(id),
  amount_cents  int,                                   -- 退费时记录退款金额
  note          text,
  created_by    int NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lesson_ledger_student_idx ON lesson_ledger(student_id);

-- 规则 11：课时流水只追加，不修改不删除（钱的审计线）
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'lesson_ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lesson_ledger_append_only
  BEFORE UPDATE OR DELETE ON lesson_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- 余额缓存：和流水在同一事务里更新；数据库兜底保证不会出现负余额，欠课最多 2 节
CREATE TABLE student_balances (
  student_id      int PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  remaining_hours int NOT NULL DEFAULT 0,
  owed_hours      int NOT NULL DEFAULT 0,
  CONSTRAINT balance_not_negative CHECK (remaining_hours >= 0),     -- 规则 4
  CONSTRAINT owed_within_limit CHECK (owed_hours BETWEEN 0 AND 2),  -- 规则 9
  CHECK (owed_hours = 0 OR remaining_hours = 0)                     -- 有余额时不会欠课
);

-- ───────────── 试听 ─────────────
CREATE TABLE trial_templates (
  id           serial PRIMARY KEY,
  subject      text NOT NULL,
  level        text NOT NULL,
  title        text NOT NULL,
  outline      text NOT NULL,
  duration_min int NOT NULL CHECK (duration_min > 0)
);

CREATE TABLE trial_slots (
  id          serial PRIMARY KEY,
  template_id int NOT NULL REFERENCES trial_templates(id),
  teacher_id  int NOT NULL REFERENCES users(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  capacity    int NOT NULL DEFAULT 1 CHECK (capacity > 0),
  created_by  int NOT NULL REFERENCES users(id),
  CHECK (starts_at < ends_at),
  -- 规则 13（兜底部分）：同一老师的试听时段之间不能重叠
  CONSTRAINT trial_slots_teacher_no_overlap EXCLUDE USING gist (
    teacher_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
);

CREATE TABLE trial_lessons (
  id                serial PRIMARY KEY,
  student_id        int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  slot_id           int NOT NULL REFERENCES trial_slots(id),
  subject           text NOT NULL,                     -- 冗余一份，用于"每科只试听一次"
  status            text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'attended', 'no_show', 'cancelled')),
  outcome           text NOT NULL DEFAULT 'pending'
                    CHECK (outcome IN ('pending', 'enrolled', 'thinking', 'lost')),
  suggested_level   text,
  feedback          text,
  next_follow_up_at timestamptz,
  created_by        int NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- 规则 12：每个学生每个科目只能试听一次；缺席或取消的可以重新安排
CREATE UNIQUE INDEX trial_lessons_once_per_subject
  ON trial_lessons(student_id, subject) WHERE status IN ('scheduled', 'attended');

-- ───────────── 待办与 AI 排班建议 ─────────────
CREATE TABLE follow_up_tasks (
  id         serial PRIMARY KEY,
  student_id int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  admin_id   int NOT NULL REFERENCES users(id),
  type       text NOT NULL CHECK (type IN ('trial_follow_up', 'owed_hours', 'teacher_flag')),
  note       text,
  due_at     timestamptz NOT NULL,
  done_at    timestamptz,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follow_up_tasks_open_idx ON follow_up_tasks(admin_id) WHERE done_at IS NULL;

CREATE TABLE schedule_suggestions (
  id                serial PRIMARY KEY,
  student_id        int NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_by      int NOT NULL REFERENCES users(id),
  request_text      text NOT NULL,
  subject           text,
  proposals_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  status            text NOT NULL CHECK (status IN ('ready', 'failed', 'accepted', 'dismissed')),
  error             text,
  accepted_class_id int REFERENCES classes(id),
  model             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
