import {
  EMPTY_LEAD,
  FIELD_LABELS,
  type ExtractionResult,
  type FieldMeta,
  type FieldStatus,
  type Lead,
  type LeadIdentity,
  type LeadType,
  type PageType,
  type PostCandidate,
} from '@/schema/lead';
import { absoluteDateValue } from '@/utils/date';
import { flattenLines, hashId } from '@/utils/text';
import { normalizeUrl } from '@/utils/url';

export class ExtractionBuilder {
  private lead: Lead = {
    ...EMPTY_LEAD,
    platformFields: {},
  };
  private status = new Map<string, FieldStatus>();
  private extras: Array<{ key: string; label: string; value: string; status: FieldStatus }> =
    [];
  warnings: string[] = [];
  candidates: PostCandidate[] = [];

  constructor(
    private readonly platformId: string,
    private readonly sourceName: string,
    pageType: PageType,
    sourceUrl: string,
  ) {
    this.lead.source = sourceName;
    this.lead.leadType =
      pageType === 'unsupported' ? 'unknown' : pageType === 'feed' ? 'post' : pageType;
    this.lead.sourceUrl = sourceUrl;
    this.mark('source', sourceName);
    this.mark('leadType', this.lead.leadType);
    this.mark('sourceUrl', sourceUrl);
    this.mark('status', this.lead.status);
  }

  set<K extends keyof Lead>(key: K, value: string | undefined | null): this {
    if (key === 'platformFields' || key === 'leadType' || key === 'status') {
      return this;
    }
    let cleaned = (value ?? '').toString().trim();
    if (key === 'jobDescription') cleaned = flattenLines(cleaned);
    cleaned = absoluteDateValue(String(key), cleaned);
    (this.lead[key] as string) = cleaned;
    this.status.set(key, cleaned ? 'found' : 'missing');
    return this;
  }

  setType(type: LeadType): this {
    this.lead.leadType = type;
    this.mark('leadType', type);
    return this;
  }

  extra(key: string, label: string, value: string | undefined | null): this {
    const cleaned = absoluteDateValue(key, (value ?? '').toString().trim(), label);
    if (cleaned) this.lead.platformFields[key] = cleaned;
    this.extras.push({
      key,
      label,
      value: cleaned,
      status: cleaned ? 'found' : 'missing',
    });
    return this;
  }

  warn(message: string): this {
    this.warnings.push(message);
    return this;
  }

  peek(): Lead {
    return this.lead;
  }

  has(key: keyof Lead): boolean {
    const value = this.lead[key];
    return typeof value === 'string' ? value.trim().length > 0 : false;
  }

  identityFrom(options?: Partial<LeadIdentity>): LeadIdentity {
    const identity: LeadIdentity = {
      platformLeadId: options?.platformLeadId || this.lead.platformLeadId,
      jobUrl: normalizeUrl(options?.jobUrl || this.lead.jobUrl),
      profileUrl: normalizeUrl(options?.profileUrl || this.lead.profileUrl),
      postId: options?.postId || this.lead.platformFields.postId || '',
      sourceUrl: normalizeUrl(options?.sourceUrl || this.lead.sourceUrl),
    };
    if (!this.lead.platformLeadId && identity.platformLeadId) {
      this.lead.platformLeadId = identity.platformLeadId;
      this.mark('platformLeadId', identity.platformLeadId);
    }
    if (!this.lead.leadId) {
      const raw =
        identity.platformLeadId ||
        identity.jobUrl ||
        identity.postId ||
        identity.profileUrl ||
        identity.sourceUrl;
      this.lead.leadId = `${this.platformId}:${hashId(raw)}`;
    }
    this.mark('leadId', this.lead.leadId);
    return identity;
  }

  result(pageType: PageType, identity?: LeadIdentity): ExtractionResult {
    const resolved = identity ?? this.identityFrom();
    const fields = this.toFields();
    return {
      ok: true,
      lead: { ...this.lead, platformFields: { ...this.lead.platformFields } },
      fields,
      missingFields: fields.filter((field) => field.status === 'missing').map((f) => f.label),
      foundFields: fields.filter((field) => field.status === 'found').map((f) => f.label),
      warnings: [...this.warnings],
      pageType,
      platformId: this.platformId,
      sourceName: this.sourceName,
      identity: resolved,
      candidates: this.candidates.length ? this.candidates : undefined,
    };
  }

  private mark(key: string, value: string) {
    this.status.set(key, value ? 'found' : 'missing');
  }

  private toFields(): FieldMeta[] {
    const skip = new Set([
      'leadId',
      'source',
      'leadType',
      'status',
      'capturedBy',
      'capturedAt',
      'lastUpdatedBy',
      'lastUpdatedAt',
      'salesOwner',
      'platformFields',
    ]);
    const fields: FieldMeta[] = [];
    for (const [key, value] of Object.entries(this.lead)) {
      if (skip.has(key) || typeof value !== 'string') continue;
      if (!value && !this.status.has(key)) continue;
      fields.push({
        key,
        label: FIELD_LABELS[key] ?? key,
        value,
        status: this.status.get(key) ?? (value ? 'found' : 'missing'),
        multiline: key === 'jobDescription' || key === 'postContent' || key === 'notes' || key === 'skills',
      });
    }
    for (const extra of this.extras) {
      fields.push({
        key: `platform:${extra.key}`,
        label: extra.label,
        value: extra.value,
        status: extra.status,
        platformSpecific: true,
      });
    }
    return fields;
  }
}

export function identityFromLead(lead: Lead): LeadIdentity {
  return {
    platformLeadId: lead.platformLeadId,
    jobUrl: normalizeUrl(lead.jobUrl),
    profileUrl: normalizeUrl(lead.profileUrl),
    postId: lead.platformFields.postId ?? '',
    sourceUrl: normalizeUrl(lead.sourceUrl),
  };
}
