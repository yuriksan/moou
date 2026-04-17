// ─── Enums ───

export const OutcomeStatus = ['draft', 'active', 'approved', 'deferred', 'completed', 'archived'] as const;
export type OutcomeStatus = (typeof OutcomeStatus)[number];

export const MotivationStatus = ['active', 'resolved'] as const;
export type MotivationStatus = (typeof MotivationStatus)[number];

export const MilestoneStatus = ['upcoming', 'active', 'completed'] as const;
export type MilestoneStatus = (typeof MilestoneStatus)[number];

export const MilestoneType = ['release', 'deadline', 'review'] as const;
export type MilestoneType = (typeof MilestoneType)[number];

export const EffortSize = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type EffortSize = (typeof EffortSize)[number];

export const ChangeType = [
  'created', 'updated', 'deleted',
  'linked', 'unlinked',
  'resolved', 'reopened',
  'pinned', 'unpinned',
] as const;
export type ChangeType = (typeof ChangeType)[number];

export const HistoryEntityType = ['outcome', 'motivation', 'milestone', 'outcome_motivation', 'external_link'] as const;
export type HistoryEntityType = (typeof HistoryEntityType)[number];

// ─── Effort penalty map ───

export const EFFORT_PENALTY: Record<EffortSize, number> = {
  XS: 0,
  S: 50,
  M: 150,
  L: 300,
  XL: 500,
};

// ─── Entity types ───

export interface User {
  id: string;
  name: string;
  role: string;
  initials: string;
}

export interface Outcome {
  id: string;
  title: string;
  description: string | null;
  effort: EffortSize | null;
  milestoneId: string | null;
  status: OutcomeStatus;
  pinned: boolean;
  priorityScore: number;
  primaryLinkId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Motivation {
  id: string;
  typeId: string;
  title: string;
  status: MotivationStatus;
  notes: string | null;
  attributes: Record<string, unknown>;
  targetDate: string | null;
  score: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MotivationType {
  id: string;
  name: string;
  description: string | null;
  attributeSchema: Record<string, unknown>;
  scoringFormula: string;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  name: string;
  targetDate: string;
  type: MilestoneType | null;
  description: string | null;
  status: MilestoneStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  emoji: string | null;
  colour: string | null;
  description: string | null;
}

export interface ExternalLink {
  id: string;
  outcomeId: string;
  provider: string;
  entityType: string;
  entityId: string;
  url: string | null;
  createdBy: string;
  createdAt: string;
}

// ─── Provider configuration ───

export interface ProviderEntityType {
  name: string;
  label: string;
}

export interface ProviderConfig {
  name: string;
  label: string;
  entityTypes: ProviderEntityType[];
}

export interface Comment {
  id: string;
  outcomeId: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  entityType: HistoryEntityType;
  entityId: string;
  changeType: ChangeType;
  changes: Record<string, { old: unknown; new: unknown }>;
  changedBy: string;
  changedAt: string;
}

// ─── API response types ───

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
