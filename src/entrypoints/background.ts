import { currentUser, signIn, signOut } from '@/auth/google';
import type { ExtensionMessage, PageState } from '@/messaging/types';
import { findAdapter } from '@/platforms/registry';
import { identityFromLead } from '@/platforms/builder';
import { DuplicateError, OfflineQueuedError, SameUserDuplicateError, checkDuplicate, saveLead } from '@/sheets/save';
import { identityKeys } from '@/sheets/duplicates';
import { COMPANY_SHEET_NAME, COMPANY_SPREADSHEET_ID } from '@/config/company';
import {
  getConfig,
  getDrafts,
  removeDraft,
  saveConfig,
  saveDraft,
  type AppConfig,
  type PendingDraft,
} from '@/storage/config';
import { logger } from '@/utils/logger';
import { isNetworkError, isOnline } from '@/utils/network';
import type { ExtractResponse } from '@/schema/lead';
import { listSaveJobs, trackSaveJob } from '@/storage/saves';
import type { DuplicateMatch, SaveResult } from '@/sheets/types';

const PANEL_PATH = '/sidepanel.html';
const FLUSH_ALARM = 'leadbridge.flush-outbox';
let ownerTabId: number | null = null;
let ignoreDisconnectUntil = 0;
let flushingOutbox = false;
const savingLocks = new Set<string>();

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
    // Older Chromium builds may not support this helper.
  });
  // Disable the window-wide panel so other tabs cannot fall back to it.
  void browser.sidePanel.setOptions({ enabled: false }).catch(() => undefined);

  browser.action.onClicked.addListener((tab) => {
    if (!tab.id) return;
    const tabId = tab.id;
    ownerTabId = tabId;
    ignoreDisconnectUntil = Date.now() + 600;
    void browser.sidePanel.setOptions({
      tabId,
      path: PANEL_PATH,
      enabled: true,
    });
    void browser.sidePanel.open({ tabId });
    void disablePanelOnOtherTabs(tabId);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'leadbridge-sidepanel') return;
    port.onDisconnect.addListener(() => {
      void handlePanelDisconnect();
    });
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    ignoreDisconnectUntil = Date.now() + 500;
    void syncPanelForTab(tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    if (tabId === ownerTabId) ownerTabId = null;
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

  void browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 }).catch(() => undefined);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM) void flushOutbox();
  });
  browser.runtime.onStartup.addListener(() => {
    void flushOutbox();
  });
  browser.runtime.onInstalled.addListener(() => {
    void browser.storage.local.remove(['leadbridge.knownLeads', 'leadbridge.knownLeads.v2']);
    void flushOutbox();
  });
  globalThis.addEventListener?.('online', () => {
    void flushOutbox();
  });
  void browser.storage.local.remove(['leadbridge.knownLeads', 'leadbridge.knownLeads.v2']);
  void flushOutbox();
});

async function syncPanelForTab(tabId: number) {
  const isOwner = ownerTabId != null && tabId === ownerTabId;
  try {
    await browser.sidePanel.setOptions({
      tabId,
      path: PANEL_PATH,
      enabled: isOwner,
    });
    if (isOwner) {
      await browser.sidePanel.open({ tabId }).catch(() => undefined);
    }
    if (isOwner) {
      await browser.sidePanel.open({ tabId }).catch(() => undefined);
    }
  } catch {
    // Ignore missing sidePanel.setOptions in older builds.
  }
}

async function disablePanelOnOtherTabs(ownerId: number) {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id && tab.id !== ownerId)
      .map((tab) =>
        browser.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => undefined),
      ),
  );
}

async function handlePanelDisconnect() {
  if (Date.now() < ignoreDisconnectUntil) return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const activeId = tab?.id;
  if (ownerTabId == null || activeId !== ownerTabId) return;
  const closed = ownerTabId;
  ownerTabId = null;
  await browser.sidePanel.setOptions({ tabId: closed, enabled: false }).catch(() => undefined);
}

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
      return queueSave(message.lead, message.action, message.existingRow, ownerTabId);
    case 'GET_SAVE_JOBS':
      return { ok: true, jobs: await listSaveJobs() };
    case 'SAVE_RESULT':
      return { ok: true };
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
    spreadsheetId: COMPANY_SPREADSHEET_ID,
    sheetName: COMPANY_SHEET_NAME,
    googleClientId: '',
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
      message: 'Open a LinkedIn, Upwork, or Wellfound page, then click LeadBridge again.',
    };
  }

  const config = await getConfig();
  const matched = findAdapter(url);
  if (!matched) {
    return {
      url,
      title,
      tabId: tab?.id,
      status: 'unknown_platform',
      message:
        "LeadBridge doesn't recognize this website yet. Supported platforms: LinkedIn, Upwork, and Wellfound.",
    };
  }
  if (!config.enabledPlatforms.includes(matched.id)) {
    return {
      url,
      title,
      tabId: tab?.id,
      platformId: matched.id,
      sourceName: matched.sourceName,
      status: 'unknown_platform',
      message: `${matched.sourceName} is turned off in Settings. Enable it there, then try again.`,
    };
  }
  const adapter = matched;

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

function queueSave(
  lead: Parameters<typeof saveLead>[0],
  action: Parameters<typeof saveLead>[1],
  existingRow?: number,
  tabId?: number | null,
) {
  const lock = saveLock(lead);
  if (savingLocks.has(lock)) {
    return { ok: true as const, queued: true as const, jobId: 'in-flight' };
  }
  savingLocks.add(lock);
  const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const title = lead.jobTitle || lead.leadName || lead.company || 'Lead';
  const sourceUrl = lead.sourceUrl || lead.jobUrl || '';
  void keepAliveWhile(
    (async () => {
      try {
        const toastTab = tabId ?? (await activeTab())?.id;
        await trackSaveJob({
          jobId,
          title,
          sourceUrl,
          status: 'saving',
          detail: 'Writing to Google Sheets',
          at: Date.now(),
        });
        await showPageToast(toastTab, {
          jobId,
          tone: 'saving',
          title: 'Saving…',
          detail: title,
        });
        const result = await saveMessage(lead, action, existingRow);
        await finishSaveJob(jobId, title, sourceUrl, toastTab, result);
      } finally {
        savingLocks.delete(lock);
      }
    })(),
  );
  return { ok: true as const, queued: true as const, jobId };
}

function saveLock(lead: Parameters<typeof saveLead>[0]): string {
  const keys = identityKeys(identityFromLead(lead));
  return keys.sort().join('|') || lead.jobUrl || lead.sourceUrl || lead.leadId;
}

async function finishSaveJob(
  jobId: string,
  title: string,
  sourceUrl: string,
  tabId: number | undefined,
  result: {
    ok: boolean;
    save?: SaveResult;
    error?: string;
    keepDraft?: boolean;
    queuedOffline?: boolean;
    duplicate?: DuplicateMatch;
  },
) {
  let status: 'saving' | 'success' | 'error' | 'duplicate' | 'queued' = 'error';
  let detail = result.error || 'Could not save this lead.';
  let toastTitle = 'Save failed';
  let tone: 'saving' | 'success' | 'error' | 'queued' = 'error';
  if (result.ok && result.save) {
    status = 'success';
    tone = 'success';
    toastTitle = result.save.action === 'updated' ? 'Lead updated' : 'Lead saved';
    detail = result.save.action === 'updated'
      ? result.save.rowNumber
        ? `Updated row ${result.save.rowNumber}`
        : 'Lead updated in Google Sheets'
      : result.save.rowNumber
        ? `Saved as row ${result.save.rowNumber}`
        : 'Saved to Google Sheets';
  } else if (result.duplicate) {
    status = 'duplicate';
    toastTitle = 'Already in the sheet';
    detail = result.error || 'This lead already exists.';
    tone = 'error';
  } else if (result.queuedOffline) {
    status = 'queued';
    tone = 'queued';
    toastTitle = 'Saved on this device';
    detail = result.error || 'Will upload when you are back online.';
  } else if (result.keepDraft) {
    detail = `${result.error || 'Could not save.'} Kept as a local draft.`;
  }

  await trackSaveJob({ jobId, title, sourceUrl, status, detail, at: Date.now() });
  await showPageToast(tabId, {
    jobId,
    tone,
    title: toastTitle,
    detail: `${title} · ${detail}`,
  });
  await browser.runtime
    .sendMessage({
      type: 'SAVE_RESULT',
      jobId,
      title,
      sourceUrl,
      ok: result.ok,
      save: result.save,
      error: result.error,
      keepDraft: result.keepDraft,
      queuedOffline: result.queuedOffline,
      duplicate: result.duplicate,
    })
    .catch(() => undefined);
}

function keepAliveWhile(task: Promise<unknown>) {
  const timer = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => undefined);
  }, 8000);
  return task.finally(() => clearInterval(timer));
}

async function showPageToast(
  tabId: number | undefined,
  toast: { jobId: string; tone: 'saving' | 'success' | 'error' | 'queued'; title: string; detail?: string },
) {
  const ids = new Set<number>();
  if (tabId) ids.add(tabId);
  const active = await activeTab();
  if (active?.id) ids.add(active.id);
  for (const id of ids) {
    try {
      await sendToTab(id, { type: 'CONTENT_TOAST', ...toast });
      return;
    } catch {
      // Try the next tab.
    }
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
    if (error instanceof OfflineQueuedError) {
      return {
        ok: false,
        error: error.message,
        keepDraft: true,
        queuedOffline: true,
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
  const result = await saveMessage(draft.lead, draft.action ?? 'create', draft.existingRow);
  if (result.ok || result.duplicate) await removeDraft(draftId);
  return result;
}

async function flushOutbox() {
  if (flushingOutbox || !isOnline()) return;
  const drafts = (await getDrafts()).filter((draft) => shouldAutoRetry(draft));
  if (!drafts.length) return;
  flushingOutbox = true;
  await keepAliveWhile(
    (async () => {
      try {
        for (const draft of drafts) {
          if (!isOnline()) break;
          const result = await saveMessage(draft.lead, draft.action ?? 'create', draft.existingRow);
          if (result.ok || result.duplicate) {
            await removeDraft(draft.id);
            continue;
          }
          if (result.queuedOffline || isNetworkError(result.error)) {
            break;
          }
          await saveDraft({
            ...draft,
            autoRetry: false,
            reason: result.error || draft.reason,
            lastAttemptAt: Date.now(),
          });
        }
      } finally {
        flushingOutbox = false;
      }
    })(),
  );
}

function shouldAutoRetry(draft: PendingDraft): boolean {
  if (draft.autoRetry === false) return false;
  const reason = draft.reason || '';
  return /you're offline|network is back/i.test(reason) || isNetworkError(reason);
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
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch {
    await injectContentScript(tabId);
    return browser.tabs.sendMessage(tabId, message);
  }
}

async function injectContentScript(tabId: number) {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/content-scripts/content.js'],
  });
}

