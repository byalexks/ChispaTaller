# Análisis del formato que ya usan

Estado: **pendiente** — no tenemos el archivo todavía.

Ruta / enlace del archivo original:

```
(sin definir)
```

Regla: se analiza y se trabaja sobre una **copia**. El original no se edita ni se
mueve.

---

## 1. Inventario del archivo

| Dato | Respuesta |
|---|---|
| Nombre del archivo | |
| Formato (`.xlsx`, Sheet de Google, ambos) | |
| Tamaño / últimas modificaciones | |
| ¿Cuántas hojas tiene? | |
| Nombres de las hojas | |
| ¿Tiene fórmulas? ¿Cuáles? | |
| ¿Tiene celdas combinadas? | |
| ¿Tiene macros (`.xlsm`)? | |
| ¿Tiene listas desplegables o validaciones? | |
| ¿Tiene formato condicional / colores con significado? | |
| ¿Se comparte con alguien más? ¿Quién edita? | |
| ¿Se imprime? ¿Qué vista exactamente? | |

## 2. Estructura de la hoja principal

Copiar los encabezados **tal cual**, en su orden, sin corregir ortografía:

| Pos | Columna | Qué contiene realmente | ¿Se usa? | Problema detectado |
|---|---|---|---|---|
| A | | | | |
| B | | | | |
| C | | | | |

Preguntas guía:

- ¿Una fila = una cita, un día, o un cliente?
- ¿Hay una hoja por local, por mes, o todo junto?
- ¿Dónde se escribe el estado (asistió / no vino)?
- ¿Dónde queda la evidencia fotográfica?
- ¿Hay columnas que se llenan a mano y otras con fórmula?
- ¿Hay datos repetidos escritos de formas distintas ("Toyota", "toyota", "TOYOTA")?

## 3. Calidad de los datos

- Fechas: ¿son fechas reales o texto? ¿Formato `dd/mm` o `mm/dd`?
- Teléfonos: ¿con indicativo? ¿como texto o número (se comen el 0)?
- Seriales: ¿completos? ¿se repiten?
- Nombres: ¿cargados igual siempre?
- Vacíos: ¿qué porcentaje de celdas clave está vacío?

## 4. Lo que se conserva (no negociable)

Anotar lo que el cliente o su equipo usan a diario:

- [ ] Orden de columnas
- [ ] Nombre de la hoja
- [ ] Colores y su significado
- [ ] Vista de impresión
- [ ] Columnas que otros reportes consumen
- [ ] Fórmulas existentes que producen algún número que ellos miran

## 5. Lo que hay que cambiar (mínimo indispensable)

| Cambio propuesto | Por qué | Impacto para ellos |
|---|---|---|
| | | |

Regla: si un cambio no ayuda a controlar cupos o a evitar errores de carga, **no se
hace**.

## 6. Plan de migración

1. Copia del original → `01-docs/original-<fecha>.xlsx`.
2. Convertir la copia a Sheet nativo (Archivo → Guardar como hoja de cálculo).
3. Limpiar: normalizar fechas, teléfonos y textos; separar datos de fórmulas.
4. Cargar histórico en la hoja de citas (o en una hoja `_Historico` si el volumen
   es grande).
5. Agregar pestañas auxiliares: `_Panel`, `_Config`, `_Catalogos`.
6. Validar con 10 citas reales.
7. Recién ahí, compartir con el cliente.

## 7. Riesgos detectados

- 

## 8. Conclusión

- ¿Se puede adaptar su archivo tal cual? (sí / no / sí con cambios)
- ¿Qué es lo primero que hay que arreglar?
- ¿Qué se deja para una segunda fase?
