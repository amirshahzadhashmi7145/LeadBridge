import { allAdapters } from '@/platforms/registry';
import { COMMON_LEAD_FIELDS, type CommonLeadField, type Lead } from '@/schema/lead';
import { COMPANY_SHEET_NAME, COMPANY_SPREADSHEET_ID } from '@/config/company';

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
  defaultsVersion?: number;
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
  action?: 'create' | 'update' | 'force-create';
  existingRow?: number;
  identityKeys?: string[];
  autoRetry?: boolean;
  attempts?: number;
  lastAttemptAt?: number;
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
  { field: 'employmentType', header: 'Employment Type' },
  { field: 'datePosted', header: 'Posting Date' },
  { field: 'workplaceType', header: 'Workplace Type' },
  { field: 'jobInsights', header: 'Job Insights' },
  { field: 'companyIndustry', header: 'Industry' },
  { field: 'companySize', header: 'Company Size' },
  { field: 'companyWebsite', header: 'Company Website' },
  { field: 'companyFollowers', header: 'Company Followers' },
  { field: 'linkedInHeadcount', header: 'Employees on LinkedIn' },
  { field: 'candidateSeniority', header: 'Candidate Seniority' },
  { field: 'candidateEducation', header: 'Candidate Education' },
  { field: 'hiringTrend', header: 'Hiring Trend' },
  { field: 'employeeTenure', header: 'Median Employee Tenure' },
  { field: 'experienceLevel', header: 'Experience Level' },
  { field: 'jobFunction', header: 'Job Function' },
  { field: 'pricingType', header: 'Hourly / Fixed-price' },
  { field: 'duration', header: 'Project Duration' },
  { field: 'category', header: 'Job Category' },
  { field: 'proposals', header: 'Proposals' },
  { field: 'clientRating', header: 'Client Rating' },
  { field: 'jobsPosted', header: 'Jobs Posted' },
  { field: 'totalHires', header: 'Total Hires' },
  { field: 'totalSpent', header: 'Total Spent' },
  { field: 'equity', header: 'Equity' },
  { field: 'visaSponsorship', header: 'Visa Sponsorship' },
  { field: 'funding', header: 'Funding' },
  { field: 'clientHistory', header: 'Client History' },
  { field: 'authorHeadline', header: 'Author Headline' },
  { field: 'postTimestamp', header: 'Post Date' },
  { field: 'postLinks', header: 'Post Links' },
  { field: 'platformFields', header: 'Other Platform Fields' },
];

const PLATFORM_DEFAULTS_VERSION = 3;

export function defaultConfig(): AppConfig {
  return {
    spreadsheetId: COMPANY_SPREADSHEET_ID,
    sheetName: COMPANY_SHEET_NAME,
    googleClientId: '',
    enabledPlatforms: allAdapters()
      .filter((adapter) => adapter.enabledByDefault)
      .map((adapter) => adapter.id),
    columnMap: DEFAULT_COLUMN_MAP.map((item) => ({ ...item })),
    defaultsVersion: PLATFORM_DEFAULTS_VERSION,
  };
}

const CONFIG_KEY = 'leadbridge.config';
const SESSION_KEY = 'leadbridge.session';
const DRAFTS_KEY = 'leadbridge.drafts';

export async function getConfig(): Promise<AppConfig> {
  const [syncStored, localStored] = await Promise.all([
    browser.storage.sync.get(CONFIG_KEY).catch(() => ({})),
    browser.storage.local.get(CONFIG_KEY).catch(() => ({})),
  ]);
  const syncValue = (syncStored as Record<string, AppConfig | undefined>)[CONFIG_KEY];
  const localValue = (localStored as Record<string, AppConfig | undefined>)[CONFIG_KEY];
  const value = {
    ...defaultConfig(),
    ...syncValue,
    ...localValue,
    googleClientId: '',
    spreadsheetId: COMPANY_SPREADSHEET_ID,
    sheetName: COMPANY_SHEET_NAME,
  };
  const savedVersion = localValue?.defaultsVersion ?? syncValue?.defaultsVersion ?? 0;
  const merged = mergeEnabledPlatforms(value.enabledPlatforms, savedVersion);
  if (
    merged.defaultsVersion !== savedVersion ||
    merged.enabledPlatforms.join(',') !== (value.enabledPlatforms ?? []).join(',')
  ) {
    void saveConfig({ ...value, ...merged, columnMap: mergeColumnMap(value.columnMap) }).catch(
      () => undefined,
    );
  }
  return {
    ...value,
    ...merged,
    columnMap: mergeColumnMap(value.columnMap),
  };
}

function mergeEnabledPlatforms(
  enabledPlatforms: string[] | undefined,
  savedVersion: number,
): {
  enabledPlatforms: string[];
  defaultsVersion: number;
} {
  const enabled = enabledPlatforms?.length
    ? [...enabledPlatforms]
    : defaultConfig().enabledPlatforms;
  if (savedVersion >= PLATFORM_DEFAULTS_VERSION) {
    return { enabledPlatforms: enabled, defaultsVersion: savedVersion };
  }
  for (const adapter of allAdapters()) {
    if (adapter.enabledByDefault && !enabled.includes(adapter.id)) {
      enabled.push(adapter.id);
    }
  }
  return { enabledPlatforms: enabled, defaultsVersion: PLATFORM_DEFAULTS_VERSION };
}

export function mergeColumnMap(saved?: ColumnMap[]): ColumnMap[] {
  const current = saved?.length ? saved.map((item) => ({ ...item })) : [];
  if (!current.length) return DEFAULT_COLUMN_MAP.map((item) => ({ ...item }));
  const seen = new Set(current.map((item) => item.field));
  const missing = DEFAULT_COLUMN_MAP.filter((item) => !seen.has(item.field));
  const leftover = current.findIndex((item) => item.field === 'platformFields');
  if (leftover >= 0) {
    current.splice(leftover, 0, ...missing.filter((item) => item.field !== 'platformFields'));
    return current;
  }
  return [...current, ...missing];
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  await Promise.all([
    browser.storage.local.set({ [CONFIG_KEY]: config }),
    browser.storage.sync.set({ [CONFIG_KEY]: config }).catch(() => undefined),
  ]);
  return config;
}

export function setupProblems(config: AppConfig): string | null {
  if (!config.spreadsheetId.trim()) {
    return 'This build is missing the team spreadsheet ID.';
  }
  return null;
}

export async function getSession(): Promise<StoredSession | null> {
  const [sessionStore, localStore] = await Promise.all([
    browser.storage.session.get(SESSION_KEY).catch(() => ({})),
    browser.storage.local.get(SESSION_KEY).catch(() => ({})),
  ]);
  const session =
    ((sessionStore as Record<string, StoredSession | undefined>)[SESSION_KEY] ??
      (localStore as Record<string, StoredSession | undefined>)[SESSION_KEY]) ||
    null;
  if (session && session.expiresAt <= Date.now()) {
    await clearSession();
    return null;
  }
  return session;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    browser.storage.session.set({ [SESSION_KEY]: session }).catch(() => undefined),
    browser.storage.local.set({ [SESSION_KEY]: session }),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    browser.storage.session.remove(SESSION_KEY).catch(() => undefined),
    browser.storage.local.remove(SESSION_KEY),
  ]);
}

export async function getDrafts(): Promise<PendingDraft[]> {
  const stored = await browser.storage.local.get(DRAFTS_KEY);
  return (stored[DRAFTS_KEY] as PendingDraft[] | undefined) ?? [];
}

export async function saveDraft(draft: PendingDraft): Promise<void> {
  const drafts = await getDrafts();
  const rest = drafts.filter((item) => !sameOutboxItem(item, draft));
  await browser.storage.local.set({ [DRAFTS_KEY]: [draft, ...rest].slice(0, 50) });
}

function sameOutboxItem(left: PendingDraft, right: PendingDraft): boolean {
  if (left.id === right.id) return true;
  const leftKeys = new Set((left.identityKeys ?? []).map((key) => key.toLowerCase()));
  const rightKeys = (right.identityKeys ?? []).map((key) => key.toLowerCase());
  if (leftKeys.size && rightKeys.some((key) => leftKeys.has(key))) return true;
  const leftId = left.lead.leadId?.trim();
  const rightId = right.lead.leadId?.trim();
  if (leftId && rightId && leftId === rightId) return true;
  const leftUrl = (left.lead.jobUrl || left.lead.sourceUrl).trim();
  const rightUrl = (right.lead.jobUrl || right.lead.sourceUrl).trim();
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
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
