import {
  allAppointmentsForDay,
  isoWithOffset,
  listLocations,
  listTechnicians,
  photosForAppointment,
} from "./db";

export interface DailyRow {
  id: string;
  fecha: string;
  hora: string;
  tecnico: string;
  local: string;
  cliente: string;
  telefono: string;
  vehiculo: string;
  tipo: string;
  estado: string;
  monto: number | null;
  observaciones: string;
  fotos: number;
}

export interface DailyPayload {
  fecha: string;
  generadoEn: string;
  total: number;
  filas: DailyRow[];
}

/** Everything that happened on a date, ready to be appended to a Google Sheet. */
export async function buildDaily(date: string): Promise<DailyPayload> {
  const [appointments, technicians, locations] = await Promise.all([
    allAppointmentsForDay(date),
    listTechnicians(true),
    listLocations(true),
  ]);

  const techName = new Map(technicians.map((item) => [item.id, item.name]));
  const placeName = new Map(locations.map((item) => [item.id, item.name]));

  const rows: DailyRow[] = [];

  for (const appointment of appointments) {
    const photos = await photosForAppointment(appointment.id);
    rows.push({
      id: appointment.id,
      fecha: appointment.date ?? date,
      hora: appointment.time ?? "",
      tecnico: techName.get(appointment.technicianId) ?? appointment.technicianId,
      local: appointment.locationId ? placeName.get(appointment.locationId) ?? "" : "",
      cliente: appointment.name ?? "",
      telefono: appointment.phone ?? "",
      vehiculo: appointment.model ?? "",
      tipo: appointment.type ?? "",
      estado: appointment.status,
      monto: appointment.amount,
      observaciones: appointment.notes ?? "",
      fotos: photos.length,
    });
  }

  return {
    fecha: date,
    generadoEn: new Date().toISOString(),
    total: rows.length,
    filas: rows,
  };
}

/** Several days in one payload, so a forgotten day gets uploaded later. */
export async function buildRange(start: string, end: string): Promise<DailyPayload> {
  const filas: DailyRow[] = [];
  let date = start;
  let guard = 0;

  while (date <= end && guard < 31) {
    const daily = await buildDaily(date);
    filas.push(...daily.filas);
    date = isoWithOffset(date, 1);
    guard += 1;
  }

  return {
    fecha: start === end ? start : `${start}..${end}`,
    generadoEn: new Date().toISOString(),
    total: filas.length,
    filas,
  };
}

/**
 * Sends the day to a Google Apps Script web app.
 * Uses text/plain so the browser does not need a CORS preflight.
 */export async function uploadDaily(
  url: string,
  token: string,
  payload: DailyPayload
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token, ...payload }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  let data: { ok?: boolean; mensaje?: string; error?: string } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("La URL no devolvió JSON. ¿Publicaste el Apps Script como aplicación web?");
  }

  if (data?.ok === false) throw new Error(data.error ?? "El script rechazó los datos.");
  return data?.mensaje ?? `${payload.total} filas subidas`;
}
