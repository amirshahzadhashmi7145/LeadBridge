import type { Lead, LeadIdentity } from '@/schema/lead';
import type { AppConfig } from '@/storage/config';
import { normalizeUrl } from '@/utils/url';
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
  const keys = [
    identity.platformLeadId && lead.platformLeadId && same(identity.platformLeadId, lead.platformLeadId),
    identity.jobUrl && lead.jobUrl && sameUrl(identity.jobUrl, lead.jobUrl),
    identity.profileUrl && lead.profileUrl && sameUrl(identity.profileUrl, lead.profileUrl),
    identity.postId && lead.platformFields?.postId && same(identity.postId, lead.platformFields.postId),
    identity.sourceUrl && lead.sourceUrl && sameUrl(identity.sourceUrl, lead.sourceUrl),
  ];
  return keys.some(Boolean);
}

export function ownershipMessage(match: DuplicateMatch): string {
  const when = formatWhen(match.capturedAt);
  const source = match.source ? ` Source: ${match.source}.` : '';
  return `This lead has already been captured by ${match.capturedBy} on ${when}.${source}`;
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameUrl(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

function emailsEqual(value: string | undefined, email: string): boolean {
  if (!value || !email) return false;
  const lower = email.toLowerCase();
  return value.toLowerCase() === lower || value.toLowerCase().includes(lower);
}

function formatWhen(iso: string): string {
  if (!iso) return 'an unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
