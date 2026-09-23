import { findAdapter } from '@/platforms/registry';
import {
  findPostById,
  findPostElements,
  postCandidates,
  postIdFromEl,
} from '@/platforms/linkedin/posts';
import { getConfig } from '@/storage/config';
import { logger } from '@/utils/logger';
import type { ExtractResponse } from '@/schema/lead';

const HIGHLIGHT_ATTR = 'data-lb-highlight';
const STYLE_ID = 'leadbridge-highlight-style';

export default defineContentScript({
  matches: [
    'https://www.linkedin.com/*',
    'https://linkedin.com/*',
    'https://www.upwork.com/*',
    'https://upwork.com/*',
    'https://wellfound.com/*',
    'https://www.wellfound.com/*',
    'https://angel.co/*',
    'https://www.angel.co/*',
    'https://weworkremotely.com/*',
    'https://www.weworkremotely.com/*',
  ],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const task = handleMessage(message);
      if (task) {
        task
          .then((result) => sendResponse(result))
          .catch(async (error) => {
            await logger.error('content', 'Message handler failed', String(error));
            sendResponse({
              ok: false,
              reason: 'extract_error',
              message: error instanceof Error ? error.message : 'Extraction failed.',
              url: location.href,
            });
          });
        return true;
      }
      return false;
    });
  },
});

async function handleMessage(message: { type?: string; selectedPostId?: string; postId?: string }) {
  switch (message.type) {
    case 'CONTENT_DETECT':
      return detect();
    case 'CONTENT_EXTRACT':
      return extract(message.selectedPostId);
    case 'CONTENT_HIGHLIGHT_POSTS':
      highlightAll();
      return { ok: true };
    case 'CONTENT_HIGHLIGHT_POST':
      highlightOne(message.postId ?? '');
      return { ok: true };
    case 'CONTENT_CLEAR_HIGHLIGHTS':
      clearHighlights();
      return { ok: true };
    default:
      return null;
  }
}

async function detect() {
  const config = await getConfig();
  const adapter = findAdapter(location.href, config.enabledPlatforms);
  if (!adapter) {
    return {
      ok: true,
      supported: false,
      platformId: undefined,
      sourceName: undefined,
      pageType: undefined,
    };
  }
  const pageType = adapter.detectPageType({
    url: new URL(location.href),
    document,
  });
  return {
    ok: true,
    supported: pageType !== 'unsupported',
    platformId: adapter.id,
    sourceName: adapter.sourceName,
    pageType,
  };
}

async function extract(selectedPostId?: string): Promise<ExtractResponse> {
  const config = await getConfig();
  const adapter = findAdapter(location.href, config.enabledPlatforms);
  if (!adapter) {
    return {
      ok: false,
      reason: 'unknown_platform',
      message:
        "LeadBridge doesn't recognize this website yet. Supported platforms: LinkedIn and Upwork.",
      url: location.href,
    };
  }

  const ctx = {
    url: new URL(location.href),
    document,
    selectedPostId,
  };
  const pageType = adapter.detectPageType(ctx);
  await logger.info('extract', `Extracting ${adapter.sourceName} ${pageType}`, location.href);

  try {
    const extracted = await adapter.extract(ctx);
    if ('needsSelection' in extracted) {
      highlightAll();
      return extracted.result;
    }
    if (pageType === 'unsupported') {
      return {
        ok: false,
        reason: 'unsupported_page',
        message: `This looks like ${adapter.sourceName}, but this page type isn't supported for capture.`,
        platformId: adapter.id,
        sourceName: adapter.sourceName,
        pageType,
        url: location.href,
      };
    }
    return extracted;
  } catch (error) {
    await logger.error('extract', 'Adapter failed', String(error));
    return {
      ok: false,
      reason: 'extract_error',
      message:
        'The page structure may have changed. Some fields could not be extracted. Try refreshing the page.',
      platformId: adapter.id,
      sourceName: adapter.sourceName,
      pageType,
      url: location.href,
    };
  }
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${HIGHLIGHT_ATTR}] {
      outline: 2px solid #1f6feb !important;
      outline-offset: 4px !important;
      border-radius: 12px !important;
      position: relative !important;
    }
    [${HIGHLIGHT_ATTR}="active"] {
      outline-color: #1b7f4e !important;
    }
    .lb-capture-badge {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 2147483646;
      background: #1f6feb;
      color: #fff;
      font: 600 12px/1.2 system-ui, sans-serif;
      padding: 6px 10px;
      border-radius: 999px;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.18);
    }
  `;
  document.documentElement.appendChild(style);
}

function highlightAll() {
  ensureStyles();
  clearHighlights();
  const posts = findPostElements(document).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.height > 80 && rect.bottom > 0 && rect.top < window.innerHeight;
  });
  const candidates = postCandidates(document);
  posts.forEach((el) => {
    const id = postIdFromEl(el);
    const index = candidates.findIndex((item) => item.id === id);
    el.setAttribute(HIGHLIGHT_ATTR, 'candidate');
    const badge = document.createElement('div');
    badge.className = 'lb-capture-badge';
    badge.textContent = index >= 0 ? `Capture ${index + 1}` : 'Capture';
    el.appendChild(badge);
  });
}

function highlightOne(postId: string) {
  ensureStyles();
  document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => {
    el.setAttribute(HIGHLIGHT_ATTR, 'candidate');
  });
  const el = findPostById(document, postId);
  if (el) {
    el.setAttribute(HIGHLIGHT_ATTR, 'active');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function clearHighlights() {
  document.querySelectorAll('.lb-capture-badge').forEach((el) => el.remove());
  document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => {
    el.removeAttribute(HIGHLIGHT_ATTR);
  });
}
