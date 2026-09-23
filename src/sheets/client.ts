import type { AppConfig } from '@/storage/config';
import type { Lead } from '@/schema/lead';
import { logger } from '@/utils/logger';
import { headerIndex, leadToRow, requiredHeaders, rowToLead } from './mapping';

export interface SheetSnapshot {
  headers: string[];
  rows: string[][];
}

export async function sheetsGet(
  token: string,
  config: AppConfig,
  range: string,
): Promise<string[][]> {
  const encoded = encodeURIComponent(`${config.sheetName}!${range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encoded}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'GET failed', { status: response.status, text });
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
  const encoded = encodeURIComponent(`${config.sheetName}!${range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encoded}?valueInputOption=USER_ENTERED`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'UPDATE failed', { status: response.status, text });
    throw sheetsError(response.status, text);
  }
}

export async function sheetsAppend(
  token: string,
  config: AppConfig,
  values: string[][],
): Promise<number> {
  const encoded = encodeURIComponent(`${config.sheetName}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  if (!response.ok) {
    const text = await response.text();
    await logger.error('sheets', 'APPEND failed', { status: response.status, text });
    throw sheetsError(response.status, text);
  }
  const data = (await response.json()) as {
    updates?: { updatedRange?: string };
  };
  return parseRowNumber(data.updates?.updatedRange);
}

export async function loadSheet(token: string, config: AppConfig): Promise<SheetSnapshot> {
  if (!config.spreadsheetId) {
    throw new Error('Set a destination Google Sheet ID in Options before saving leads.');
  }
  const values = await sheetsGet(token, config, 'A1:ZZ');
  if (values.length === 0) {
    const headers = requiredHeaders(config);
    await sheetsUpdate(token, config, 'A1', [headers]);
    await logger.info('sheets', 'Created header row');
    return { headers, rows: [] };
  }
  const headers = values[0] ?? [];
  const missing = requiredHeaders(config).filter(
    (header) => headerIndex(headers, header) < 0,
  );
  if (missing.length) {
    const nextHeaders = [...headers, ...missing];
    await sheetsUpdate(token, config, 'A1', [nextHeaders]);
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
  const snapshot = await loadSheet(token, config);
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
  if (status === 401 || status === 403) {
    return new Error(
      'Google Sheets access was denied. Sign in again and confirm this account can edit the sheet.',
    );
  }
  if (status === 404) {
    return new Error('The configured Google Sheet was not found. Check the spreadsheet ID.');
  }
  return new Error(`Google Sheets is unavailable (${status}). ${body.slice(0, 180)}`);
}
