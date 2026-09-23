import { cleanText, uniqueJoin } from '@/utils/text';

export interface VisibleJobMeta {
  location: string;
  posted: string;
  workplace: string;
  employmentType: string;
  applicants: string;
  applicantsPastDay: string;
  applicantTotal: string;
  seniorityMix: string;
  educationMix: string;
  companyIndustry: string;
  companySize: string;
  companyWebsite: string;
  companyFollowers: string;
  linkedInHeadcount: string;
  hiringTrend: string;
  employeeTenure: string;
  offLinkedIn: string;
}

const EMPTY: VisibleJobMeta = {
  location: '',
  posted: '',
  workplace: '',
  employmentType: '',
  applicants: '',
  applicantsPastDay: '',
  applicantTotal: '',
  seniorityMix: '',
  educationMix: '',
  companyIndustry: '',
  companySize: '',
  companyWebsite: '',
  companyFollowers: '',
  linkedInHeadcount: '',
  hiringTrend: '',
  employeeTenure: '',
  offLinkedIn: '',
};

export function parseVisibleJobMeta(
  doc: Document,
  pane: ParentNode | null,
  title = '',
): VisibleJobMeta {
  const { headerText, extrasText } = jobWindow(doc, pane, title);
  return parseJobMetaWindows(headerText, extrasText, title);
}

export function parseJobMetaWindows(
  headerText: string,
  extrasText: string,
  title = '',
): VisibleJobMeta {
  const text = `${headerText}\n${extrasText}`;
  if (!text.trim()) return { ...EMPTY };

  const headerLines = splitLines(headerText);
  const extraLines = splitLines(extrasText);
  const lines = [...headerLines, ...extraLines];
  const header = parseHeaderLines(headerLines, title);
  const joined = text;

  const about = joined.match(
    /([A-Za-z][A-Za-z /&-]{2,60}?)\s*[•·|]\s*(\d[\d,]*\s*-\s*\d[\d,]*|\d[\d,]+\+?)\s*employees(?:\s*[•·|]\s*(\d[\d,]*)\s+on LinkedIn)?/i,
  );

  return {
    location: header.location || countryOrCity(headerText),
    posted: header.posted || timeAgo(headerText),
    workplace: header.workplace || lineMatch(lines, /^(Remote|Hybrid|On-?site)$/i),
    employmentType:
      header.employmentType || lineMatch(lines, /^(Full-?time|Part-?time|Contract|Internship)$/i),
    applicants: header.applicants,
    applicantsPastDay: pick(joined, /(\d[\d,]*)\s+in the past day/i),
    applicantTotal:
      pick(joined, /(\d[\d,]*)\s+total applicants/i) ||
      pick(joined, /(\d[\d,]*)\s+total\b(?!\s*employees)/i),
    seniorityMix: stripViewerHints(
      collectPercents(lines, /candidate|seniority|entry level|cxo|director/i),
    ),
    educationMix: stripViewerHints(
      collectPercents(lines, /degree|bachelor|master|education/i),
    ),
    companyIndustry: cleanText(about?.[1] || ''),
    companySize: about?.[2]
      ? `${cleanText(about[2])} employees`
      : pick(joined, /(\d[\d,]*\s*-\s*\d[\d,]*|\d[\d,]+\+?)\s*employees/i),
    companyWebsite: companyWebsite(joined),
    companyFollowers: pick(joined, /([\d,]+)\s+followers/i),
    linkedInHeadcount: about?.[3]
      ? `${about[3]} on LinkedIn`
      : pick(joined, /(\d[\d,]*)\s+on LinkedIn/i),
    hiringTrend: formatHiringTrend(joined),
    employeeTenure: pick(joined, /Median employee tenure:\s*([^\n]+)/i),
    offLinkedIn: /responses managed off linkedin/i.test(joined)
      ? 'Responses managed off LinkedIn'
      : '',
  };
}

function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function jobWindow(
  doc: Document,
  pane: ParentNode | null,
  title: string,
): { headerText: string; extrasText: string } {
  const body = rawText(doc.body);
  const paneText = pane && pane !== doc ? rawText(pane as Element) : '';
  // Always prefer the full page around LinkedIn landmarks. The detail "pane"
  // is often just the description box, which has no header or company insights.
  const headerText =
    sliceBefore(body, /about the job/i, 1200) ||
    sliceBefore(paneText, /about the job/i, 1200) ||
    sliceAround(paneText, title, 800) ||
    sliceAround(body, title, 800);
  const extrasText =
    sliceFrom(body, /about the company/i, 4000) ||
    sliceFrom(paneText, /about the company/i, 4000) ||
    sliceFrom(body, /about the job/i, 5500) ||
    sliceFrom(paneText, /about the job/i, 5500);
  return { headerText, extrasText };
}

function sliceBefore(text: string, landmark: RegExp, chars: number): string {
  const at = text.search(landmark);
  if (at < 0) return '';
  return text.slice(Math.max(0, at - chars), at);
}

function sliceFrom(text: string, landmark: RegExp, chars: number): string {
  const at = text.search(landmark);
  if (at < 0) return '';
  return text.slice(at, at + chars);
}

function sliceAround(text: string, title: string, chars: number): string {
  if (!title || !text) return '';
  const at = text.indexOf(title);
  if (at < 0) return '';
  return text.slice(at, at + chars);
}

function rawText(el: Element | null): string {
  if (!el) return '';
  if ('innerText' in el && typeof el.innerText === 'string' && el.innerText.trim()) {
    return el.innerText;
  }
  return el.textContent || '';
}

const TIME_AGO =
  /(?:just now|today|(?:re)?posted\s+)?\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago/i;

function parseHeaderLines(lines: string[], title = '') {
  let location = '';
  let comboPosted = '';
  let linePosted = '';
  let applicants = '';
  let workplace = '';
  let employmentType = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const combo = line.match(
      /^(.*?)\s*[·•|]\s*((?:(?:re)?posted\s+)?(?:\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago|just now|today))\s*[·•|]\s*(.+)$/i,
    );
    if (combo) {
      location = location || cleanLocation(combo[1] || '');
      comboPosted = comboPosted || cleanPosted(combo[2] || '');
      applicants = applicants || cleanText(combo[3] || '');
      continue;
    }
    if (TIME_AGO.test(line) && line.length < 40) {
      linePosted = linePosted || cleanPosted(line);
      const prev = lines[i - 1] || '';
      const next = lines[i + 1] || '';
      if (!location && prev.toLowerCase() !== title.toLowerCase()) {
        location = cleanLocation(prev);
      }
      if (!applicants && /clicked apply|applicant/i.test(next)) applicants = next;
    }
    if (!workplace && /^(Remote|Hybrid|On-?site|On site)$/i.test(line)) workplace = normalizeWorkplace(line);
    if (!employmentType && /^(Full-?time|Part-?time|Contract|Internship)$/i.test(line)) {
      employmentType = normalizeEmployment(line);
    }
  }

  return {
    location,
    posted: comboPosted || linePosted,
    applicants,
    workplace,
    employmentType,
  };
}

function lineMatch(lines: string[], pattern: RegExp): string {
  const found = lines.find((line) => pattern.test(line));
  if (!found) return '';
  if (/remote|hybrid|on-?site|on site/i.test(found)) return normalizeWorkplace(found);
  if (/full|part|contract|intern/i.test(found)) return normalizeEmployment(found);
  return found;
}

function normalizeWorkplace(value: string): string {
  if (/hybrid/i.test(value)) return 'Hybrid';
  if (/on[-\s]?site/i.test(value)) return 'On-site';
  if (/remote/i.test(value)) return 'Remote';
  return cleanText(value);
}

function normalizeEmployment(value: string): string {
  if (/full/i.test(value)) return 'Full-time';
  if (/part/i.test(value)) return 'Part-time';
  if (/contract/i.test(value)) return 'Contract';
  if (/intern/i.test(value)) return 'Internship';
  return cleanText(value);
}

function timeAgo(text: string): string {
  return cleanPosted(
    pick(text, /\b(?:just now|today|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b/i),
  );
}

function countryOrCity(text: string): string {
  return (
    text.match(
      /\b(United States|United Kingdom|United Arab Emirates|Canada|Germany|France|India|Australia|Netherlands|Ireland|Spain|Italy|Singapore|Pakistan|Sweden|Switzerland|Poland|Portugal|Brazil|Mexico|Japan|South Korea|New Zealand)\b/,
    )?.[1] ||
    text.match(/\b(Greater [A-Z][A-Za-z .'-]+ Area|[A-Z][A-Za-z .'-]+ Metropolitan Area)\b/)?.[1] ||
    ''
  );
}

export function looksLikeLocation(value: string): boolean {
  const cleaned = cleanText(value);
  if (!cleaned || cleaned.length > 80) return false;
  if (LOCATION_CHROME.test(cleaned)) return false;
  if (/^(remote|hybrid|on-?site|on site)$/i.test(cleaned)) return false;
  if (countryOrCity(cleaned)) return true;
  if (/^[A-Z][a-zA-Z.'-]+(?:[\s-][A-Z][a-zA-Z.'-]+){0,3},\s*([A-Z]{2}|[A-Z][a-zA-Z.]+)/.test(cleaned)) {
    return true;
  }
  if (/\b(Greater|Area|Metropolitan|County|Region|District)\b/i.test(cleaned)) return true;
  return /^[A-Z][a-zA-Z.'-]+(?:[\s-][A-Z][a-zA-Z.'-]+){0,3}$/.test(cleaned) && cleaned.split(/\s+/).length <= 4;
}

export function locationFromBlob(text: string): string {
  const cleaned = stripWorkplaceSuffix(cleanText(text));
  if (!cleaned) return '';
  if (looksLikeLocation(cleaned)) return cleaned;
  for (const part of cleaned.split(/\s*[·•|]\s*/)) {
    const loc = stripWorkplaceSuffix(part);
    if (looksLikeLocation(loc)) return loc;
  }
  return countryOrCity(cleaned);
}

function stripWorkplaceSuffix(value: string): string {
  return cleanText(value.replace(/\s*\((?:remote|hybrid|on-?site|on site)\)\s*$/i, ''));
}

const LOCATION_CHROME =
  /applicant|reviewing|clicked apply|easy apply|promoted|reposted|posted | ago$|about the job|see more|show more|follow|premium|match|resume|logo|connections?|alumni|message|notify|save job|engineer|developer|scientist|designer|recruiter|analyst/i;

function cleanLocation(value: string): string {
  return locationFromBlob(value);
}

function cleanPosted(value: string): string {
  return cleanText(value.replace(/^(?:re)?posted\s+/i, ''));
}

function formatHiringTrend(text: string): string {
  const total = text.match(/(\d[\d,]*)\s*Total employees/i)?.[1];
  const companyWide = text.match(/(\d[\d,.]*)\s*%\s*Company-wide/i)?.[1];
  const engineering = text.match(/(\d[\d,.]*)\s*%\s*Engineering/i)?.[1];
  return uniqueJoin([
    total ? `${total} total employees` : '',
    companyWide ? `${companyWide}% company-wide` : '',
    engineering ? `${engineering}% engineering` : '',
  ]);
}

function stripViewerHints(value: string): string {
  return cleanText(value.replace(/\s*\((?:similar to you|more than you|less than you)\)/gi, ''));
}

function companyWebsite(text: string): string {
  const found = text.match(/\b((?:https?:\/\/)?www\.[a-z0-9-]+\.[a-z]{2,})\b/i);
  const site = cleanText(found?.[1] || '');
  if (!site || /linkedin\.com|microsoft\.com|google\.com/i.test(site)) return '';
  return site.startsWith('http') ? site : `https://${site}`;
}

function collectPercents(lines: string[], label: RegExp): string {
  return uniqueJoin(lines.filter((line) => /\d+%/.test(line) && label.test(line)));
}

function pick(text: string, pattern: RegExp): string {
  return cleanText(text.match(pattern)?.[1] || text.match(pattern)?.[0] || '');
}
