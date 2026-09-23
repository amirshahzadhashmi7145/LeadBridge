import type { AppConfig } from '@/storage/config';
import type { Lead } from '@/schema/lead';
import { logger } from '@/utils/logger';
import { a1Range, parseSpreadsheetId } from './ids';
import { headerIndex, leadToRow, requiredHeaders, rowToLead } from './mapping';

export interface SheetSnapshot {
  headers: string[];
  rows: string[][];
}

function resolvedConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    spreadsheetId: parseSpreadsheetId(config.spreadsheetId),
    sheetName: config.sheetName.trim() || 'Leads',
  };
}

async function sheetsFetch(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  return response;
}

export async function sheetsGet(
  token: string,
  config: AppConfig,
  range: string,
): Promise<string[][]> {
  const resolved = resolvedConfig(config);
  const encoded = encodeURIComponent(a1Range(resolved.sheetName, range));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(resolved.spreadsheetId)}/values/${encoded}`;
  const response = await sheetsFetch(token, url);
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'GET failed', { status: response.status, text: text.slice(0, 400) });
    throw sheetsError(response.status, text);
  }
  const data = (await response.json()) as { values?: string[][] };
  return data.values ?? [];
}

export async function sheetsUpdate(
  token: string,
  config: AppConfig,
  range: string,
  values: string[][],
): Promise<void> {
  const resolved = resolvedConfig(config);
  const encoded = encodeURIComponent(a1Range(resolved.sheetName, range));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(resolved.spreadsheetId)}/values/${encoded}?valueInputOption=USER_ENTERED`;
  const response = await sheetsFetch(token, url, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'UPDATE failed', { status: response.status, text: text.slice(0, 400) });
    throw sheetsError(response.status, text);
  }
}

export async function sheetsAppend(
  token: string,
  config: AppConfig,
  values: string[][],
): Promise<number> {
  const resolved = resolvedConfig(config);
  const encoded = encodeURIComponent(a1Range(resolved.sheetName, 'A1'));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(resolved.spreadsheetId)}/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await sheetsFetch(token, url, {
    method: 'POST',
    body: JSON.stringify({ values }),
  });
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'APPEND failed', { status: response.status, text: text.slice(0, 400) });
    throw sheetsError(response.status, text);
  }
  const data = (await response.json()) as {
    updates?: { updatedRange?: string };
  };
  return parseRowNumber(data.updates?.updatedRange);
}

async function listSheetTitles(token: string, spreadsheetId: string): Promise<string[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const response = await sheetsFetch(token, url);
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'metadata failed', { status: response.status, text: text.slice(0, 400) });
    throw sheetsError(response.status, text);
  }
  const data = (await response.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  return (data.sheets ?? []).map((sheet) => sheet.properties?.title ?? '').filter(Boolean);
}

async function createSheetTab(token: string, spreadsheetId: string, title: string): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const response = await sheetsFetch(token, url, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title } } }],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'addSheet failed', { status: response.status, text: text.slice(0, 400) });
    throw sheetsError(response.status, text);
  }
}

export async function loadSheet(
  token: string,
  config: AppConfig,
  lead?: Lead,
): Promise<SheetSnapshot> {
  const resolved = resolvedConfig(config);
  if (!resolved.spreadsheetId) {
    throw new Error('Set a destination Google Sheet ID in Settings before saving leads.');
  }

  const titles = await listSheetTitles(token, resolved.spreadsheetId);
  if (!titles.some((title) => title.toLowerCase() === resolved.sheetName.toLowerCase())) {
    const existing = titles.find((title) => title.toLowerCase() === resolved.sheetName.toLowerCase());
    if (!existing) {
      await createSheetTab(token, resolved.spreadsheetId, resolved.sheetName);
      await logger.info('sheets', `Created tab "${resolved.sheetName}"`);
    }
  }

  const values = await sheetsGet(token, resolved, 'A1:CZ');
  if (values.length === 0) {
    const headers = requiredHeaders(resolved, lead);
    await sheetsUpdate(token, resolved, 'A1', [headers]);
    await logger.info('sheets', 'Created header row');
    return { headers, rows: [] };
  }
  const headers = values[0] ?? [];
  const missing = requiredHeaders(resolved, lead).filter(
    (header) => headerIndex(headers, header) < 0,
  );
  if (missing.length) {
    const nextHeaders = [...headers, ...missing];
    await sheetsUpdate(token, resolved, 'A1', [nextHeaders]);
    await logger.info('sheets', 'Added missing header columns', missing);
    return { headers: nextHeaders, rows: values.slice(1) };
  }
  return { headers, rows: values.slice(1) };
}

export function snapshotLeads(snapshot: SheetSnapshot, config: AppConfig) {
  return snapshot.rows.map((row, index) => ({
    rowNumber: index + 2,
    lead: rowToLead(row, snapshot.headers, config.columnMap),
    row,
  }));
}

export async function writeLeadRow(
  token: string,
  config: AppConfig,
  lead: Lead,
  rowNumber?: number,
): Promise<number> {
  const snapshot = await loadSheet(token, config, lead);
  const values = [leadToRow(lead, snapshot.headers, config.columnMap)];
  if (rowNumber) {
    await sheetsUpdate(token, config, `A${rowNumber}`, values);
    return rowNumber;
  }
  return sheetsAppend(token, config, values);
}

function parseRowNumber(updatedRange?: string): number {
  const match = updatedRange?.match(/![A-Z]+(\d+)/);
  return match?.[1] ? Number(match[1]) : 0;
}

function sheetsError(status: number, body: string): Error {
  const apiMessage = readApiMessage(body);
  if (body.includes('<!DOCTYPE') || body.includes('<html')) {
    return new Error(
      'Google rejected the sheet request. In Settings, paste the spreadsheet ID only (the long value after /d/ in the URL), or paste the full sheet URL and save again. Confirm this Google account can edit the file.',
    );
  }
  if (status === 401 || status === 403) {
    return new Error(
      apiMessage ||
        'Google Sheets access was denied. Sign in again, enable the Google Sheets API in Cloud Console, and confirm this account can edit the sheet.',
    );
  }
  if (status === 404) {
    return new Error('The configured Google Sheet was not found. Check the spreadsheet ID.');
  }
  return new Error(apiMessage || `Google Sheets is unavailable (${status}).`);
}

function readApiMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? '';
  } catch {
    return '';
  }
}
