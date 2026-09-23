import { isCommonField, type AppConfig, type ColumnMap } from '@/storage/config';
import type { Lead } from '@/schema/lead';
import { flattenLines } from '@/utils/text';

const FIELD_ALIASES: Record<string, string[]> = {
  companyIndustry: ['companyIndustry', 'industry'],
  companyWebsite: ['companyWebsite', 'website'],
  datePosted: ['datePosted', 'postedDate'],
};

export function headerIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => header.trim().toLowerCase() === name.trim().toLowerCase());
}

export function leadToRow(lead: Lead, headers: string[], columnMap: ColumnMap[]): string[] {
  const map = columnMapWithLeadExtras(columnMap, lead);
  const row = headers.map(() => '');
  for (const mapping of map) {
    const index = headerIndex(headers, mapping.header);
    if (index < 0) continue;
    row[index] = fieldValue(lead, mapping.field, map);
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

export function requiredHeaders(config: AppConfig, lead?: Lead): string[] {
  return columnMapWithLeadExtras(config.columnMap, lead).map((item) => item.header);
}

export function columnMapWithLeadExtras(columnMap: ColumnMap[], lead?: Lead): ColumnMap[] {
  const extras = Object.keys(lead?.platformFields ?? {});
  const seen = new Set(columnMap.map((item) => item.field));
  const added = extras
    .filter((key) => !seen.has(key) && !FIELD_ALIASES_FLAT.has(key))
    .map((key) => ({ field: key, header: headerFromField(key) }));
  if (!added.length) return columnMap;
  const leftover = columnMap.findIndex((item) => item.field === 'platformFields');
  if (leftover >= 0) {
    return [...columnMap.slice(0, leftover), ...added, ...columnMap.slice(leftover)];
  }
  return [...columnMap, ...added];
}

const FIELD_ALIASES_FLAT = new Set(Object.values(FIELD_ALIASES).flat());

function headerFromField(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

function fieldValue(lead: Lead, field: string, columnMap: ColumnMap[]): string {
  if (field === 'platformFields') {
    const mapped = new Set(
      columnMap.filter((item) => item.field !== 'platformFields').flatMap((item) => FIELD_ALIASES[item.field] ?? [item.field]),
    );
    return Object.entries(lead.platformFields)
      .filter(([key]) => !mapped.has(key))
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  }
  if (field === 'capturedAtRaw') return lead.capturedAt;
  const extra = platformValue(lead, field);
  if (extra) return extra;
  const value = lead[field as keyof Lead];
  if (typeof value !== 'string') return '';
  if (field === 'jobDescription') return flattenLines(value);
  return value;
}

function platformValue(lead: Lead, field: string): string {
  for (const key of FIELD_ALIASES[field] ?? [field]) {
    const value = lead.platformFields[key];
    if (value) return value;
  }
  return '';
}

function assignField(lead: Partial<Lead>, field: string, value: string) {
  if (field === 'platformFields') {
    lead.platformFields = { ...(lead.platformFields ?? {}), raw: value };
    return;
  }
  if (!isCommonField(field) && field !== 'capturedAtRaw') {
    lead.platformFields = { ...(lead.platformFields ?? {}), [field]: value };
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
