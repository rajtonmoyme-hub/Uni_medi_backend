export const STANDARD_TIME_SLOTS = [
  '09:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '02:00 PM',
  '03:00 PM',
  '04:00 PM',
  '05:00 PM',
  '06:00 PM',
  '07:00 PM',
  '08:00 PM',
  '09:00 PM',
];

export const DEFAULT_CHAMBER_SLOTS = [
  '05:00 PM',
  '06:00 PM',
  '07:00 PM',
  '08:00 PM',
];

function to24Hour(hourStr: string, meridiem: string): number {
  let hr = parseInt(hourStr, 10);
  const mer = meridiem.toUpperCase();
  if (mer === 'PM' && hr < 12) hr += 12;
  if (mer === 'AM' && hr === 12) hr = 0;
  return hr;
}

function format12Hour(hour24: number): string {
  const mer = hour24 >= 12 ? 'PM' : 'AM';
  let hr12 = hour24 % 12;
  if (hr12 === 0) hr12 = 12;
  return `${String(hr12).padStart(2, '0')}:00 ${mer}`;
}

export function deriveSlotsFromScheduleText(scheduleText: string): string[] {
  const match = scheduleText.match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!match) {
    return [...DEFAULT_CHAMBER_SLOTS];
  }
  const start24 = to24Hour(match[1], match[3]);
  const end24 = to24Hour(match[4], match[6]);
  if (end24 <= start24) {
    return [format12Hour(start24)];
  }
  const derived: string[] = [];
  for (let h = start24; h < end24; h += 1) {
    derived.push(format12Hour(h));
  }
  return derived.length > 0 ? derived : [...DEFAULT_CHAMBER_SLOTS];
}

export function parseScheduleAndSlots(rawSchedule?: string | null): {
  scheduleLabel: string;
  availableSlots: string[];
} {
  const raw = String(
    rawSchedule || 'Sun, Tue, Thu: 5:00 PM - 9:00 PM'
  ).trim();
  const parts = raw.split(/\s*\|\s*Slots:\s*/i);
  const scheduleLabel =
    parts[0]?.trim() || 'Sun, Tue, Thu: 5:00 PM - 9:00 PM';

  if (parts.length > 1 && parts[1].trim()) {
    const explicitSlots = Array.from(
      new Set(
        parts[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
    if (explicitSlots.length > 0) {
      return {
        scheduleLabel,
        availableSlots: explicitSlots,
      };
    }
  }

  return {
    scheduleLabel,
    availableSlots: deriveSlotsFromScheduleText(scheduleLabel),
  };
}

export function formatScheduleWithSlots(
  scheduleInput?: string | null,
  availableSlots?: string[] | null
): string {
  const { scheduleLabel, availableSlots: existingSlots } =
    parseScheduleAndSlots(scheduleInput);
  const cleanedSlots = Array.isArray(availableSlots)
    ? Array.from(
        new Set(
          availableSlots
            .map((s) => String(s).trim())
            .filter(Boolean)
        )
      )
    : existingSlots;

  if (cleanedSlots.length > 0) {
    return `${scheduleLabel} | Slots: ${cleanedSlots.join(', ')}`;
  }
  return scheduleLabel;
}

export function getIndependentChamberConfig(profileVisibility?: any): {
  independentSchedule: string;
  independentSlots: string[];
} {
  const vis =
    profileVisibility && typeof profileVisibility === 'object'
      ? profileVisibility
      : {};
  const rawSchedule =
    typeof vis.independentSchedule === 'string' &&
    vis.independentSchedule.trim()
      ? vis.independentSchedule.trim()
      : 'Sat, Mon, Wed: 5:00 PM - 9:00 PM';

  if (Array.isArray(vis.independentSlots) && vis.independentSlots.length > 0) {
    const clean: string[] = Array.from(
      new Set<string>(
        vis.independentSlots
          .map((s: any) => String(s).trim())
          .filter(Boolean)
      )
    );
    if (clean.length > 0) {
      return {
        independentSchedule: parseScheduleAndSlots(rawSchedule).scheduleLabel,
        independentSlots: clean,
      };
    }
  }

  const parsed = parseScheduleAndSlots(rawSchedule);
  return {
    independentSchedule: parsed.scheduleLabel,
    independentSlots: parsed.availableSlots,
  };
}
