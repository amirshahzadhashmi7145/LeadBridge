export const LEAD_STATUSES = [
  'Lead captured',
  'Message sent',
  'Application submitted',
  'Proposal sent',
  'Client replied',
  'Follow-up required',
  'Follow-up completed',
  'Converted',
  'Rejected/Closed',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type LeadType = 'job' | 'company' | 'post' | 'profile' | 'page' | 'unknown';

export type FieldStatus = 'found' | 'missing' | 'edited';

export const COMMON_LEAD_FIELDS = [
  'leadId',
  'platformLeadId',
  'source',
  'leadType',
  'leadName',
  'company',
  'companyUrl',
  'jobTitle',
  'jobDescription',
  'location',
  'budget',
  'skills',
  'contact',
  'postContent',
  'profileUrl',
  'jobUrl',
  'sourceUrl',
  'capturedAt',
  'salesOwner',
  'status',
  'notes',
  'capturedBy',
  'lastUpdatedBy',
  'lastUpdatedAt',
] as const;

export type CommonLeadField = (typeof COMMON_LEAD_FIELDS)[number];

export interface Lead {
  leadId: string;
  platformLeadId: string;
  source: string;
  leadType: LeadType;
  sourceUrl: string;
  leadName: string;
  company: string;
  companyUrl: string;
  location: string;
  contact: string;
  jobTitle: string;
  jobDescription: string;
  jobUrl: string;
  budget: string;
  skills: string;
  postContent: string;
  profileUrl: string;
  status: LeadStatus;
  notes: string;
  salesOwner: string;
  capturedBy: string;
  capturedAt: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  platformFields: Record<string, string>;
}

export const EMPTY_LEAD: Lead = {
  leadId: '',
  platformLeadId: '',
  source: '',
  leadType: 'unknown',
  sourceUrl: '',
  leadName: '',
  company: '',
  companyUrl: '',
  location: '',
  contact: '',
  jobTitle: '',
  jobDescription: '',
  jobUrl: '',
  budget: '',
  skills: '',
  postContent: '',
  profileUrl: '',
  status: 'Lead captured',
  notes: '',
  salesOwner: '',
  capturedBy: '',
  capturedAt: '',
  lastUpdatedBy: '',
  lastUpdatedAt: '',
  platformFields: {},
};

export interface LeadIdentity {
  platformLeadId: string;
  jobUrl: string;
  profileUrl: string;
  postId: string;
  sourceUrl: string;
}

export interface FieldMeta {
  key: string;
  label: string;
  value: string;
  status: FieldStatus;
  multiline?: boolean;
  platformSpecific?: boolean;
}

export interface PostCandidate {
  id: string;
  author: string;
  snippet: string;
  timestamp: string;
}

export interface ExtractionResult {
  ok: true;
  lead: Lead;
  fields: FieldMeta[];
  missingFields: string[];
  foundFields: string[];
  warnings: string[];
  pageType: PageType;
  platformId: string;
  sourceName: string;
  identity: LeadIdentity;
  candidates?: PostCandidate[];
}

export interface ExtractionFailure {
  ok: false;
  reason:
    | 'unknown_platform'
    | 'unsupported_page'
    | 'needs_refresh'
    | 'needs_selection'
    | 'extract_error';
  message: string;
  platformId?: string;
  sourceName?: string;
  pageType?: PageType;
  url?: string;
  candidates?: PostCandidate[];
}

export type ExtractResponse = ExtractionResult | ExtractionFailure;

export type PageType =
  | 'job'
  | 'company'
  | 'post'
  | 'feed'
  | 'profile'
  | 'unsupported';

export const FIELD_LABELS: Record<string, string> = {
  leadId: 'Lead ID',
  platformLeadId: 'Platform ID',
  source: 'Source',
  leadType: 'Lead type',
  leadName: 'Lead name',
  company: 'Company',
  companyUrl: 'Company URL',
  jobTitle: 'Job title',
  jobDescription: 'Job description',
  location: 'Location',
  budget: 'Budget / salary',
  skills: 'Skills',
  contact: 'Contact',
  postContent: 'Post content',
  profileUrl: 'Profile URL',
  jobUrl: 'Job URL',
  sourceUrl: 'Source URL',
  capturedAt: 'Date captured',
  salesOwner: 'Sales owner',
  status: 'Status',
  notes: 'Notes',
  capturedBy: 'Captured by',
  lastUpdatedBy: 'Last updated by',
  lastUpdatedAt: 'Last updated at',
};

export const REVIEW_FIELDS: Array<{
  key: keyof Lead;
  multiline?: boolean;
}> = [
  { key: 'leadName' },
  { key: 'company' },
  { key: 'companyUrl' },
  { key: 'jobTitle' },
  { key: 'jobDescription', multiline: true },
  { key: 'location' },
  { key: 'budget' },
  { key: 'skills', multiline: true },
  { key: 'contact' },
  { key: 'postContent', multiline: true },
  { key: 'profileUrl' },
  { key: 'jobUrl' },
  { key: 'sourceUrl' },
  { key: 'platformLeadId' },
  { key: 'notes', multiline: true },
];
