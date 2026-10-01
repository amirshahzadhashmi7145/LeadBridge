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
  for (const key of ['currentJobId', 'n_uid', 'job_listing_slug']) {
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

export function extractPlatformKey(value: string | undefined | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const current = raw.match(/[?&]currentJobId=(\d+)/i);
  if (current?.[1]) return current[1];
  const view = raw.match(/\/jobs\/view\/(\d+)/);
  if (view?.[1]) return view[1];
  const liJobSlug = raw.match(/linkedin\.com\/jobs\/[^/?#]*-(\d+)(?:[/?#]|$)/i);
  if (liJobSlug?.[1]) return liJobSlug[1];
  const activity = raw.match(/urn:li:activity:(\d+)/i);
  if (activity?.[1]) return activity[1];
  const company = raw.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (company?.[1]) return company[1].replace(/\/$/, '');
  const upwork = raw.match(/~([A-Za-z0-9]{8,})/);
  if (upwork?.[1]) return `~${upwork[1]}`;
  const wellfound = raw.match(/(?:wellfound\.com|angel\.co)\/(?:jobs|l|company)\/([^/?#]+)/i);
  if (wellfound?.[1]) return decodeURIComponent(wellfound[1]);
  if (/^\d{6,}$/.test(raw)) return raw;
  if (/^~[A-Za-z0-9]{8,}$/.test(raw)) return raw;
  return '';
}
