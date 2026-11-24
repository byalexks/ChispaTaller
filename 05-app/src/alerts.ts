import type { Alert } from "./types";

export const MISSING_PHONE_MESSAGE =
  "Cliente sin teléfono registrado: no se podrá llamar ni confirmar por WhatsApp. Pedile al administrador que lo agregue.";

export const MISSING_VEHICLE_MESSAGE =
  "Sin vehículo o modelo: completalo para que el historial del cliente quede claro.";

export function unknownLocationMessage(location: string): string {
  return `La sede "${location}" no está registrada. La cita se guarda sin sede: pedile al administrador que la cree en Administración → Sedes.`;
}

/**
 * Notes that travel with the appointment when the message does not carry
 * everything the visit needs. They are advisory: the appointment is still saved.
 */
export function dataAlerts(input: {
  hasPhone: boolean;
  hasModel: boolean;
  unknownLocation: string | null;
}): Alert[] {
  const alerts: Alert[] = [];

  if (!input.hasPhone) {
    alerts.push({
      code: "MISSING_PHONE",
      field: "phone",
      severity: "medium",
      message: MISSING_PHONE_MESSAGE,
    });
  }

  if (input.unknownLocation) {
    alerts.push({
      code: "UNKNOWN_LOCATION",
      field: "location",
      severity: "medium",
      message: unknownLocationMessage(input.unknownLocation),
    });
  }

  if (!input.hasModel) {
    alerts.push({
      code: "MISSING_VEHICLE",
      field: "model",
      severity: "low",
      message: MISSING_VEHICLE_MESSAGE,
    });
  }

  return alerts;
}
