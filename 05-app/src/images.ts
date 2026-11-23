/**
 * Resizes and compresses a camera photo before storing it.
 * A 4 MB photo becomes ~150 KB, which keeps IndexedDB small.
 */
export async function compressPhoto(
  file: File,
  maxSize = 1280,
  quality = 0.72
): Promise<{ blob: Blob; mimeType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Este navegador no puede procesar la imagen.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  if (!blob) throw new Error("No se pudo comprimir la foto.");

  return { blob, mimeType: "image/jpeg" };
}
