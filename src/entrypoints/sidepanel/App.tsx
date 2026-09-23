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
import type { AppConfig, GoogleUser } from '@/storage/config';
import { DuplicateDialog } from '@/ui/DuplicateDialog';
import { FieldRow } from '@/ui/FieldRow';
import { StatusBanner } from '@/ui/StatusBanner';

type Banner = { tone: 'success' | 'error' | 'warn' | 'info'; text: string } | null;

export default function App() {
  const [page, setPage] = useState<PageState | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [lead, setLead] = useState<Lead | null>(null);
  const [status, setStatus] = useState<Lead['status']>('Lead captured');
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [setupWarning, setSetupWarning] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setBanner(null);
    setDuplicate(null);
    try {
      const session = await sendMessage<{ ok: true; user: GoogleUser | null }>({
        type: 'GET_SESSION',
      });
      setUser(session.user);
      const cfg = await sendMessage<{ ok: true; config: AppConfig }>({ type: 'GET_CONFIG' });
      const missing: string[] = [];
      if (!cfg.config.googleClientId.trim()) missing.push('OAuth Client ID');
      if (!cfg.config.spreadsheetId.trim()) missing.push('Google Sheet ID');
      setSetupWarning(
        missing.length
          ? `Settings still need: ${missing.join(' and ')}. Open Settings, save them, then sign in.`
          : '',
      );
      const state = await sendMessage<{ ok: true; page: PageState }>({ type: 'GET_PAGE_STATE' });
      setPage(state.page);
      if (state.page.status !== 'ready') {
        setExtraction(null);
        setLead(null);
        setFields([]);
        return;
      }
      const extracted = await sendMessage<{ ok: true; extraction: ExtractResponse }>({
        type: 'EXTRACT_LEAD',
      });
      applyExtraction(extracted.extraction);
    } catch (error) {
      setBanner({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not read this page.',
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const lastUrl = useRef('');

  useEffect(() => {
    const sync = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      if (!url || url === lastUrl.current) return;
      lastUrl.current = url;
      await load();
    };
    void sync();
    const onActivated = () => {
      void sync();
    };
    const onUpdated = (
      _id: number,
      info: { url?: string; status?: string },
      tab: { active?: boolean },
    ) => {
      if (tab.active && (info.url || info.status === 'complete')) void sync();
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
          ? { ...current, status: 'needs_selection', candidates: result.candidates, message: 'Multiple posts are visible. Choose one.' }
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

  async function selectPost(postId: string) {
    setBusy(true);
    try {
      await sendMessage({ type: 'HIGHLIGHT_POST', postId });
      const extracted = await sendMessage<{ ok: true; extraction: ExtractionResult }>({
        type: 'EXTRACT_LEAD',
        selectedPostId: postId,
      });
      applyExtraction(extracted.extraction);
      setPage((current) => (current ? { ...current, status: 'ready' } : current));
    } finally {
      setBusy(false);
    }
  }

  function updateField(key: string, value: string) {
    setFields((current) =>
      current.map((field) =>
        field.key === key
          ? { ...field, value, status: field.status === 'found' && field.value !== value ? 'edited' : field.status === 'missing' && value ? 'edited' : field.status }
          : field,
      ),
    );
    setLead((current) => {
      if (!current) return current;
      if (key.startsWith('platform:')) {
        const extraKey = key.slice('platform:'.length);
        return { ...current, platformFields: { ...current.platformFields, [extraKey]: value } };
      }
      return { ...current, [key]: value };
    });
  }

  const commonFields = useMemo(() => fields.filter((field) => !field.platformSpecific), [fields]);
  const extraFields = useMemo(() => fields.filter((field) => field.platformSpecific), [fields]);

  async function signIn() {
    setBusy(true);
    try {
      const response = await sendMessage<{ ok: boolean; user?: GoogleUser; error?: string }>({
        type: 'GOOGLE_SIGN_IN',
      });
      if (!response.ok || !response.user) {
        setBanner({ tone: 'error', text: response.error || 'Google sign-in failed.' });
        return;
      }
      setUser(response.user);
      setBanner({ tone: 'success', text: `Signed in as ${response.user.name}` });
    } catch (error) {
      setBanner({ tone: 'error', text: error instanceof Error ? error.message : 'Google sign-in failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function persist(action: 'create' | 'update' | 'force-create', existingRow?: number) {
    if (!lead) return;
    setBusy(true);
    setDuplicate(null);
    try {
      const payload: Lead = { ...lead, status, notes: lead.notes };
      const response = await sendMessage<{
        ok: boolean;
        save?: { action: string; rowNumber: number };
        error?: string;
        keepDraft?: boolean;
        duplicate?: DuplicateMatch;
      }>({
        type: 'SAVE_LEAD',
        lead: payload,
        action,
        existingRow,
      });
      if (!response.ok) {
        if (response.duplicate) {
          setDuplicate(response.duplicate);
          setBanner({ tone: 'error', text: response.error || 'This lead already exists.' });
          return;
        }
        setBanner({
          tone: 'error',
          text: response.keepDraft
            ? `${response.error} Your lead was saved as a local draft so it is not lost.`
            : response.error || 'Save failed.',
        });
        return;
      }
      await sendMessage({ type: 'CLEAR_HIGHLIGHTS' });
      setBanner({
        tone: 'success',
        text:
          response.save?.action === 'updated'
            ? `Lead updated in Google Sheets (row ${response.save.rowNumber}).`
            : `Lead captured in Google Sheets (row ${response.save?.rowNumber ?? ''}).`,
      });
    } finally {
      setBusy(false);
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
        {setupWarning ? <StatusBanner tone="warn">{setupWarning}</StatusBanner> : null}
        {banner ? <StatusBanner tone={banner.tone}>{banner.text}</StatusBanner> : null}

        {!page || busy && !lead ? <div className="card muted">Reading the current page…</div> : null}

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
            <h2>Multiple posts are visible</h2>
            <p className="muted">Click the post you want to capture. That is the only extra step.</p>
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
        {!user ? (
          <button className="secondary" disabled={busy} onClick={() => void signIn()}>
            Sign in with Google
          </button>
        ) : null}
        <button className="secondary" disabled={busy} onClick={() => void load()}>
          Re-extract this page
        </button>
        <button
          className="primary"
          disabled={busy || !lead || page?.status !== 'ready'}
          onClick={() => void persist('create')}
        >
          {busy ? 'Working…' : 'Save / Capture'}
        </button>
        <button className="ghost" onClick={() => void browser.runtime.openOptionsPage()}>
          Open settings
        </button>
      </div>

      {duplicate ? (
        <DuplicateDialog
          match={duplicate}
          onCancel={() => setDuplicate(null)}
          onUpdate={() => void persist('update', duplicate.rowNumber)}
          onCreate={() => void persist('force-create')}
        />
      ) : null}
    </div>
  );
}
