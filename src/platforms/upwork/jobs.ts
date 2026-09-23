import { firstHref, firstText, metaContent } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, uniqueJoin } from '@/utils/text';
import { pathOf } from '@/utils/url';

const TITLE_SELECTORS = [
  '[data-test="job-title"]',
  '[data-cy="job-title"]',
  'h1.air3-title',
  'h2.air3-title',
  'h1[class*="title"]',
  'h2[class*="JobDetails"]',
  'h1',
  'h2',
];

const DESCRIPTION_SELECTORS = [
  '[data-test="Description"]',
  '[data-test="job-description"]',
  '[data-cy="job-description"]',
  '.job-description',
  'section[data-test="Description"] .air3-line-clamp',
  '[class*="JobDescription"]',
];

const SKILL_SELECTORS = [
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
  const title =
    firstText(pane, TITLE_SELECTORS) ||
    metaContent(doc, ['og:title']) ||
    cleanText(doc.title.replace(/-\s*Upwork.*$/i, '').replace(/^Job Details\s*/i, ''));
  const description =
    firstText(pane, DESCRIPTION_SELECTORS) || metaContent(doc, ['og:description', 'description']);
  const skills = uniqueJoin(
    [...pane.querySelectorAll(SKILL_SELECTORS.join(','))].map((el) => el.textContent),
  );
  const clientName = firstText(pane, CLIENT_NAME_SELECTORS);
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
    .set('location', clientLocation(pane, text))
    .extra('pricingType', 'Hourly / fixed-price', pricingType(text))
    .extra('experienceLevel', 'Experience level', experienceLevel(text))
    .extra('duration', 'Project duration', projectDuration(text))
    .extra('category', 'Job category', jobCategory(text))
    .extra('proposals', 'Proposals', proposals(text))
    .extra('postedDate', 'Job posting date', postedDate(text))
    .extra('clientRating', 'Client rating', clientRating(text))
    .extra('jobsPosted', 'Total jobs posted', jobsPosted(text))
    .extra('totalHires', 'Total hires', totalHires(text))
    .extra('totalSpent', 'Total amount spent', totalSpent(text))
    .extra('clientHistory', 'Client history', clientHistory(text))
    .extra('clientProfile', 'Client profile', clientProfile(pane));

  return builder;
}

function jobPane(doc: Document): ParentNode {
  for (const selector of PANE_SELECTORS) {
    for (const el of doc.querySelectorAll(selector)) {
      const text = el.textContent || '';
      if (
        text.length > 180 &&
        /about the client|job description|about the job|fixed-price|hourly rate|submit a proposal/i.test(
          text,
        )
      ) {
        return el;
      }
    }
  }
  return doc;
}

async function waitForJobPane(doc: Document): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const pane = jobPane(doc);
    const text = visibleText(pane);
    if (/about the client/i.test(text) && /fixed-price|hourly|proposals/i.test(text)) return;
    if (/job description|about the job|submit a proposal/i.test(text) && text.length > 400) return;
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
  const labeled = text.match(
    /est(?:imated)?\.?\s*time[:\s]*([^\n]+)|project\s+(?:length|duration)[:\s]*([^\n]+)/i,
  );
  const value = cleanText(labeled?.[1] || labeled?.[2] || '');
  if (value && !/intermediate|expert|entry/i.test(value)) return value;
  const hours = text.match(/less than \d+ (?:week|month|hrs?\/week)[^\n]{0,40}/i);
  return cleanText(hours?.[0] || '');
}

function jobCategory(text: string): string {
  const match = text.match(/(?:category|specialization)[:\s]*([^\n]+)/i);
  const value = cleanText(match?.[1] || '');
  if (!value || /proposal|hour|fixed|intermediate/i.test(value)) return '';
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

function clientRating(text: string): string {
  const match = text.match(/([1-5]\.\d)\s*(?:of\s*5|stars?)/i);
  return cleanText(match?.[1] || '');
}

function jobsPosted(text: string): string {
  return cleanText(text.match(/(\d[\d,]*)\s+jobs?\s+posted/i)?.[1] || '');
}

function totalHires(text: string): string {
  return cleanText(text.match(/(\d[\d,]*)\s+hires?/i)?.[1] || '');
}

function totalSpent(text: string): string {
  return cleanText(text.match(/\$[\d,.]+[kKmM]?\s+spent/i)?.[0] || '');
}

const COUNTRIES =
  /\b(Nigeria|United States|United Kingdom|India|Canada|Pakistan|Germany|France|Australia|Kenya|Ghana|Egypt|Philippines|Indonesia|Brazil|Mexico|Ukraine|Poland|Spain|Italy|Netherlands|Sweden|Ireland|Singapore|Bangladesh|South Africa)\b/i;

function clientLocation(root: ParentNode, text: string): string {
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
  return cleanText(value.replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, ''));
}

function clientHistory(text: string): string {
  return uniqueJoin([
    jobsPosted(text) ? `${jobsPosted(text)} jobs posted` : '',
    totalHires(text) ? `${totalHires(text)} hires` : '',
    totalSpent(text),
    cleanText(text.match(/member since[^\n]+/i)?.[0] || ''),
    cleanText(text.match(/avg(?:erage)?\s*hourly[^\n]+/i)?.[0] || ''),
  ]);
}

function clientProfile(root: ParentNode): string {
  const about = firstText(root, ['[data-test="AboutClient"]', '[data-qa="client-info"]']);
  if (!about) return '';
  return cleanText(about).slice(0, 240);
}

function pricingType(text: string): string {
  if (/hourly rate|\/\s*hr/i.test(text)) return 'Hourly';
  if (/fixed[- ]price/i.test(text)) return 'Fixed-price';
  if (/hourly/i.test(text)) return 'Hourly';
  return '';
}
