# Cierre diario a Google (híbrido)

La app trabaja local en el teléfono. Al cerrar el día, el admin sube las citas a
una **hoja de Google** mediante un **Apps Script**. Sin servidor y sin costo.

## 1. Hoja y script (5 minutos)

1. En la **misma cuenta** donde creaste el Client ID, abrí
   <https://sheets.new> y poné un nombre (ej. *Chispa Taller — Cierre*).
2. **Extensiones → Apps Script**.
3. Borrá lo que haya y pegá el contenido de `cierre.gs`.
4. Cambiá `TOKEN` por una clave larga inventada. Anotá la clave: va también en la app.
5. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario** (necesario para que la app pueda enviar sin login)
6. Autorizá los permisos.
7. Copiá la URL que termina en **`/exec`**.

> “Cualquier usuario” suena abierto, pero el script solo escribe si el token
> coincide. Si te preocupa, usá un token de 40+ caracteres.

## 2. En la app

1. Entrá como admin (PIN `9999`).
2. **Subir a Google** → pegá la URL `/exec` y el token → **Guardar**.
3. **Subir cierre** → confirmar.

La hoja “Cierre” se crea sola con encabezados:

`ID · Fecha · Hora · Técnico · Local · Cliente · Teléfono · Vehículo · Tipo · Estado · Monto · Observaciones · Fotos · Subido`

## Detalles

- **No duplica**: el script salta los IDs que ya están en la hoja. Podés subir
  varias veces el mismo día sin miedo.
- **Fotos**: por ahora sube el **número** de fotos, no los archivos. Las fotos se
  descargan desde la app (por visita o ZIP del día).
- **Si cambia una cita después de subir**, la fila vieja queda. El cierre es una
  foto del momento, no un espejo. Si necesitás corrección, se edita la hoja.
- El script **no** requiere Google Cloud ni facturación.

## Probar que quedó bien

Abrí la URL `/exec` en el navegador: debe devolver

```json
{ "ok": true, "mensaje": "Chispa Taller listo" }
```
