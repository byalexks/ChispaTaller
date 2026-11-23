# Las dos ramas del proyecto

Un mismo problema, dos entregables distintos. Se comparten el modelo de datos, las
reglas y el parser; cambia dónde vive la información y quién la usa.

---

## Rama A — el trabajador (en construcción)

**Producto:** sitio web instalable como PWA. Una persona, su día, su celular.

- Entrada: el técnico **copia el mensaje de WhatsApp y lo pega**. No hay sync, no
  hay bot, no hay API de WhatsApp.
- El parser entiende la plantilla y propone la cita.
- El mensaje puede **crear, actualizar o cancelar** una cita existente.
- El local de la cita sale del **horario** del técnico.
- Cupos por ventana: mañana (recepción 8–9) y tarde (14–16).
- Historial por cliente, foto de evidencia y observaciones al cerrar la visita.
- Login simple: elegir técnico + PIN de 4 dígitos. Separa agendas; **no es
  seguridad** (quien tenga el teléfono ve todo).
- Almacenamiento: **IndexedDB** en el dispositivo. Sin servidor, sin costo, sin que
  los datos salgan del equipo.
- Multi-técnico: cada uno ve su agenda y su horario.

**Pantallas:** Login · Hoy · Bandeja · Semana · Pegar · Revisión · Cierre de visita
· Horario. Modo claro y modo "dim".

**Riesgos:** un solo dispositivo (no hay sync), respaldo manual (pendiente), y en
iPhone el navegador puede borrar datos de una PWA sin uso.

---

## Rama B — el negocio (parqueada)

**Producto:** libro de Google Sheets con todo: 6 locales, cupos, panel, historial,
evidencias y reportes.

- Entrada: hoja llena a mano o texto pegado.
- Depende del **archivo real del cliente**: su estructura manda.
- Sin app: el libro es la interfaz.
- No avanza hasta tener su Excel y las respuestas del cuestionario.

**Riesgos:** formato heredado, celdas combinadas, fechas como texto, y que el
archivo actual sea parte del problema.

---

## Lo que comparten

| Pieza | Definición |
|---|---|
| Tipos de servicio | Mantenimiento, revisión, garantía, repuesto |
| Estados | Agendada, por confirmar, confirmada, asistió, no vino, reprogramada, cancelada |
| Ventanas | Mañana 8–9 (recepción) · Tarde 14–16 |
| Parser | Motor determinista por etiquetas + validación |
| Dedupe | Teléfono, luego nombre + modelo + fecha |
| IDs | Secuenciales hexadecimales (`C-0001`) |

## Orden

1. Cerrar el UI de la rama A. ← ahora
2. Probarla una semana con mensajes reales.
3. Si funciona: respaldo/export y, si pide verlo en el computador, sync.
4. Retomar la rama B cuando llegue el Excel del cliente.
