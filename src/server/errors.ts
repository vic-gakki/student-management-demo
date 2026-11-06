// 所有业务规则失败都抛 DomainError，API 层统一转成 { error: { code, message } }。
// 前端按 code 展示；破坏测试时直接看 code 就知道是哪条规则拦住的。

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'SCHEDULE_CONFLICT'
  | 'TEACHER_BUSY'
  | 'CLASS_FULL'
  | 'SLOT_FULL'
  | 'INSUFFICIENT_HOURS'
  | 'NOT_ENROLLED'
  | 'ALREADY_ENROLLED'
  | 'CLASS_ENDED'
  | 'INVALID_DATE'
  | 'TOO_EARLY'
  | 'WINDOW_CLOSED'
  | 'SESSION_CANCELLED'
  | 'NOT_IN_ROSTER'
  | 'OWED_LIMIT'
  | 'DUPLICATE_PAYMENT'
  | 'TRIAL_ALREADY_USED'
  | 'NOTHING_TO_REFUND'
  | 'INVALID_STATE';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  INVALID_DATE: 400,
  SCHEDULE_CONFLICT: 409,
  TEACHER_BUSY: 409,
  CLASS_FULL: 409,
  SLOT_FULL: 409,
  INSUFFICIENT_HOURS: 409,
  NOT_ENROLLED: 409,
  ALREADY_ENROLLED: 409,
  CLASS_ENDED: 409,
  TOO_EARLY: 409,
  WINDOW_CLOSED: 409,
  SESSION_CANCELLED: 409,
  NOT_IN_ROSTER: 409,
  OWED_LIMIT: 409,
  DUPLICATE_PAYMENT: 409,
  TRIAL_ALREADY_USED: 409,
  NOTHING_TO_REFUND: 409,
  INVALID_STATE: 409,
};

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
  get status() {
    return STATUS[this.code];
  }
}

/** PostgreSQL 约束错误 → 业务错误。数据库是最后防线，这里把它翻译成用户看得懂的话。 */
export function mapDbError(err: unknown): DomainError | null {
  const e = findPgError(err);
  if (!e) return null;
  const c = e.constraint ?? '';
  const msg = e.message ?? '';
  if (e.code === '23P01' && (c.includes('teacher') || msg.includes('teacher_no_overlap')))
    return new DomainError('TEACHER_BUSY', '该老师在这个时间已有课程（数据库约束拦截）');
  if (e.code === '23505' && (c.includes('payment_ref') || msg.includes('payment_ref')))
    return new DomainError('DUPLICATE_PAYMENT', '这笔付款（付款凭证号）已经录入过');
  if (e.code === '23505' && (c.includes('attendance_once') || msg.includes('attendance_once')))
    return new DomainError('INVALID_STATE', '这节课已有该学生的出勤记录，请刷新后重试');
  if (e.code === '23505' && (c.includes('trial_lessons_once') || msg.includes('trial_lessons_once')))
    return new DomainError('TRIAL_ALREADY_USED', '该学生这个科目已经试听过（或已安排）');
  if (e.code === '23505' && (c.includes('enrollments_one_open') || msg.includes('enrollments_one_open')))
    return new DomainError('ALREADY_ENROLLED', '学生已经在这个班里');
  if (e.code === '23514' && (c.includes('balance_not_negative') || msg.includes('balance_not_negative')))
    return new DomainError('INSUFFICIENT_HOURS', '课时余额不足（数据库约束拦截）');
  if (e.code === '23514' && (c.includes('owed_within_limit') || msg.includes('owed_within_limit')))
    return new DomainError('OWED_LIMIT', '欠课已达上限（数据库约束拦截）');
  return null;
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

function findPgError(err: unknown): PgErrorLike | null {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const c = cur as PgErrorLike & { cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

/** 在服务函数里包一层：数据库约束错误转成 DomainError，其他错误原样抛出 */
export async function withDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) throw err;
    const mapped = mapDbError(err);
    if (mapped) throw mapped;
    throw err;
  }
}
