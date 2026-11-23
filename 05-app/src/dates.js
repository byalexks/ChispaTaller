// Spanish date and time parsing, no dependencies.
// All math runs in UTC so time zones cannot shift a day.

const MONTHS = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const WEEKDAYS = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const WEEKDAY_LABELS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

/** Lowercase, accents stripped, spaces collapsed. Detection only, never for display. */
export function normalize(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function detectWeekday(text) {
  const value = normalize(text);
  for (const weekday of Object.keys(WEEKDAYS)) {
    if (new RegExp(`\\b${weekday}\\b`).test(value)) return weekday;
  }
  return null;
}

function weekdayOf(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function toIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function findNumericDate(value) {
  for (const match of value.matchAll(/(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { day, month, year: match[3] ? Number(match[3]) : null };
    }
  }
  return null;
}

function findMonthNameDate(value) {
  const pattern = /(\d{1,2})\s*(?:de\s+|[-\/.]\s*)?([a-z]{3,10})\s*(?:de\s+|[-\/.]\s*)?(\d{2,4})?/g;
  for (const match of value.matchAll(pattern)) {
    const day = Number(match[1]);
    const month = MONTHS[match[2]];
    if (!month || day < 1 || day > 31) continue;
    return { day, month, year: match[3] ? Number(match[3]) : null };
  }
  return null;
}

/**
 * Parses a Spanish date out of free text.
 * Without a year, it picks the closest one to the reference date, because the
 * year written in these templates is unreliable (they get recycled).
 */
export function parseDate(text, reference = new Date()) {
  const value = normalize(text);
  const weekdayText = detectWeekday(value);
  const alerts = [];

  const parts = findNumericDate(value) ?? findMonthNameDate(value);
  if (!parts) {
    return { date: null, weekdayText, weekday: null, yearInferred: false, alerts };
  }

  let { day, month, year } = parts;
  let yearInferred = false;

  if (year === null) {
    yearInferred = true;
    const referenceYear = reference.getUTCFullYear();
    const referenceMs = Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate()
    );

    let bestYear = null;
    let bestDistance = Infinity;
    for (const candidate of [referenceYear - 1, referenceYear, referenceYear + 1]) {
      const iso = toIso(candidate, month, day);
      if (!iso) continue;
      const [y, m, d] = iso.split("-").map(Number);
      const distance = Math.abs(Date.UTC(y, m - 1, d) - referenceMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestYear = candidate;
      }
    }

    if (bestYear === null) {
      return { date: null, weekdayText, weekday: null, yearInferred, alerts };
    }

    year = bestYear;
    alerts.push({
      code: "YEAR_INFERRED",
      field: "date",
      severity: "low",
      message: `El mensaje no trae año; se asumió ${year}.`,
    });
  } else if (year < 100) {
    year = year >= 70 ? 1900 + year : 2000 + year;
  }

  const date = toIso(year, month, day);
  if (!date) {
    alerts.push({
      code: "INVALID_DATE",
      field: "date",
      severity: "high",
      message: `La fecha ${day}/${month}/${year} no existe.`,
    });
    return { date: null, weekdayText, weekday: null, yearInferred, alerts };
  }

  const weekday = weekdayOf(date);
  const weekdayName = WEEKDAY_LABELS[weekday];

  if (weekdayText && WEEKDAYS[weekdayText] !== weekday) {
    alerts.push({
      code: "WEEKDAY_MISMATCH",
      field: "date",
      severity: "high",
      message: `El mensaje dice ${weekdayText}, pero el ${date} es ${weekdayName}.`,
    });
  }

  return { date, weekdayText, weekday, yearInferred, alerts };
}

function to24Hour(hour, suffix) {
  let value = Number(hour);
  const isPm = suffix === "pm";
  if (isPm && value < 12) value += 12;
  if (!isPm && suffix === "am" && value === 12) value = 0;
  return value;
}

function formatTime(hour, minute = 0) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parses a single time or a time window.
 * Understands "8:00am", "2 pm", "a las 2", "14:00" and "8:00am a 9pm".
 */
export function parseTime(text) {
  const value = normalize(text);
  const alerts = [];

  const windows = [];
  for (const match of value.matchAll(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:a|hasta|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g
  )) {
    const start = to24Hour(match[1], match[3]);
    const end = to24Hour(match[4], match[6] ?? match[3]);
    if (start <= 23 && end <= 23) windows.push({ start, end });
  }

  if (windows.length) {
    const { start, end } = windows[0];
    let endHour = end;
    if (endHour <= start) endHour += 12;
    return {
      time: formatTime(start),
      endTime: formatTime(endHour % 24),
      isWindow: true,
      alerts,
    };
  }

  const withSuffix = value.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (withSuffix) {
    const hour = to24Hour(withSuffix[1], withSuffix[3]);
    const minute = withSuffix[2] ? Number(withSuffix[2]) : 0;
    return { time: formatTime(hour, minute), endTime: null, isWindow: false, alerts };
  }

  const atTime = value.match(/a\s+las\s+(\d{1,2})(?::(\d{2}))?/);
  if (atTime) {
    const hour = Number(atTime[1]);
    const minute = atTime[2] ? Number(atTime[2]) : 0;
    if (hour <= 23) {
      return { time: formatTime(hour, minute), endTime: null, isWindow: false, alerts };
    }
  }

  const clock = value.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour <= 23 && minute <= 59) {
      return { time: formatTime(hour, minute), endTime: null, isWindow: false, alerts };
    }
  }

  return { time: null, endTime: null, isWindow: false, alerts };
}

/** "HH:MM" to minutes since midnight. */
export function toMinutes(time) {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
