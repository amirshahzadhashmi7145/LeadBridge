import { cleanText } from '@/utils/text';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DATE_FIELD_KEYS = new Set([
  'datePosted',
  'postedDate',
  'postTimestamp',
  'posted',
  'capturedAt',
  'lastUpdatedAt',
  'memberSince',
]);

const RELATIVE_PHRASE =
  /(?:just now|moments? ago|a few seconds? ago|seconds? ago|yesterday|today|(?:an?|\d+)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?)\s+ago)/i;

export function formatCalendarDate(date: Date): string {
  const month = MONTHS[date.getMonth()];
  if (!month || Number.isNaN(date.getTime())) return '';
  return `${month} ${date.getDate()}, ${date.getFullYear()}, ${formatClock(date)}`;
}

export function isDateField(key: string, label = ''): boolean {
  if (DATE_FIELD_KEYS.has(key)) return true;
  return /\b(posting date|job posting date|post date|date posted|captured at|last updated|member since)\b/i.test(
    label,
  );
}

export function looksLikeDateValue(value: string): boolean {
  const text = stripDateNoise(value);
  if (!text) return false;
  if (isWholeRelative(text)) return true;
  if (/^\d+\s*(?:mo|yr|y|w|d|h|m)(?:\s+ago)?$/i.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}(?:[t\s].*)?$/i.test(text)) return true;
  if (/^\d{10,13}$/.test(text)) return true;
  if (
    /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:\s*,?\s+\d{1,2}:\d{2}(?:\s*[ap]m)?)?$/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function toAbsoluteDate(value: string, now = new Date()): string {
  const text = stripDateNoise(value);
  if (!text) return '';

  const fromEpoch = parseEpoch(text);
  if (fromEpoch) return formatCalendarDate(fromEpoch);

  const relative = parseRelative(text, now);
  if (relative) return formatCalendarDate(relative);

  const absolute = parseAbsolute(text);
  if (absolute) return formatCalendarDate(absolute);

  const embedded = text.match(RELATIVE_PHRASE);
  if (embedded?.[0]) {
    const fromEmbedded = parseRelative(embedded[0], now);
    if (fromEmbedded) return formatCalendarDate(fromEmbedded);
  }

  return '';
}

export function absoluteDateValue(key: string, value: string, label = ''): string {
  const cleaned = cleanText(value);
  if (!cleaned) return '';
  if (!isDateField(key, label) && !looksLikeDateValue(cleaned)) return cleaned;
  return toAbsoluteDate(cleaned) || cleaned;
}

function formatClock(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minutes} ${hour24 >= 12 ? 'PM' : 'AM'}`;
}

function stripDateNoise(value: string): string {
  return cleanText(value)
    .replace(/^(?:re)?posted\s*[:\s-]*/i, '')
    .split(/\s*[•·|]\s*|\s+(?:recruiter|actively|hiring contact)\b/i)[0]
    ?.replace(/^[·•|,.\s]+|[·•|,.\s]+$/g, '')
    .trim() || '';
}

function parseEpoch(value: string): Date | null {
  if (!/^\d{10,13}$/.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1_000_000_000) return null;
  const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWholeRelative(text: string): boolean {
  const match = text.match(RELATIVE_PHRASE);
  return Boolean(match?.[0] && match[0].length === text.length);
}

function parseAbsolute(value: string): Date | null {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (!looksLikeAbsoluteDate(value)) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function looksLikeAbsoluteDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}/.test(value) ||
    /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.test(value) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value)
  );
}

function parseRelative(value: string, now: Date): Date | null {
  const text = value
    .toLowerCase()
    .replace(/^(?:about|over|almost|around|approx(?:imately)?)\s+/i, '')
    .trim();

  if (/^(just now|moments? ago|now|a few seconds? ago|seconds? ago)$/i.test(text)) {
    return new Date(now);
  }
  if (/^today$/i.test(text)) return new Date(now);
  if (/^yesterday$/i.test(text)) return add(now, { days: -1 });

  const longForm = text.match(
    /^(an?|(\d+))\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?)\s+ago$/i,
  );
  if (longForm) {
    const amount = longForm[1]?.startsWith('a') ? 1 : Number(longForm[2] || longForm[1]);
    const unit = (longForm[3] || '').toLowerCase();
    if (!Number.isFinite(amount) || !unit) return null;
    return shift(now, amount, unit);
  }

  const compact = text.match(/^(\d+)\s*(m|h|d|w|mo|yr|y)(?:\s+ago)?$/i);
  if (compact?.[1] && compact[2]) {
    const amount = Number(compact[1]);
    const unit = compact[2].toLowerCase();
    const mapped =
      unit === 'm'
        ? 'minute'
        : unit === 'h'
          ? 'hour'
          : unit === 'd'
            ? 'day'
            : unit === 'w'
              ? 'week'
              : unit === 'mo'
                ? 'month'
                : 'year';
    return shift(now, amount, mapped);
  }

  return null;
}

function shift(now: Date, amount: number, unit: string): Date | null {
  if (unit.startsWith('sec')) return add(now, { seconds: -amount });
  if (unit.startsWith('min')) return add(now, { minutes: -amount });
  if (unit.startsWith('hour') || unit.startsWith('hr')) return add(now, { hours: -amount });
  if (unit.startsWith('day')) return add(now, { days: -amount });
  if (unit.startsWith('week')) return add(now, { days: -amount * 7 });
  if (unit.startsWith('month')) return add(now, { months: -amount });
  if (unit.startsWith('year') || unit.startsWith('yr')) return add(now, { years: -amount });
  return null;
}

function add(
  now: Date,
  parts: {
    seconds?: number;
    minutes?: number;
    hours?: number;
    days?: number;
    months?: number;
    years?: number;
  },
): Date {
  const date = new Date(now.getTime());
  if (parts.seconds != null) date.setSeconds(date.getSeconds() + parts.seconds);
  if (parts.minutes != null) date.setMinutes(date.getMinutes() + parts.minutes);
  if (parts.hours != null) date.setHours(date.getHours() + parts.hours);
  if (parts.days != null) date.setDate(date.getDate() + parts.days);
  if (parts.months != null) date.setMonth(date.getMonth() + parts.months);
  if (parts.years != null) date.setFullYear(date.getFullYear() + parts.years);
  return date;
}
