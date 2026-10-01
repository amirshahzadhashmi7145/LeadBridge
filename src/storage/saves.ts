const SAVES_KEY = 'leadbridge.saveJobs';

export interface SaveJobRecord {
  jobId: string;
  title: string;
  sourceUrl?: string;
  status: 'saving' | 'success' | 'error' | 'duplicate' | 'queued';
  detail: string;
  at: number;
}

export async function trackSaveJob(job: SaveJobRecord): Promise<void> {
  const jobs = await listSaveJobs();
  const next = [job, ...jobs.filter((item) => item.jobId !== job.jobId)].slice(0, 20);
  await Promise.all([
    browser.storage.session.set({ [SAVES_KEY]: next }).catch(() => undefined),
    browser.storage.local.set({ [SAVES_KEY]: next }),
  ]);
}

export async function listSaveJobs(): Promise<SaveJobRecord[]> {
  const session = await browser.storage.session.get(SAVES_KEY).catch(() => ({}));
  const local = await browser.storage.local.get(SAVES_KEY).catch(() => ({}));
  return (
    ((session as Record<string, SaveJobRecord[] | undefined>)[SAVES_KEY] ??
      (local as Record<string, SaveJobRecord[] | undefined>)[SAVES_KEY] ??
      []) as SaveJobRecord[]
  );
}
