import { requireUser } from '@/auth/google';
import { identityFromLead } from '@/platforms/builder';
import type { Lead } from '@/schema/lead';
import { getConfig, saveDraft, getDrafts, setupProblems, type GoogleUser } from '@/storage/config';
import { formatCalendarDate } from '@/utils/date';
import { logger } from '@/utils/logger';
import { isNetworkError, OFFLINE_QUEUE_MESSAGE } from '@/utils/network';
import { hashId } from '@/utils/text';
import { checkLeadOnSheet, saveLeadOnSheet, setupWebhookProblems } from './webhook';
import { identityKeys } from './duplicates';
import type { DuplicateMatch, SaveResult } from './types';

export class DuplicateError extends Error {
  constructor(public readonly match: DuplicateMatch) {
    super('This lead already exists.');
    this.name = 'DuplicateError';
  }
}

export class SameUserDuplicateError extends Error {
  constructor(public readonly match: DuplicateMatch) {
    super('This lead already exists.');
    this.name = 'SameUserDuplicateError';
  }
}

export class OfflineQueuedError extends Error {
  constructor() {
    super(OFFLINE_QUEUE_MESSAGE);
    this.name = 'OfflineQueuedError';
  }
}

export async function checkDuplicate(lead: Lead): Promise<DuplicateMatch | null> {
  const config = await getConfig();
  const setupError = setupWebhookProblems() || setupProblems(config);
  if (setupError) throw new Error(setupError);
  const user = await requireUser();
  return checkLeadOnSheet(lead, user);
}

export async function saveLead(
  lead: Lead,
  action: 'create' | 'update' | 'force-create',
  existingRow?: number,
): Promise<SaveResult> {
  const config = await getConfig();
  const setupError = setupWebhookProblems() || setupProblems(config);
  if (setupError) throw new Error(setupError);
  const user = await requireUser();
  const now = formatCalendarDate(new Date());
  const prepared = applyAudit(lead, user, now, action !== 'update');

  if (action === 'force-create') {
    prepared.leadId = `${prepared.leadId}-${Date.now().toString(36)}`;
  }

  const keys = identityKeys(identityFromLead(prepared));

  try {
    const { result, duplicate } = await saveLeadOnSheet(
      prepared,
      user,
      config,
      action,
      existingRow,
    );

    if (duplicate && action === 'create') {
      throw duplicate.sameUser ? new SameUserDuplicateError(duplicate) : new DuplicateError(duplicate);
    }

    await logger.info('sheets', action === 'update' ? 'Updated lead' : 'Created lead', {
      rowNumber: result.rowNumber,
      source: prepared.source,
      identity: identityFromLead(prepared),
    });
    return { action: result.action, rowNumber: result.rowNumber, lead: prepared };
  } catch (error) {
    if (error instanceof DuplicateError || error instanceof SameUserDuplicateError) {
      throw error;
    }
    await persistDraft(prepared, error, action, existingRow, keys);
    if (isNetworkError(error)) throw new OfflineQueuedError();
    throw error;
  }
}

function applyAudit(lead: Lead, user: GoogleUser, now: string, isCreate: boolean): Lead {
  const next = { ...lead, platformFields: { ...lead.platformFields } };
  const who = user.name || user.email || 'LeadBridge';
  next.salesOwner = next.salesOwner || who;
  next.lastUpdatedBy = who;
  next.lastUpdatedAt = now;
  next.status = next.status || 'Lead captured';
  if (isCreate || !next.capturedBy) {
    next.capturedBy = who;
    next.capturedAt = next.capturedAt || now;
  }
  return next;
}

async function persistDraft(
  lead: Lead,
  error: unknown,
  action: 'create' | 'update' | 'force-create',
  existingRow: number | undefined,
  keys: string[],
) {
  const reason = error instanceof Error ? error.message : 'Google Sheets is unavailable.';
  if (/already exists|duplicate/i.test(reason)) return;
  const autoRetry = isNetworkError(error);
  const id = hashId(`outbox:${keys.slice().sort().join('|') || lead.leadId || lead.sourceUrl}`);
  const existing = (await getDrafts()).find((draft) => draft.id === id);
  await saveDraft({
    id,
    savedAt: existing?.savedAt || new Date().toISOString(),
    reason: autoRetry ? OFFLINE_QUEUE_MESSAGE : reason,
    lead,
    action,
    existingRow,
    identityKeys: keys,
    autoRetry,
    attempts: (existing?.attempts ?? 0) + 1,
    lastAttemptAt: Date.now(),
  });
  await logger.error(
    'sheets',
    autoRetry ? 'Save queued until the network is back' : 'Save failed; draft kept locally',
    reason,
  );
}
