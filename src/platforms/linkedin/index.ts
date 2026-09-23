import { ExtractionBuilder, identityFromLead } from '@/platforms/builder';
import type { ExtractContext, PlatformAdapter } from '@/platforms/types';
import type { PageType } from '@/schema/lead';
import { pathOf, searchParam } from '@/utils/url';
import { extractLinkedInCompany, linkedinCompanySlug } from './company';
import { extractLinkedInJob, linkedinJobId } from './jobs';
import { extractLinkedInPost, postCandidates } from './posts';

function pageType(url: URL, doc?: Document): PageType {
  const path = url.pathname;
  if (
    path.includes('/jobs/view/') ||
    path.includes('/jobs/collections/') ||
    path.includes('/jobs/search/') ||
    path.includes('/jobs/search-results/') ||
    searchParam(url.toString(), 'currentJobId')
  ) {
    return 'job';
  }
  if (path.includes('/company/')) return 'company';
  if (path.includes('/feed/update/') || path.includes('/posts/') || path.includes('/pulse/')) {
    return 'post';
  }
  if (path === '/feed' || path.startsWith('/feed/')) return 'feed';
  if (path.startsWith('/in/')) return 'profile';
  if (doc?.querySelector('div.feed-shared-update-v2, div[data-urn^="urn:li:activity:"]')) {
    return 'feed';
  }
  return 'unsupported';
}

export const linkedinAdapter: PlatformAdapter = {
  id: 'linkedin',
  sourceName: 'LinkedIn',
  enabledByDefault: true,
  match(url) {
    return /(^|\.)linkedin\.com$/i.test(url.hostname);
  },
  detectPageType(ctx) {
    return pageType(ctx.url, ctx.document);
  },
  async extract(ctx: ExtractContext) {
    const type = pageType(ctx.url, ctx.document);
    const builder = new ExtractionBuilder(
      'linkedin',
      'LinkedIn',
      type,
      ctx.url.toString(),
    );

    if (type === 'job') {
      extractLinkedInJob(builder, ctx);
      return builder.result('job');
    }
    if (type === 'company') {
      extractLinkedInCompany(builder, ctx);
      return builder.result('company');
    }
    if (type === 'feed' || type === 'post') {
      extractLinkedInPost(builder, ctx);
      const result = builder.result(type === 'post' ? 'post' : 'feed');
      const candidates = result.candidates ?? postCandidates(ctx.document);
      if (!ctx.selectedPostId && candidates.length > 1 && !builder.has('postContent')) {
        return {
          needsSelection: true,
          result: { ...result, candidates },
        };
      }
      if (type === 'feed' && !builder.has('postContent') && candidates.length === 0) {
        builder.warn('No LinkedIn post is currently visible on screen.');
      }
      return result;
    }

    builder.warn(
      'This LinkedIn page type is not supported yet. Open a job, company page, or a post in the feed.',
    );
    builder
      .set('leadName', ctx.document.title)
      .set('sourceUrl', ctx.url.toString())
      .set('platformLeadId', pathOf(ctx.url.toString()));
    return builder.result('unsupported');
  },
  getLeadIdentity(lead) {
    const identity = identityFromLead(lead);
    if (!identity.platformLeadId) {
      identity.platformLeadId =
        linkedinJobId(lead.jobUrl || lead.sourceUrl) ||
        linkedinCompanySlug(lead.sourceUrl) ||
        lead.platformFields.postId ||
        '';
    }
    return identity;
  },
};
