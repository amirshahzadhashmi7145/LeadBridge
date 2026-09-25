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
]);

const RELATIVE =
  /^(?:(?:re)?posted\s+)?(?:about|over|almost|around|approx(?:imately)?\s+)?(?:just now|moments? ago|today|yesterday|(?:an?|\d+)\s+(?:minute|hour|day|week|month|year)s?\s+ago|\d+\s*(?:m|h|d|w|mo|yr|y))$/i;

export function formatCalendarDate(date: Date): string {
  const month = MONTHS[date.getMonth()];
  if (!month || Number.isNaN(date.getTime())) return '';
  return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

export function isDateField(key: string, label = ''): boolean {
  if (DATE_FIELD_KEYS.has(key)) return true;
  return /\b(posting date|job posting date|post date|date posted)\b/i.test(label);
}

export function looksLikeDateValue(value: string): boolean {
  const text = stripDatePrefix(value);
  if (!text) return false;
  if (RELATIVE.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}(?:[t\s].*)?$/i.test(text)) return true;
  if (/^\d{10,13}$/.test(text)) return true;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}$/i.test(text)) {
    return true;
  }
  return false;
}

export function toAbsoluteDate(value: string, now = new Date()): string {
  const text = stripDatePrefix(value);
  if (!text) return '';

  const fromEpoch = parseEpoch(text);
  if (fromEpoch) return formatCalendarDate(fromEpoch);

  const relative = parseRelative(text, now);
  if (relative) return formatCalendarDate(relative);

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed) && looksLikeAbsoluteDate(text)) {
    return formatCalendarDate(new Date(parsed));
  }

  const embedded = text.match(
    /\b(?:just now|yesterday|today|(?:an?|\d+)\s+(?:minute|hour|day|week|month|year)s?\s+ago|\d+\s*(?:mo|yr|y|w|d|h|m))\b/i,
  );
  if (embedded?.[0]) {
    const fromEmbedded = parseRelative(embedded[0], now);
    if (fromEmbedded) return formatCalendarDate(fromEmbedded);
  }

  return '';
}

function looksLikeAbsoluteDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}/.test(value) ||
    /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.test(value) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value)
  );
}

export function absoluteDateValue(key: string, value: string, label = ''): string {
  const cleaned = cleanText(value);
  if (!cleaned) return '';
  if (!isDateField(key, label) && !looksLikeDateValue(cleaned)) return cleaned;
  return toAbsoluteDate(cleaned) || cleaned;
}

function stripDatePrefix(value: string): string {
  return cleanText(value)
    .replace(/^(?:re)?posted\s+/i, '')
    .replace(/^[·•|,.\s]+|[·•|,.\s]+$/g, '');
}

function parseEpoch(value: string): Date | null {
  if (!/^\d{10,13}$/.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1_000_000_000) return null;
  const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRelative(value: string, now: Date): Date | null {
  const text = value
    .toLowerCase()
    .replace(/^(?:about|over|almost|around|approx(?:imately)?)\s+/i, '')
    .trim();

  if (/^(just now|moments? ago|today)$/i.test(text)) return new Date(now);
  if (/^yesterday$/i.test(text)) return add(now, { days: -1 });

  const longForm = text.match(/^(an?|(\d+))\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (longForm) {
    const amount = longForm[1]?.startsWith('a') ? 1 : Number(longForm[2] || longForm[1]);
    const unit = (longForm[3] || '').toLowerCase();
    if (!Number.isFinite(amount) || !unit) return null;
    return shift(now, amount, unit);
  }

  const compact = text.match(/^(\d+)\s*(m|h|d|w|mo|yr|y)$/i);
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
  if (unit.startsWith('minute')) return add(now, { minutes: -amount });
  if (unit.startsWith('hour')) return add(now, { hours: -amount });
  if (unit.startsWith('day')) return add(now, { days: -amount });
  if (unit.startsWith('week')) return add(now, { days: -amount * 7 });
  if (unit.startsWith('month')) return add(now, { months: -amount });
  if (unit.startsWith('year')) return add(now, { years: -amount });
  return null;
}

function add(
  now: Date,
  parts: { minutes?: number; hours?: number; days?: number; months?: number; years?: number },
): Date {
  const date = new Date(now.getTime());
  if (parts.minutes) date.setMinutes(date.getMinutes() + parts.minutes);
  if (parts.hours) date.setHours(date.getHours() + parts.hours);
  if (parts.days) date.setDate(date.getDate() + parts.days);
  if (parts.months) date.setMonth(date.getMonth() + parts.months);
  if (parts.years) date.setFullYear(date.getFullYear() + parts.years);
  return date;
}
