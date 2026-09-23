import { ExtractionBuilder, identityFromLead } from '@/platforms/builder';
import type { ExtractContext, PlatformAdapter } from '@/platforms/types';
import type { PageType } from '@/schema/lead';
import { extractUpworkJob, upworkJobId } from './jobs';

function pageType(url: URL): PageType {
  const path = url.pathname;
  if (path.includes('/jobs/')) return 'job';
  if (path.includes('/ab/applicants/') || path.includes('/nx/find-work/')) return 'job';
  if (path.includes('/freelancers/') || path.includes('/agencies/')) return 'profile';
  return 'unsupported';
}

export const upworkAdapter: PlatformAdapter = {
  id: 'upwork',
  sourceName: 'Upwork',
  enabledByDefault: true,
  match(url) {
    return /(^|\.)upwork\.com$/i.test(url.hostname);
  },
  detectPageType(ctx) {
    return pageType(ctx.url);
  },
  async extract(ctx: ExtractContext) {
    const type = pageType(ctx.url);
    const builder = new ExtractionBuilder('upwork', 'Upwork', type, ctx.url.toString());
    if (type === 'job') {
      extractUpworkJob(builder, ctx);
      return builder.result('job');
    }
    builder
      .set('leadName', ctx.document.title.replace(/-\s*Upwork.*$/i, ''))
      .set('sourceUrl', ctx.url.toString())
      .set('platformLeadId', upworkJobId(ctx.url.toString()) || ctx.url.pathname)
      .warn('Open an Upwork job page to capture client and job details.');
    return builder.result(type);
  },
  getLeadIdentity(lead) {
    const identity = identityFromLead(lead);
    if (!identity.platformLeadId) {
      identity.platformLeadId = upworkJobId(lead.jobUrl || lead.sourceUrl);
    }
    return identity;
  },
};
