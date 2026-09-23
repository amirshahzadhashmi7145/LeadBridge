import { currentUser, signIn, signOut } from '@/auth/google';
import type { ExtensionMessage, PageState } from '@/messaging/types';
import { findAdapter } from '@/platforms/registry';
import { parseSpreadsheetId } from '@/sheets/ids';
import { DuplicateError, SameUserDuplicateError, checkDuplicate, saveLead } from '@/sheets/save';
import {
  getConfig,
  getDrafts,
  removeDraft,
  saveConfig,
  type AppConfig,
} from '@/storage/config';
import { logger } from '@/utils/logger';
import type { ExtractResponse } from '@/schema/lead';

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Older Chromium builds may not support this helper.
  });

  browser.action.onClicked.addListener((tab) => {
    if (tab.id) {
      void browser.sidePanel.open({ tabId: tab.id });
    }
  });

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    handle(message, sender)
      .then(sendResponse)
      .catch(async (error) => {
        await logger.error('background', 'Handler failed', String(error));
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Something went wrong.',
          keepDraft: true,
        });
      });
    return true;
  });
});

async function handle(message: ExtensionMessage, sender: { tab?: { id?: number } }) {
  switch (message.type) {
    case 'GET_PAGE_STATE':
      return { ok: true, page: await getPageState() };
    case 'EXTRACT_LEAD':
      return { ok: true, extraction: await extractFromActiveTab(message.selectedPostId) };
    case 'DETECT_PAGE':
      return { ok: true, page: await getPageState() };
    case 'HIGHLIGHT_POSTS':
      await sendToActiveTab({ type: 'CONTENT_HIGHLIGHT_POSTS' });
      return { ok: true };
    case 'HIGHLIGHT_POST':
      await sendToActiveTab({ type: 'CONTENT_HIGHLIGHT_POST', postId: message.postId });
      return { ok: true };
    case 'CLEAR_HIGHLIGHTS':
      await sendToActiveTab({ type: 'CONTENT_CLEAR_HIGHLIGHTS' });
      return { ok: true };
    case 'SAVE_LEAD':
      return saveMessage(message.lead, message.action, message.existingRow);
    case 'CHECK_DUPLICATE':
      return { ok: true, duplicate: await checkDuplicate(message.lead) };
    case 'GET_CONFIG':
      return { ok: true, config: await getConfig() };
    case 'SAVE_CONFIG':
      return { ok: true, config: await saveConfig(sanitizeConfig(message.config)) };
    case 'GOOGLE_SIGN_IN':
      return { ok: true, user: await signIn() };
    case 'GOOGLE_SIGN_OUT':
      await signOut();
      return { ok: true, user: null };
    case 'GET_SESSION':
      return { ok: true, user: await currentUser() };
    case 'GET_LOGS':
      return { ok: true, logs: await logger.list() };
    case 'CLEAR_LOGS':
      await logger.clear();
      return { ok: true, logs: [] };
    case 'GET_DRAFTS':
      return { ok: true, drafts: await getDrafts() };
    case 'RETRY_DRAFT':
      return retryDraft(message.draftId);
    case 'DISCARD_DRAFT':
      await removeDraft(message.draftId);
      return { ok: true, drafts: await getDrafts() };
    default:
      await logger.warn('background', 'Unknown message', message);
      return { ok: false, error: 'Unknown message.' };
  }
}

function sanitizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    spreadsheetId: parseSpreadsheetId(config.spreadsheetId),
    sheetName: config.sheetName.trim() || 'Leads',
    googleClientId: config.googleClientId.trim(),
  };
}

async function getPageState(): Promise<PageState> {
  const tab = await activeTab();
  const url = tab?.url ?? '';
  const title = tab?.title ?? '';
  if (!url || url.startsWith('chrome://') || url.startsWith('edge://')) {
    return {
      url,
      title,
      tabId: tab?.id,
      status: 'unknown_platform',
      message: 'Open a LinkedIn or Upwork page, then click LeadBridge again.',
    };
  }

  const config = await getConfig();
  const adapter = findAdapter(url, config.enabledPlatforms);
  if (!adapter) {
    return {
      url,
      title,
      tabId: tab?.id,
      status: 'unknown_platform',
      message:
        "LeadBridge doesn't recognize this website yet. Supported platforms: LinkedIn and Upwork.",
    };
  }

  try {
    const detect = (await sendToTab(tab!.id!, { type: 'CONTENT_DETECT' })) as {
      pageType?: string;
      supported?: boolean;
    };
    const pageType = detect.pageType;
    if (pageType === 'unsupported') {
      return {
        url,
        title,
        tabId: tab?.id,
        platformId: adapter.id,
        sourceName: adapter.sourceName,
        pageType,
        status: 'unsupported_page',
        message: `This looks like ${adapter.sourceName}, but this page type isn't supported for capture. Open a job, company, or post.`,
      };
    }
    return {
      url,
      title,
      tabId: tab?.id,
      platformId: adapter.id,
      sourceName: adapter.sourceName,
      pageType,
      status: 'ready',
    };
  } catch {
    return {
      url,
      title,
      tabId: tab?.id,
      platformId: adapter.id,
      sourceName: adapter.sourceName,
      status: 'needs_refresh',
      message: `Refresh this ${adapter.sourceName} page so LeadBridge can read it, then try again.`,
    };
  }
}

async function extractFromActiveTab(selectedPostId?: string): Promise<ExtractResponse> {
  const tab = await activeTab();
  if (!tab?.id) {
    return {
      ok: false,
      reason: 'extract_error',
      message: 'No active tab found.',
    };
  }
  try {
    return (await sendToTab(tab.id, {
      type: 'CONTENT_EXTRACT',
      selectedPostId,
    })) as ExtractResponse;
  } catch (error) {
    await logger.warn('background', 'Content script missing', String(error));
    return {
      ok: false,
      reason: 'needs_refresh',
      message: 'Refresh this page so LeadBridge can read it, then try again.',
      url: tab.url,
    };
  }
}

async function saveMessage(
  lead: Parameters<typeof saveLead>[0],
  action: Parameters<typeof saveLead>[1],
  existingRow?: number,
) {
  try {
    const save = await saveLead(lead, action, existingRow);
    return { ok: true, save };
  } catch (error) {
    if (error instanceof SameUserDuplicateError) {
      return {
        ok: false,
        error: error.message,
        duplicate: error.match,
      };
    }
    if (error instanceof DuplicateError) {
      return {
        ok: false,
        error: error.message,
        duplicate: error.match,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save this lead.',
      keepDraft: true,
    };
  }
}

async function retryDraft(draftId: string) {
  const drafts = await getDrafts();
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft) return { ok: false, error: 'That draft is no longer available.' };
  const result = await saveMessage(draft.lead, 'create');
  if (result.ok) await removeDraft(draftId);
  return result;
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToActiveTab(message: ExtensionMessage) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No active tab.');
  return sendToTab(tab.id, message);
}

async function sendToTab(tabId: number, message: ExtensionMessage) {
  return browser.tabs.sendMessage(tabId, message);
}

