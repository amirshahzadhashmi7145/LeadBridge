import { ExtractionBuilder, identityFromLead } from '@/platforms/builder';
import type { ExtractContext, PlatformAdapter } from '@/platforms/types';
import type { PageType } from '@/schema/lead';
import { extractWellfoundCompany, wellfoundCompanySlug } from './company';
import { extractWellfoundJob, wellfoundJobId } from './jobs';

function pageType(url: URL): PageType {
  const path = url.pathname;
  if (/\/jobs\/\d+/.test(path) || /^\/jobs\/?$/.test(path)) return 'job';
  if (url.searchParams.get('job_listing_slug') || url.searchParams.get('jobId')) return 'job';
  if (/\/company\/[^/]+/.test(path)) return 'company';
  return 'unsupported';
}

export const wellfoundAdapter: PlatformAdapter = {
  id: 'wellfound',
  sourceName: 'Wellfound',
  enabledByDefault: true,
  match(url) {
    return /(^|\.)wellfound\.com$/i.test(url.hostname) || /(^|\.)angel\.co$/i.test(url.hostname);
  },
  detectPageType(ctx) {
    return pageType(ctx.url);
  },
  async extract(ctx: ExtractContext) {
    const type = pageType(ctx.url);
    const builder = new ExtractionBuilder('wellfound', 'Wellfound', type, ctx.url.toString());
    if (type === 'job') {
      await extractWellfoundJob(builder, ctx);
      const result = builder.result('job');
      if (!ctx.selectedPostId && (result.candidates?.length ?? 0) > 1 && !builder.has('jobTitle')) {
        return { needsSelection: true, result };
      }
      return result;
    }
    if (type === 'company') {
      extractWellfoundCompany(builder, ctx);
      return builder.result('company');
    }
    builder
      .set('leadName', ctx.document.title.replace(/\s*[•|].*$/, ''))
      .set('sourceUrl', ctx.url.toString())
      .set('platformLeadId', ctx.url.pathname)
      .warn('Open a Wellfound job or company page to capture details.');
    return builder.result(type);
  },
  getLeadIdentity(lead) {
    const identity = identityFromLead(lead);
    if (!identity.platformLeadId) {
      identity.platformLeadId =
        wellfoundJobId(lead.jobUrl || lead.sourceUrl) ||
        wellfoundCompanySlug(lead.companyUrl || lead.sourceUrl);
    }
    return identity;
  },
};
