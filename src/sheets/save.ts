import { requireSession } from '@/auth/google';
import { identityFromLead } from '@/platforms/builder';
import type { Lead } from '@/schema/lead';
import { getConfig, saveDraft, setupProblems, type GoogleUser } from '@/storage/config';
import { hashId } from '@/utils/text';
import { logger } from '@/utils/logger';
import { loadSheet, writeLeadRow } from './client';
import { findDuplicate, ownershipMessage } from './duplicates';
import type { DuplicateMatch, SaveResult } from './types';

export class DuplicateError extends Error {
  constructor(public readonly match: DuplicateMatch) {
    super(ownershipMessage(match));
    this.name = 'DuplicateError';
  }
}

export class SameUserDuplicateError extends Error {
  constructor(public readonly match: DuplicateMatch) {
    super('This lead is already in the sheet.');
    this.name = 'SameUserDuplicateError';
  }
}

export async function checkDuplicate(lead: Lead): Promise<DuplicateMatch | null> {
  const config = await getConfig();
  const setupError = setupProblems(config);
  if (setupError) throw new Error(setupError);
  const session = await requireSession();
  const snapshot = await loadSheet(session.accessToken, config);
  return findDuplicate(snapshot, config, identityFromLead(lead), session.user.email);
}

export async function saveLead(
  lead: Lead,
  action: 'create' | 'update' | 'force-create',
  existingRow?: number,
): Promise<SaveResult> {
  const config = await getConfig();
  const setupError = setupProblems(config);
  if (setupError) throw new Error(setupError);
  const session = await requireSession();
  const now = new Date().toISOString();
  const prepared = applyAudit(lead, session.user, now, action !== 'update');

  try {
    const snapshot = await loadSheet(session.accessToken, config);
    const match = findDuplicate(
      snapshot,
      config,
      identityFromLead(prepared),
      session.user.email,
    );

    if (match && !match.sameUser) {
      throw new DuplicateError(match);
    }

    if (match && match.sameUser && action === 'create') {
      throw new SameUserDuplicateError(match);
    }

    if (action === 'force-create' && match?.sameUser) {
      prepared.leadId = `${prepared.leadId}-${Date.now().toString(36)}`;
    }

    if (action === 'update') {
      const row = existingRow || match?.rowNumber;
      if (!row) throw new Error('Could not find the existing lead row to update.');
      if (match && !match.sameUser) throw new DuplicateError(match);
      const original = match?.lead;
      prepared.capturedBy = original?.capturedBy || prepared.capturedBy;
      prepared.capturedAt = original?.capturedAt || prepared.capturedAt;
      const rowNumber = await writeLeadRow(session.accessToken, config, prepared, row);
      await logger.info('sheets', 'Updated lead', { rowNumber, source: prepared.source });
      return { action: 'updated', rowNumber, lead: prepared };
    }

    const rowNumber = await writeLeadRow(session.accessToken, config, prepared);
    await logger.info('sheets', 'Created lead', { rowNumber, source: prepared.source });
    return { action: 'created', rowNumber, lead: prepared };
  } catch (error) {
    if (error instanceof DuplicateError || error instanceof SameUserDuplicateError) {
      throw error;
    }
    await persistDraft(prepared, error);
    throw error;
  }
}

function applyAudit(lead: Lead, user: GoogleUser, now: string, isCreate: boolean): Lead {
  const next = { ...lead, platformFields: { ...lead.platformFields } };
  next.salesOwner = next.salesOwner || user.name;
  next.lastUpdatedBy = user.name;
  next.lastUpdatedAt = now;
  next.status = next.status || 'Lead captured';
  if (isCreate || !next.capturedBy) {
    next.capturedBy = user.name;
    next.capturedAt = next.capturedAt || now;
  }
  return next;
}

async function persistDraft(lead: Lead, error: unknown) {
  const reason = error instanceof Error ? error.message : 'Google Sheets is unavailable.';
  await saveDraft({
    id: hashId(`${lead.sourceUrl}:${Date.now()}`),
    savedAt: new Date().toISOString(),
    reason,
    lead,
  });
  await logger.error('sheets', 'Save failed; draft kept locally', reason);
}
