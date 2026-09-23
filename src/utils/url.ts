export function safeUrl(value: string | undefined | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function absoluteUrl(href: string | null | undefined, base: string): string {
  if (!href) return '';
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function normalizeUrl(value: string | undefined | null): string {
  const url = safeUrl(value);
  if (!url) return (value ?? '').trim().replace(/\/+$/, '');

  url.hash = '';
  const keep = new URLSearchParams();
  for (const key of ['currentJobId', 'n_uid']) {
    const found = url.searchParams.get(key);
    if (found) keep.set(key, found);
  }
  url.search = keep.toString();
  url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
  url.protocol = 'https:';

  let href = url.toString();
  if (href.endsWith('/')) href = href.slice(0, -1);
  return href;
}

export function hostOf(value: string): string {
  return safeUrl(value)?.hostname.replace(/^www\./, '').toLowerCase() ?? '';
}

export function pathOf(value: string): string {
  return safeUrl(value)?.pathname ?? '';
}

export function searchParam(value: string, key: string): string {
  return safeUrl(value)?.searchParams.get(key) ?? '';
}
