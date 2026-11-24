import { getDb } from "./db";

const TABLES = [
  "technicians",
  "appointments",
  "clients",
  "vehicles",
  "locations",
  "schedule",
  "messages",
  "settings",
] as const;

interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
  counters: [string, number][];
  photos: {
    id: string;
    appointmentId?: string;
    mimeType: string;
    createdAt: string;
    dataUrl: string;
  }[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Everything the app knows, in one JSON file. Photos go inline as data URLs. */
export async function exportBackup(): Promise<Blob> {
  const db = await getDb();

  const tables: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    tables[table] = (await db.getAll(table)) as unknown[];
  }

  const counters = await db.getAll("counters");
  const counterKeys = await db.getAllKeys("counters");
  const photos = await db.getAll("photos");

  const payload: BackupFile = {
    format: "servicio-tecnico-agenda",
    version: 1,
    exportedAt: new Date().toISOString(),
    tables,
    counters: counterKeys.map((key, index) => [String(key), Number(counters[index])]),
    photos: await Promise.all(
      photos.map(async (photo) => ({
        id: photo.id,
        appointmentId: photo.appointmentId,
        mimeType: photo.mimeType,
        createdAt: photo.createdAt,
        dataUrl: await blobToDataUrl(photo.blob),
      }))
    ),
  };

  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

/** Replaces ALL local data with the backup. Returns how many rows were restored. */
export async function importBackup(file: File): Promise<number> {
  const payload = JSON.parse(await file.text()) as BackupFile;

  if (payload?.format !== "servicio-tecnico-agenda") {
    throw new Error("El archivo no parece un respaldo de esta app.");
  }

  const db = await getDb();

  // Decode photos before opening the transaction: IndexedDB commits on foreign awaits.
  const photos = await Promise.all(
    (payload.photos ?? []).map(async (photo) => ({
      id: photo.id,
      appointmentId: photo.appointmentId ?? photo.id,
      mimeType: photo.mimeType,
      createdAt: photo.createdAt,
      blob: await (await fetch(photo.dataUrl)).blob(),
    }))
  );

  const stores = [...TABLES, "photos", "counters"] as const;
  const tx = db.transaction(stores, "readwrite");

  for (const table of TABLES) await tx.objectStore(table).clear();
  await tx.objectStore("photos").clear();
  await tx.objectStore("counters").clear();

  let restored = 0;
  for (const table of TABLES) {
    const rows = (payload.tables?.[table] ?? []) as never[];
    for (const row of rows) {
      await tx.objectStore(table).put(row);
      restored += 1;
    }
  }

  for (const [key, value] of payload.counters ?? []) {
    await tx.objectStore("counters").put(value, key);
  }

  for (const photo of photos) {
    await tx.objectStore("photos").put(photo);
  }

  await tx.done;
  return restored;
}
