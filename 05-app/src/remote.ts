/**
 * Conexión por defecto al Apps Script.
 *
 * Van compiladas en la app para que cualquier equipo quede configurado solo,
 * sin pegar URL ni token. El costo: quien abra el sitio puede verlas en el
 * código. Si algún día se cambia el token, hay que editar acá y volver a publicar.
 */
export const DEFAULT_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbx4IxJ92LV1V_ZpcPGSbzdMFXPeTD9SoocHCo2OTg52y1IUmVmTsZRq3dYRAIkfK14F/exec";

export const DEFAULT_SCRIPT_TOKEN = "chispa-2026-abc123";

export function hasRemoteDefaults(): boolean {
  return Boolean(DEFAULT_SCRIPT_URL && DEFAULT_SCRIPT_TOKEN);
}
