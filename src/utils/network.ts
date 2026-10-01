export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function isNetworkError(error: unknown): boolean {
  if (!isOnline()) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|networkerror|network request failed|load failed|internet|offline|err_internet|err_network|err_name_not_resolved|err_connection|err_timed_out|timed? ?out|temporarily unavailable|502|503|504|net::/i.test(
    message,
  );
}

export const OFFLINE_QUEUE_MESSAGE =
  "You're offline. This lead is saved on this device and will upload when the network is back.";
