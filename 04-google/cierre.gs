/**
 * Chispa Taller — receptor del cierre diario.
 *
 * MODO PRUEBA: TOKEN vacío = no pide clave. Cualquiera con la URL puede escribir.
 * Cuando confirmes que funciona, poné una clave larga acá y en la app.
 */

const TOKEN = "";
const SHEET_NAME = "Cierre";
const VERSION = "3";

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

    if (TOKEN && body.token !== TOKEN) {
      return json({ ok: false, error: "Token inválido" });
    }

    const sheet = getSheet();
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
  const provided = e && e.parameter ? e.parameter.token : null;
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
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
