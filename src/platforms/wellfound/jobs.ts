import { firstText } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, firstLine, uniqueJoin } from '@/utils/text';
import { formatCalendarDate, toAbsoluteDate } from '@/utils/date';
import type { PostCandidate } from '@/schema/lead';
import { absoluteUrl, pathOf, safeUrl } from '@/utils/url';
import {
  asText,
  deref,
  derefMany,
  htmlToText,
  nodesOf,
  readApollo,
  tagName,
  type ApolloNode,
  type ApolloStore,
} from './apollo';
import { companySizeLabel, formatFunding, startupFromStore, wellfoundCompanySlug } from './company';

export function wellfoundJobId(url: string): string {
  const parsed = safeUrl(url);
  const path = parsed?.pathname || pathOf(url);
  const fromPath = path.match(/\/jobs\/(\d+)/);
  if (fromPath?.[1]) return fromPath[1];
  const slug =
    parsed?.searchParams.get('job_listing_slug') ||
    parsed?.searchParams.get('jobId') ||
    parsed?.searchParams.get('job_listing_id') ||
    '';
  return slug.match(/^(\d+)/)?.[1] ?? '';
}

export function wellfoundJobSlug(url: string): string {
  const parsed = safeUrl(url);
  const fromPath = (parsed?.pathname || '').match(/\/jobs\/(\d+-[^/?#]+)/);
  if (fromPath?.[1]) return fromPath[1];
  return parsed?.searchParams.get('job_listing_slug') || '';
}

export function isWellfoundJobsFeed(url: URL): boolean {
  return /^\/jobs\/?$/.test(url.pathname);
}

export async function extractWellfoundJob(
  builder: ExtractionBuilder,
  ctx: { url: URL; document: Document; selectedPostId?: string },
) {
  const { document: doc, url } = ctx;
  let jobId = wellfoundJobId(url.toString()) || ctx.selectedPostId || '';
  if (isWellfoundJobsFeed(url) && !jobId) {
    const candidates = wellfoundJobCandidates(doc);
    if (candidates.length !== 1) {
      builder.candidates = candidates;
      builder.warn(candidates.length ? 'Select the job you want to capture.' : 'No Wellfound jobs are visible yet.');
      return builder;
    }
    jobId = candidates[0]?.id ?? '';
  }
  await waitForJob(doc, jobId);
  const store = readApollo(doc);
  const job = currentJob(store, jobId, url);
  const startup = job ? deref(store, job.startup) : startupFromStore(store, wellfoundCompanySlug(url.toString()));
  const visible =
    jobFromModal(doc, url.toString()) ||
    jobFromCard(doc, jobId, url.toString()) ||
    jobFromDom(doc, url.toString()) ||
    emptyVisible();
  const title = asText(job?.title) || visible.title;
  const company = asText(startup?.name) || visible.company;
  const companySlug = asText(startup?.slug) || wellfoundCompanySlug(visible.companyHref);
  const companyPage = companySlug ? `https://wellfound.com/company/${companySlug}` : visible.companyHref;
  const website = asText(startup?.companyUrl) || visible.website;
  const compensation = splitCompensation(asText(job?.compensation) || visible.compensation);
  const locations = uniqueJoin([
    ...stringList(job?.locationNames),
    ...stringList(job?.startupLocationNames),
    visible.location,
  ]);
  const remoteLocations = uniqueJoin(stringList(job?.acceptedRemoteLocationNames));
  const description =
    asText(job?.description) ||
    htmlToText(asText(job?.descriptionHtml)) ||
    visible.description;
  const skills = uniqueJoin([
    ...derefMany(store, job?.skills).map(tagName),
    ...visible.skills,
  ]);
  const industry = uniqueJoin([
    ...derefMany(store, startup?.marketTaggings).map(tagName),
    ...visible.industry,
  ]);
  const contact = recruitingContact(store, job) || visible.contact;
  const posted = toAbsoluteDate(
    postedFromJob(job) ||
      visible.posted ||
      firstText(doc, ['time']),
  );

  builder
    .setType('job')
    .set('jobTitle', title)
    .set('leadName', company || title)
    .set('company', company)
    .set('companyUrl', companyPage)
    .set('jobDescription', description)
    .set('location', locations)
    .set('budget', compensation.salary)
    .set('skills', skills)
    .set('contact', contact)
    .set('jobUrl', canonicalJobUrl(jobId, asText(job?.slug) || wellfoundJobSlug(url.toString()) || wellfoundJobSlug(visible.jobHref), url.toString()))
    .set('sourceUrl', url.toString())
    .set('platformLeadId', jobId || asText(job?.id) || url.pathname)
    .extra('employmentType', 'Employment type', jobTypeLabel(asText(job?.jobType) || visible.jobType || ''))
    .extra('workplaceType', 'Workplace type', workplaceLabel(store, job, visible.workplace || ''))
    .extra('experienceLevel', 'Experience level', experienceLabel(job, visible.experience || ''))
    .extra('datePosted', 'Posting date', posted)
    .extra('jobFunction', 'Job function', asText(job?.primaryRoleTitle))
    .extra('companyIndustry', 'Industry', industry)
    .extra('companySize', 'Company size', companySizeLabel(asText(startup?.companySize)) || visible.companySize)
    .extra('companyWebsite', 'Company website', website)
    .extra('equity', 'Equity', compensation.equity)
    .extra('visaSponsorship', 'Visa sponsorship', boolLabel(job?.visaSponsorship) || visible.visa)
    .extra('funding', 'Funding', formatFunding(startup?.totalRaisedAmount));

  if (remoteLocations) {
    builder.extra('remoteLocations', 'Remote locations', remoteLocations);
  }

  return builder;
}

function currentJob(store: ApolloStore, jobId: string, url: URL): ApolloNode | null {
  const jobs = nodesOf(store, 'JobListing');
  if (jobId) {
    const hit = jobs.find((job) => asText(job.id) === jobId);
    if (hit) return hit;
    if (isWellfoundJobsFeed(url)) return null;
  }
  return jobs.find((job) => asText(job.description) || asText(job.descriptionHtml)) ?? jobs[0] ?? null;
}

function canonicalJobUrl(jobId: string, slug: string, fallback: string): string {
  if (slug && /^\d+-/.test(slug)) return `https://wellfound.com/jobs/${slug}`;
  if (jobId && slug) return `https://wellfound.com/jobs/${jobId}-${slug}`;
  if (jobId) return `https://wellfound.com/jobs/${jobId}`;
  return fallback;
}

function postedFromJob(job: ApolloNode | null): string {
  if (!job) return '';
  const meta = job.meta && typeof job.meta === 'object' ? (job.meta as ApolloNode) : null;
  const structured = asText(meta?.structuredData);
  if (structured) {
    try {
      const parsed = JSON.parse(structured) as { datePosted?: string };
      if (parsed.datePosted) return toAbsoluteDate(parsed.datePosted) || parsed.datePosted;
    } catch {
      // Ignore broken JobPosting JSON.
    }
  }
  const unix = job.liveStartAt;
  if (typeof unix === 'number' && unix > 0) {
    const ms = unix > 1e12 ? unix : unix * 1000;
    return formatCalendarDate(new Date(ms));
  }
  return '';
}

function jobTypeLabel(value: string): string {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    full_time: 'Full-time',
    part_time: 'Part-time',
    contract: 'Contract',
    intern: 'Internship',
    internship: 'Internship',
    cofounder: 'Cofounder',
    freelance: 'Freelance',
  };
  return labels[key] || cleanText(value.replace(/_/g, ' '));
}

function workplaceLabel(store: ApolloStore, job: ApolloNode | null, fallback: string): string {
  if (fallback) return fallback;
  if (!job) return '';
  const config = deref(store, job.remoteConfig);
  const kind = asText(config?.kind);
  if (kind === 'REMOTE' || job.remote === true) return 'Remote';
  if (kind === 'HYBRID') return 'Hybrid';
  if (kind === 'ONSITE') return 'On-site';
  if (config?.wfhFlexible === true) return 'Remote optional';
  return '';
}

function experienceLabel(job: ApolloNode | null, fallback: string): string {
  if (fallback) return fallback;
  if (!job) return '';
  const min = numberish(job.yearsExperienceMin);
  const max = numberish(job.yearsExperienceMax);
  if (min != null && max != null) return `${min}–${max} years`;
  if (min != null) return `${min}+ years`;
  if (max != null) return `Up to ${max} years`;
  return '';
}

function recruitingContact(store: ApolloStore, job: ApolloNode | null): string {
  if (!job) return '';
  const user = deref(store, job.recruitingContact);
  const name = asText(user?.name);
  const slug = asText(user?.slug);
  if (name && slug) return `${name} (https://wellfound.com/u/${slug})`;
  if (name) return name;
  const role = derefMany(store, (job.coworkers as ApolloNode | undefined)?.edges).map((edge) =>
    deref(store, (edge as ApolloNode).node),
  )[0];
  const founder = deref(store, role?.user);
  const founderName = asText(founder?.name);
  const title = asText(role?.title) || asText(role?.roleDisplayName);
  const founderSlug = asText(founder?.slug);
  if (!founderName) return '';
  const label = title ? `${founderName}, ${title}` : founderName;
  return founderSlug ? `${label} (https://wellfound.com/u/${founderSlug})` : label;
}

function splitCompensation(value: string): { salary: string; equity: string } {
  const parts = value
    .split('•')
    .map((part) => cleanText(part))
    .filter(Boolean);
  const salary = parts.find((part) => /[$€£₹]|k\b|\bL\b/i.test(part) && !/%/.test(part)) || '';
  const equity = parts.find((part) => /equity|%/.test(part)) || '';
  if (salary || equity) return { salary, equity };
  return { salary: value, equity: '' };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter(Boolean);
}

function boolLabel(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

function numberish(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type VisibleJob = {
  title: string;
  company: string;
  companyHref: string;
  compensation: string;
  location: string;
  workplace: string;
  jobType: string;
  experience: string;
  companySize: string;
  website: string;
  description: string;
  skills: string[];
  industry: string[];
  contact: string;
  posted: string;
  visa: string;
  jobHref: string;
};

function emptyVisible(): VisibleJob {
  return {
    title: '',
    company: '',
    companyHref: '',
    compensation: '',
    location: '',
    workplace: '',
    jobType: '',
    experience: '',
    companySize: '',
    website: '',
    description: '',
    skills: [],
    industry: [],
    contact: '',
    posted: '',
    visa: '',
    jobHref: '',
  };
}

function jobFromModal(doc: Document, pageUrl: string): VisibleJob | null {
  const root = wellfoundJobModal(doc);
  if (!root) return null;
  return visibleFromRoot(root, pageUrl);
}

function jobFromCard(doc: Document, jobId: string, pageUrl: string): VisibleJob | null {
  if (!jobId || !isWellfoundJobsFeed(new URL(pageUrl))) return null;
  const card = findWellfoundJobById(doc, jobId);
  if (!card) return null;
  return visibleFromRoot(card, pageUrl);
}

function jobFromDom(doc: Document, pageUrl: string): VisibleJob | null {
  const titleRaw = firstText(doc, ['h1']);
  if (!titleRaw || /^search for jobs$/i.test(titleRaw)) return null;
  return visibleFromRoot(
    (doc.querySelector('h1')?.closest('main, article, [class*="job"]') as HTMLElement | null) ?? doc.body,
    pageUrl,
  );
}

export function wellfoundJobCandidates(doc: Document): PostCandidate[] {
  return findWellfoundJobCards(doc).map((card) => {
    const parsed = visibleFromRoot(card, location.href);
    return {
      id: wellfoundJobIdFromEl(card),
      author: parsed.company || parsed.title || 'Wellfound job',
      snippet: firstLine([parsed.title, parsed.compensation, parsed.location].filter(Boolean).join(' · '), 160),
      timestamp: toAbsoluteDate(parsed.posted) || parsed.posted,
    };
  });
}

export function findWellfoundJobCards(doc: Document): HTMLElement[] {
  const seen = new Set<string>();
  const cards: HTMLElement[] = [];
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/"]')) {
    if (link.closest('[class*="ReactModal"], [role="dialog"], [aria-modal="true"]')) continue;
    const id = wellfoundJobIdFromEl(link);
    if (!id || seen.has(id)) continue;
    const card = wellfoundCardRoot(link);
    if (!card) continue;
    seen.add(id);
    cards.push(card);
  }
  return cards;
}

export function findWellfoundJobById(doc: Document, jobId: string): HTMLElement | null {
  if (!jobId) return null;
  return findWellfoundJobCards(doc).find((card) => wellfoundJobIdFromEl(card) === jobId) ?? null;
}

export function wellfoundJobIdFromEl(el: Element): string {
  const href =
    (el instanceof HTMLAnchorElement ? el.getAttribute('href') : '') ||
    el.querySelector('a[href*="/jobs/"]')?.getAttribute('href') ||
    '';
  try {
    return wellfoundJobId(new URL(href, 'https://wellfound.com').toString());
  } catch {
    return '';
  }
}

function wellfoundCardRoot(link: HTMLElement): HTMLElement {
  return (
    link.closest<HTMLElement>('[class*="styles_component__Ey"]') ||
    (link.matches('[class*="jobLink"]') ? link : null) ||
    link.closest<HTMLElement>('article, li') ||
    link
  );
}

function wellfoundJobModal(doc: Document): HTMLElement | null {
  const nodes = [
    ...doc.querySelectorAll<HTMLElement>('[class*="ReactModal__Content"], [role="dialog"], [aria-modal="true"]'),
  ];
  return (
    nodes.find((el) => /about the job|apply now/i.test(elementText(el))) ??
    nodes.find((el) => el.querySelector('h1, h2')) ??
    null
  );
}

function visibleFromRoot(root: HTMLElement, pageUrl: string): VisibleJob {
  const text = elementText(root);
  const traits = characteristicMap(root);
  const companyLink = companyAnchorNear(root);
  const companyHref = companyLink ? absoluteUrl(companyLink.getAttribute('href'), pageUrl) : '';
  const company =
    firstLine(cleanText(companyLink?.textContent), 80) ||
    labeledValue(text, 'about the company') ||
    companyFromTitle(headingText(root));
  const title = stripCompanyTitle(headingText(root) || firstLine(text, 160), company);
  const skills = [
    ...[...root.querySelectorAll('a[href*="/skills/"], a[href*="/skill/"]')].map((el) => cleanText(el.textContent)),
    ...sectionLines(text, /^skills$/i, /about the job|about the company|hiring contact/i),
  ].filter(Boolean);
  const industry = sectionLines(
    text,
    /^(company industries?|industry)$/i,
    /learn more|jobs at|similar jobs|about the job|about the company/i,
  );
  const posted =
    cleanText(
      text.match(
        /posted[:\s]+((?:today|just now|yesterday|(?:an?|\d+)\s+(?:minute|hour|day|week|month|year)s?\s+ago))/i,
      )?.[1] ||
        '',
    ) || labeledValue(text, 'posted');
  return {
    title,
    company,
    companyHref,
    compensation:
      firstText(root, ['[class*="subheader"]']) ||
      compensationFromText(text) ||
      labeledValue(text, 'compensation'),
    location: uniqueJoin([
      traits.get('job location') || labeledValue(text, 'job location'),
      locationFromText(text),
      traits.get('hires remotely') || labeledValue(text, 'hires remotely in'),
      labeledValue(text, 'company location'),
      companyLocations(root),
    ]),
    workplace:
      traits.get('remote work policy') ||
      labeledValue(text, 'remote work policy') ||
      (/\bremote only\b/i.test(text) ? 'Remote only' : /\bin office\b/i.test(text) ? 'In office' : ''),
    jobType: traits.get('job type') || labeledValue(text, 'job type') || employmentFromText(text),
    experience: traits.get('experience') || labeledValue(text, 'experience') || experienceFromText(text),
    companySize: sizeFromText(text) || labeledValue(text, 'company size'),
    website: firstText(root, ['button[class*="website"]']) || '',
    description: descriptionFromText(text),
    skills,
    industry,
    contact:
      firstText(root, ['[class*="identity"] a', 'a[href*="/u/"]']) || labeledValue(text, 'hiring contact'),
    posted,
    visa: visaLabel(visaFromText(text) || traits.get('visa sponsorship') || labeledValue(text, 'visa sponsorship')),
    jobHref: jobHrefFrom(root, pageUrl),
  };
}

function elementText(el: Element): string {
  return cleanText('innerText' in el ? (el as HTMLElement).innerText : el.textContent || '');
}

function headingText(root: HTMLElement): string {
  const skip = /^(about the job|about the company|search for jobs)$/i;
  if (root.matches('h1, h2, h3')) {
    const own = cleanText(root.textContent);
    if (own && !skip.test(own)) return own;
  }
  for (const el of root.querySelectorAll('h1, h2, h3')) {
    const text = cleanText(el.textContent);
    if (text && !skip.test(text)) return text;
  }
  return '';
}

function companyAnchorNear(root: HTMLElement): HTMLAnchorElement | null {
  let node: HTMLElement | null = root;
  for (let i = 0; i < 8 && node; i += 1) {
    for (const link of node.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]')) {
      const name = firstLine(cleanText(link.textContent), 80);
      if (name && !/learn more|see all jobs|funding/i.test(name)) return link;
    }
    node = node.parentElement;
  }
  return null;
}

function jobHrefFrom(root: HTMLElement, pageUrl: string): string {
  if (root instanceof HTMLAnchorElement && /\/jobs\/\d+/.test(root.getAttribute('href') || '')) {
    return absoluteUrl(root.getAttribute('href'), pageUrl);
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/"]')) {
    if (/\/jobs\/\d+/.test(link.getAttribute('href') || '')) {
      return absoluteUrl(link.getAttribute('href'), pageUrl);
    }
  }
  return '';
}

function labeledValue(text: string, label: string): string {
  const match = text.match(new RegExp(`(?:^|\\n)${escapeReg(label)}\\s*[:\\n]+([^\\n]+)`, 'i'));
  return cleanText(match?.[1] || '');
}

function sectionLines(text: string, start: RegExp, stop: RegExp): string[] {
  const lines = text.split('\n').map((line) => cleanText(line)).filter(Boolean);
  const index = lines.findIndex((line) => start.test(line));
  if (index < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (stop.test(line)) break;
    out.push(line);
  }
  return out;
}

function locationFromText(text: string): string {
  const remotePlace = cleanText(text.match(/remote\s*\(([^)]+)\)/i)?.[1] || '');
  return remotePlace ? `Remote (${remotePlace})` : '';
}

function descriptionFromText(text: string): string {
  const start = text.search(/about the job|role overview|job description/i);
  if (start < 0) return '';
  return cleanText(
    text
      .slice(start)
      .split(/\n(?=About the company|Meet your team|Similar jobs|Jobs at )/i)[0]
      ?.replace(/^(about the job|role overview|job description)\s*/i, ''),
  ).slice(0, 8000);
}

function visaFromText(text: string): string {
  const match = text.match(/visa sponsorship\s*[:\n]+\s*(not available|available)/i);
  return match?.[1] || '';
}

function visaLabel(value: string): string {
  const key = value.trim().toLowerCase();
  if (!key) return '';
  if (/not available|^no\b/.test(key)) return 'No';
  if (/available|^yes\b/.test(key)) return 'Yes';
  return cleanText(value);
}

function employmentFromText(text: string): string {
  return cleanText(text.match(/\b(full[ -]?time|part[ -]?time|contract|internship|cofounder|freelance)\b/i)?.[1] || '');
}

function experienceFromText(text: string): string {
  return cleanText(text.match(/(\d+\+?\s*(?:-|–)\s*\d+\s+years?|\d+\+?\s+years?(?:\s+of exp)?)/i)?.[1] || '');
}

function visibleBlock(doc: Document): string {
  const h1 = [...doc.querySelectorAll('h1')].find((el) => !/^search for jobs$/i.test(cleanText(el.textContent)));
  const root = h1?.closest('main, article, [class*="job"]') ?? doc.body;
  return elementText(root);
}

function characteristicMap(root: ParentNode): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of root.querySelectorAll('[class*="characteristic"]')) {
    const lines = cleanText(el.textContent)
      .split('\n')
      .map((line) => cleanText(line))
      .filter(Boolean);
    const label = lines[0]?.toLowerCase() ?? '';
    const value = cleanText(lines.slice(1).join(' '));
    if (label && value) map.set(label, value);
  }
  return map;
}

function companyFromTitle(title: string): string {
  const match = title.match(/\sat\s+(.+)$/);
  return cleanText(match?.[1] || '');
}

function stripCompanyTitle(title: string, company: string): string {
  if (!company) return title.replace(/\sat\s+[A-Z].*$/, '').trim() || title;
  return title.replace(new RegExp(`\\s+at\\s+${escapeReg(company)}$`, 'i'), '').trim() || title;
}

function companyLocations(root: ParentNode): string {
  return uniqueJoin(
    [...root.querySelectorAll('a[href*="/l/"], a[href*="/location/"]')].map((el) => cleanText(el.textContent)),
  );
}

function compensationFromText(text: string): string {
  return (
    text.match(/([$€£₹][\d.,]+[kKmMlL]?(?:\s*[–-]\s*[$€£₹]?[\d.,]+[kKmMlL]?)?(?:\s*•\s*[^.\n]+)?)/)?.[1] ||
    ''
  );
}

function sizeFromText(text: string): string {
  const match = text.match(/\b(\d+\s*-\s*\d+\s+employees|\d{1,3}\+?\s+employees)\b/i);
  return cleanText(match?.[1] || '');
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitForJob(doc: Document, jobId: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (wellfoundJobModal(doc)) return;
    const store = readApollo(doc);
    if (jobId && nodesOf(store, 'JobListing').some((job) => asText(job.id) === jobId)) return;
    const title = headingText(doc.body);
    if (title && !/^search for jobs$/i.test(title) && /\$|₹|equity|remote|full time|posted|about the job/i.test(visibleBlock(doc))) {
      return;
    }
    if (jobId && findWellfoundJobById(doc, jobId)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
