// Drizzle 表定义：只用于类型安全的查询。
// 真正的建表语句（包括 EXCLUDE / CHECK / 部分唯一索引 / 触发器）在 db/migrations/*.sql，
// 因为这些约束是规则的最后防线，用手写 SQL 最清楚，也最容易在面试时指出来。
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  smallint,
  time,
  date,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').$type<'admin' | 'teacher'>().notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  expiresAt: tstz('expires_at').notNull(),
});

export const guardians = pgTable('guardians', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone'),
  wechat: text('wechat'),
});

export type StudentStatus = 'lead' | 'trial' | 'enrolled' | 'paused' | 'churned';

export const students = pgTable('students', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  grade: text('grade'),
  status: text('status').$type<StudentStatus>().notNull().default('lead'),
  ownerAdminId: integer('owner_admin_id').notNull(),
  notes: text('notes'),
  lostReason: text('lost_reason'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const studentGuardians = pgTable(
  'student_guardians',
  {
    studentId: integer('student_id').notNull(),
    guardianId: integer('guardian_id').notNull(),
    relation: text('relation'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.guardianId] })],
);

export const studentOwnerHistory = pgTable('student_owner_history', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  fromAdmin: integer('from_admin'),
  toAdmin: integer('to_admin').notNull(),
  reason: text('reason'),
  at: tstz('at').notNull().defaultNow(),
});

export const studentSubjects = pgTable(
  'student_subjects',
  {
    studentId: integer('student_id').notNull(),
    subject: text('subject').notNull(),
    targetLevel: text('target_level'),
    status: text('status').$type<'inquiry' | 'trial' | 'active' | 'stopped'>().notNull().default('inquiry'),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.subject] })],
);

export const studentAvailability = pgTable('student_availability', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  weekday: smallint('weekday').notNull(),
  fromTime: time('from_time').notNull(),
  toTime: time('to_time').notNull(),
});

export const classes = pgTable('classes', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  level: text('level').notNull(),
  teacherId: integer('teacher_id').notNull(),
  weekday: smallint('weekday').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  capacity: integer('capacity').notNull(),
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }),
});

export const classSessions = pgTable('class_sessions', {
  id: serial('id').primaryKey(),
  classId: integer('class_id').notNull(),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at').notNull(),
  status: text('status').$type<'scheduled' | 'cancelled' | 'done'>().notNull().default('scheduled'),
  substituteTeacherId: integer('substitute_teacher_id'),
});

export const enrollments = pgTable('enrollments', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  classId: integer('class_id').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),
  createdBy: integer('created_by').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const lessonPackages = pgTable('lesson_packages', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  hours: integer('hours').notNull(),
  priceCents: integer('price_cents').notNull(),
  paymentMethod: text('payment_method').notNull(),
  paymentRef: text('payment_ref').notNull(),
  purchasedAt: tstz('purchased_at').notNull().defaultNow(),
  createdBy: integer('created_by').notNull(),
});

export type AttendanceStatus = 'present' | 'late' | 'excused' | 'absent';
export type Billing = 'charged' | 'free' | 'owed' | 'settled';

export const attendance = pgTable('attendance', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull(),
  studentId: integer('student_id').notNull(),
  status: text('status').$type<AttendanceStatus>().notNull(),
  billing: text('billing').$type<Billing>().notNull(),
  feedbackRaw: text('feedback_raw'),
  feedbackJson: jsonb('feedback_json'),
  llmStatus: text('llm_status').$type<'none' | 'ok' | 'failed'>().notNull().default('none'),
  needsFollowUp: boolean('needs_follow_up').notNull().default(false),
  markedBy: integer('marked_by').notNull(),
  markedAt: tstz('marked_at').notNull().defaultNow(),
});

export const lessonLedger = pgTable('lesson_ledger', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  packageId: integer('package_id'),
  delta: integer('delta').notNull(),
  reason: text('reason').$type<'purchase' | 'attendance' | 'refund' | 'adjustment'>().notNull(),
  attendanceId: integer('attendance_id'),
  amountCents: integer('amount_cents'),
  note: text('note'),
  createdBy: integer('created_by').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const studentBalances = pgTable('student_balances', {
  studentId: integer('student_id').primaryKey(),
  remainingHours: integer('remaining_hours').notNull().default(0),
  owedHours: integer('owed_hours').notNull().default(0),
});

export const trialTemplates = pgTable('trial_templates', {
  id: serial('id').primaryKey(),
  subject: text('subject').notNull(),
  level: text('level').notNull(),
  title: text('title').notNull(),
  outline: text('outline').notNull(),
  durationMin: integer('duration_min').notNull(),
});

export const trialSlots = pgTable('trial_slots', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').notNull(),
  teacherId: integer('teacher_id').notNull(),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at').notNull(),
  capacity: integer('capacity').notNull().default(1),
  createdBy: integer('created_by').notNull(),
});

export type TrialStatus = 'scheduled' | 'attended' | 'no_show' | 'cancelled';
export type TrialOutcome = 'pending' | 'enrolled' | 'thinking' | 'lost';

export const trialLessons = pgTable('trial_lessons', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  slotId: integer('slot_id').notNull(),
  subject: text('subject').notNull(),
  status: text('status').$type<TrialStatus>().notNull().default('scheduled'),
  outcome: text('outcome').$type<TrialOutcome>().notNull().default('pending'),
  suggestedLevel: text('suggested_level'),
  feedback: text('feedback'),
  nextFollowUpAt: tstz('next_follow_up_at'),
  createdBy: integer('created_by').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export type TaskType = 'trial_follow_up' | 'owed_hours' | 'teacher_flag';

export const followUpTasks = pgTable('follow_up_tasks', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  adminId: integer('admin_id').notNull(),
  type: text('type').$type<TaskType>().notNull(),
  note: text('note'),
  dueAt: tstz('due_at').notNull(),
  doneAt: tstz('done_at'),
  sourceRef: text('source_ref'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const scheduleSuggestions = pgTable('schedule_suggestions', {
  id: serial('id').primaryKey(),
  studentId: integer('student_id').notNull(),
  requestedBy: integer('requested_by').notNull(),
  requestText: text('request_text').notNull(),
  subject: text('subject'),
  proposalsJson: jsonb('proposals_json').notNull().default([]),
  status: text('status').$type<'ready' | 'failed' | 'accepted' | 'dismissed'>().notNull(),
  error: text('error'),
  acceptedClassId: integer('accepted_class_id'),
  model: text('model'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});
