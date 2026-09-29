import { firstAttr, firstDatetime, firstEl, firstHref, firstText, metaContent } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, flattenLines, uniqueJoin } from '@/utils/text';
import { pathOf } from '@/utils/url';

const CARD_SELECTORS = [
  '.job-details-card',
  '.job-details-content',
  '[data-ev-sublocation="jobdetails"]',
  '[slidername="job-details"]',
  '.air3-slider-body',
  '.fe-job-details',
];

const TITLE_SELECTORS = [
  'h4 span.flex-1',
  '.job-details-card > .air3-card-sections > section.air3-card-section h4 span.flex-1',
  '.job-details-card h4 span.flex-1',
  '.job-details-content h4 span.flex-1',
  '[data-ev-sublocation="jobdetails"] h4 span.flex-1',
  '.fe-job-details h3.h5',
  'h3.h5',
  '.job-details-card h4',
  '.job-details-content h4',
  '[data-ev-sublocation="jobdetails"] h4',
  'h4',
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
  '.fe-job-details',
  '.fe-job-apply',
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
    .set('budget', jobBudget(pane, text))
    .set('location', client.location || clientLocation(pane, text))
    .extra('pricingType', 'Hourly / fixed-price', pricingType(pane, text))
    .extra('experienceLevel', 'Experience level', experienceLevel(pane, text))
    .extra('duration', 'Project duration', projectDuration(pane, text))
    .extra('category', 'Job category', jobCategory(pane, text))
    .extra('proposals', 'Proposals', proposals(text))
    .extra('postedDate', 'Job posting date', jobPostedAt(pane, text))
    .extra('clientRating', 'Client rating', client.rating)
    .extra('jobsPosted', 'Total jobs posted', client.jobsPosted)
    .extra('totalHires', 'Total hires', client.hires)
    .extra('totalSpent', 'Total amount spent', client.spent)
    .extra('companyIndustry', 'Industry', client.industry)
    .extra('companySize', 'Company size', client.size)
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
  return   /^(upwork|job details|submit a proposal|find work|best matches|proposal|apply|footer|footer navigation|navigation|open job in a new window|go back|apply now|save job|skills and expertise)$/i.test(
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

function featureLi(root: ParentNode, selector: string): HTMLElement | null {
  const el = root.querySelector(selector);
  return el?.closest('li') ?? null;
}

function featureLabel(li: Element | null): string {
  if (!li) return '';
  return (
    firstText(li, ['.d-none.d-lg-inline']) ||
    firstText(li, ['.d-lg-none']) ||
    firstText(li, ['strong'])
  );
}

function jobBudget(root: ParentNode, text: string): string {
  const row = featureLi(root, '[data-cy="clock-timelog"]') || featureLi(root, '[data-cy="fixed-price"]');
  const featureText = row ? visibleText(row) : '';
  const fromFeature = moneyRange(featureText);
  if (fromFeature) return formatBudget(fromFeature, featureText);

  const hourlyRange = text.match(
    /\$[\d,.]+(?:\.\d{2})?\s*-\s*\$[\d,.]+(?:\.\d{2})?(?:\s*(?:hourly|\/\s*hr))?/i,
  );
  if (hourlyRange?.[0] && !/avg|bid range|high \$|low \$/i.test(hourlyRange[0])) {
    return formatBudget(moneyRange(hourlyRange[0]) || cleanText(hourlyRange[0]), hourlyRange[0]);
  }

  const labeled = text.match(/(?:budget|fixed[- ]price|est\.?\s*budget)[:\s]*(\$[\d,.]+(?:\s*-\s*\$[\d,.]+)?)/i);
  if (labeled?.[1]) return cleanText(labeled[1]);
  return '';
}

function moneyRange(text: string): string {
  if (!text) return '';
  const range = text.match(/\$[\d,.]+(?:\.\d{2})?\s*-\s*\$[\d,.]+(?:\.\d{2})?/);
  if (range?.[0]) return cleanText(range[0].replace(/\s+/g, ''));
  const single = text.match(/\$[\d,.]+(?:\.\d{2})?(?:\s*\/\s*hr)?/i);
  if (!single?.[0] || /spent|earned|connects/i.test(text)) return '';
  return cleanText(single[0]);
}

function formatBudget(amount: string, context: string): string {
  if (/\/\s*hr/i.test(amount)) return amount.replace(/\s+/g, '');
  if (/hourly/i.test(context)) return `${amount} /hr`;
  return amount;
}

function experienceLevel(root: ParentNode, text: string): string {
  const li = featureLi(root, '[data-cy="expertise"]');
  const fromRow = (li ? firstText(li, ['strong']) : '') || text;
  if (/\bentry\s*level\b/i.test(fromRow) || /^entry\b/i.test(fromRow)) return 'Entry level';
  if (/\bintermediate\b/i.test(fromRow)) return 'Intermediate';
  if (/\bexpert\b/i.test(fromRow)) return 'Expert';
  return '';
}

function projectDuration(root: ParentNode, text: string): string {
  const li = featureLi(root, '[data-cy*="duration"]');
  const cleaned = cleanDuration(featureLabel(li));
  if (cleaned) return cleaned;
  const labeled = text.match(
    /((?:less than|more than)\s+\d+\s+months?|\d+\+\s+months?|\d+\s*(?:to|-)\s*\d+\s+months?|< 1 month)\s*duration/i,
  );
  return cleanDuration(labeled?.[1] || '');
}

function cleanDuration(value: string): string {
  const duration = cleanText(value)
    .replace(/< 1 month/i, 'Less than 1 month')
    .replace(/\b6\+\s*months?\b/i, 'More than 6 months')
    .replace(/(\d+)\s*-\s*(\d+)\s+months?/i, '$1 to $2 months');
  if (!duration || /hourly|hrs?\/week|intermediate|expert|entry|experience|willing to pay/i.test(duration)) {
    return '';
  }
  if (!/month/i.test(duration)) return '';
  return duration.replace(/\s+/g, ' ');
}

function jobCategory(root: ParentNode, text: string): string {
  const labeled = firstText(root, [
    '[data-test="category"]',
    '[data-test="JobCategory"]',
    'a[href*="category"]',
  ]);
  if (labeled && !/proposal|hour|fixed|upwork|project type/i.test(labeled)) return labeled;
  const projectType =
    firstText(root, ['.segmentations li']) ||
    text.match(/project type:\s*([^\n]+)/i)?.[1] ||
    '';
  const typeValue = cleanText(projectType.replace(/^project type:\s*/i, ''));
  if (typeValue && !/proposal|hour|fixed|upwork/i.test(typeValue)) return typeValue;
  const match = text.match(/(?:category|specialization)[:\s]*([^\n]+)/i);
  const value = cleanText(match?.[1] || '');
  if (!value || /proposal|hour|fixed|intermediate|expert/i.test(value)) return '';
  return value;
}

function proposals(text: string): string {
  const match = text.match(
    /proposals?[:\s]*((?:less than\s+)?\d[\d,]*\+?(?:\s+to\s+\d[\d,]*)?)/i,
  );
  return cleanText(match?.[1] || '');
}

function jobPostedAt(root: ParentNode, text: string): string {
  return (
    firstText(root, ['[itemprop="datePosted"]']) ||
    firstDatetime(root) ||
    postedDate(text)
  );
}

function postedDate(text: string): string {
  return cleanText(
    text.match(
      /posted\s+((?:just now|yesterday|(?:an?|\d+)\s+(?:minute|hour|day|week|month|year)s?\s+ago|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}))/i,
    )?.[1] || '',
  );
}

function clientRating(root: ParentNode, text: string): string {
  const labeled = unsmash(
    firstText(root, [
      '[data-test="rating-minimal"] .air3-rating-minimal-text',
      '[data-test="rating-minimal"]',
      '.air3-rating-minimal-text',
      '.cfe-ui-job-about-client .rating',
      '[data-qa="client-rating"]',
      '[data-test="client-rating"]',
      '[data-qa="client-feedback"]',
    ]) ||
      firstAttr(root, ['[aria-label*="rating"]', '[aria-label*="reviews"]'], 'aria-label'),
  );
  return parseRating(labeled) || parseRating(text);
}

function parseRating(text: string): string {
  if (!text) return '';
  const full = text.match(
    /\b([0-5](?:\.\d{1,2})?)\s*(?:\/\s*5)?\s*(?:out\s+of\s+5)?\s*(?:of|from)\s+(\d[\d,]*)\s+reviews?\b/i,
  );
  if (full?.[1] && full[2] != null) return `${full[1]} of ${full[2]} reviews`;
  const stacked = text.match(/\b([0-5](?:\.\d{1,2})?)\b[\s\S]{0,40}?\b(\d[\d,]*)\s+reviews?\b/i);
  if (stacked?.[1] && stacked[2] != null && !/hire rate/i.test(text.slice(0, 80))) {
    return `${stacked[1]} of ${stacked[2]} reviews`;
  }
  return '';
}

function aboutClient(root: ParentNode, text: string) {
  const box = firstEl(root, [
    '[data-test="about-client-container"]',
    '.cfe-ui-job-about-client',
    '[data-test="AboutClient"]',
    '[data-qa="client-info"]',
    '[data-test="about-client"]',
  ]);
  const scope = box ?? root;
  const section = box ? visibleText(box) : aboutClientWindow(text);
  const postingStats = tidyClientPhrase(unsmash(firstText(scope, ['[data-qa="client-job-posting-stats"]'])));
  const hiresText = tidyClientPhrase(unsmash(firstText(scope, ['[data-qa="client-hires"]'])));
  const hours = tidyClientPhrase(unsmash(firstText(scope, ['[data-qa="client-hours"]'])));
  const spentRaw =
    firstText(scope, ['[data-qa="client-spend"]', '[data-qa="client-spent"]']) ||
    labeledValue(section, /(?:total\s+)?spent/i, /(\$[\d,.]+\s*[kKmM+]*)/);
  const spent = (spentRaw.match(/\$[\d,.]+\s*[kKmM+]*/i)?.[0] || '').replace(/\s+/g, '');
  const rating = clientRating(scope, section);
  const jobs =
    postingStats.match(/(\d[\d,]*)\s+jobs?\s+posted/i)?.[1] ||
    labeledValue(section, /jobs?\s+posted/i, /(\d[\d,]*)/);
  const hires = hiresText.match(/(\d[\d,]*)\s+hires?/i)?.[1] || '';
  const since =
    firstText(scope, ['[data-qa="client-contract-date"]']) ||
    cleanText(section.match(/member since[^\n]+/i)?.[0] || '');
  const location = clientLocation(scope, section || text);
  const industry = firstText(scope, ['[data-qa="client-company-profile-industry"]']);
  const size = firstText(scope, ['[data-qa="client-company-profile-size"]']);
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
    industry,
    size,
    history: uniqueJoin([
      postingStats,
      hiresText,
      hours,
      spent ? `${spent} total spent` : '',
      jobs && !/jobs?\s+posted/i.test(postingStats) ? `${jobs} jobs posted` : '',
      industry,
      size,
      since,
    ]),
    profile: uniqueJoin([...verified, postingStats, hiresText, hours, spent, industry, size, since]).slice(
      0,
      280,
    ),
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

const ISO_COUNTRIES: Record<string, string> = {
  IND: 'India',
  USA: 'United States',
  GBR: 'United Kingdom',
  CAN: 'Canada',
  PAK: 'Pakistan',
  NGA: 'Nigeria',
  AUS: 'Australia',
  DEU: 'Germany',
  FRA: 'France',
  KEN: 'Kenya',
  GHA: 'Ghana',
  EGY: 'Egypt',
  PHL: 'Philippines',
  IDN: 'Indonesia',
  BRA: 'Brazil',
  MEX: 'Mexico',
  UKR: 'Ukraine',
  POL: 'Poland',
  ESP: 'Spain',
  ITA: 'Italy',
  NLD: 'Netherlands',
  SWE: 'Sweden',
  IRL: 'Ireland',
  SGP: 'Singapore',
  BGD: 'Bangladesh',
  ZAF: 'South Africa',
  ARE: 'United Arab Emirates',
  SAU: 'Saudi Arabia',
  ROU: 'Romania',
  BEL: 'Belgium',
  NZL: 'New Zealand',
  CHE: 'Switzerland',
  AUT: 'Austria',
  DNK: 'Denmark',
  NOR: 'Norway',
  FIN: 'Finland',
  PRT: 'Portugal',
  CZE: 'Czechia',
  HUN: 'Hungary',
  GRC: 'Greece',
  ISR: 'Israel',
  QAT: 'Qatar',
  KWT: 'Kuwait',
  LKA: 'Sri Lanka',
  NPL: 'Nepal',
  VNM: 'Vietnam',
  THA: 'Thailand',
  MYS: 'Malaysia',
  JPN: 'Japan',
  KOR: 'South Korea',
  TUR: 'Turkey',
  ARG: 'Argentina',
  COL: 'Colombia',
  CHL: 'Chile',
  PER: 'Peru',
  MAR: 'Morocco',
};

function expandCountry(value: string): string {
  const trimmed = cleanText(value);
  return ISO_COUNTRIES[trimmed.toUpperCase()] || trimmed;
}

function unsmash(value: string): string {
  return cleanText(
    value
      .replace(/([a-z])(\d)/gi, '$1 $2')
      .replace(/(\d)([A-Za-z])/g, '$1 $2')
      .replace(/%(?=\S)/g, '% '),
  );
}

function tidyClientPhrase(value: string): string {
  return cleanText(
    value
      .replace(/\b1 hours\b/i, '1 hour')
      .replace(/\bposted\s+(\d[\d.]*%\s+hire rate)/i, 'posted, $1'),
  );
}

function clientLocation(root: ParentNode, text: string): string {
  const loc = firstEl(root, ['[data-qa="client-location"]', '[data-test="client-location"]']);
  if (loc) {
    const country = expandCountry(firstText(loc, ['strong']) || '');
    const city = [...loc.querySelectorAll('.nowrap, span')]
      .map((el) => stripClock(el.textContent || ''))
      .find(
        (line) =>
          line &&
          line !== country &&
          line.toUpperCase() !== country.toUpperCase() &&
          !ISO_COUNTRIES[line.toUpperCase()] &&
          line.length > 1 &&
          line.length < 40 &&
          !/posted|hire|spent|verified|member|proposal|payment|phone/i.test(line),
      );
    if (city && country) return `${city}, ${country}`;
    if (country) return country;
  }
  const labeled = firstText(root, [
    '[data-test="client-location"]',
    '[data-qa="client-location"]',
    '[data-test="AboutClient"] [data-test="location"]',
  ]);
  if (labeled) {
    const stripped = stripClock(labeled);
    const iso = stripped.match(/\b([A-Z]{3})\b/);
    const country = iso?.[1] ? expandCountry(iso[1]) : expandCountry(stripped);
    const city = stripped
      .replace(/\b[A-Z]{3}\b/, '')
      .replace(country, '')
      .trim();
    if (city && country && city.toLowerCase() !== country.toLowerCase()) return `${city}, ${country}`;
    return country;
  }

  const lines = text
    .split('\n')
    .map((line) => stripClock(line))
    .filter(Boolean);
  const about = lines.findIndex((line) => /about the client/i.test(line));
  const window = about >= 0 ? lines.slice(about, about + 15) : lines;
  const country =
    window.find((line) => COUNTRIES.test(line) && line.length < 40) ||
    window.find((line) => Boolean(ISO_COUNTRIES[line.toUpperCase()])) ||
    '';
  const expanded = expandCountry(country);
  const city = window.find(
    (line) =>
      Boolean(expanded) &&
      line !== country &&
      line !== expanded &&
      /^[A-Z][A-Za-z .'-]{2,40}$/.test(line) &&
      !/posted|hire|spent|verified|member|proposal|payment|phone|email|about|client/i.test(line),
  );
  if (city && expanded) return `${city}, ${expanded}`;
  return expanded;
}

function stripClock(value: string): string {
  return cleanText(
    value
      .replace(/\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, '')
      .replace(/([A-Za-z])(\d)/g, '$1 $2'),
  );
}

function pricingType(root: ParentNode, text: string): string {
  if (featureLi(root, '[data-cy="fixed-price"]') || /fixed[- ]price/i.test(text)) return 'Fixed-price';
  const hourlyRow = featureLi(root, '[data-cy="clock-hourly"]') || featureLi(root, '[data-cy="clock-timelog"]');
  if (hourlyRow || /hourly rate|\/\s*hr|\bhourly\b/i.test(text)) return 'Hourly';
  return '';
}
