export type PageToastTone = 'saving' | 'success' | 'error' | 'queued';

export interface PageToast {
  jobId: string;
  tone: PageToastTone;
  title: string;
  detail?: string;
}

const HOST_ID = 'leadbridge-toast-host';
const cards = new Map<string, HTMLElement>();
const timers = new Map<string, number>();

export function showPageToast(toast: PageToast) {
  const root = ensureStack();
  const jobId = 'leadbridge-save';
  let card = cards.get(jobId);
  if (!card) {
    card = document.createElement('div');
    card.className = 'lb-toast';
    root.appendChild(card);
    cards.set(jobId, card);
  }
  card.className = `lb-toast ${toast.tone}`;
  card.innerHTML = `
    <span class="lb-toast-icon" aria-hidden="true">${icon(toast.tone)}</span>
    <div class="lb-toast-body">
      <strong>${escapeHtml(toast.title)}</strong>
      ${toast.detail ? `<span>${escapeHtml(toast.detail)}</span>` : ''}
    </div>
    ${toast.tone === 'saving' ? '' : '<button class="lb-toast-close" type="button" aria-label="Close">×</button>'}
    ${toast.tone === 'saving' ? '' : '<i class="lb-toast-bar"></i>'}
  `;
  card.querySelector('.lb-toast-close')?.addEventListener('click', () => dismiss(jobId));
  const existing = timers.get(jobId);
  if (existing) window.clearTimeout(existing);
  if (toast.tone !== 'saving') {
    const bar = card.querySelector('.lb-toast-bar') as HTMLElement | null;
    const ms = toast.tone === 'error' ? 6000 : toast.tone === 'queued' ? 5000 : 3500;
    if (bar) bar.style.animationDuration = `${ms}ms`;
    timers.set(
      jobId,
      window.setTimeout(() => dismiss(jobId), ms),
    );
  }
}

function dismiss(jobId: string) {
  const card = cards.get(jobId);
  if (!card) return;
  card.classList.add('out');
  const timer = timers.get(jobId);
  if (timer) window.clearTimeout(timer);
  timers.delete(jobId);
  window.setTimeout(() => {
    card.remove();
    cards.delete(jobId);
  }, 180);
}

function ensureStack(): HTMLElement {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
  }
  if (host.shadowRoot) {
    return host.shadowRoot.querySelector('.wrap') as HTMLElement;
  }
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
    }
    .wrap {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: min(360px, calc(100vw - 32px));
      pointer-events: none;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    }
    .lb-toast {
      pointer-events: auto;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 12px 12px 14px;
      background: #fff;
      color: #4a4a4a;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.08);
      animation: in .22s ease;
    }
    .lb-toast.out { animation: out .18s ease forwards; }
    .lb-toast-icon {
      width: 20px;
      height: 20px;
      flex: none;
      margin-top: 1px;
      display: grid;
      place-items: center;
    }
    .lb-toast.saving .lb-toast-icon { color: #3498db; }
    .lb-toast.success .lb-toast-icon { color: #07bc0c; }
    .lb-toast.error .lb-toast-icon { color: #e74c3c; }
    .lb-toast.queued .lb-toast-icon { color: #f39c12; }
    .lb-toast-body { flex: 1; min-width: 0; }
    .lb-toast-body strong {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #2c2c2c;
      line-height: 1.3;
    }
    .lb-toast-body span {
      display: block;
      margin-top: 2px;
      font-size: 13px;
      line-height: 1.35;
      color: #6b6b6b;
    }
    .lb-toast-close {
      border: 0;
      background: transparent;
      color: #999;
      font-size: 18px;
      line-height: 1;
      padding: 0;
      width: 20px;
      height: 20px;
      cursor: pointer;
    }
    .lb-toast-close:hover { color: #555; }
    .lb-toast-bar {
      position: absolute;
      left: 0;
      bottom: 0;
      height: 3px;
      width: 100%;
      transform-origin: left;
      animation: bar linear forwards;
    }
    .lb-toast.success .lb-toast-bar { background: #07bc0c; }
    .lb-toast.error .lb-toast-bar { background: #e74c3c; }
    .lb-toast.queued .lb-toast-bar { background: #f39c12; }
    .spin {
      width: 16px;
      height: 16px;
      border: 2px solid #cfe8f8;
      border-top-color: #3498db;
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }
    @keyframes in {
      from { opacity: 0; transform: translateX(16px); }
      to { opacity: 1; transform: none; }
    }
    @keyframes out {
      to { opacity: 0; transform: translateX(16px); }
    }
    @keyframes bar {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  root.append(style, wrap);
  return wrap;
}

function icon(tone: PageToastTone) {
  if (tone === 'saving') return '<span class="spin"></span>';
  if (tone === 'success') {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>';
  }
  if (tone === 'queued') {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
