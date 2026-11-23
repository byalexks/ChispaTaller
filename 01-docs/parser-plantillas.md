# Parser de plantillas de WhatsApp — diseño v0.1

Estado: **borrador**. Se actualiza con cada ejemplo nuevo.
Regla: **sin IA.** Extracción determinista, auditable, sin costo y sin que los
mensajes salgan del equipo.

---

## El problema real

No hay "un formato". Hay varios, y aparecen nuevos. Cuatro ejemplos ya mostraron:

- cuatro estructuras distintas,
- cuatro formas de escribir la fecha,
- tres nombres distintos para el mismo campo (`Vehículo` / `Modelo`),
- campos que aparecen y desaparecen (local, teléfono, precio),
- y una plantilla reciclada de 2024 con el año cambiado.

Por eso: **nada de un parser por plantilla**. Un motor genérico que se adapta.

## Las siete capas

```
texto crudo
   │
   1. normalizar        quitar reenvíos, "*", viñetas, líneas vacías
   │
   2. segmentar         convertir en pares etiqueta → valor
   │
   3. mapear            alias de etiqueta → campo canónico
   │
   4. detectar          fecha, hora, teléfono, dinero, placa, serial (en todo el texto)
   │
   5. clasificar        tipo de servicio por palabras clave
   │
   6. validar           día vs fecha, año ausente, fecha pasada, faltantes
   │
   7. deduplicar        ¿ya existe esta cita?
   │
borrador de cita + faltantes + dudas + extras
```

Cada capa se puede probar sola. Si algo falla, se sabe en cuál.

### 1. Normalizar

- Quitar `[4:47 PM, 11/23/2026] Nombre:`, `Reenviado`, `Forwarded`.
- Quitar `*` de énfasis de WhatsApp (`*Texto*` → `Texto`).
- Quitar viñetas (`•`, `-`, `·`) del inicio.
- Colapsar espacios múltiples y líneas vacías.
- **No** corregir ortografía: `dejo` queda `dejo` (es dato del cliente).

### 2. Segmentar en etiquetas

Una línea que termina en `:` es una etiqueta. Su valor es:

- lo que sigue en la misma línea, o
- las líneas siguientes hasta la próxima etiqueta.

Ejemplo, `*Nombre y Apellidos:*` con el valor en la línea de abajo. Y
`*Vehículo:* galaxy 3` con el valor al lado. **Las dos formas tienen que funcionar.**

Sin lista cerrada de etiquetas: cualquier `Algo:` se reconoce como etiqueta.

### 3. Diccionario de alias

| Campo canónico | Alias aceptados |
|---|---|
| `nombre` | Nombre, Nombre y Apellidos, Cliente, Propietario, Señor(a) |
| `modelo` | Vehículo, Vehiculo, Modelo, Carro, Moto |
| `fecha_hora` | Día y Hora, Fecha y hora, Fecha, Día, Cita |
| `telefono` | Teléfono, Telefono, Celular, Tel, WhatsApp, Contacto |
| `local` | Local, Sede, Punto, Taller |
| `repuesto` | Repuesto, Pieza, Accesorio |
| `valor` | Total a pagar, Valor, Precio, Total |
| `descripcion` | Problema, Falla, Motivo, Observaciones, Notas |
| `direccion` | Dirección, Direccion, Ubicación |

Lo que no está en la tabla **no se descarta**: va a `extras` con su etiqueta
original. Así una plantilla nueva no pierde información.

### 4. Detectores universales

Corren sobre todo el texto, no solo sobre los valores de etiqueta (porque la fecha
puede venir en el título, como en T2):

| Detector | Qué reconoce |
|---|---|
| Fecha | `20 - NOVIEMBRE -2026` · `20 DE NOVIEMBRE` · `20/11/26` · `20/11/2026` |
| Día de semana | lunes…domingo, con o sin tilde, en mayúsculas |
| Hora | `8:00am`, `2 pm`, `14:00`, `8:00AM A 9PM` (ventana) |
| Teléfono | 10 dígitos, con o sin puntos/guiones/espacios |
| Dinero | `$240.000`, `240000`, `240.000` |
| Placa | `ABC123` |
| Serial | alfanumérico de 17 (VIN) |

### 5. Clasificar el tipo

Por palabras clave, en orden de prioridad:

| Palabras | Tipo |
|---|---|
| MANTENIMIENTO | Mantenimiento |
| REVISIÓN / REVISION | Revisión |
| GARANTÍA / GARANTIA | Garantía |
| REPUESTO / INSTALACIÓN DE | Repuesto |

Puede haber dos: T1 es **mantenimiento + repuesto**. Se guarda el principal y el
secundario, no se pierde ninguno.

### 6. Validar (acá está el valor de verdad)

| Regla | Acción |
|---|---|
| Día de la semana ≠ fecha calculada | **Marcar.** Es el checksum. Detecta plantillas recicladas. |
| Sin año en el texto | Usar el año del mensaje; si la fecha queda muy en el pasado, marcar. |
| Fecha en el pasado | Marcar: "esta cita ya pasó". |
| Hora fuera del horario del local | Marcar. |
| Ventana de 13 horas (`8:00AM A 9PM`) | Interpretar como recepción 8–9 y marcar. |
| Falta local | Marcar como faltante. |
| Falta teléfono | Se permite; el dedupe usa nombre + modelo + fecha. |
| Falta todo lo identificable | Va a **bandeja**, nunca se inventa. |

### 7. Deduplicar

Orden de confianza:

1. Teléfono + fecha.
2. Nombre normalizado + modelo + fecha.
3. Texto del mensaje idéntico (mismo reenvío).

Si hay coincidencia: `"Ya existe una cita para HILDA DE AVILA el 20/11"`. Nunca
crear dos en silencio.

---

## Lo que el texto revela sobre la agenda

Los mensajes no son citas por hora. Son **ventanas**:

| Tipo | Ventana | Qué ocupa |
|---|---|---|
| Mantenimiento | Recepción 8:00–9:00. Entrega en la tarde por orden de llegada. | 1 cupo de recepción |
| Revisión | 14:00–16:00 ("de dos a cuatro de la tarde") | 1 cupo de tarde |
| Garantía / repuesto | 14:00–16:00 (el ejemplo dice "2 pm") | 1 cupo de tarde + local |

Entonces el calendario es de **cupos por ventana**, no de horas. "¿Qué hueco hay?"
significa *cuántos caben todavía en esa ventana*.

Esto conecta directo con el problema original del primer audio: si el día tiene 8
agendados y el cupo es 4, el aviso tiene que saltar solo.

## Reglas del audio del 23/11 (47 s)

- **Cancelación**: no hay plantilla aparte. Se reutiliza el formato del
  mantenimiento y se agrega **`CANCELADO`** al final. → Si el texto contiene
  `CANCELADO`/`CANCELADA`, el estado es *Cancelada* y no ocupa cupo.
- **Revisión**: fecha + hora + nombre + modelo + problema. La hora es una ventana
  ("de dos a cuatro de la tarde"), no una hora exacta.
- **El título define el servicio**: `MANTENIMIENTO` solo; si incluye pieza, se
  agrega `INSTALACIÓN DE REPUESTOS`.
- **Pago**: si es pago, se agrega `TOTAL A PAGAR: $...`. Si no aparece, no asumir
  que es gratis.
- **El primer mantenimiento no se paga.** → Si no hay valor y es la primera cita
  del cliente, el sistema *sugiere* Gratuito; no lo decide solo.
- **El formato es estable**: "no se modifica mucho el formato". Buena noticia para
  el parser: alcanza con tolerar variantes menores.

> La transcripción tiene ruido ("el nombre de la presión del modelo", "formatico").
> Se interpretó lo evidente; lo dudoso quedó marcado para confirmar con el cliente.

---

## Cómo se agrega una plantilla nueva

1. Pegar el mensaje en `03-pruebas/plantillas-reales.md`.
2. Ver qué etiquetas trae y si alguna no está en el diccionario de alias.
3. Agregar el alias (o el sinónimo de tipo). **No se toca el motor.**

Si un mensaje nuevo obliga a cambiar el motor, es que el motor estaba mal
diseñado, no que falta una plantilla.

## Lo que nunca se pierde

- El **mensaje original**, guardado junto a la cita.
- Los **campos desconocidos**, en `extras`.
- La **confianza** de cada campo y el motivo de cada alerta.

## Pendiente

- Más ejemplos: cancelaciones, reprogramaciones, mensajes de clientes (texto libre),
  mensajes con serial o placa, y los que llegan sin plantilla.
- Catálogo real de locales (aparece `Ofero centro`) y de modelos (`galaxy 3`,
  `stareer 3`, `Ledo 3`).
