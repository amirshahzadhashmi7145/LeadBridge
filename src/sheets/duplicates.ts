import type { Lead, LeadIdentity } from '@/schema/lead';
import type { AppConfig } from '@/storage/config';
import { extractPlatformKey } from '@/utils/url';
import { formatCalendarDate, toAbsoluteDate } from '@/utils/date';
import type { DuplicateMatch } from './types';
import { snapshotLeads, type SheetSnapshot } from './client';

export function findDuplicate(
  snapshot: SheetSnapshot,
  config: AppConfig,
  identity: LeadIdentity,
  currentEmail: string,
): DuplicateMatch | null {
  const rows = snapshotLeads(snapshot, config);
  const match = rows.find(({ lead }) => identitiesMatch(identity, lead));
  if (!match) return null;

  const capturedBy = match.lead.capturedBy || match.lead.salesOwner || 'another teammate';
  const capturedAt = match.lead.capturedAt || '';
  const source = match.lead.source || identity.sourceUrl;
  const sameUser = emailsEqual(capturedBy, currentEmail) || emailsEqual(match.lead.salesOwner, currentEmail);

  return {
    rowNumber: match.rowNumber,
    lead: match.lead,
    capturedBy,
    capturedAt,
    source,
    sameUser,
  };
}

export function identitiesMatch(identity: LeadIdentity, lead: Partial<Lead>): boolean {
  const incoming = identityKeys(identity);
  const existing = identityKeys({
    platformLeadId: lead.platformLeadId,
    jobUrl: lead.jobUrl,
    profileUrl: lead.profileUrl,
    postId: lead.platformFields?.postId,
    sourceUrl: lead.sourceUrl,
    leadId: lead.leadId,
  });
  if (!incoming.length || !existing.length) return false;
  return incoming.some((key) => existing.includes(key));
}

export function identityKeys(
  identity: Partial<LeadIdentity> & { leadId?: string; companyUrl?: string },
): string[] {
  const keys = new Set<string>();
  const add = (value?: string, allowCompanySlug = false) => {
    const extracted = extractPlatformKey(value).toLowerCase();
    if (extracted && (allowCompanySlug || !isCompanySlugOnly(value, extracted))) {
      keys.add(extracted);
    }
    const trimmed = (value ?? '').trim().toLowerCase();
    if (trimmed && isBareId(trimmed)) keys.add(trimmed);
  };
  add(identity.platformLeadId, true);
  add(identity.jobUrl);
  add(identity.postId, true);
  add(identity.profileUrl, true);
  add(identity.sourceUrl);
  return [...keys];
}

function isBareId(value: string): boolean {
  if (value.includes('://') || value.includes('/')) return false;
  if (value.startsWith('linkedin:')) return false;
  return /^[~a-z0-9._-]{6,}$/i.test(value);
}

function isCompanySlugOnly(value: string | undefined, extracted: string): boolean {
  const raw = value ?? '';
  const company = raw.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!company?.[1]) return false;
  const slug = company[1].replace(/\/$/, '').toLowerCase();
  if (slug !== extracted) return false;
  return !/[?&]currentJobId=|\/jobs\/view\/|urn:li:activity:/i.test(raw);
}

export function ownershipMessage(match: DuplicateMatch): string {
  const when = formatWhen(match.capturedAt);
  const source = match.source ? ` Source: ${match.source}.` : '';
  return `This lead has already been captured by ${match.capturedBy} on ${when}.${source}`;
}

function emailsEqual(value: string | undefined, email: string): boolean {
  if (!value || !email) return false;
  const lower = email.toLowerCase();
  const hay = value.toLowerCase();
  const local = lower.split('@')[0] ?? '';
  return hay === lower || hay.includes(lower) || hay === local || Boolean(local && hay.includes(local));
}

function formatWhen(value: string): string {
  if (!value) return 'an unknown date';
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return formatCalendarDate(new Date(parsed)) || value;
  }
  return toAbsoluteDate(value) || value;
}
