export interface StudentDetail {
  id: number;
  name: string;
  grade: string | null;
  status: string;
  notes: string | null;
  lostReason: string | null;
  ownerName: string;
  canEdit: boolean;
  remainingHours: number;
  owedHours: number;
  balanceFlag: string;
  guardians: { id: number; name: string; phone: string | null; relation: string | null; isPrimary: boolean }[];
  subjects: { subject: string; targetLevel: string | null; status: string }[];
  availability: { weekday: number; fromTime: string; toTime: string }[];
  enrollments: {
    id: number;
    classId: number;
    className: string;
    subject: string;
    level: string;
    teacherName: string;
    weekday: number;
    startTime: string;
    endTime: string;
    startDate: string;
    endDate: string | null;
  }[];
  ledger: { id: number; delta: number; reason: string; note: string | null; amountCents: number | null; createdAt: string }[];
  trials: {
    id: number;
    subject: string;
    title: string;
    teacherName: string;
    startsAt: string;
    status: string;
    outcome: string;
    suggestedLevel: string | null;
    feedback: string | null;
    nextFollowUpAt: string | null;
  }[];
  tasks: { id: number; type: string; note: string | null; dueAt: string }[];
  recentFeedback: {
    className: string;
    startsAt: string;
    status: string;
    raw: string | null;
    structured: { engagement: string; parentSummary: string; concerns: string[] } | null;
  }[];
}

export interface ClassOption {
  classId: number;
  name: string;
  subject: string;
  level: string;
  teacherName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  enrolled: number;
  startDate: string;
  ok: boolean;
  reasons: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}

export interface Suggestion {
  suggestionId: number;
  status: 'ready' | 'failed';
  summary: string;
  error?: string;
  proposals: { classId: number; reasons: string[]; unmetPreferences: string[]; option: ClassOption }[];
  options: ClassOption[];
}
