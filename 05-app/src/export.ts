/** Small CSV helpers: enough for end-of-day reports, no dependencies. */

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\r\n");
}

export function downloadCsv(fileName: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) {
    window.alert("No hay datos para exportar.");
    return;
  }
  const blob = new Blob(["\ufeff" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
