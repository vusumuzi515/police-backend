export type NoticeUrgency = 'emergency' | 'advisory' | 'info';

export type NoticeCategory =
  | 'traffic'
  | 'crime'
  | 'weather'
  | 'community'
  | 'missing'
  | 'national';

export type NoticeScope = 'national' | 'regional';

export type NoticeStatus = 'draft' | 'published' | 'archived';

export type NoticeActionType = 'call' | 'report' | 'get_help' | 'ai' | 'area';

export interface NoticeAction {
  type: NoticeActionType;
  label: string;
  number?: string;
  aiPrompt?: string;
}

export interface AdminNotice {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  expiresAt?: string;
  urgency: NoticeUrgency;
  category: NoticeCategory;
  scope: NoticeScope;
  region?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  verified: boolean;
  reference?: string;
  acknowledgeable?: boolean;
  actions?: NoticeAction[];
  attachmentUrl?: string;
  status: NoticeStatus;
  publishedAt?: string;
  createdBy: string;
  updatedAt: string;
}

export type NoticeFormData = Omit<
  AdminNotice,
  'id' | 'timestamp' | 'status' | 'publishedAt' | 'createdBy' | 'updatedAt'
>;

export const CATEGORY_LABELS: Record<NoticeCategory, string> = {
  traffic: 'Traffic',
  crime: 'Crime',
  weather: 'Weather',
  community: 'Community',
  missing: 'Missing person',
  national: 'National',
};

export const URGENCY_LABELS: Record<NoticeUrgency, string> = {
  emergency: 'Emergency',
  advisory: 'Advisory',
  info: 'Info',
};

export const STATUS_LABELS: Record<NoticeStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};
