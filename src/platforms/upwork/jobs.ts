import { firstDatetime, firstEl, firstHref, firstText, metaContent } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, flattenLines, uniqueJoin } from '@/utils/text';
import { pathOf } from '@/utils/url';

const CARD_SELECTORS = [
  '.job-details-card',
  '.job-details-content',
  '[data-ev-sublocation="jobdetails"]',
  '[slidername="job-details"]',
  '.air3-slider-body',
];

const TITLE_SELECTORS = [
  'h4 span.flex-1',
  '.job-details-card > .air3-card-sections > section.air3-card-section h4 span.flex-1',
  '.job-details-card h4 span.flex-1',
  '.job-details-content h4 span.flex-1',
  '[data-ev-sublocation="jobdetails"] h4 span.flex-1',
  'h4',
  '.job-details-card h4',
  '.job-details-content h4',
  '[data-ev-sublocation="jobdetails"] h4',
  '[data-test="job-title"]',
  '[data-cy="job-title"]',
  'h1.air3-title',
  'h2.air3-title',
];

const DESCRIPTION_SELECTORS = [
  '[data-test="Description"] p',
  '[data-test="Description"] .multiline-text',
  '[data-test="job-description"]',
  '[data-cy="job-description"]',
  '.job-description',
  'section[data-test="Description"] .air3-line-clamp',
  '[class*="JobDescription"]',
];

const SKILL_SELECTORS = [
  '.skills-list a',
  '.skills-list .air3-line-clamp',
  '[data-test="skill"]',
  '[data-test="TokenClamp"] a',
  '[data-test="TokenClamp"] span',
  '.air3-token',
  '[class*="skills"] .air3-badge',
];

const CLIENT_NAME_SELECTORS = [
  '[data-test="client-name"]',
  '[data-qa="client-name"]',
  '[data-test="AboutClientUser"] h2',
  '[data-test="AboutClient"] h2',
  'section[data-test="AboutClient"] h2',
  '[data-test="AboutClient"] [class*="name"]',
];

const PANE_SELECTORS = [
  '[role="dialog"]',
  '[data-test="job-details"]',
  '[data-test="JobDetails"]',
  '[data-test="job-posting"]',
  '[data-test="JobPosting"]',
  '[data-ev-label="job_details"]',
  '[data-ev-sublocation="job_details"]',
  '[class*="apply-page"]',
  '[class*="ApplyPage"]',
  'aside',
  'main',
  '[class*="JobDetails"]',
  '[class*="job-details"]',
];

export function upworkJobId(url: string): string {
  const fromUrl = url.match(/~([A-Za-z0-9]{8,})/);
  if (fromUrl?.[1]) return `~${fromUrl[1]}`;
  const tilde = pathOf(url).match(/\/(?:jobs|details)\/~([A-Za-z0-9]+)/);
  if (tilde?.[1]) return `~${tilde[1]}`;
  const slug = pathOf(url).match(/\/jobs\/([^/?#]+)/);
  return slug?.[1] ? decodeURIComponent(slug[1]) : '';
}

export function canonicalJobUrl(jobId: string, fallback: string): string {
  return jobId.startsWith('~') ? `https://www.upwork.com/jobs/${jobId}` : fallback;
}

export async function extractUpworkJob(
  builder: ExtractionBuilder,
  ctx: { url: URL; document: Document },
) {
  const { document: doc, url } = ctx;
  const jobId = upworkJobId(url.toString());
  await waitForJobPane(doc);
  const pane = jobPane(doc);
  const text = visibleText(pane);
  const title = jobTitle(pane, doc, jobId);
  const description = jobDescription(pane, doc);
  const skills = uniqueJoin(
    [...pane.querySelectorAll(SKILL_SELECTORS.join(','))].map((el) => el.textContent),
  );
  const client = aboutClient(pane, text);
  const clientName = cleanClientName(firstText(pane, CLIENT_NAME_SELECTORS) || client.name);
  const jobUrl = canonicalJobUrl(jobId, url.toString());
  const clientHref = firstHref(
    pane,
    ['a[href*="/freelancers/"]', 'a[href*="/agencies/"]', 'a[href*="/nx/client/"]'],
    url.toString(),
  );

  builder
    .setType('job')
    .set('jobTitle', title)
    .set('jobDescription', description)
    .set('skills', skills)
    .set('leadName', clientName || title)
    .set('company', clientName)
    .set('companyUrl', clientHref)
    .set('jobUrl', jobUrl)
    .set('sourceUrl', url.toString())
    .set('platformLeadId', jobId || jobUrl)
    .set('budget', jobBudget(text))
    .set('location', client.location || clientLocation(pane, text))
    .extra('pricingType', 'Hourly / fixed-price', pricingType(text))
    .extra('experienceLevel', 'Experience level', experienceLevel(text))
    .extra('duration', 'Project duration', projectDuration(text))
    .extra('category', 'Job category', jobCategory(pane, text))
    .extra('proposals', 'Proposals', proposals(text))
    .extra('postedDate', 'Job posting date', firstDatetime(pane) || postedDate(text))
    .extra('clientRating', 'Client rating', client.rating)
    .extra('jobsPosted', 'Total jobs posted', client.jobsPosted)
    .extra('totalHires', 'Total hires', client.hires)
    .extra('totalSpent', 'Total amount spent', client.spent)
    .extra('clientHistory', 'Client history', client.history)
    .extra('clientProfile', 'Client profile', client.profile);

  return builder;
}

function jobDescription(pane: ParentNode, doc: Document): string {
  const fromCard = firstText(pane, DESCRIPTION_SELECTORS);
  if (fromCard) return flattenLines(fromCard.replace(/^summary\s+/i, ''));
  return flattenLines(metaContent(doc, ['og:description', 'description']));
}

function jobTitle(pane: ParentNode, doc: Document, jobId: string): string {
  const fromCard = firstJobTitle(pane);
  if (fromCard) return fromCard;
  const card = firstEl(doc, CARD_SELECTORS);
  if (card) {
    const fromDocCard = firstJobTitle(card);
    if (fromDocCard) return fromDocCard;
  }
  if (jobId) {
    const link = pane.querySelector(`a[href*="/jobs/${jobId}"]`);
    const fromLink = cleanJobTitle(link?.textContent);
    if (fromLink) return fromLink;
  }
  return cleanJobTitle(metaContent(doc, ['og:title'])) ||
    cleanJobTitle(doc.title.replace(/-\s*Upwork.*$/i, ''));
}

function firstJobTitle(root: ParentNode): string {
  for (const selector of TITLE_SELECTORS) {
    try {
      for (const el of root.querySelectorAll(selector)) {
        const title = cleanJobTitle(el.textContent);
        if (title) return title;
      }
    } catch {
      // Invalid selector — skip.
    }
  }
  return '';
}

function cleanJobTitle(value: string | null | undefined): string {
  const title = cleanText(value).replace(/^job details\s*[-–:]?\s*/i, '');
  if (!title || isJunkTitle(title)) return '';
  return title;
}

function isJunkTitle(value: string): boolean {
  const title = value.trim();
  if (title.length > 120 || title.split(/\s+/).length > 14) return true;
  return /^(upwork|job details|submit a proposal|find work|best matches|proposal|apply|footer|footer navigation|navigation|open job in a new window|go back|apply now|save job)$/i.test(
    title,
  ) || /boosted proposals|upgrade your membership|first place winners|footer navigation|available connects/i.test(
    title,
  );
}

function cleanClientName(value: string): string {
  const name = cleanText(value);
  if (!name || isJunkTitle(name) || /about the client/i.test(name)) return '';
  return name;
}

function jobPane(doc: Document): ParentNode {
  for (const selector of CARD_SELECTORS) {
    try {
      const el = doc.querySelector(selector);
      if (el && /about the client|hourly|fixed-price|skills and expertise/i.test(el.textContent || '')) {
        return el;
      }
    } catch {
      // Invalid selector — skip.
    }
  }
  const matches: Element[] = [];
  for (const selector of PANE_SELECTORS) {
    if (selector === 'main') continue;
    try {
      for (const el of doc.querySelectorAll(selector)) {
        const text = el.textContent || '';
        if (
          text.length > 180 &&
          /about the client|job description|about the job|fixed-price|hourly/i.test(text)
        ) {
          matches.push(el);
        }
      }
    } catch {
      // Invalid selector — skip.
    }
  }
  if (matches.length) {
    return matches.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ?? doc;
  }
  for (const el of doc.querySelectorAll('main')) {
    const text = el.textContent || '';
    if (text.length > 180 && /hourly|fixed-price|about the client/i.test(text)) return el;
  }
  return doc;
}

async function waitForJobPane(doc: Document): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const pane = jobPane(doc);
    const text = visibleText(pane);
    const title = jobTitle(pane, doc, upworkJobId(location.href));
    if (title && /about the client/i.test(text) && /fixed-price|hourly|proposals/i.test(text)) return;
    if (title && /job description|about the job|submit a proposal/i.test(text) && text.length > 400) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function visibleText(root: ParentNode): string {
  const el = root as Element;
  const raw = 'innerText' in el && typeof el.innerText === 'string' ? el.innerText : el.textContent || '';
  return cleanText(raw);
}

function jobBudget(text: string): string {
  const hourly = text.match(/\$[\d,.]+(?:\s*-\s*\$[\d,.]+)?\s*\/\s*hr/i);
  if (hourly) return cleanText(hourly[0]);
  const labeled = text.match(/(?:budget|fixed[- ]price)[:\s]*(\$[\d,.]+(?:\s*-\s*\$[\d,.]+)?)/i);
  if (labeled?.[1]) return cleanText(labeled[1]);
  const money = text.match(/\$[\d,.]+(?:[kKmM])?(?:\s*-\s*\$[\d,.]+(?:[kKmM])?)?/);
  if (money && !/spent|earned|hour/i.test(money[0])) return cleanText(money[0]);
  return '';
}

function experienceLevel(text: string): string {
  if (/\bentry\s*level\b/i.test(text)) return 'Entry level';
  if (/\bintermediate\b/i.test(text)) return 'Intermediate';
  if (/\bexpert\b/i.test(text)) return 'Expert';
  return '';
}

function projectDuration(text: string): string {
  const months = text.match(/(\d+\s*(?:to|-)\s*\d+\s+months?)\s*duration/i);
  if (months?.[1]) return cleanText(months[1]);
  const labeled = text.match(
    /(?:^|\n)\s*duration[:\s]*([^\n]+)|est(?:imated)?\.?\s*time[:\s]*([^\n]+)|project\s+(?:length|duration)[:\s]*([^\n]+)/i,
  );
  const value = cleanText(labeled?.[1] || labeled?.[2] || labeled?.[3] || '');
  if (value && !/intermediate|expert|entry|hourly|hrs?\/week/i.test(value)) return value;
  return '';
}

function jobCategory(root: ParentNode, text: string): string {
  const labeled = firstText(root, [
    '[data-test="category"]',
    '[data-test="JobCategory"]',
    'a[href*="category"]',
  ]);
  if (labeled && !/proposal|hour|fixed|upwork/i.test(labeled)) return labeled;
  const match = text.match(/(?:category|specialization)[:\s]*([^\n]+)/i);
  const value = cleanText(match?.[1] || '');
  if (!value || /proposal|hour|fixed|intermediate|expert/i.test(value)) return '';
  return value;
}

function proposals(text: string): string {
  const match = text.match(
    /proposals?[:\s]*((?:less than\s+)?\d[\d,]*(?:\s+to\s+\d[\d,]*)?)/i,
  );
  return cleanText(match?.[1] || '');
}

function postedDate(text: string): string {
  return cleanText(
    text.match(
      /posted\s+((?:just now|yesterday|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago))/i,
    )?.[1] || '',
  );
}

function aboutClient(root: ParentNode, text: string) {
  const box = firstEl(root, [
    '[data-test="about-client-container"]',
    '.cfe-ui-job-about-client',
    '[data-test="AboutClient"]',
    '[data-qa="client-info"]',
    '[data-test="about-client"]',
  ]);
  const section = box ? visibleText(box) : aboutClientWindow(text);
  const jobs = labeledValue(section, /jobs?\s+posted/i, /(\d[\d,]*)/);
  const hires = labeledValue(section, /^(total\s+)?hires?:?$/i, /(\d[\d,]*)/);
  const spent = labeledValue(section, /(?:total\s+)?spent/i, /(\$[\d,.]+[kKmM+]*)/);
  const rating = labeledValue(section, /^(client\s+)?rating|stars?$/i, /([1-5]\.\d)/);
  const postingStats = firstText(box ?? root, ['[data-qa="client-job-posting-stats"]']);
  const since =
    firstText(box ?? root, ['[data-qa="client-contract-date"]']) ||
    cleanText(section.match(/member since[^\n]+/i)?.[0] || '');
  const location = clientLocation(box ?? root, section || text);
  const verified = [
    /payment verified/i.test(section) ? 'Payment verified' : '',
    /phone number verified/i.test(section) ? 'Phone number verified' : '',
  ];
  return {
    name: '',
    location,
    jobsPosted: jobs,
    hires,
    spent,
    rating,
    history: uniqueJoin([
      jobs ? `${jobs} jobs posted` : '',
      hires ? `${hires} hires` : '',
      spent,
      postingStats,
      since,
    ]),
    profile: uniqueJoin([...verified, postingStats, since]).slice(0, 240),
  };
}

function aboutClientWindow(text: string): string {
  const lines = text.split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  const start = lines.findIndex((line) => /about the client/i.test(line));
  if (start < 0) return text;
  return lines.slice(start, start + 30).join('\n');
}

function labeledValue(text: string, label: RegExp, value: RegExp): string {
  const lines = text.split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (/hire rate/i.test(line)) continue;
    if (!label.test(line)) continue;
    const same = line.match(value);
    if (same?.[1] && !label.test(same[1]) && !/hire rate/i.test(line)) return cleanText(same[1]);
    const following = next.match(value);
    if (following?.[1] && !/hire rate/i.test(next)) return cleanText(following[1]);
  }
  const compact = text.replace(/\n+/g, ' ');
  if (/hire rate/i.test(label.source)) return '';
  const after = compact.match(new RegExp(`(?:^|\\s)${label.source}[:\\s]+${value.source}`, 'i'));
  if (after?.[1] || after?.[2]) return cleanText(after[1] || after[2] || '');
  const before = compact.match(new RegExp(`${value.source}\\s+${label.source}(?:\\s|$)`, 'i'));
  return cleanText(before?.[1] || '');
}

const COUNTRIES =
  /\b(Nigeria|United States|United Kingdom|India|Canada|Pakistan|Germany|France|Australia|Kenya|Ghana|Egypt|Philippines|Indonesia|Brazil|Mexico|Ukraine|Poland|Spain|Italy|Netherlands|Sweden|Ireland|Singapore|Bangladesh|South Africa)\b/i;

function clientLocation(root: ParentNode, text: string): string {
  const countryOnly = firstText(root, ['[data-qa="client-location"] strong']);
  if (countryOnly) return stripClock(countryOnly);
  const labeled = firstText(root, [
    '[data-test="client-location"]',
    '[data-qa="client-location"]',
    '[data-test="AboutClient"] [data-test="location"]',
  ]);
  if (labeled) return stripClock(labeled);

  const lines = text
    .split('\n')
    .map((line) => stripClock(line))
    .filter(Boolean);
  const about = lines.findIndex((line) => /about the client/i.test(line));
  const window = about >= 0 ? lines.slice(about, about + 15) : lines;
  const country = window.find((line) => COUNTRIES.test(line) && line.length < 40) || '';
  const city = window.find(
    (line) =>
      Boolean(country) &&
      line !== country &&
      /^[A-Z][A-Za-z .'-]{2,40}$/.test(line) &&
      !/posted|hire|spent|verified|member|proposal|payment|phone|email|about|client/i.test(line),
  );
  if (city && country) return `${city}, ${country}`;
  return country;
}

function stripClock(value: string): string {
  return cleanText(
    value
      .replace(/\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, '')
      .replace(/([A-Za-z])(\d)/g, '$1 $2'),
  );
}

function pricingType(text: string): string {
  if (/hourly rate|\/\s*hr/i.test(text)) return 'Hourly';
  if (/fixed[- ]price/i.test(text)) return 'Fixed-price';
  if (/hourly/i.test(text)) return 'Hourly';
  return '';
}
