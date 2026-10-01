/** Team sheet credentials come from local `.env` at build time. They are not in git. */

function env(name: 'WXT_GOOGLE_WEB_APP_URL' | 'WXT_SPREADSHEET_ID' | 'WXT_SHEET_NAME'): string {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export const COMPANY_SPREADSHEET_ID = env('WXT_SPREADSHEET_ID');
export const COMPANY_SHEET_NAME = env('WXT_SHEET_NAME') || 'LeadBridge';
export const COMPANY_GOOGLE_WEB_APP_URL = env('WXT_GOOGLE_WEB_APP_URL');
