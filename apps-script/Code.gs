/**
 * Paste this entire file into the Google Apps Script project that owns the
 * web app URL, then Deploy → Manage deployments → edit → New version.
 * Execute as: Me. Who has access: Anyone. Keep the same /exec URL.
 */
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const SHEET_NAME = 'LeadBridge';

/** Run this once in the Apps Script editor (Run ▶) and click Allow. */
function authorize() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || 'ping').toLowerCase();
    if (action === 'begin') {
      const id = Utilities.getUuid();
      return json_({ status: 'ok', service: 'LeadBridge', uploadId: id, v: 2, parallel: false });
    }
    if (action === 'chunk') {
      const id = String(params.id || '');
      if (!id) return json_({ status: 'error', message: 'Missing upload id.' });
      const cache = CacheService.getScriptCache();
      const value = String(params.data || '');
      const index = params.i;
      if (index !== undefined && index !== '') {
        const stored = cache.put(cacheKey_(id) + '_' + String(index), value, 600);
        if (params.n) cache.put(cacheKey_(id) + '_n', String(params.n), 600);
        if (!stored) return json_({ status: 'error', message: 'Could not store upload chunk. Save again.' });
        return json_({
          status: 'ok',
          service: 'LeadBridge',
          stored: true,
          i: Number(index),
          n: Number(params.n || 0),
          v: 2,
        });
      }
      const key = cacheKey_(id);
      const stored = cache.put(key, String(cache.get(key) || '') + value, 600);
      if (!stored) return json_({ status: 'error', message: 'Could not store upload chunk. Save again.' });
      return json_({ status: 'ok', service: 'LeadBridge', stored: true, v: 2 });
    }
    if (action === 'commit') {
      const id = String(params.id || '');
      const raw = readUpload_(id);
      if (!raw) return json_({ status: 'error', message: 'Upload expired. Save again.' });
      return json_(handlePayload_(JSON.parse(raw)));
    }
    if (params.payload) {
      return json_(handlePayload_(JSON.parse(params.payload)));
    }
    if (action === 'check') {
      return json_(checkLead_(paramsToIdentity_(params), params.email || ''));
    }
    return json_({ status: 'ok', service: 'LeadBridge', v: 2 });
  } catch (error) {
    return json_({ status: 'error', message: String(error) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ status: 'error', message: 'Empty request body.' });
    }
    return json_(handlePayload_(JSON.parse(e.postData.contents)));
  } catch (error) {
    return json_({ status: 'error', message: String(error) });
  }
}

function handlePayload_(data) {
  const action = String((data && data.action) || 'save').toLowerCase();
  if (action === 'check') {
    return checkLead_(data.identity || {}, (data.currentUser && data.currentUser.email) || '');
  }
  return saveLead_(data);
}

function cacheKey_(id) {
  return 'lb_' + id;
}

function readUpload_(id) {
  const cache = CacheService.getScriptCache();
  const nRaw = cache.get(cacheKey_(id) + '_n');
  if (nRaw && Number(nRaw) > 0) {
    const total = Number(nRaw);
    let raw = '';
    for (let i = 0; i < total; i++) {
      const part = cache.get(cacheKey_(id) + '_' + i);
      if (part == null) {
        throw new Error('Upload chunk ' + i + ' was missing. Save again.');
      }
      raw += part;
      cache.remove(cacheKey_(id) + '_' + i);
    }
    cache.remove(cacheKey_(id) + '_n');
    cache.remove(cacheKey_(id));
    return raw;
  }
  const raw = cache.get(cacheKey_(id));
  cache.remove(cacheKey_(id));
  cache.remove(cacheKey_(id) + '_n');
  return raw;
}

function checkLead_(identity, email) {
  const sheet = getSheet_();
  const match = findDuplicate_(sheet, identity, email);
  return { status: 'ok', service: 'LeadBridge', duplicate: match };
}

function saveLead_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return saveLeadLocked_(data);
  } finally {
    lock.releaseLock();
  }
}

function saveLeadLocked_(data) {
  const sheet = getSheet_();
  const incomingHeaders = Array.isArray(data.headers) ? data.headers.map(String) : [];
  const incomingValues = Array.isArray(data.values) ? data.values.map(toCell_) : [];
  ensureHeaders_(sheet, incomingHeaders);

  const identity = data.identity || {};
  const email = (data.currentUser && data.currentUser.email) || '';
  const match = findDuplicate_(sheet, identity, email);
  const saveAction = String(data.saveAction || 'create');

  if (match && !match.sameUser) {
    return { status: 'duplicate', service: 'LeadBridge', duplicate: match };
  }
  if (match && match.sameUser && saveAction === 'create') {
    return { status: 'duplicate', service: 'LeadBridge', duplicate: match };
  }

  const sheetHeaders = headerRow_(sheet);
  let values = incomingHeaders.length
    ? alignRow_(incomingHeaders, incomingValues, sheetHeaders)
    : fallbackRow_(data, sheetHeaders);

  if (saveAction === 'update') {
    const row = Number(data.existingRow || (match && match.rowNumber) || 0);
    if (row < 2) {
      return { status: 'error', message: 'Could not find the existing lead row to update.' };
    }
    keepOriginalCapture_(sheet, sheetHeaders, values, row);
    sheet.getRange(row, 1, 1, values.length).setValues([values]);
    return { status: 'success', service: 'LeadBridge', action: 'updated', rowNumber: row };
  }

  sheet.appendRow(values);
  return {
    status: 'success',
    service: 'LeadBridge',
    action: 'created',
    rowNumber: sheet.getLastRow(),
  };
}

function keepOriginalCapture_(sheet, headers, values, row) {
  const existing = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  const capturedByIndex = headerIndex_(headers, 'Captured By');
  const capturedAtIndex = headerIndex_(headers, 'Date Captured');
  const capturedAtRawIndex = headerIndex_(headers, 'Captured At');
  if (capturedByIndex >= 0 && existing[capturedByIndex]) values[capturedByIndex] = existing[capturedByIndex];
  if (capturedAtIndex >= 0 && existing[capturedAtIndex]) values[capturedAtIndex] = existing[capturedAtIndex];
  if (capturedAtRawIndex >= 0 && existing[capturedAtRawIndex]) {
    values[capturedAtRawIndex] = existing[capturedAtRawIndex];
  }
}

function fallbackRow_(data, headers) {
  const lead = data.lead || {};
  const byHeader = {};
  byHeader['source url'] = data.url || lead.sourceUrl || '';
  byHeader['job title'] = data.title || lead.jobTitle || '';
  byHeader['other platform fields'] = data.extractedData || '';
  Object.keys(lead).forEach((key) => {
    if (key === 'platformFields' || typeof lead[key] !== 'string') return;
    byHeader[String(key).toLowerCase()] = lead[key];
  });
  const extras = lead.platformFields || {};
  Object.keys(extras).forEach((key) => {
    byHeader[String(key).toLowerCase()] = extras[key];
  });
  if (!headers.length) {
    return [data.url || '', data.title || '', data.extractedData || ''];
  }
  return headers.map((header) => byHeader[String(header).trim().toLowerCase()] || '');
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeaders_(sheet, incomingHeaders) {
  if (!incomingHeaders.length) return;
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getLastRow() === 0 ? [] : headerRow_(sheet);
  if (!existing.length) {
    sheet.getRange(1, 1, 1, incomingHeaders.length).setValues([incomingHeaders]);
    return;
  }
  const seen = {};
  existing.forEach((header) => {
    seen[String(header).trim().toLowerCase()] = true;
  });
  const missing = incomingHeaders.filter((header) => !seen[String(header).trim().toLowerCase()]);
  if (!missing.length) return;
  const next = existing.concat(missing);
  sheet.getRange(1, 1, 1, next.length).setValues([next]);
}

function findDuplicate_(sheet, identity, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(String);
  for (let i = 1; i < values.length; i++) {
    const lead = rowToLead_(headers, values[i]);
    const hasData = values[i].some((cell) => String(cell || '').trim() !== '');
    if (!hasData) continue;
    if (!identitiesMatch_(identity, lead)) continue;
    const capturedBy = lead.capturedBy || lead.salesOwner || 'another teammate';
    const capturedAt = lead.capturedAt || '';
    const source = lead.source || lead.sourceUrl || '';
    return {
      rowNumber: i + 1,
      capturedBy: capturedBy,
      capturedAt: capturedAt,
      source: source,
      sameUser: emailsEqual_(capturedBy, email) || emailsEqual_(lead.salesOwner, email),
      lead: {
        jobTitle: lead.jobTitle || '',
        company: lead.company || '',
        sourceUrl: lead.sourceUrl || '',
        jobUrl: lead.jobUrl || '',
        capturedBy: lead.capturedBy || '',
        salesOwner: lead.salesOwner || '',
      },
    };
  }
  return null;
}

function identitiesMatch_(identity, lead) {
  if (!identity) return false;
  const incoming = identityKeys_(identity);
  const existing = identityKeys_({
    platformLeadId: lead.platformLeadId,
    jobUrl: lead.jobUrl,
    sourceUrl: lead.sourceUrl,
    profileUrl: lead.profileUrl,
    postId: (lead.platformFields && lead.platformFields.postId) || '',
  });
  if (!incoming.length || !existing.length) return false;
  for (let i = 0; i < incoming.length; i++) {
    if (existing.indexOf(incoming[i]) >= 0) return true;
  }
  return Boolean(
    (identity.jobUrl && lead.jobUrl && sameUrl_(identity.jobUrl, lead.jobUrl)) ||
      (identity.profileUrl && lead.profileUrl && sameUrl_(identity.profileUrl, lead.profileUrl)),
  );
}

function identityKeys_(identity) {
  identity = identity || {};
  const keys = [];
  const seen = {};
  function add(value, allowCompanySlug) {
    const extracted = extractPlatformId_(value);
    if (extracted && (allowCompanySlug || !isCompanySlugOnly_(value, extracted)) && !seen[extracted]) {
      seen[extracted] = true;
      keys.push(extracted);
    }
    const trimmed = String(value || '').trim().toLowerCase();
    if (trimmed && isBareId_(trimmed) && !seen[trimmed]) {
      seen[trimmed] = true;
      keys.push(trimmed);
    }
  }
  add(identity.platformLeadId, true);
  add(identity.jobUrl, false);
  add(identity.postId, true);
  add(identity.profileUrl, true);
  add(identity.sourceUrl, false);
  return keys;
}

function isBareId_(value) {
  if (!value || value.indexOf('://') >= 0 || value.indexOf('/') >= 0) return false;
  if (value.indexOf('linkedin:') === 0) return false;
  return /^[~a-z0-9._-]{6,}$/i.test(value);
}

function isCompanySlugOnly_(value, extracted) {
  const raw = String(value || '');
  const match = raw.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!match) return false;
  const slug = match[1].replace(/\/$/, '').toLowerCase();
  if (slug !== String(extracted).toLowerCase()) return false;
  return !/[?&]currentJobId=|\/jobs\/view\/|urn:li:activity:/.test(raw);
}

function extractPlatformId_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let match = raw.match(/[?&]currentJobId=(\d+)/i);
  if (match) return match[1];
  match = raw.match(/\/jobs\/view\/(\d+)/);
  if (match) return match[1];
  match = raw.match(/linkedin\.com\/jobs\/[^/?#]*-(\d+)(?:[/?#]|$)/i);
  if (match) return match[1];
  match = raw.match(/urn:li:activity:(\d+)/i);
  if (match) return match[1];
  match = raw.match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (match) return match[1].replace(/\/$/, '').toLowerCase();
  match = raw.match(/~([A-Za-z0-9]{8,})/);
  if (match) return ('~' + match[1]).toLowerCase();
  match = raw.match(/(?:wellfound\.com|angel\.co)\/(?:jobs|l|company)\/([^/?#]+)/i);
  if (match) {
    try {
      return decodeURIComponent(match[1]).toLowerCase();
    } catch (error) {
      return match[1].toLowerCase();
    }
  }
  if (/^\d{6,}$/.test(raw)) return raw;
  if (/^~[A-Za-z0-9]{8,}$/.test(raw)) return raw.toLowerCase();
  return '';
}

function rowToLead_(headers, row) {
  const lead = { platformFields: {} };
  headers.forEach((header, index) => {
    const value = toCell_(row[index]);
    const field = fieldFromHeader_(header);
    if (!field) return;
    if (field === 'platformFields') {
      lead.platformFields.raw = value;
      return;
    }
    if (
      [
        'employmentType',
        'datePosted',
        'workplaceType',
        'experienceLevel',
        'companyIndustry',
        'companySize',
        'companyWebsite',
        'equity',
        'visaSponsorship',
        'funding',
        'postId',
      ].indexOf(field) >= 0
    ) {
      lead.platformFields[field] = value;
      return;
    }
    lead[field] = value;
  });
  return lead;
}

function fieldFromHeader_(header) {
  const map = {
    'lead id': 'leadId',
    source: 'source',
    'lead type': 'leadType',
    'lead name': 'leadName',
    company: 'company',
    'company url': 'companyUrl',
    'job title': 'jobTitle',
    'job description': 'jobDescription',
    location: 'location',
    'budget/salary': 'budget',
    skills: 'skills',
    contact: 'contact',
    'post content': 'postContent',
    'profile url': 'profileUrl',
    'job url': 'jobUrl',
    'source url': 'sourceUrl',
    'date captured': 'capturedAt',
    'sales owner': 'salesOwner',
    status: 'status',
    notes: 'notes',
    'captured by': 'capturedBy',
    'captured at': 'capturedAt',
    'last updated by': 'lastUpdatedBy',
    'last updated at': 'lastUpdatedAt',
    'platform lead id': 'platformLeadId',
    'employment type': 'employmentType',
    'posting date': 'datePosted',
    'workplace type': 'workplaceType',
    industry: 'companyIndustry',
    'company size': 'companySize',
    'company website': 'companyWebsite',
    'experience level': 'experienceLevel',
    equity: 'equity',
    'visa sponsorship': 'visaSponsorship',
    funding: 'funding',
    'other platform fields': 'platformFields',
  };
  return map[String(header || '').trim().toLowerCase()] || '';
}

function headerRow_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
}

function headerIndex_(headers, name) {
  const needle = String(name).trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === needle) return i;
  }
  return -1;
}

function alignRow_(incomingHeaders, incomingValues, sheetHeaders) {
  const byHeader = {};
  incomingHeaders.forEach((header, index) => {
    byHeader[String(header).trim().toLowerCase()] = toCell_(incomingValues[index]);
  });
  return sheetHeaders.map((header) => byHeader[String(header).trim().toLowerCase()] || '');
}

function paramsToIdentity_(params) {
  params = params || {};
  return {
    platformLeadId: params.platformLeadId || '',
    jobUrl: params.jobUrl || '',
    profileUrl: params.profileUrl || '',
    postId: params.postId || '',
    sourceUrl: params.sourceUrl || '',
  };
}

function same_(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() && String(a || '').trim() !== '';
}

function sameUrl_(a, b) {
  return normalizeUrl_(a) === normalizeUrl_(b) && normalizeUrl_(a) !== '';
}

function normalizeUrl_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    url.protocol = 'https:';
    const keep = new URLSearchParams();
    ['currentJobId', 'n_uid', 'job_listing_slug'].forEach((key) => {
      const found = url.searchParams.get(key);
      if (found) keep.set(key, found);
    });
    url.search = keep.toString();
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    return raw.replace(/\/+$/, '').toLowerCase();
  }
}

function emailsEqual_(value, email) {
  if (!value || !email) return false;
  const lower = String(email).toLowerCase();
  const hay = String(value).toLowerCase();
  return hay === lower || hay.indexOf(lower) >= 0;
}

function toCell_(value) {
  if (value == null) return '';
  return String(value);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
