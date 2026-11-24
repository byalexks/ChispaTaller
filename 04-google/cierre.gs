/**
 * Chispa Taller — receptor del cierre diario.
 *
 * TOKEN debe ser el mismo que usa la app (05-app/src/remote.ts). Si lo cambiás,
 * cambialo en los dos lados y publicá una versión nueva.
 */

const TOKEN = "chispa-2026-abc123";
const SHEET_NAME = "Cierre";
const VERSION = "4";

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
