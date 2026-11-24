# Reglas del proyecto Chispa Taller

## Versión visible (obligatorio)

Cada cambio visible para el usuario (pantalla, flujo, texto, corrección) debe
subir la versión de la app:

1. `APP_VERSION` en `05-app/src/App.tsx` (se muestra en el login y en Mi perfil).
2. `version` en `05-app/package.json` y `package-lock.json`.
   Usar: `npm version x.y.z --no-git-tag-version` dentro de `05-app`.

No dejar dos versiones distintas entre `App.tsx` y `package.json`.

## Script de Google

Si se toca `04-google/cierre.gs`, hay que publicar una **versión nueva** en Apps
Script; guardar no alcanza. Subir también `VERSION` dentro del script.

## Alcance

Solo Producto B (Chispa Taller). Producto A (hoja del negocio) no se retoma sin
pedido explícito.
