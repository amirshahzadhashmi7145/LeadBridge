import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendMessage } from '@/messaging/client';
import type { PageState } from '@/messaging/types';
import {
  LEAD_STATUSES,
  type ExtractResponse,
  type ExtractionResult,
  type FieldMeta,
  type Lead,
} from '@/schema/lead';
import type { DuplicateMatch } from '@/sheets/types';
import type { SaveJobRecord } from '@/storage/saves';
import type { ExtensionMessage } from '@/messaging/types';
import type { GoogleUser } from '@/storage/config';
import { DuplicateDialog } from '@/ui/DuplicateDialog';
import { FieldRow } from '@/ui/FieldRow';
import { StatusBanner } from '@/ui/StatusBanner';
import { absoluteDateValue } from '@/utils/date';

type Banner = { tone: 'success' | 'error' | 'warn' | 'info'; text: string } | null;

export default function App() {
  const [page, setPage] = useState<PageState | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [status, setStatus] = useState<Lead['status']>('Lead captured');
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);

  const load = useCallback(async () => {
    setExtracting(true);
    setDuplicate(null);
    try {
      const session = await sendMessage<{ ok: true; user: GoogleUser | null }>({
        type: 'GET_SESSION',
      });
      setUser(session.user);
      const state = await sendMessage<{ ok: true; page: PageState }>({ type: 'GET_PAGE_STATE' });
      setPage(state.page);
      if (state.page.status !== 'ready') {
        setExtraction(null);
        setLead(null);
        setFields([]);
        return;
      }
      let extracted = await sendMessage<{ ok: true; extraction: ExtractResponse }>({
        type: 'EXTRACT_LEAD',
      });
      if (shouldRetryExtract(extracted.extraction)) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        extracted = await sendMessage<{ ok: true; extraction: ExtractResponse }>({
          type: 'EXTRACT_LEAD',
        });
      }
      applyExtraction(extracted.extraction);
    } catch (error) {
      setBanner({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not read this page.',
      });
    } finally {
      setExtracting(false);
      await restoreSaveBanner(setBanner);
    }
  }, []);

  const lastKey = useRef('');

  useEffect(() => {
    const onResult = (message: ExtensionMessage) => {
      if (message.type !== 'SAVE_RESULT') return;
      if (message.ok) {
        setDuplicate(null);
        setBanner({
          tone: 'success',
          text: message.save?.rowNumber
            ? `${message.save.action === 'updated' ? 'Updated' : 'Saved'} row ${message.save.rowNumber}.`
            : 'Saved to Google Sheets.',
        });
        void sendMessage({ type: 'CLEAR_HIGHLIGHTS' });
        return;
      }
      if (message.duplicate) {
        setDuplicate(message.duplicate);
        setBanner({ tone: 'info', text: 'This lead already exists.' });
        return;
      }
      if (message.queuedOffline) {
        setBanner({
          tone: 'info',
          text: message.error || "You're offline. Saved on this device — will upload when the network is back.",
        });
        return;
      }
      setBanner({
        tone: 'error',
        text: message.keepDraft
          ? `${message.error || 'Could not save.'} Kept as a local draft.`
          : message.error || 'Could not save this lead.',
      });
    };
    browser.runtime.onMessage.addListener(onResult);
    return () => browser.runtime.onMessage.removeListener(onResult);
  }, []);

  useEffect(() => {
    if (banner?.text !== 'Saving to Google Sheets…') return;
    const timer = window.setInterval(() => {
      void restoreSaveBanner(setBanner);
    }, 800);
    return () => window.clearInterval(timer);
  }, [banner?.text]);

  useEffect(() => {
    const pageKey = (url: string) => {
      try {
        const parsed = new URL(url);
        return (
          parsed.searchParams.get('currentJobId') ||
          parsed.pathname + parsed.search
        );
      } catch {
        return url;
      }
    };
    const sync = async (force = false) => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      const key = pageKey(url);
      if (!url || (!force && key === lastKey.current)) return;
      lastKey.current = key;
      await load();
    };
    void sync(true);
    const onActivated = () => {
      lastKey.current = '';
      void sync(true);
    };
    const onUpdated = (
      _id: number,
      info: { url?: string; status?: string },
      tab: { active?: boolean },
    ) => {
      if (!tab.active) return;
      if (info.url) void sync(true);
      else if (info.status === 'complete') void sync();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [load]);

  function applyExtraction(result: ExtractResponse) {
    if (!result || result.ok === false) {
      setExtraction(null);
      setLead(null);
      setFields([]);
      if (result.candidates?.length) {
        setPage((current) =>
          current
            ? {
                ...current,
                status: 'needs_selection',
                candidates: result.candidates,
                message: result.message,
              }
            : current,
        );
        return;
      }
      setBanner({ tone: 'warn', text: result.message || 'Nothing could be extracted from this page.' });
      return;
    }

    if (result.candidates && result.candidates.length > 1 && !result.lead.postContent) {
      setExtraction(result);
      setLead(result.lead);
      setFields(result.fields);
      setPage((current) =>
        current
          ? { ...current, status: 'needs_selection', candidates: result.candidates, message: 'Multiple jobs are visible. Choose one.' }
          : current,
      );
      void sendMessage({ type: 'HIGHLIGHT_POSTS' });
      return;
    }

    setExtraction(result);
    setLead(result.lead);
    setFields(result.fields);
    setStatus(result.lead.status);
    if (result.missingFields.length) {
      setBanner({
        tone: 'info',
        text: `Captured ${result.foundFields.length} fields. ${result.missingFields.length} were not found and can be filled in.`,
      });
    } else {
      setBanner({ tone: 'success', text: 'All expected fields were extracted. Review them before saving.' });
    }
  }

  function shouldRetryExtract(result: ExtractResponse): boolean {
    if (!result || result.ok === false) return result?.pageType === 'job';
    if (result.sourceName !== 'LinkedIn' || result.pageType !== 'job') return false;
    const extras = result.lead.platformFields;
    return (
      !result.lead.location ||
      !extras.employmentType ||
      !extras.workplaceType ||
      !extras.companySize ||
      result.missingFields.length > 4
    );
  }

  async function selectPost(postId: string) {
    setExtracting(true);
    try {
      await sendMessage({ type: 'HIGHLIGHT_POST', postId });
      const extracted = await sendMessage<{ ok: true; extraction: ExtractionResult }>({
        type: 'EXTRACT_LEAD',
        selectedPostId: postId,
      });
      applyExtraction(extracted.extraction);
      setPage((current) => (current ? { ...current, status: 'ready' } : current));
    } finally {
      setExtracting(false);
    }
  }

  function updateField(key: string, value: string) {
    const extraKey = key.startsWith('platform:') ? key.slice('platform:'.length) : key;
    const nextValue = absoluteDateValue(extraKey, value);
    setFields((current) =>
      current.map((field) =>
        field.key === key
          ? {
              ...field,
              value: nextValue,
              status:
                field.status === 'found' && field.value !== nextValue
                  ? 'edited'
                  : field.status === 'missing' && nextValue
                    ? 'edited'
                    : field.status,
            }
          : field,
      ),
    );
    setLead((current) => {
      if (!current) return current;
      if (key.startsWith('platform:')) {
        return { ...current, platformFields: { ...current.platformFields, [extraKey]: nextValue } };
      }
      return { ...current, [key]: nextValue };
    });
  }

  const commonFields = useMemo(() => fields.filter((field) => !field.platformSpecific), [fields]);
  const extraFields = useMemo(() => fields.filter((field) => field.platformSpecific), [fields]);

  async function persist(action: 'create' | 'update' | 'force-create', existingRow?: number) {
    if (!lead) return;
    const payload: Lead = {
      ...lead,
      status,
      notes: lead.notes,
      platformFields: { ...lead.platformFields },
    };
    setBanner({ tone: 'info', text: 'Saving to Google Sheets…' });
    setDuplicate(null);
    try {
      const response = await sendMessage<{
        ok: boolean;
        queued?: boolean;
        jobId?: string;
        duplicate?: DuplicateMatch;
        error?: string;
      }>({
        type: 'SAVE_LEAD',
        lead: payload,
        action,
        existingRow,
      });
      if (!response.ok && !response.queued) {
        if (response.duplicate) {
          setDuplicate(response.duplicate);
          setBanner({ tone: 'info', text: 'This lead already exists.' });
        } else {
          setBanner({
            tone: 'error',
            text: response.error || 'Could not save this lead.',
          });
        }
      }
    } catch (error) {
      setBanner({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not save this lead.',
      });
    }
  }

  const candidates = page?.candidates ?? extraction?.candidates ?? [];

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/icon-32.png" alt="" />
          LeadBridge
        </div>
        <div className="row">
          {page?.sourceName ? <span className="badge">{page.sourceName}</span> : null}
          {user ? <span className="user-chip">{user.name}</span> : null}
        </div>
      </header>

      <main className="page">
        {banner ? <StatusBanner tone={banner.tone}>{banner.text}</StatusBanner> : null}

        {!page || (extracting && !lead) ? (
          <div className="card muted">Waiting for the page to finish loading…</div>
        ) : null}

        {page && page.status === 'unknown_platform' ? (
          <div className="card empty">
            <h1>Unsupported site</h1>
            <p className="muted">{page.message}</p>
          </div>
        ) : null}

        {page && page.status === 'unsupported_page' ? (
          <div className="card empty">
            <h1>Unsupported {page.sourceName} page</h1>
            <p className="muted">{page.message}</p>
          </div>
        ) : null}

        {page && page.status === 'needs_refresh' ? (
          <div className="card empty">
            <h1>Refresh required</h1>
            <p className="muted">{page.message}</p>
          </div>
        ) : null}

        {page && page.status === 'needs_selection' ? (
          <div className="card">
            <h2>Multiple items are visible</h2>
            <p className="muted">Click the one you want to capture. That is the only extra step.</p>
            {candidates.map((candidate, index) => (
              <button
                key={candidate.id || index}
                className="candidate"
                onClick={() => void selectPost(candidate.id)}
              >
                <strong>{index + 1}. {candidate.author || 'Unknown author'}</strong>
                <div className="muted">{candidate.snippet || 'No text found'}</div>
              </button>
            ))}
          </div>
        ) : null}

        {lead && page?.status === 'ready' ? (
          <>
            <div className="card">
              <div className="spread">
                <div>
                  <h2>{lead.jobTitle || lead.leadName || 'Review lead'}</h2>
                  <div className="muted">
                    {extraction?.sourceName} · {extraction?.pageType}
                  </div>
                </div>
              </div>
              <div className="stats">
                <span>{extraction?.foundFields.length ?? 0} found</span>
                <span>{extraction?.missingFields.length ?? 0} missing</span>
              </div>
            </div>

            <div className="card">
              {commonFields.map((field) => (
                <FieldRow key={field.key} field={field} onChange={updateField} />
              ))}
              <div className="field">
                <label htmlFor="status">Current status</label>
                <select
                  id="status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as Lead['status'])}
                >
                  {LEAD_STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              {extraFields.length ? (
                <details className="more">
                  <summary>Platform-specific fields</summary>
                  {extraFields.map((field) => (
                    <FieldRow key={field.key} field={field} onChange={updateField} />
                  ))}
                </details>
              ) : null}
            </div>
          </>
        ) : null}
      </main>

      <div className="actions">
        <button className="secondary" disabled={extracting} onClick={() => void load()}>
          {extracting ? 'Extracting…' : 'Re-extract this page'}
        </button>
        <button
          className="primary"
          disabled={!lead || page?.status !== 'ready'}
          onClick={() => void persist('create')}
        >
          Save / Capture
        </button>
        <button className="ghost" onClick={() => void browser.runtime.openOptionsPage()}>
          Open settings
        </button>
      </div>

      {duplicate ? (
        <DuplicateDialog match={duplicate} onCancel={() => setDuplicate(null)} />
      ) : null}
    </div>
  );
}

async function restoreSaveBanner(setBanner: (banner: Banner) => void) {
  try {
    const response = await sendMessage<{ ok: true; jobs: SaveJobRecord[] }>({ type: 'GET_SAVE_JOBS' });
    const job = response.jobs[0];
    if (!job || Date.now() - job.at > 3 * 60_000) return;
    if (job.status === 'saving') {
      setBanner({ tone: 'info', text: 'Saving to Google Sheets…' });
      return;
    }
    if (job.status === 'success') {
      setBanner({ tone: 'success', text: job.detail });
      return;
    }
    if (job.status === 'queued') {
      setBanner({ tone: 'info', text: job.detail });
      return;
    }
    if (job.status === 'duplicate') {
      setBanner({ tone: 'info', text: 'This lead already exists.' });
      return;
    }
    if (job.status === 'error') {
      setBanner({ tone: 'error', text: job.detail });
    }
  } catch {
    // Keep the current banner if the background page is waking up.
  }
}
