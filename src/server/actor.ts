import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { students } from '@/db/schema';
import { DomainError } from './errors';

export interface Actor {
  id: number;
  role: 'admin' | 'teacher';
  name: string;
}

export function requireRole(actor: Actor, ...roles: Actor['role'][]) {
  if (!roles.includes(actor.role)) throw new DomainError('FORBIDDEN', '当前角色无权执行此操作');
}

/**
 * 规则 6：所有 admin 都能看全部学生，只有负责人能改。
 * lock=true 时在事务里锁住学生行，后续针对这个学生的并发写操作会排队执行。
 */
export async function assertCanModifyStudent(db: Db, actor: Actor, studentId: number, lock = false) {
  requireRole(actor, 'admin');
  const q = db.select().from(students).where(eq(students.id, studentId));
  const [student] = lock ? await q.for('update') : await q;
  if (!student) throw new DomainError('NOT_FOUND', '学生不存在');
  if (student.ownerAdminId !== actor.id)
    throw new DomainError('FORBIDDEN', '只有该学生的负责 admin 才能修改（你可以查看）');
  return student;
}
