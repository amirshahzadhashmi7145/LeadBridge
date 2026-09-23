import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/client';
import { allAdapters } from '@/platforms/registry';
import type { AppConfig, GoogleUser, PendingDraft } from '@/storage/config';
import { defaultConfig } from '@/storage/config';
import type { LogEntry } from '@/utils/logger';
import { StatusBanner } from '@/ui/StatusBanner';

export default function OptionsApp() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig());
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [drafts, setDrafts] = useState<PendingDraft[]>([]);
  const [redirectUrl, setRedirectUrl] = useState('');
  const [extensionId, setExtensionId] = useState('');
  const [banner, setBanner] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    const chromeApi = (
      globalThis as typeof globalThis & {
        chrome?: { identity?: { getRedirectURL?: () => string }; runtime?: { id?: string } };
      }
    ).chrome;
    setRedirectUrl(chromeApi?.identity?.getRedirectURL?.() || browser.identity.getRedirectURL());
    setExtensionId(browser.runtime.id);
    void reload();
  }, []);

  async function reload() {
    const [cfg, session, logList, draftList] = await Promise.all([
      sendMessage<{ ok: true; config: AppConfig }>({ type: 'GET_CONFIG' }),
      sendMessage<{ ok: true; user: GoogleUser | null }>({ type: 'GET_SESSION' }),
      sendMessage<{ ok: true; logs: LogEntry[] }>({ type: 'GET_LOGS' }),
      sendMessage<{ ok: true; drafts: PendingDraft[] }>({ type: 'GET_DRAFTS' }),
    ]);
    setConfig(cfg.config);
    setUser(session.user);
    setLogs(logList.logs);
    setDrafts(draftList.drafts);
  }

  async function persist() {
    setError('');
    const saved = await sendMessage<{ ok: true; config: AppConfig }>({
      type: 'SAVE_CONFIG',
      config,
    });
    setConfig(saved.config);
    setBanner('Settings saved.');
  }

  async function signIn() {
    try {
      if (config.googleClientId.trim()) {
        await persist();
      }
      const response = await sendMessage<{ ok: boolean; user?: GoogleUser; error?: string }>({
        type: 'GOOGLE_SIGN_IN',
      });
      if (!response.ok || !response.user) {
        setError(response.error || 'Sign-in failed.');
        return;
      }
      setUser(response.user);
      setBanner(`Signed in as ${response.user.name} (${response.user.email})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setBanner('Copied.');
  }

  return (
    <div className="wrap">
      <header className="header page-header">
        <div className="brand">
          <img src="/icon-32.png" alt="" />
          LeadBridge settings
        </div>
        <span className="badge">{user ? user.email : 'Not signed in'}</span>
      </header>

      {banner ? <StatusBanner tone="success">{banner}</StatusBanner> : null}
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

      <div className="grid">
        <section className="card">
          <h2>Google account</h2>
          <p className="muted">
            Team members sign in with the company Google account that already has access to the
            shared lead sheet. LeadBridge never stores Google passwords.
          </p>
          <div className="row">
            <button className="primary" onClick={() => void signIn()}>
              {user ? 'Switch account' : 'Sign in with Google'}
            </button>
            {user ? (
              <button
                className="secondary"
                onClick={async () => {
                  await sendMessage({ type: 'GOOGLE_SIGN_OUT' });
                  setUser(null);
                }}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </section>

        <section className="card">
          <h2>Destination Google Sheet</h2>
          <div className="field">
            <label htmlFor="spreadsheetId">Spreadsheet ID</label>
            <input
              id="spreadsheetId"
              value={config.spreadsheetId}
              placeholder="From the sheet URL: docs.google.com/spreadsheets/d/THIS_PART/edit"
              onChange={(event) => setConfig({ ...config, spreadsheetId: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="sheetName">Tab name</label>
            <input
              id="sheetName"
              value={config.sheetName}
              onChange={(event) => setConfig({ ...config, sheetName: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="clientId">OAuth client ID (Web application)</label>
            <input
              id="clientId"
              value={config.googleClientId}
              placeholder="123456789-xxxx.apps.googleusercontent.com"
              onChange={(event) => setConfig({ ...config, googleClientId: event.target.value })}
            />
          </div>
          <p className="banner warn">
            Keep only <strong>one</strong> LeadBridge installed. Two copies have two IDs, and Google
            will block sign-in. This copy&apos;s ID is <code>{extensionId}</code>.
          </p>
          <ol className="muted setup-steps">
            <li>
              Open the <strong>same</strong> Web application OAuth client you already created.
            </li>
            <li>
              Under <strong>Authorized redirect URIs</strong> add both URLs below, then Save. Wait 1–2
              minutes.
            </li>
          </ol>
          <div className="copy-row">
            <code>{redirectUrl || 'Reload the extension to see this URL.'}</code>
            <button className="secondary" type="button" onClick={() => void copy(redirectUrl)}>
              Copy
            </button>
          </div>
          <div className="copy-row">
            <code>{redirectUrl.replace(/\/$/, '')}</code>
            <button
              className="secondary"
              type="button"
              onClick={() => void copy(redirectUrl.replace(/\/$/, ''))}
            >
              Copy
            </button>
          </div>
          <p className="muted">
            Extension ID: <code>{extensionId}</code>. After saving the client, paste the Client ID
            above, click <strong>Save settings</strong>, then Sign in.
          </p>
        </section>

        <section className="card">
          <h2>Platforms</h2>
          <div className="platforms">
            {allAdapters().map((adapter) => (
              <label key={adapter.id}>
                <input
                  type="checkbox"
                  checked={config.enabledPlatforms.includes(adapter.id)}
                  onChange={(event) => {
                    const enabled = event.target.checked
                      ? [...config.enabledPlatforms, adapter.id]
                      : config.enabledPlatforms.filter((id) => id !== adapter.id);
                    setConfig({ ...config, enabledPlatforms: enabled });
                  }}
                />
                {adapter.sourceName}
                {!adapter.enabledByDefault ? ' (starter adapter)' : ''}
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Column mapping</h2>
          <p className="muted">
            Map LeadBridge fields to the first-row headers in your sheet. Workflow status stays a
            normal column so existing sales stages keep working.
          </p>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Sheet header</th>
              </tr>
            </thead>
            <tbody>
              {config.columnMap.map((item, index) => (
                <tr key={`${item.field}-${index}`}>
                  <td>{item.field}</td>
                  <td>
                    <input
                      value={item.header}
                      onChange={(event) => {
                        const columnMap = config.columnMap.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, header: event.target.value } : row,
                        );
                        setConfig({ ...config, columnMap });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <div className="spread">
            <h2>Unsaved drafts</h2>
            <span className="muted">{drafts.length} stored</span>
          </div>
          {drafts.length === 0 ? (
            <p className="muted">If Google Sheets is down, failed captures are kept here.</p>
          ) : (
            drafts.map((draft) => (
              <div key={draft.id} className="field">
                <strong>{draft.lead.jobTitle || draft.lead.leadName || draft.lead.sourceUrl}</strong>
                <div className="muted">{draft.reason}</div>
                <div className="row">
                  <button
                    className="secondary"
                    onClick={async () => {
                      const result = await sendMessage<{ ok: boolean; error?: string }>({
                        type: 'RETRY_DRAFT',
                        draftId: draft.id,
                      });
                      if (!result.ok) setError(result.error || 'Retry failed.');
                      else setBanner('Draft saved to the sheet.');
                      await reload();
                    }}
                  >
                    Retry save
                  </button>
                  <button
                    className="ghost"
                    onClick={async () => {
                      await sendMessage({ type: 'DISCARD_DRAFT', draftId: draft.id });
                      await reload();
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <div className="spread">
            <h2>Debug log</h2>
            <button
              className="ghost"
              onClick={async () => {
                await sendMessage({ type: 'CLEAR_LOGS' });
                setLogs([]);
              }}
            >
              Clear
            </button>
          </div>
          <div className="log">
            {logs.length === 0 ? 'No log entries yet.' : null}
            {logs.map((entry, index) => (
              <div key={`${entry.at}-${index}`} className={entry.level}>
                [{entry.at}] {entry.level.toUpperCase()} {entry.scope}: {entry.message}
                {entry.detail ? ` — ${entry.detail}` : ''}
              </div>
            ))}
          </div>
        </section>

        <button className="primary" onClick={() => void persist()}>
          Save settings
        </button>
      </div>
    </div>
  );
}
