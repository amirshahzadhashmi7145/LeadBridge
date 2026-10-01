import {
  COMPANY_GOOGLE_WEB_APP_URL,
} from '@/config/company';
import { identityFromLead } from '@/platforms/builder';
import { findAdapter } from '@/platforms/registry';
import type { Lead } from '@/schema/lead';
import type { AppConfig, GoogleUser } from '@/storage/config';
import { logger } from '@/utils/logger';
import { extractPlatformKey } from '@/utils/url';
import { leadToRow, requiredHeaders } from './mapping';
import type { DuplicateMatch } from './types';

export interface WebhookSaveResult {
  action: 'created' | 'updated';
  rowNumber: number;
}

interface WebhookBody {
  status?: string;
  service?: string;
  message?: string;
  action?: string;
  rowNumber?: number;
  uploadId?: string;
  v?: number;
  parallel?: boolean;
  stored?: boolean;
  i?: number;
  n?: number;
  duplicate?: Partial<DuplicateMatch> | null;
}

export function setupWebhookProblems(): string | null {
  if (!COMPANY_GOOGLE_WEB_APP_URL.trim()) {
    return 'This build is missing the team Google script URL.';
  }
  return null;
}

const IDENTITY_HEADERS = new Set([
  'lead id',
  'platform lead id',
  'job url',
  'source url',
  'profile url',
]);

export async function checkLeadOnSheet(
  lead: Lead,
  user: GoogleUser,
): Promise<DuplicateMatch | null> {
  const data = await requestWebhook('POST', {
    action: 'check',
    currentUser: { name: user.name, email: user.email },
    identity: resolveIdentity(lead),
  });
  return duplicateFromResponse(data, user.email);
}

export async function saveLeadOnSheet(
  lead: Lead,
  user: GoogleUser,
  config: AppConfig,
  saveAction: 'create' | 'update' | 'force-create',
  existingRow?: number,
): Promise<{ result: WebhookSaveResult; duplicate: DuplicateMatch | null }> {
  const identity = resolveIdentity(lead);
  const stamped: Lead = {
    ...lead,
    platformLeadId: identity.platformLeadId || lead.platformLeadId,
    jobUrl: identity.jobUrl || lead.jobUrl,
    sourceUrl: identity.sourceUrl || lead.sourceUrl,
    profileUrl: identity.profileUrl || lead.profileUrl,
  };
  const allHeaders = requiredHeaders(config, stamped);
  const allValues = leadToRow(stamped, allHeaders, config.columnMap);
  const headers: string[] = [];
  const values: string[] = [];
  allHeaders.forEach((header, index) => {
    const value = allValues[index] ?? '';
    if (value.trim() || IDENTITY_HEADERS.has(header.trim().toLowerCase())) {
      headers.push(header);
      values.push(clampSheetValue(header, value));
    }
  });
  const data = await requestWebhook('POST', {
    identity,
    action: 'save',
    saveAction,
    existingRow,
    currentUser: { name: user.name, email: user.email },
    headers,
    values,
  });

  if (data.status === 'duplicate' || data.status === 'error') {
    const duplicate = duplicateFromResponse(data, user.email);
    if (duplicate) return { result: { action: 'created', rowNumber: 0 }, duplicate };
    throw new Error(data.message || 'The team sheet rejected this lead.');
  }

  if (data.status === 'unconfirmed') {
    return { result: { action: 'created', rowNumber: 0 }, duplicate: null };
  }

  const saved = data.action === 'updated' || data.action === 'created' || Number(data.rowNumber) > 0;
  if (!saved) {
    throw new Error(
      'The Google script did not write a row. Run authorize in Apps Script, click Allow, then save again.',
    );
  }

  if (data.status && data.status !== 'success' && data.status !== 'ok') {
    throw new Error(data.message || 'The team sheet rejected this lead.');
  }

  const action = data.action === 'updated' ? 'updated' : 'created';
  return {
    result: { action, rowNumber: Number(data.rowNumber) || 0 },
    duplicate: data.status === 'duplicate' ? duplicateFromResponse(data, user.email) : null,
  };
}

const INLINE_LIMIT = 2800;
const LONG_HEADERS = new Set([
  'job description',
  'post content',
  'notes',
  'other platform fields',
  'job insights',
  'client history',
]);
const SHEET_AUTH_ERROR =
  'The Google script cannot open the spreadsheet. a.fdev786@gmail.com must open Apps Script, click Run on authorize, press Allow, then Deploy → New version.';
const WEB_APP_ACCESS_ERROR =
  'The team Google script is not public. a.fdev786@gmail.com must open Deploy → Manage deployments → Edit, set Who has access to Anyone, Execute as Me, then Deploy. Keep the same /exec URL.';

async function requestWebhook(method: 'GET' | 'POST', payload?: unknown): Promise<WebhookBody> {
  void method;
  if (payload == null) {
    return fetchJson(COMPANY_GOOGLE_WEB_APP_URL);
  }
  const current = payload;
  for (let round = 0; round < 8; round += 1) {
    const encoded = encodeURIComponent(JSON.stringify(current));
    if (encoded.length <= INLINE_LIMIT) {
      return fetchJson(`${COMPANY_GOOGLE_WEB_APP_URL}?action=run&payload=${encoded}`);
    }
    if (!shrinkWebhookPayload(current)) break;
  }
  throw new Error('This lead is too large to send to the team Google script in one request.');
}

async function fetchJson(url: string): Promise<WebhookBody> {
  const { status, text, requestUrl } = await fetchAppsScript(url);
  if (status < 200 || status >= 300) {
    await logger.error('sheets', 'GET webhook failed', {
      status,
      text: text.slice(0, 400),
      url: requestUrl.slice(0, 180),
    });
    throw webhookError(status, text, requestUrl);
  }
  const data = parseBody(text, requestUrl);
  if (data.status === 'unconfirmed') return data;
  if (data.status === 'duplicate') return data;
  if (data.duplicate && data.duplicate.rowNumber) return data;
  if (data.status === 'error') {
    throw new Error(scriptErrorMessage(data.message));
  }
  return data;
}

function isPayloadRequest(url: string): boolean {
  return /[?&]payload=/.test(url);
}

async function fetchAppsScript(
  url: string,
): Promise<{ status: number; text: string; requestUrl: string }> {
  const first = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    credentials: 'omit',
  });

  if (first.ok && first.type !== 'opaqueredirect') {
    return { status: first.status, text: await first.text(), requestUrl: url };
  }

  const location = first.headers.get('Location');
  if (location && first.status >= 300 && first.status < 400) {
    return fetchEcho(new URL(location, url).toString(), url);
  }

  if (isPayloadRequest(url) && (first.type === 'opaqueredirect' || first.status === 0 || (first.status >= 300 && first.status < 400))) {
    return unconfirmedResponse(url);
  }

  return { status: first.status || 0, text: await first.text().catch(() => ''), requestUrl: url };
}

async function fetchEcho(
  echoUrl: string,
  originUrl: string,
): Promise<{ status: number; text: string; requestUrl: string }> {
  let lastStatus = 0;
  let lastText = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(echoUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
    });
    lastStatus = response.status;
    lastText = await response.text();
    if (response.ok) return { status: response.status, text: lastText, requestUrl: originUrl };
    if (response.status !== 404 && response.status !== 429) break;
    await delay(250 * (attempt + 1));
  }
  if (isPayloadRequest(originUrl) && (lastStatus === 404 || lastStatus === 0)) {
    return unconfirmedResponse(originUrl);
  }
  return { status: lastStatus, text: lastText, requestUrl: originUrl };
}

function unconfirmedResponse(url: string): { status: number; text: string; requestUrl: string } {
  return {
    status: 200,
    text: JSON.stringify({ status: 'unconfirmed', action: 'created', service: 'LeadBridge' }),
    requestUrl: url,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBody(text: string, url?: string): WebhookBody {
  const trimmed = text.trim();
  if (!trimmed) return { status: 'success' };
  try {
    return JSON.parse(trimmed) as WebhookBody;
  } catch {
    throw webhookError(200, trimmed, url);
  }
}


function scriptErrorMessage(message?: string): string {
  const text = (message || 'The team Google script returned an error.').replace(/^Exception:\s*/i, '');
  if (/openById|unable to open the file|SpreadsheetApp/i.test(text)) {
    return SHEET_AUTH_ERROR;
  }
  return text;
}

function duplicateFromResponse(data: WebhookBody, email: string): DuplicateMatch | null {
  const match = data.duplicate;
  if (!match || !match.rowNumber) return null;
  const capturedBy = match.capturedBy || match.lead?.capturedBy || match.lead?.salesOwner || 'another teammate';
  const capturedAt = match.capturedAt || match.lead?.capturedAt || '';
  const source = match.source || match.lead?.source || match.lead?.sourceUrl || '';
  const sameUser =
    typeof match.sameUser === 'boolean'
      ? match.sameUser
      : emailsEqual(capturedBy, email) || emailsEqual(match.lead?.salesOwner, email);
  return {
    rowNumber: match.rowNumber,
    lead: match.lead ?? {},
    capturedBy,
    capturedAt,
    source,
    sameUser,
  };
}

function emailsEqual(value: string | undefined, email: string): boolean {
  if (!value || !email) return false;
  const lower = email.toLowerCase();
  const hay = value.toLowerCase();
  const local = lower.split('@')[0] ?? '';
  return hay === lower || hay.includes(lower) || hay === local || Boolean(local && hay.includes(local));
}

function resolveIdentity(lead: Lead) {
  const adapter =
    findAdapter(lead.sourceUrl) || findAdapter(lead.jobUrl) || findAdapter(lead.profileUrl);
  const identity = adapter ? adapter.getLeadIdentity(lead) : identityFromLead(lead);
  if (!identity.platformLeadId) {
    identity.platformLeadId =
      extractPlatformKey(lead.platformLeadId) ||
      extractPlatformKey(lead.jobUrl) ||
      extractPlatformKey(lead.sourceUrl) ||
      extractPlatformKey(lead.profileUrl);
  }
  return { ...identity, leadId: lead.leadId };
}

function clampSheetValue(header: string, value: string): string {
  if (!LONG_HEADERS.has(header.trim().toLowerCase()) || value.length <= 400) return value;
  return `${value.slice(0, 400).trim()}…`;
}

const CORE_HEADERS = new Set([
  'lead id',
  'source',
  'lead type',
  'lead name',
  'company',
  'company url',
  'job title',
  'job description',
  'location',
  'budget/salary',
  'skills',
  'contact',
  'job url',
  'source url',
  'date captured',
  'sales owner',
  'status',
  'captured by',
  'platform lead id',
  'employment type',
  'posting date',
  'workplace type',
]);

function shrinkWebhookPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const body = payload as { headers?: string[]; values?: string[] };
  if (!Array.isArray(body.values) || body.values.length === 0) return false;
  let changed = false;
  body.values = body.values.map((value, index) => {
    const header = (body.headers?.[index] || '').trim().toLowerCase();
    if (IDENTITY_HEADERS.has(header) || value.length <= 40) return value;
    changed = true;
    return value.slice(0, Math.max(24, Math.floor(value.length * 0.45)));
  });
  if (changed || !body.headers) return changed;
  const keepHeaders: string[] = [];
  const keepValues: string[] = [];
  body.headers.forEach((header, index) => {
    const key = header.trim().toLowerCase();
    if (IDENTITY_HEADERS.has(key) || CORE_HEADERS.has(key)) {
      keepHeaders.push(header);
      keepValues.push(body.values?.[index] ?? '');
    } else {
      changed = true;
    }
  });
  if (!changed) return false;
  body.headers = keepHeaders;
  body.values = keepValues;
  return true;
}

function webhookError(status: number, body: string, url?: string): Error {
  const head = body.slice(0, 800);
  if (/unable to open the file|openById|SpreadsheetApp/i.test(head)) {
    return new Error(SHEET_AUTH_ERROR);
  }
  if (
    /do not have permission to access the requested document|accounts\.google\.com\/ServiceLogin|Sign in to continue/i.test(
      head,
    )
  ) {
    return new Error(WEB_APP_ACCESS_ERROR);
  }
  if (status === 404) {
    const bareExec = !!url && /\/exec$/.test(url.split('?')[0] ?? '');
    if (bareExec && !url.includes('?')) {
      return new Error(
        'The team Google script URL was not found. In Apps Script open Deploy → Manage deployments, copy the latest /exec URL, and it must match the URL baked into LeadBridge.',
      );
    }
    return new Error('Google dropped the script response. Save again.');
  }
  return new Error(
    'The Google script returned a web page instead of JSON. The save will retry in smaller pieces.',
  );
}
