/**
 * Chispa Taller — receptor del cierre diario.
 *
 * TOKEN debe ser el mismo que usa la app (05-app/src/remote.ts). Si lo cambiás,
 * cambialo en los dos lados y publicá una versión nueva.
 */

const TOKEN = "chispa-2026-abc123";
const SHEET_NAME = "Cierre";
const VERSION = "5";

const HEADERS = [
  "ID",
  "Fecha",
  "Hora",
  "Técnico",
  "Local",
  "Cliente",
  "Teléfono",
  "Vehículo",
  "Tipo",
  "Estado",
  "Monto",
  "Observaciones",
  "Fotos",
  "Subido",
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.action === "config") {
      if (!TOKEN) {
        return json({ ok: false, error: "Configurá un TOKEN en el script" });
      }
      if (body.token !== TOKEN) {
        return json({ ok: false, error: "Token inválido" });
      }
      PropertiesService.getScriptProperties().setProperty(
        "configCipher",
        body.cipher || ""
      );
      return json({ ok: true, mensaje: "Configuración guardada" });
    }

    if (TOKEN && body.token !== TOKEN) {
      return json({ ok: false, error: "Token inválido" });
    }

    if (body.action && body.action.indexOf("calendar-") === 0) {
      return handleCalendar(body);
    }

    const sheet = getSheet();
    ensureHeaders(sheet);
    const lastRow = sheet.getLastRow();
    const existing = new Set(
      lastRow > 1
        ? sheet
            .getRange(2, 1, lastRow - 1, 1)
            .getValues()
            .flat()
            .map(String)
        : []
    );

    const rows = [];
    for (const row of body.filas || []) {
      if (existing.has(String(row.id))) continue;
      rows.push([
        row.id,
        row.fecha,
        row.hora,
        row.tecnico,
        row.local,
        row.cliente,
        row.telefono,
        row.vehiculo,
        row.tipo,
        row.estado,
        row.monto === null ? "" : row.monto,
        row.observaciones,
        row.fotos,
        body.generadoEn,
      ]);
    }

    if (rows.length) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length)
        .setValues(rows);
    }

    return json({
      ok: true,
      mensaje: rows.length
        ? `${rows.length} filas subidas`
        : "Todo ya estaba subido",
    });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action === "config") {
    if (!TOKEN) {
      return json({ ok: false, error: "Configurá un TOKEN en el script para compartir la configuración" });
    }
    if (params.token !== TOKEN) {
      return json({ ok: false, error: "Token inválido" });
    }
    const cipher =
      PropertiesService.getScriptProperties().getProperty("configCipher") || "";
    return json({ ok: true, cipher });
  }

  const provided = params.token ? params.token : null;
  return json({
    ok: true,
    version: VERSION,
    mensaje: "Chispa Taller listo",
    tokenConfigurado: Boolean(TOKEN),
    tokenOk: provided ? provided === TOKEN : null,
  });
}

/**
 * Calendar events in the script owner's calendar.
 *
 * The app no longer needs OAuth: the script creates, updates and deletes the
 * events with the same Google account that owns the Sheet.
 */
function handleCalendar(body) {
  try {
    const calendar = CalendarApp.getDefaultCalendar();
    const start = new Date(body.start);
    const end = new Date(body.end);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return json({ ok: false, error: "Fecha u hora inválida" });
    }

    if (body.action === "calendar-create") {
      const event = calendar.createEvent(
        body.summary || "Cita",
        start,
        end,
        {
          description: body.description || "",
          location: body.location || "",
        }
      );
      return json({ ok: true, eventId: event.getId() });
    }

    if (body.action === "calendar-update") {
      const event = body.eventId ? CalendarApp.getEventById(body.eventId) : null;
      if (!event) {
        // The event was deleted in Google: create a fresh one.
        const created = calendar.createEvent(
          body.summary || "Cita",
          start,
          end,
          {
            description: body.description || "",
            location: body.location || "",
          }
        );
        return json({ ok: true, eventId: created.getId() });
      }
      event.setTitle(body.summary || "Cita");
      event.setTime(start, end);
      event.setDescription(body.description || "");
      event.setLocation(body.location || "");
      return json({ ok: true, eventId: event.getId() });
    }

    if (body.action === "calendar-delete") {
      const event = body.eventId ? CalendarApp.getEventById(body.eventId) : null;
      if (event) event.deleteEvent();
      return json({ ok: true });
    }

    return json({ ok: false, error: "Acción de calendario desconocida" });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}

function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
  }
  ensureHeaders(sheet);
  return sheet;
}

/**
 * The first row is always the header row.
 *
 * If the sheet was cleaned (or has old data without headers), the headers are
 * written again. Existing rows are never deleted: if row 1 already has data,
 * a new row is inserted above it so that row 1 becomes the header.
 */
function ensureHeaders(sheet) {
  const width = HEADERS.length;
  const first = sheet.getRange(1, 1, 1, width).getValues()[0];
  const already = HEADERS.every(
    (header, index) => String(first[index]).trim() === header
  );

  if (!already) {
    const empty = first.every((value) => String(value).trim() === "");
    const looksLikeHeader = first.some((value) =>
      HEADERS.includes(String(value).trim())
    );

    // Row 1 has real data (not a header): push it down, never delete it.
    if (!empty && !looksLikeHeader && sheet.getLastRow() > 0) {
      sheet.insertRowBefore(1);
    }
    sheet.getRange(1, 1, 1, width).setValues([HEADERS]);
  }

  sheet.getRange(1, 1, 1, width).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
