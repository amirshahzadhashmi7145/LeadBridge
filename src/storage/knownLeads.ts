import type { Lead } from '@/schema/lead';
import type { DuplicateMatch } from '@/sheets/types';

const KNOWN_LEADS_KEY = 'leadbridge.knownLeads.v2';
const MAX_KNOWN = 300;

export interface KnownLead {
  keys: string[];
  rowNumber: number;
  capturedBy: string;
  capturedAt: string;
  source: string;
  email: string;
  lead: Partial<Lead>;
  at: number;
}

export async function rememberKnownLead(entry: KnownLead): Promise<void> {
  if (!entry.keys.length) return;
  const existing = await listKnownLeads();
  const next = [
    entry,
    ...existing.filter((item) => !keysOverlap(item.keys, entry.keys) || item.rowNumber !== entry.rowNumber),
  ].slice(0, MAX_KNOWN);
  await browser.storage.local.set({ [KNOWN_LEADS_KEY]: next });
}

export async function findKnownLead(keys: string[]): Promise<KnownLead | null> {
  if (!keys.length) return null;
  const existing = await listKnownLeads();
  return existing.find((item) => keysOverlap(item.keys, keys)) ?? null;
}

export function knownLeadToMatch(entry: KnownLead, email: string): DuplicateMatch {
  const sameUser =
    !email ||
    entry.email.toLowerCase() === email.toLowerCase() ||
    entry.capturedBy.toLowerCase().includes(email.toLowerCase());
  return {
    rowNumber: entry.rowNumber,
    lead: entry.lead,
    capturedBy: entry.capturedBy || 'you',
    capturedAt: entry.capturedAt,
    source: entry.source,
    sameUser,
  };
}

async function listKnownLeads(): Promise<KnownLead[]> {
  const stored = await browser.storage.local.get(KNOWN_LEADS_KEY).catch(() => ({}));
  return ((stored as Record<string, KnownLead[] | undefined>)[KNOWN_LEADS_KEY] ?? []) as KnownLead[];
}

function keysOverlap(left: string[], right: string[]): boolean {
  const set = new Set(left);
  return right.some((key) => set.has(key));
}
