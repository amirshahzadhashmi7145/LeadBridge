import type { ExtractResponse, Lead, LeadIdentity, PostCandidate } from '@/schema/lead';
import type { AppConfig, GoogleUser, PendingDraft } from '@/storage/config';
import type { DuplicateMatch, SaveResult } from '@/sheets/types';
import type { LogEntry } from '@/utils/logger';

export type PageStatus =
  | 'unknown_platform'
  | 'unsupported_page'
  | 'ready'
  | 'needs_selection'
  | 'needs_refresh'
  | 'error';

export interface PageState {
  url: string;
  title: string;
  tabId?: number;
  platformId?: string;
  sourceName?: string;
  pageType?: string;
  status: PageStatus;
  message?: string;
  extraction?: ExtractResponse;
  candidates?: PostCandidate[];
}

export type ExtensionMessage =
  | { type: 'GET_PAGE_STATE' }
  | { type: 'EXTRACT_LEAD'; selectedPostId?: string }
  | { type: 'DETECT_PAGE' }
  | { type: 'HIGHLIGHT_POSTS'; candidates?: PostCandidate[] }
  | { type: 'HIGHLIGHT_POST'; postId: string }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | { type: 'SAVE_LEAD'; lead: Lead; action: 'create' | 'update' | 'force-create'; existingRow?: number }
  | { type: 'CHECK_DUPLICATE'; identity: LeadIdentity; lead: Lead }
  | { type: 'GET_CONFIG' }
  | { type: 'SAVE_CONFIG'; config: AppConfig }
  | { type: 'GOOGLE_SIGN_IN' }
  | { type: 'GOOGLE_SIGN_OUT' }
  | { type: 'GET_SESSION' }
  | { type: 'GET_LOGS' }
  | { type: 'CLEAR_LOGS' }
  | { type: 'GET_DRAFTS' }
  | { type: 'RETRY_DRAFT'; draftId: string }
  | { type: 'DISCARD_DRAFT'; draftId: string }
  | { type: 'CONTENT_EXTRACT'; selectedPostId?: string }
  | { type: 'CONTENT_DETECT' }
  | { type: 'CONTENT_HIGHLIGHT_POSTS' }
  | { type: 'CONTENT_HIGHLIGHT_POST'; postId: string }
  | { type: 'CONTENT_CLEAR_HIGHLIGHTS' };

export type ExtensionResponse =
  | { ok: true; page?: PageState; extraction?: ExtractResponse }
  | { ok: true; config: AppConfig }
  | { ok: true; user: GoogleUser | null }
  | { ok: true; logs: LogEntry[] }
  | { ok: true; drafts: PendingDraft[] }
  | { ok: true; save: SaveResult }
  | { ok: true; duplicate: DuplicateMatch | null }
  | { ok: false; error: string; keepDraft?: boolean; duplicate?: DuplicateMatch };

export interface ContentExtractOk {
  ok: true;
  extraction: ExtractResponse;
}

export interface ContentDetectOk {
  ok: true;
  platformId?: string;
  sourceName?: string;
  pageType?: string;
  supported: boolean;
}
