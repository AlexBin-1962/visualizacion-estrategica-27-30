# Estratégico

Abre `index.html` desde la raíz del repo o usa Live Server apuntando al proyecto.

## Estructura actual

Cada vista principal vive ahora en su propia carpeta dentro de `estrategico/`:

- `portal/portal.html`, `portal/portal.css`, `portal/portal.js`
- `analisis_territorial/analisis_territorial.html`, `analisis_territorial/analisis_territorial.css`, `analisis_territorial/analisis_territorial.js`
- `campo/campo.html`, `campo/campo.css`, `campo/campo.js`
- `estructura/estructura.html`, `estructura/estructura.css`, `estructura/estructura.js`
- `dia_D/dia_D.html`, `dia_D/dia_D.css`, `dia_D/dia_D.js`
- `ganar_todo/ganar_todo.html`, `ganar_todo/ganar_todo.css`, `ganar_todo/ganar_todo.js`
- `cct/cct.html`, `cct/cct.css`, `cct/cct.js`
- `socioeconomico/socioeconomico.html`, `socioeconomico/socioeconomico.css`, `socioeconomico/socioeconomico.js`
- `dashboard_municipio/dashboard_municipio.html`, `dashboard_municipio/dashboard_municipio.css`, `dashboard_municipio/dashboard_municipio.js`

## Wrappers de compatibilidad

Los archivos `estrategico/*.html` originales se conservaron como wrappers de redirección.

Ejemplo:

- `estrategico/portal.html` redirige a `estrategico/portal/portal.html`

Esto permite no romper enlaces viejos mientras se actualizan accesos internos y despliegues.

## Rutas relativas

Como las páginas reales ahora están un nivel abajo, las referencias internas deben usar `../` para llegar a recursos compartidos:

- `../assets/...`
- `../data/...`
- `../src/...`
- `../config/...`

Entre módulos, la navegación debe apuntar directo a la página final, por ejemplo:

- `../portal/portal.html`
- `../campo/campo.html`
- `../estructura/estructura.html`

## Regla de mantenimiento

Para cualquier módulo nuevo o existente:

- el HTML vive en `modulo/modulo.html`
- el CSS vive en `modulo/modulo.css`
- el JS vive en `modulo/modulo.js`
- evita volver a incrustar bloques `<style>` o `<script>` inline si no es estrictamente necesario

## Script de apoyo

Existe un script de apoyo para separar HTML con CSS y JS embebidos:

- `scripts/separate_inline_assets.ps1`

Úsalo con cuidado: toma como base los `*.html` de `estrategico/` y genera la carpeta por vista.
