import type { Lead } from '@/schema/lead';

export interface DuplicateMatch {
  rowNumber: number;
  lead: Partial<Lead>;
  capturedBy: string;
  capturedAt: string;
  source: string;
  sameUser: boolean;
}

export interface SaveResult {
  action: 'created' | 'updated';
  rowNumber: number;
  lead: Lead;
}
