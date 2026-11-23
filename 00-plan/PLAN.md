# Plan del proyecto — Agenda de servicio técnico

**Versión:** 0.1 (borrador) · **Fecha:** 2026-11-23 · **Estado:** abierto, pendiente
de respuestas del cliente.

> Este plan no está finalizado. Se cierra cuando el cliente responda
> `PREGUNTAS.md` **y** hayamos analizado el formato que ya usan. Hasta entonces,
> los números y reglas marcados con ⚠️ son supuestos.

---

## 1. Contexto

Negocio de servicios técnicos con **6 locales**: 5 en Cartagena y 1 en Turbaco.

- **Mantenimientos** → franja de la mañana. Se reciben entre 8:00 y 9:00 y se
  entregan después del mediodía.
- **Revisiones** → franja de la tarde, a partir de las 14:00.
- **Garantías / cambio de repuesto en garantía** → se agenda el día del cambio.

Todo llega por **WhatsApp** y se agenda a mano: mensajes con fechas mal escritas
("miércoles 20" cuando es viernes), sin nombre de local y sin control de cupos.

## 2. El problema

No es un CRM. Es **control de capacidad + una sola fuente de verdad**.

1. Se agendan 8 personas un día y otros días quedan vacíos.
2. Cuando un cliente pregunta "¿tenés cupo el miércoles?", no hay forma de
   responder sin revisar mensajes.
3. No queda registro de quién asistió ni de qué se le hizo al vehículo.
4. Las reprogramaciones y cancelaciones no liberan ni mueven el cupo.

## 3. Alcance

### Dentro (esta fase)

- Un libro de Google Sheets que funciona como agenda, base de datos y tablero.
- Control de cupos por día con semáforo verde/amarillo/rojo.
- Registro de cita: persona, teléfono, vehículo, serial, modelo, local, tipo,
  pago/gratuito, estado y evidencia.
- Vista de día y vista de semana.
- Registro de reprogramaciones, cancelaciones y no-show.
- Historial consultable por cliente y por vehículo.
- Exportación a `.xlsx` / PDF cuando se necesite.

### Fuera (por ahora)

- App móvil o web propia.
- Parser automático de mensajes de WhatsApp (el texto se pega a mano).
- Sincronización automática con Google Calendar.
- Bot de WhatsApp / recordatorios automáticos.
- Multiusuario con roles complejos.

> Si más adelante se quiere automatizar, se monta un Apps Script **encima** del
> mismo libro: el diseño de las pestañas ya queda preparado para eso.

## 4. Arquitectura

**Un solo archivo: libro de Google Sheets.** Sin servidor, sin base de datos
externa, sin costo de infraestructura.

**El libro parte de su formato, no del nuestro.** Ellos ya tienen un Excel de
trabajo. El proyecto no reemplaza ese formato: lo adopta, lo ordena y le agrega lo
que le falta.

### Principios de adaptación

1. **Sus columnas se quedan, en su orden.** Si hay que agregar un dato, va al
   final de la tabla o en una pestaña auxiliar; nunca en medio.
2. **La lógica vive aparte.** Validaciones, capacidad y semáforos van en pestañas
   auxiliares que se pueden ocultar (`_Panel`, `_Config`, `_Catalogos`), para que
   su hoja se vea como ellos la conocen.
3. **Se respeta lo que imprimen.** Si imprimen la agenda del día, esa vista se
   conserva tal cual.
4. **Cambio mínimo, no diseño ideal.** Si su estructura impide controlar cupos, se
   propone la modificación más pequeña posible y se explica el porqué.
5. **Nada se borra.** El archivo original se conserva intacto; el nuevo es una
   copia mejorada y versionada.
6. **Se migran sus datos.** Las citas históricas se cargan para que el libro no
   arranque vacío.

Consecuencias de diseño:

- El libro es **también la interfaz**: el cliente lo abre y lo edita. Nada de
  columnas técnicas ilegibles ni fórmulas repartidas.
- **La lógica de capacidad vive en un solo lugar** (pestaña `Panel`), nunca en
  fórmulas sueltas por fila.
- El libro tolera ediciones manuales: validaciones de datos y listas cerradas para
  evitar valores raros.
- El trabajo se hace a mano, así que el orden de las columnas debe seguir el orden
  en que el técnico piensa (fecha → local → persona → vehículo → servicio).

## 5. Modelo de datos

⚠️ **Provisional.** Este esquema es el que usaríamos si partiéramos de cero. El
definitivo sale de `01-docs/analisis-formato-existente.md`, es decir, de lo que
ellos ya tienen. La lógica de capacidad y estados sí se mantiene.

Detalle completo en `02-sheets/esquema-pestanas.md`. Resumen:

| Pestaña | Rol |
|---|---|
| `Citas` | Una fila por cita. Tabla transaccional. |
| `Panel` | Cupos por día, ocupación, semáforo. Solo fórmulas. |
| `Capacidad` | Reglas editables: local × día → máximos. ⚠️ 1 fila o 6 según respuesta. |
| `Locales` | 5 Cartagena + 1 Turbaco. |
| `Clientes` | Nombre, teléfono, notas. |
| `Vehiculos` | Serial/VIN, modelo, placa, cliente. |
| `Catalogos` | Listas para validación. |
| `Log` | Auditoría de cambios. |
| `Config` | Parámetros generales. |

Estados de una cita:

```
Agendada → Confirmada → Asistió
                     ↘ No asistió → (Reprogramada | Cancelada)
```

Solo `Agendada`, `Confirmada` y `Asistió` **ocupan cupo**. `No asistió`,
`Reprogramada` y `Cancelada` lo liberan.

## 6. Reglas de capacidad (⚠️ por confirmar)

Supuesto actual:

- Máximo **4 mantenimientos** y **2–3 revisiones** por día.
- **Total del día** para el técnico (no por local) — ⚠️ confirmar.
- Si se pasa el tope, el libro **advierte** pero no bloquea (flexibilidad pedida).
- Cancelar o reprogramar libera el cupo de inmediato.
- Sábados: solo Turbaco, con regla aparte — ⚠️ confirmar.

## 7. Fases

| Fase | Entregable | Criterio de terminado |
|---|---|---|
| 0. Descubrimiento | Cuestionario respondido + `DECISIONES.md` actualizado | Las decisiones abiertas resueltas |
| 0.5 Diagnóstico | Archivo actual analizado + `analisis-formato-existente.md` | Sabemos qué columnas tienen, qué fórmulas, qué rompe y qué se conserva |
| 1. Libro base | Su archivo convertido a Sheet + validaciones + pestañas auxiliares | Se puede cargar una cita sin errores de tipeo y sin cambiar su forma de trabajar |
| 2. Capacidad | `Capacidad` + `Panel` con fórmulas y semáforo | Responde "¿hay cupo el miércoles?" en menos de 5 s |
| 3. Operación | Vista día/semana, estados, evidencia, reprogramación | El técnico lo usa un día completo sin tocar WhatsApp para consultar |
| 4. Historial y reportes | Historial por cliente/vehículo, cierre de semana, PDF/Excel | Se puede imprimir la agenda del día |
| 5. Pruebas con datos reales | Mensajes reales cargados y corregidos | 10 citas consecutivas sin retrabajo manual |

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Regla de capacidad mal definida (por local vs. total) | Bloquea la fase 2 hasta que el cliente responda la pregunta 15 y 16. |
| El cliente edita a mano y rompe el formato (fechas como texto, filas duplicadas) | Listas cerradas, validación de fecha real, formato condicional de filas inválidas. |
| Dos personas editando a la vez | Es un riesgo bajo con 2 usuarios; se documenta "una persona agenda". |
| Fórmulas que se rompen al insertar filas | Referencias a columnas completas y rangos con nombre. |
| Pérdida del archivo | Copia diaria automática (o manual al cierre) + historial de versiones de Drive. |
| Adopción: si es más lento que WhatsApp, no lo usan | El libro debe abrirse en el celular y cargar una cita en menos de 30 s. |
| Su formato actual esconde fórmulas o celdas combinadas que se rompen al copiar | Diagnóstico previo; se trabaja sobre una copia; nunca se edita el original. |
| Quieren conservar columnas que no aportan al control de cupos | Se respetan y se agrega la información en pestañas auxiliares. |
| El formato actual está lleno de datos reales y desordenados | Se migra y se limpia por separado; el histórico no bloquea el arranque. |
| Confusión `.xlsx` vs. Sheet | Se entrega Sheet nativo; `.xlsx` solo como exportación. |

## 9. Criterios de éxito (a un mes)

- Ningún día supera el tope sin decisión consciente del técnico.
- Cero citas perdidas en el chat.
- Responder disponibilidad sin abrir WhatsApp.
- El técnico registra el 100% de las asistencias con evidencia.
- El cliente puede leer el libro sin explicación previa.

## 10. Pendientes inmediatos

1. **Conseguir el archivo que usan hoy** (aunque tenga datos reales o esté
   desordenado). Es el insumo principal.
2. Diagnosticarlo con `01-docs/analisis-formato-existente.md`.
3. Enviar `02-sheets/cuestionario-cliente.xlsx` al cliente.
4. Cargar 10–20 mensajes reales en `03-pruebas/`.
5. Cerrar `DECISIONES.md`.
6. Construir sobre su formato (fase 1).
