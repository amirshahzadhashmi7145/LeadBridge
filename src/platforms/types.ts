import type {
  ExtractionResult,
  Lead,
  LeadIdentity,
  PageType,
} from '@/schema/lead';

export interface ExtractContext {
  url: URL;
  document: Document;
  selectedPostId?: string;
}

export interface PlatformAdapter {
  id: string;
  sourceName: string;
  enabledByDefault: boolean;
  match(url: URL): boolean;
  detectPageType(ctx: ExtractContext): PageType;
  extract(ctx: ExtractContext): Promise<ExtractionResult | { needsSelection: true; result: ExtractionResult }>;
  getLeadIdentity(lead: Lead): LeadIdentity;
}
