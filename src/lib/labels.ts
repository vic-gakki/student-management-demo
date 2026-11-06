export const STUDENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  lead: { label: '咨询中', tone: 'blue' },
  trial: { label: '试听', tone: 'purple' },
  enrolled: { label: '在读', tone: 'green' },
  paused: { label: '暂停', tone: 'gray' },
  churned: { label: '流失', tone: 'gray' },
};

export const ATTENDANCE_STATUS: Record<string, string> = { present: '出勤', late: '迟到', excused: '请假', absent: '缺席' };

export const TASK_TYPE: Record<string, string> = {
  trial_follow_up: '试听跟进',
  owed_hours: '欠课续费',
  teacher_flag: '老师反馈',
  inquiry_no_trial: '待安排试听',
};

export const LEDGER_REASON: Record<string, string> = { purchase: '购买', attendance: '上课', refund: '退费', adjustment: '调整' };

export const TRIAL_STATUS: Record<string, string> = { scheduled: '已安排', attended: '已试听', no_show: '缺席', cancelled: '已取消' };
export const TRIAL_OUTCOME: Record<string, string> = { pending: '待跟进', enrolled: '已报名', thinking: '考虑中', lost: '放弃' };

export type Tone = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export function balanceBadge(flag: string, remaining?: number, owed?: number): { label: string; tone: Tone } {
  if (flag === 'owed') return { label: owed !== undefined ? `已欠 ${owed} 节` : '课时已用完（欠课）', tone: 'red' };
  if (flag === 'out') return { label: remaining !== undefined ? '余额 0 节' : '课时已用完', tone: 'red' };
  if (flag === 'low') return { label: remaining !== undefined ? `剩 ${remaining} 节` : '课时快用完', tone: 'orange' };
  return { label: remaining !== undefined ? `剩 ${remaining} 节` : '课时充足', tone: 'green' };
}

export const SUBJECT_OPTIONS = ['数学', '英语', '物理', '编程'];
