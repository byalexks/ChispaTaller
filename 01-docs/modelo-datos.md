# Modelo de datos — Producto B (técnico)

Estado: **propuesta**. Se cierra cuando definamos almacenamiento.

La regla que ordena todo: **el local no viene en el mensaje; viene del horario.**
El mensaje dice la fecha y la hora. Dónde está el trabajador a esa hora lo define
su horario de trabajo. Si el mensaje trae local (T3 sí lo trae), se valida contra el
horario; si no coincide, salta alerta.

---

## Entidades

### `trabajador`
Una sola fila por instalación mientras sea de un trabajador.

| Campo | Tipo |
|---|---|
| id | texto |
| nombre | texto |
| telefono | texto |

### `local`

| Campo | Tipo | Nota |
|---|---|---|
| id | texto | `cartagena-1` … `turbaco` |
| nombre | texto | |
| ciudad | texto | |
| alias | lista | `Ofero centro`, `Ofero`, `Centro`… |
| direccion | texto | |
| activo | booleano | |

5 en Cartagena + 1 en Turbaco. Los alias existen porque en los mensajes el local
viene escrito a mano y con errores.

### `horario` (lo que él configura)

| Campo | Tipo | Nota |
|---|---|---|
| id | texto | |
| dia_semana | 0–6 | 0 = domingo |
| desde | hora | `08:00` |
| hasta | hora | `09:00` |
| local_id | texto | |
| tipo | enum | mantenimiento / revision / garantia |
| cupo | entero | cuántos caben en ese bloque |

Ejemplo real:

```
lunes   08:00–09:00  cartagena-1  mantenimiento  4
lunes   14:00–16:00  cartagena-1  revision       3
sábado  08:00–09:00  turbaco      mantenimiento  4
```

Un día puede tener varios bloques, incluso en locales distintos. Si no hay bloque,
ese día está **cerrado** para ese tipo.

### `cliente`

| Campo | Tipo |
|---|---|
| id | texto |
| nombre | texto |
| nombre_normalizado | texto (sin tildes, minúsculas) |
| telefonos | lista (puede estar vacía) |
| alias | lista (para unir "Rosaida" con "Rosaida Hernández") |

### `vehiculo`

| Campo | Tipo |
|---|---|
| id | texto |
| cliente_id | texto |
| modelo | texto |
| placa | texto (opcional) |
| serial | texto (opcional) |

Los modelos vienen inconsistentes (`galaxy 3`, `stareer 3`, `Ledo 3`). Se guardan
tal cual y se normalizan contra catálogo cuando exista.

### `cita`

| Campo | Tipo | Nota |
|---|---|---|
| id | texto | |
| cliente_id / vehiculo_id | texto | |
| tipo / tipo_secundario | enum | |
| estado | enum | ver abajo |
| fecha | fecha | |
| hora / hora_fin | hora | |
| local_id | texto | **sale del bloque de horario** |
| valor / cobro | número / enum | pagado · gratuito · por_definir |
| repuesto | texto | |
| descripcion | texto | el "Problema" del mensaje |
| instrucciones | texto | lo que hay que llevar |
| evidencia_url | texto | foto, fase posterior |
| mensaje_id | texto | trazabilidad |
| alertas | lista | lo que el parser marcó |

### `mensaje`

| Campo | Tipo |
|---|---|
| id | texto |
| texto | texto crudo |
| recibido_en | fecha-hora |
| bandeja | booleano |
| cita_id | texto (si se convirtió) |

### `evento` (auditoría)

`fecha · entidad · entidad_id · accion · antes · despues`

---

## Estados y cupo

```
agendada → por_confirmar → confirmada → asistió
                                    ↘ no_asistió → reprogramada | cancelada
```

| Estado | ¿Ocupa cupo? |
|---|---|
| agendada | Sí |
| por_confirmar | Sí |
| confirmada | Sí |
| asistió | Sí |
| no_asistió | No |
| reprogramada | No |
| cancelada | No |

---

## Cálculo de huecos

Para una fecha:

1. `dia = día de la semana de la fecha`.
2. `bloques = horario[dia]` activos.
3. Por cada bloque: `ocupados = citas(fecha, local_id, tipo compatible, estado que ocupa)`.
4. `libres = cupo − ocupados`.
5. Resultado por bloque:

| libres | Estado |
|---|---|
| `> 1` | disponible |
| `= 1` | último |
| `= 0` | lleno |
| sin bloque | cerrado |

Lo que se muestra al trabajador:

```
Jueves 26
  Mañana  · Cartagena 1 · 2/4   → quedan 2
  Tarde   · Cartagena 1 · 3/3   → LLENO
```

Eso responde exactamente "¿tiene huecos?" sin abrir WhatsApp.

## Reglas de negocio

1. **Local = bloque de horario.** Si el mensaje trae local y no coincide con el
   bloque de esa hora → alerta, no se agenda solo.
2. **Primer mantenimiento gratuito (sugerencia).** Si el cliente no tiene ningún
   mantenimiento *asistido* y el mensaje no trae valor → sugerir `gratuito`. Nunca
   decidirlo solo.
3. **Cancelado no ocupa cupo.** Detectado por la palabra `CANCELADO`.
4. **Reprogramar libera el cupo viejo** y valida el nuevo antes de mover.
5. **Fecha en el pasado o día que no coincide** → alerta; no se agenda sin
   confirmación humana.

## Historial

Vista por cliente:

```
HILDA DE AVILA · 300 653 2525
  Vehículo: galaxy 3
  12/03/2026  Mantenimiento   asistió    $240.000
  20/11/2026  Mantenimiento   agendada   —
  Primer mantenimiento: no
```

Sirve para tres cosas: saber si es cliente nuevo (gratis), no duplicar, y responder
"¿cada cuánto viene?".

## Pendiente de definir

- ¿El trabajador está en **un local por bloque** o se mueve dentro del mismo bloque?
  Si se mueve, hay que meter tiempo de traslado y el cupo baja.
- Cuál es el local real de `Ofero centro`.
- Si los 5 locales de Cartagena atienden a la misma hora o él rota.
