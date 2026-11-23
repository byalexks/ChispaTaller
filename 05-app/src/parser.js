// Deterministic parser for WhatsApp templates.
// No AI: labeled fields + universal detectors + validation.
// Storage agnostic: text in, plain object out.

import { normalize, parseDate, parseTime, toMinutes } from "./dates.js";

/** Canonical field -> accepted Spanish labels (already normalized). */
const FIELD_ALIASES = {
  name: ["nombre y apellidos", "nombre", "cliente", "propietario", "senor", "senora"],
  model: ["vehiculo", "modelo", "carro", "moto"],
  dateTime: ["dia y hora", "fecha y hora", "fecha", "dia", "cita"],
  phone: ["telefono", "celular", "tel", "whatsapp", "contacto"],
  location: ["local", "sede", "punto", "taller"],
  part: ["repuesto", "pieza", "accesorio"],
  amount: ["total a pagar", "valor", "precio", "total"],
  description: ["problema", "falla", "motivo", "observaciones", "notas"],
  address: ["direccion", "ubicacion"],
  instructions: ["recomendaciones", "llevar"],
};

/** Reception windows per service type. */
const WINDOWS = {
  maintenance: { from: "08:00", to: "09:00" },
  revision: { from: "14:00", to: "16:00" },
  warranty: { from: "14:00", to: "16:00" },
  part: { from: "14:00", to: "16:00" },
};

const FORWARD_HEADER =
  /^\[\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?)?,\s*\d{1,2}\/\d{1,2}\/\d{2,4}\]\s*[^:\n]{1,60}:\s*/i;
const LABEL_LINE = /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][^:\n]{0,40}?)\s*:\s*(.*)$/;
const MESSAGE_START =
  /^\s*\*?\s*(PROGRAMACION|PROGRAMACIÓN|REVISION|REVISIÓN|INSTALACION|INSTALACIÓN)\b/i;

function cleanLine(line) {
  let text = String(line ?? "").replace(FORWARD_HEADER, "").trim();
  text = text.replace(/^[*•·\-\s]+/, "").replace(/[*\s]+$/, "").trim();
  return text;
}

function cleanValue(value) {
  return String(value ?? "")
    .replace(/^\*+\s*/, "")
    .replace(/\s*\*+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a pasted chat into individual messages, one per template header. */
export function splitMessages(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const blocks = [];
  let current = [];

  for (const line of lines) {
    const startCandidate = line.replace(FORWARD_HEADER, "").trim();
    if (MESSAGE_START.test(startCandidate) && current.some((item) => item.trim())) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.some((item) => item.trim())) blocks.push(current.join("\n"));

  const cleaned = blocks.map((block) => block.trim()).filter(Boolean);
  return cleaned.length ? cleaned : [String(text ?? "").trim()];
}

/** Turns one message into label -> value pairs. No closed list of labels. */
export function segment(text) {
  const labels = [];
  const leftovers = [];
  let current = null;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    const match = line.match(LABEL_LINE);
    if (match) {
      current = { label: match[1].trim(), value: cleanValue(match[2]) };
      labels.push(current);
    } else if (current) {
      current.value = cleanValue(`${current.value} ${line}`);
    } else {
      leftovers.push(line);
    }
  }

  return { labels, leftovers };
}

export function mapFields(labels) {
  const fields = {};
  const extras = {};

  for (const { label, value } of labels) {
    const key = normalize(label);
    const canonical = Object.keys(FIELD_ALIASES).find((field) =>
      FIELD_ALIASES[field].includes(key)
    );

    if (!canonical) {
      if (key) extras[label] = value;
      continue;
    }
    fields[canonical] = fields[canonical] ? `${fields[canonical]} ${value}`.trim() : value;
  }

  return { fields, extras };
}

export function classify(text) {
  const value = normalize(text);
  const found = {
    maintenance: /\bmantenimiento\b/.test(value),
    revision: /\brevision\b|\brevisar\b/.test(value),
    warranty: /\bgarantia\b/.test(value),
    part: /\brepuestos?\b|\bpiezas?\b/.test(value),
  };

  const secondary = [];
  let primary = null;

  if (found.warranty) primary = "warranty";
  else if (found.revision) primary = "revision";
  else if (found.maintenance) primary = "maintenance";
  else if (found.part) primary = "part";

  for (const [type, present] of Object.entries(found)) {
    if (present && type !== primary) secondary.push(type);
  }

  return { primary, secondary };
}

function extractPhone(text, labelValue) {
  for (const candidate of [labelValue, text]) {
    if (!candidate) continue;
    const digits = String(candidate).replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("57")) return digits.slice(2);
    if (digits.length === 10) return digits;
  }
  return null;
}

function extractAmount(labelValue) {
  if (!labelValue) return null;
  const text = String(labelValue);
  const thousands = text.match(/(\d{1,3})\s*mil/i);
  if (thousands) return Number(thousands[1]) * 1000;

  const withSymbol = text.match(/\$\s*([\d.,]+)/);
  const numeric = (withSymbol ? withSymbol[1] : text).replace(/\./g, "").replace(/,/g, ".");
  const value = Number.parseFloat(numeric);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function extractPlate(text) {
  const match = String(text ?? "").toUpperCase().match(/\b[A-Z]{3}\d{3}\b/);
  return match ? match[0] : null;
}

function extractSerial(text) {
  const match = String(text ?? "").toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  return match ? match[0] : null;
}

/**
 * Parses one free-form message into a draft appointment.
 * @param {string} text Message exactly as it arrived.
 * @param {{receivedAt?: Date}} options
 */
export function parseMessage(text, options = {}) {
  const receivedAt = options.receivedAt ?? new Date();
  const original = String(text ?? "");
  const { labels, leftovers } = segment(original);
  const { fields, extras } = mapFields(labels);

  const normalized = normalize(original);
  const { primary: type, secondary } = classify(original);
  const status = /cancelad/.test(normalized) ? "cancelled" : "scheduled";

  const dateSource = [fields.dateTime, leftovers.join(" "), original].filter(Boolean).join(" | ");
  const date = parseDate(dateSource, receivedAt);
  const time = parseTime(dateSource);

  const alerts = [...date.alerts, ...time.alerts];

  let endTime = time.endTime;
  if (time.isWindow && time.time && endTime && toMinutes(endTime) - toMinutes(time.time) > 240) {
    alerts.push({
      code: "IMPOSSIBLE_WINDOW",
      field: "time",
      severity: "medium",
      message: `La ventana ${time.time}–${endTime} no es creíble; se asumió 60 minutos.`,
    });
    endTime = `${String(Number(time.time.slice(0, 2)) + 1).padStart(2, "0")}:${time.time.slice(3)}`;
  }

  const name = cleanValue(fields.name) || null;
  const phone = extractPhone(original, fields.phone);
  const location = cleanValue(fields.location) || null;
  const address = cleanValue(fields.address) || null;
  const part = cleanValue(fields.part) || null;
  const description = cleanValue(fields.description) || null;
  const instructions = cleanValue(fields.instructions) || null;
  const amount = extractAmount(fields.amount);
  const plate = extractPlate(original);
  const serial = extractSerial(original);

  if (date.date) {
    const today = Date.UTC(
      receivedAt.getUTCFullYear(),
      receivedAt.getUTCMonth(),
      receivedAt.getUTCDate()
    );
    const [year, month, day] = date.date.split("-").map(Number);
    if (Date.UTC(year, month - 1, day) < today) {
      alerts.push({
        code: "PAST_DATE",
        field: "date",
        severity: "low",
        message: `La cita es para el ${date.date}, que ya pasó.`,
      });
    }
  }

  const window = type ? WINDOWS[type] : null;
  if (window && time.time) {
    const start = toMinutes(time.time);
    if (start < toMinutes(window.from) || start > toMinutes(window.to)) {
      alerts.push({
        code: "OUTSIDE_WINDOW",
        field: "time",
        severity: "medium",
        message: `${time.time} está fuera de la ventana de ${window.from}–${window.to}.`,
      });
    }
  }

  const missing = [];
  if (!name) missing.push("name");
  if (!date.date) missing.push("date");
  if (!phone) missing.push("phone");
  if (!location) missing.push("location");

  return {
    appointment: {
      type,
      secondaryType: secondary[0] ?? null,
      status,
      name,
      model: cleanValue(fields.model) || null,
      date: date.date,
      weekday: date.weekday,
      time: time.time,
      endTime,
      isWindow: time.isWindow,
      phone,
      location,
      address,
      part,
      description,
      instructions,
      amount,
      payment: amount !== null ? "paid" : "pending",
      plate,
      serial,
      extras,
      originalText: original.trim(),
      receivedAt: receivedAt.toISOString(),
    },
    alerts,
    missing,
    inbox: !name || !date.date,
  };
}
