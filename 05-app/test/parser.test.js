import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMessage, splitMessages } from "../src/parser.js";
import { parseDate, parseTime } from "../src/dates.js";
import {
  RECEIVED_AT,
  MAINTENANCE_WITH_PART,
  REVISION,
  WARRANTY,
  WEEKDAY_MISMATCH,
  CANCELLED,
  FREE_TEXT,
  FORWARDED_CHAT,
} from "./fixtures.js";

const codes = (result) => result.alerts.map((alert) => alert.code);

test("maintenance with part: paid, phone and full data", () => {
  const { appointment, alerts, missing } = parseMessage(MAINTENANCE_WITH_PART, {
    receivedAt: RECEIVED_AT,
  });

  assert.equal(appointment.type, "maintenance");
  assert.equal(appointment.secondaryType, "part");
  assert.equal(appointment.name, "Engerling Marrugo arroyo");
  assert.equal(appointment.model, "galaxy 3");
  assert.equal(appointment.date, "2026-11-20");
  assert.equal(appointment.time, "08:00");
  assert.equal(appointment.phone, "3012277629");
  assert.equal(appointment.amount, 240000);
  assert.equal(appointment.payment, "paid");
  assert.match(appointment.instructions, /puntual/i);
  assert.ok(!codes({ alerts }).includes("WEEKDAY_MISMATCH"));
  assert.deepEqual(missing, ["location"]);
});

test("revision: date lives in the title, no phone", () => {
  const { appointment, missing, inbox } = parseMessage(REVISION, { receivedAt: RECEIVED_AT });

  assert.equal(appointment.type, "revision");
  assert.equal(appointment.name, "Karol Giraldo");
  assert.equal(appointment.model, "stareer 3");
  assert.equal(appointment.date, "2026-11-20");
  assert.equal(appointment.time, "14:00");
  assert.match(appointment.description, /descargada/);
  assert.equal(appointment.phone, null);
  assert.ok(missing.includes("phone"));
  assert.equal(inbox, false);
});

test("warranty: location and part", () => {
  const { appointment } = parseMessage(WARRANTY, { receivedAt: RECEIVED_AT });

  assert.equal(appointment.type, "warranty");
  assert.equal(appointment.secondaryType, "part");
  assert.equal(appointment.name, "rosaida Hernández");
  assert.equal(appointment.model, "Ledo 3");
  assert.equal(appointment.part, "flasher");
  assert.equal(appointment.location, "Ofero centro");
  assert.equal(appointment.date, "2026-11-20");
  assert.equal(appointment.time, "14:00");
});

test("flags a weekday that does not match the date", () => {
  const { appointment, alerts } = parseMessage(WEEKDAY_MISMATCH, { receivedAt: RECEIVED_AT });

  assert.equal(appointment.date, "2026-11-20");
  assert.equal(appointment.weekday, 5);
  assert.ok(codes({ alerts }).includes("WEEKDAY_MISMATCH"));
  assert.ok(codes({ alerts }).includes("IMPOSSIBLE_WINDOW"));
  assert.equal(appointment.time, "08:00");
  assert.equal(appointment.endTime, "09:00");
});

test("same template plus CANCELADO changes the status", () => {
  const { appointment } = parseMessage(CANCELLED, { receivedAt: RECEIVED_AT });

  assert.equal(appointment.status, "cancelled");
  assert.equal(appointment.name, "JORGE PEREZ");
});

test("free text goes to the inbox, nothing is invented", () => {
  const { appointment, inbox } = parseMessage(FREE_TEXT, { receivedAt: RECEIVED_AT });

  assert.equal(inbox, true);
  assert.equal(appointment.name, null);
  assert.equal(appointment.date, null);
  assert.equal(appointment.originalText, FREE_TEXT);
});

test("a pasted forwarded chat is split into one block per message", () => {
  const blocks = splitMessages(FORWARDED_CHAT);

  assert.equal(blocks.length, 3);
  assert.match(blocks[0], /MANTENIMIENTO/);
  assert.match(blocks[1], /REVISION/);
  assert.match(blocks[2], /GARANTÍA/);
});

test("dates: the four formats found in the messages", () => {
  assert.equal(parseDate("viernes 20 - NOVIEMBRE -2026", RECEIVED_AT).date, "2026-11-20");
  assert.equal(parseDate("20 DE NOVIEMBRE", RECEIVED_AT).date, "2026-11-20");
  assert.equal(parseDate("20/11/26", RECEIVED_AT).date, "2026-11-20");
  assert.equal(parseDate("miercoles 20- NOVIEMBRE -2026", RECEIVED_AT).date, "2026-11-20");
});

test("dates: without a year it picks the closest one", () => {
  const january = new Date("2026-01-05T12:00:00Z");
  assert.equal(parseDate("20 de diciembre", january).date, "2025-12-20");
  assert.equal(parseDate("20 de marzo", january).date, "2026-03-20");
});

test("times: suffix, a las, and window", () => {
  assert.equal(parseTime("8:00am").time, "08:00");
  assert.equal(parseTime("2 pm").time, "14:00");
  assert.equal(parseTime("a las 2 pm").time, "14:00");
  const window = parseTime("8:00AM A 9PM");
  assert.equal(window.time, "08:00");
  assert.equal(window.endTime, "21:00");
  assert.equal(window.isWindow, true);
});
