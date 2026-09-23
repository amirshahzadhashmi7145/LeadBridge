import { asString } from '@/platforms/dom';
import { cleanText } from '@/utils/text';

export interface EmbeddedJob {
  title: string;
  company: string;
  companyUrl: string;
  location: string;
  description: string;
  employmentType: string;
  datePosted: string;
  workplace: string;
}

export function extractEmbeddedJob(doc: Document, jobId: string): Partial<EmbeddedJob> {
  const found: Partial<EmbeddedJob> = {};
  const blobs = collectJsonBlobs(doc);

  walk(blobs, (obj) => {
    const haystack = [
      asString(obj.entityUrn),
      asString(obj.dashEntityUrn),
      asString(obj.jobPostingId),
      asString(obj.jobId),
      asString(obj.objectUrn),
    ].join(' ');
    const mentionsJob = jobId ? haystack.includes(jobId) : false;
    const looksLikePosting =
      mentionsJob ||
      hasAny(obj, ['jobPostingTitle', 'formattedLocation', 'workplaceTypes']) ||
      (hasAny(obj, ['title']) && hasAny(obj, ['description', 'descriptionText', 'formattedLocation']));

    if (!looksLikePosting) return;

    const title = asString(obj.title || obj.jobPostingTitle || obj.localizedTitle);
    const company = asString(
      obj.companyName ||
        obj.secondaryDescription ||
        nestedName(obj.companyDetails) ||
        nestedName(obj.company) ||
        nestedName(obj.hiringOrganization),
    );
    const companyUrl = asString(
      obj.companyUrl || nestedUrl(obj.companyDetails) || nestedUrl(obj.company),
    );
    const location = asString(
      obj.formattedLocation || obj.locationDescription || obj.jobLocation || nestedName(obj.jobLocation),
    );
    const description = asString(
      obj.descriptionText ||
        (typeof obj.description === 'object'
          ? (obj.description as { text?: string })?.text
          : obj.description),
    );
    const employmentType = asString(obj.formattedEmploymentStatus || obj.employmentType);
    const datePosted = asString(obj.listedAt || obj.originalListedAt || obj.createdAt || obj.datePosted);
    const workplace = asString(
      Array.isArray(obj.workplaceTypes) ? obj.workplaceTypes.join(', ') : obj.workplaceType,
    );

    if (title && !found.title) found.title = title;
    if (company && !found.company) found.company = company;
    if (companyUrl && !found.companyUrl) found.companyUrl = companyUrl;
    if (location && !found.location) found.location = location;
    if (description && description.length > (found.description?.length ?? 0)) {
      found.description = description;
    }
    if (employmentType && !found.employmentType) found.employmentType = employmentType;
    if (datePosted && !found.datePosted) found.datePosted = formatMaybeEpoch(datePosted);
    if (workplace && !found.workplace) found.workplace = workplace;
  });

  return found;
}

function collectJsonBlobs(doc: Document): unknown[] {
  const blobs: unknown[] = [];
  doc.querySelectorAll('code, script:not([src])').forEach((node) => {
    const text = node.textContent?.trim() ?? '';
    if (text.length < 40) return;
    const parsed = tryParseJson(text);
    if (parsed) blobs.push(parsed);
  });
  return blobs;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function walk(value: unknown, visit: (obj: Record<string, unknown>) => void) {
  const seen = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const obj = current as Record<string, unknown>;
    visit(obj);
    for (const child of Object.values(obj)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }
}

function hasAny(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => obj[key] != null && obj[key] !== '');
}

function nestedName(value: unknown): string {
  if (!value || typeof value !== 'object') return asString(value);
  const record = value as Record<string, unknown>;
  return asString(record.name || record.companyName || record.localizedName);
}

function nestedUrl(value: unknown): string {
  if (!value || typeof value !== 'object') return asString(value);
  const record = value as Record<string, unknown>;
  return asString(record.url || record.companyUrl || record.website);
}

function formatMaybeEpoch(value: string): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  return cleanText(value);
}
