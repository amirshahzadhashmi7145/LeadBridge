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
  const [banner, setBanner] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
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

  return (
    <div className="wrap">
      <header className="header page-header">
        <div className="brand">
          <img src="/icon-32.png" alt="" />
          LeadBridge settings
        </div>
        <span className="badge">{user?.email || 'Ready'}</span>
      </header>

      {banner ? <StatusBanner tone="success">{banner}</StatusBanner> : null}
      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

      <div className="grid">
        <section className="card">
          <h2>Team sheet</h2>
          <p className="muted">
            Saves go to the shared LeadBridge sheet through the team Google script. Nobody signs in
            or pastes a sheet ID. Capture from LinkedIn, Upwork, or Wellfound and hit Save.
          </p>
          {user ? <p className="muted">Chrome profile: {user.email || user.name}</p> : null}
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
            <p className="muted">Failed captures wait here and retry automatically when you are back online.</p>
          ) : (
            drafts.map((draft) => (
              <div key={draft.id} className="field">
                <strong>{draft.lead.jobTitle || draft.lead.leadName || draft.lead.sourceUrl}</strong>
                <div className="muted">
                  {draft.autoRetry === false
                    ? draft.reason
                    : `${draft.reason}${draft.attempts ? ` · tried ${draft.attempts} time${draft.attempts === 1 ? '' : 's'}` : ''}`}
                </div>
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
