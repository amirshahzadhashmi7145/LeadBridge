import { firstHref, firstText, isMostlyVisible, visibleOverlap } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import type { PostCandidate } from '@/schema/lead';
import { cleanText, firstLine } from '@/utils/text';
import { absoluteUrl } from '@/utils/url';

const POST_SELECTORS = [
  'div.feed-shared-update-v2[data-urn]',
  'div[data-urn^="urn:li:activity:"]',
  'div[data-urn^="urn:li:ugcPost:"]',
  'article[data-urn^="urn:li:activity:"]',
  'div.main-feed-activity-card[data-urn]',
].join(',');

export function findPostElements(doc: Document): HTMLElement[] {
  const seen = new Set<string>();
  const posts: HTMLElement[] = [];
  doc.querySelectorAll<HTMLElement>(POST_SELECTORS).forEach((el) => {
    const id = postIdFromEl(el);
    if (!id || seen.has(id)) return;
    if (el.closest('.comments-comment-item, .comments-comments-list')) return;
    seen.add(id);
    posts.push(el);
  });
  return posts;
}

export function visiblePostElements(doc: Document): HTMLElement[] {
  return findPostElements(doc)
    .filter((el) => isMostlyVisible(el, 90))
    .sort((a, b) => visibleOverlap(b) - visibleOverlap(a));
}

export function postIdFromEl(el: Element): string {
  return el.getAttribute('data-urn') || el.getAttribute('data-id') || '';
}

export function postCandidates(doc: Document): PostCandidate[] {
  return visiblePostElements(doc).map((el) => {
    const extracted = readPost(el, location.href);
    return {
      id: extracted.id,
      author: extracted.author,
      snippet: firstLine(extracted.text, 160),
      timestamp: extracted.timestamp,
    };
  });
}

export function findPostById(doc: Document, id: string): HTMLElement | null {
  return (
    findPostElements(doc).find((el) => postIdFromEl(el) === id) ??
    doc.querySelector<HTMLElement>(`[data-urn="${CSS.escape(id)}"]`)
  );
}

export function extractLinkedInPost(
  builder: ExtractionBuilder,
  ctx: { url: URL; document: Document; selectedPostId?: string },
) {
  const visible = visiblePostElements(ctx.document);
  const selected = ctx.selectedPostId
    ? findPostById(ctx.document, ctx.selectedPostId)
    : visible.length === 1
      ? visible[0]
      : mostDominantPost(visible);

  if (!selected) {
    builder.candidates = postCandidates(ctx.document);
    builder.warn('Select the post you want to capture.');
    return builder;
  }

  const post = readPost(selected, ctx.url.toString());
  const postUrl =
    post.url ||
    (post.id ? `https://www.linkedin.com/feed/update/${encodeURIComponent(post.id)}/` : ctx.url.toString());

  builder
    .setType('post')
    .set('leadName', post.author)
    .set('contact', post.headline)
    .set('company', post.company)
    .set('postContent', post.text)
    .set('profileUrl', post.profileUrl)
    .set('sourceUrl', postUrl)
    .set('jobUrl', postUrl)
    .set('platformLeadId', post.id || postUrl)
    .extra('authorHeadline', 'Author headline', post.headline)
    .extra('postTimestamp', 'Post date', post.timestamp)
    .extra('postLinks', 'Links in post', post.links)
    .extra('postId', 'Post ID', post.id);

  return builder;
}

function mostDominantPost(posts: HTMLElement[]): HTMLElement | undefined {
  if (posts.length === 0) return undefined;
  if (posts.length === 1) return posts[0];
  const [first, second] = posts;
  if (!first || !second) return first;
  const a = visibleOverlap(first);
  const b = visibleOverlap(second);
  if (a >= window.innerHeight * 0.55 && a > b * 1.6) return first;
  return undefined;
}

function readPost(el: HTMLElement, base: string) {
  const id = postIdFromEl(el);
  const author = firstText(el, [
    '.update-components-actor__title span[aria-hidden="true"]',
    '.update-components-actor__name',
    '.update-components-actor__title',
    '.feed-shared-actor__name',
    'a.update-components-actor__meta-link',
  ]);
  const headline = firstText(el, [
    '.update-components-actor__description',
    '.update-components-actor__sub-description',
    '.feed-shared-actor__description',
  ]);
  const timestamp = firstText(el, [
    '.update-components-actor__sub-description span[aria-hidden="true"]',
    'time',
    '.feed-shared-actor__sub-description',
  ]);
  const text = firstText(el, [
    '.feed-shared-update-v2__description',
    '.update-components-text',
    '.feed-shared-text',
    '.break-words',
    '[class*="update-components-update-v2__commentary"]',
  ]);
  const profileUrl = firstHref(
    el,
    [
      'a.update-components-actor__meta-link',
      'a.update-components-actor__image',
      '.update-components-actor__title a',
      'a.app-aware-link[href*="/in/"]',
    ],
    base,
  );
  const links = [...el.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((anchor) => absoluteUrl(anchor.href, base))
    .filter((href) => href && !href.includes('linkedin.com/feed') && !href.includes('miniProfileUrn'))
    .slice(0, 8)
    .join('\n');
  const company = /·/.test(headline)
    ? cleanText(headline.split('·')[0])
    : /\bat\b/i.test(headline)
      ? cleanText(headline.split(/\bat\b/i)[1])
      : '';
  const permalink = firstHref(
    el,
    [
      'a.control-link',
      'a.app-aware-link[href*="/feed/update/"]',
      'a[href*="/posts/"]',
    ],
    base,
  );

  return {
    id,
    author,
    headline,
    timestamp,
    text,
    profileUrl,
    links,
    company,
    url: permalink,
  };
}
