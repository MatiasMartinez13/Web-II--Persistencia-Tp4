# Evidencia

Generada automáticamente con `npm run evidence` (requiere Chrome/Edge; se puede
definir `CHROME_PATH` si no está en la ruta por defecto).

## Sincronización (3 participantes + pantalla)

- `01-tres-participantes-y-pantalla.gif` — GIF de 3 frames (1.6 s c/u): ingreso,
  propuesta conjunta y votos sincronizados en los 3 participantes y en la
  pantalla SSE.
- `01-tres-participantes-ingreso.png`, `01-tres-participantes-propuesta.png`,
  `01-tres-participantes-votos.png` — cuadros individuales del GIF.
- `06-pantalla-ranking.png` — pantalla completa con el ranking final.

## Fallos parciales

- `02-propuesta-fallos-parciales.png` — propuesta `10, 11, 999999`: se agregan
  los válidos y solo el autor ve el `not_found`.
- `02b-fallos-parciales-otro-participante.png` — otro participante solo ve los
  productos agregados, sin el error ajeno.

## Catálogo lento

- `03-catalogo-lento-esperando.png` — indicador «Consultando el catálogo…» con
  `CATALOG_DELAY_MS=3000` y ranking aún vacío.
- `03b-catalogo-lento-resultado.png` — productos agregados al terminar la espera.

## Mensaje inválido

- `04-mensaje-invalido.png` — `INVALID_JSON`, `UNKNOWN_TYPE` e
  `INVALID_PRODUCT_IDS` en el autor, que recibe un error y sigue conectado.
