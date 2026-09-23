export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  at: string;
  level: LogLevel;
  scope: string;
  message: string;
  detail?: string;
}

const STORAGE_KEY = 'leadbridge.logs';
const MAX_LOGS = 200;

async function readLogs(): Promise<LogEntry[]> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as LogEntry[] | undefined) ?? [];
}

async function writeLog(entry: LogEntry): Promise<void> {
  const logs = await readLogs();
  logs.unshift(entry);
  await browser.storage.local.set({ [STORAGE_KEY]: logs.slice(0, MAX_LOGS) });
}

function serialize(detail: unknown): string | undefined {
  if (detail == null) return undefined;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export const logger = {
  async write(level: LogLevel, scope: string, message: string, detail?: unknown) {
    const entry: LogEntry = {
      at: new Date().toISOString(),
      level,
      scope,
      message,
      detail: serialize(detail),
    };
    if (level === 'error' || level === 'warn') {
      console[level](`[LeadBridge:${scope}] ${message}`, detail ?? '');
    } else {
      console.log(`[LeadBridge:${scope}] ${message}`, detail ?? '');
    }
    try {
      await writeLog(entry);
    } catch {
      // Logging must never break capture.
    }
  },
  debug(scope: string, message: string, detail?: unknown) {
    return this.write('debug', scope, message, detail);
  },
  info(scope: string, message: string, detail?: unknown) {
    return this.write('info', scope, message, detail);
  },
  warn(scope: string, message: string, detail?: unknown) {
    return this.write('warn', scope, message, detail);
  },
  error(scope: string, message: string, detail?: unknown) {
    return this.write('error', scope, message, detail);
  },
  list: readLogs,
  async clear() {
    await browser.storage.local.remove(STORAGE_KEY);
  },
};
