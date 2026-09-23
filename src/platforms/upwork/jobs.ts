import { firstText, metaContent } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, uniqueJoin } from '@/utils/text';
import { pathOf } from '@/utils/url';

const TITLE_SELECTORS = [
  '[data-test="job-title"]',
  '[data-cy="job-title"]',
  'h1.air3-title',
  'h1[class*="title"]',
  'h2[class*="JobDetails"]',
  'h1',
];

const DESCRIPTION_SELECTORS = [
  '[data-test="Description"]',
  '[data-test="job-description"]',
  '[data-cy="job-description"]',
  '.job-description',
  'section[data-test="Description"] .air3-line-clamp',
  '[class*="JobDescription"]',
  'article',
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
];

export function upworkJobId(url: string): string {
  const tilde = pathOf(url).match(/\/jobs\/~([A-Za-z0-9]+)/);
  if (tilde?.[1]) return `~${tilde[1]}`;
  const slug = pathOf(url).match(/\/jobs\/([^/?#]+)/);
  return slug?.[1] ? decodeURIComponent(slug[1]) : '';
}

export function extractUpworkJob(
  builder: ExtractionBuilder,
  ctx: { url: URL; document: Document },
) {
  const { document: doc, url } = ctx;
  const text = doc.body.innerText || '';
  const title =
    firstText(doc, TITLE_SELECTORS) ||
    metaContent(doc, ['og:title']) ||
    cleanText(doc.title.replace(/-\s*Upwork.*$/i, ''));
  const description =
    firstText(doc, DESCRIPTION_SELECTORS) || metaContent(doc, ['og:description', 'description']);
  const skills = uniqueJoin([...doc.querySelectorAll(SKILL_SELECTORS.join(','))].map((el) => el.textContent));
  const clientName = firstText(doc, CLIENT_NAME_SELECTORS);
  const jobId = upworkJobId(url.toString());
  const jobUrl = jobId.startsWith('~')
    ? `https://www.upwork.com/jobs/${jobId}`
    : url.toString();

  builder
    .setType('job')
    .set('jobTitle', title)
    .set('jobDescription', description)
    .set('skills', skills)
    .set('leadName', clientName)
    .set('company', clientName)
    .set('jobUrl', jobUrl)
    .set('sourceUrl', url.toString())
    .set('platformLeadId', jobId || jobUrl)
    .set('budget', matchLine(text, /(?:hourly|fixed|budget|price)[:\s$]*([^\n]{2,80})/i) || moneyNear(text, /budget/i))
    .set('location', clientLocation(doc, text))
    .extra('pricingType', 'Hourly / fixed-price', pricingType(text))
    .extra('experienceLevel', 'Experience level', matchLine(text, /experience\s*level[:\s]*([^\n]+)/i) || findOne(text, ['Entry level', 'Intermediate', 'Expert']))
    .extra('duration', 'Project duration', matchLine(text, /(?:duration|project length)[:\s]*([^\n]+)/i))
    .extra('category', 'Job category', matchLine(text, /(?:category)[:\s]*([^\n]+)/i))
    .extra('proposals', 'Proposals', matchLine(text, /proposals?[:\s]*([^\n]+)/i))
    .extra('postedDate', 'Job posting date', matchLine(text, /posted[:\s]*([^\n]+)/i))
    .extra('clientRating', 'Client rating', matchLine(text, /([0-5]\.\d)\s*(?:of\s*5|stars?)/i))
    .extra('jobsPosted', 'Total jobs posted', matchLine(text, /([0-9,]+)\s*(?:jobs?\s*posted|total\s*jobs)/i))
    .extra('totalHires', 'Total hires', matchLine(text, /([0-9,]+)\s*hires?/i))
    .extra('totalSpent', 'Total amount spent', matchLine(text, /\$[\d,.]+[kKmM]?\s*(?:spent|total\s*spent)/))
    .extra('clientHistory', 'Client history', clientHistory(text))
    .extra('clientProfile', 'Client profile', firstText(doc, ['[data-test="AboutClient"]', '[data-qa="client-info"]']));

  return builder;
}

function matchLine(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  return cleanText(match?.[1] || match?.[0] || '');
}

function findOne(text: string, options: string[]): string {
  return options.find((option) => new RegExp(`\\b${option}\\b`, 'i').test(text)) ?? '';
}

function pricingType(text: string): string {
  if (/hourly/i.test(text) && /fixed/i.test(text)) {
    if (/hourly rate/i.test(text)) return 'Hourly';
    if (/fixed[- ]price/i.test(text)) return 'Fixed-price';
  }
  if (/hourly/i.test(text)) return 'Hourly';
  if (/fixed[- ]price|fixed price/i.test(text)) return 'Fixed-price';
  return '';
}

function moneyNear(text: string, label: RegExp): string {
  const lines = text.split('\n').map((line) => line.trim());
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (label.test(line)) {
      const same = line.match(/\$[\d,.]+(?:\s*-\s*\$[\d,.]+)?/);
      if (same) return same[0];
      const next = (lines[i + 1] ?? '').match(/\$[\d,.]+(?:\s*-\s*\$[\d,.]+)?/);
      if (next) return next[0];
    }
  }
  return '';
}

function clientLocation(doc: Document, text: string): string {
  return (
    firstText(doc, [
      '[data-test="client-location"]',
      '[data-qa="client-location"]',
      '[data-test="AboutClient"] [data-test="location"]',
    ]) || matchLine(text, /(?:location|client location)[:\s]*([^\n]+)/i)
  );
}

function clientHistory(text: string): string {
  return uniqueJoin([
    matchLine(text, /([0-9,]+)\s*jobs?\s*posted/i),
    matchLine(text, /([0-9,]+)\s*hires?/i),
    matchLine(text, /\$[\d,.]+[kKmM]?\s*spent/i),
    matchLine(text, /member since[^\n]+/i),
    matchLine(text, /avg(?:erage)?\s*hourly[^\n]+/i),
  ]);
}
