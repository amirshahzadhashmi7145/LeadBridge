import { allAdapters } from '@/platforms/registry';
import { COMMON_LEAD_FIELDS, type CommonLeadField, type Lead } from '@/schema/lead';

export interface ColumnMap {
  field: string;
  header: string;
}

export interface AppConfig {
  spreadsheetId: string;
  sheetName: string;
  googleClientId: string;
  enabledPlatforms: string[];
  columnMap: ColumnMap[];
}

export interface GoogleUser {
  name: string;
  email: string;
  picture?: string;
}

export interface StoredSession {
  accessToken: string;
  expiresAt: number;
  user: GoogleUser;
}

export interface PendingDraft {
  id: string;
  savedAt: string;
  reason: string;
  lead: Lead;
}

export const DEFAULT_COLUMN_MAP: ColumnMap[] = [
  { field: 'leadId', header: 'Lead ID' },
  { field: 'source', header: 'Source' },
  { field: 'leadType', header: 'Lead Type' },
  { field: 'leadName', header: 'Lead Name' },
  { field: 'company', header: 'Company' },
  { field: 'companyUrl', header: 'Company URL' },
  { field: 'jobTitle', header: 'Job Title' },
  { field: 'jobDescription', header: 'Job Description' },
  { field: 'location', header: 'Location' },
  { field: 'budget', header: 'Budget/Salary' },
  { field: 'skills', header: 'Skills' },
  { field: 'contact', header: 'Contact' },
  { field: 'postContent', header: 'Post Content' },
  { field: 'profileUrl', header: 'Profile URL' },
  { field: 'jobUrl', header: 'Job URL' },
  { field: 'sourceUrl', header: 'Source URL' },
  { field: 'capturedAt', header: 'Date Captured' },
  { field: 'salesOwner', header: 'Sales Owner' },
  { field: 'status', header: 'Status' },
  { field: 'notes', header: 'Notes' },
  { field: 'capturedBy', header: 'Captured By' },
  { field: 'capturedAtRaw', header: 'Captured At' },
  { field: 'lastUpdatedBy', header: 'Last Updated By' },
  { field: 'lastUpdatedAt', header: 'Last Updated At' },
  { field: 'platformLeadId', header: 'Platform Lead ID' },
  { field: 'platformFields', header: 'Platform Fields' },
];

export function defaultConfig(): AppConfig {
  return {
    spreadsheetId: '',
    sheetName: 'Leads',
    googleClientId: '',
    enabledPlatforms: allAdapters()
      .filter((adapter) => adapter.enabledByDefault)
      .map((adapter) => adapter.id),
    columnMap: DEFAULT_COLUMN_MAP.map((item) => ({ ...item })),
  };
}

const CONFIG_KEY = 'leadbridge.config';
const SESSION_KEY = 'leadbridge.session';
const DRAFTS_KEY = 'leadbridge.drafts';

export async function getConfig(): Promise<AppConfig> {
  const stored = await browser.storage.sync.get(CONFIG_KEY);
  const value = stored[CONFIG_KEY] as AppConfig | undefined;
  if (!value) return defaultConfig();
  return {
    ...defaultConfig(),
    ...value,
    enabledPlatforms: value.enabledPlatforms?.length
      ? value.enabledPlatforms
      : defaultConfig().enabledPlatforms,
    columnMap: value.columnMap?.length ? value.columnMap : defaultConfig().columnMap,
  };
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  await browser.storage.sync.set({ [CONFIG_KEY]: config });
  return config;
}

export async function getSession(): Promise<StoredSession | null> {
  const stored = await browser.storage.session.get(SESSION_KEY);
  return (stored[SESSION_KEY] as StoredSession | undefined) ?? null;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await browser.storage.session.set({ [SESSION_KEY]: session });
}

export async function clearSession(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY);
}

export async function getDrafts(): Promise<PendingDraft[]> {
  const stored = await browser.storage.local.get(DRAFTS_KEY);
  return (stored[DRAFTS_KEY] as PendingDraft[] | undefined) ?? [];
}

export async function saveDraft(draft: PendingDraft): Promise<void> {
  const drafts = await getDrafts();
  drafts.unshift(draft);
  await browser.storage.local.set({ [DRAFTS_KEY]: drafts.slice(0, 50) });
}

export async function removeDraft(id: string): Promise<void> {
  const drafts = await getDrafts();
  await browser.storage.local.set({
    [DRAFTS_KEY]: drafts.filter((draft) => draft.id !== id),
  });
}

export function isCommonField(field: string): field is CommonLeadField {
  return (COMMON_LEAD_FIELDS as readonly string[]).includes(field);
}
