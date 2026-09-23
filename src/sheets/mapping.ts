import type { AppConfig, ColumnMap } from '@/storage/config';
import type { Lead } from '@/schema/lead';

export function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => header.trim().toLowerCase() === name.trim().toLowerCase());
}

export function leadToRow(lead: Lead, headers: string[], columnMap: ColumnMap[]): string[] {
  const row = headers.map(() => '');
  for (const mapping of columnMap) {
    const index = headerIndex(headers, mapping.header);
    if (index < 0) continue;
    row[index] = fieldValue(lead, mapping.field);
  }
  return row;
}

export function rowToLead(row: string[], headers: string[], columnMap: ColumnMap[]): Partial<Lead> {
  const lead: Partial<Lead> = { platformFields: {} };
  for (const mapping of columnMap) {
    const index = headerIndex(headers, mapping.header);
    if (index < 0) continue;
    const value = row[index] ?? '';
    assignField(lead, mapping.field, value);
  }
  return lead;
}

export function requiredHeaders(config: AppConfig): string[] {
  return config.columnMap.map((item) => item.header);
}

function fieldValue(lead: Lead, field: string): string {
  if (field === 'platformFields') {
    return Object.entries(lead.platformFields)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }
  if (field === 'capturedAtRaw') return lead.capturedAt;
  const value = lead[field as keyof Lead];
  if (typeof value === 'string') return value;
  return '';
}

function assignField(lead: Partial<Lead>, field: string, value: string) {
  if (field === 'platformFields') {
    lead.platformFields = { ...(lead.platformFields ?? {}), raw: value };
    return;
  }
  if (field === 'capturedAtRaw') {
    lead.capturedAt = value;
    return;
  }
  if (field === 'leadType') {
    lead.leadType = (value as Lead['leadType']) || 'unknown';
    return;
  }
  if (field === 'status') {
    lead.status = (value as Lead['status']) || 'Lead captured';
    return;
  }
  (lead as Record<string, unknown>)[field] = value;
}
