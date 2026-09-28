# Toro

*Un pequeño almacén, a tu ritmo.*

Juego web cozy: una carretilla elevadora low poly ordena cajas pastel en sus zonas de entrega.
Sin derrota, sin presión. Solo un cronómetro opcional y tu mejor tiempo.

## Arrancar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests de lógica, niveles, storage, helpers
npm run build      # typecheck + build de producción en dist/
```

`dist/` usa rutas relativas (`base: './'`): funciona servido desde cualquier subruta (itch.io, GitHub Pages).
Para un envoltorio de escritorio, servir `dist/` por http o protocolo propio, no por `file://`.

## Controles

| Tecla | Acción |
|---|---|
| W / ↑ | Avanzar (hacia donde mira la carretilla) |
| S / ↓ | Marcha atrás |
| A / ← · D / → | Girar a la izquierda · a la derecha (también parado; W + A avanza girando) |
| Espacio | Recoger / dejar caja |
| Q / E | Girar cámara (la conducción W/S/A/D no cambia) |
| R | Reiniciar nivel (mantener ~0,5 s si ya moviste una caja) |
| M | Silencio |
| T | Mostrar / ocultar tiempo |
| Esc | Volver al inicio ("Continuar" retoma el nivel) |
| Enter | Continuar |

Mando compatible: stick izquierdo (mover en la dirección de la pantalla), cruceta (conducir como W/S/A/D), A (recoger / dejar), LB/RB (cámara), Start (continuar),
Back (reiniciar), Y (repetir en la tarjeta final).

El mapeo de movimiento se ajusta en `gameConfig.json` → `controls`: `keyboardMapping` (teclado y cruceta) `"vehicle"` (por defecto:
W/S avanzar/atrás y A/D girar, relativo a la carretilla e independiente de la cámara), `"grid"` (cada tecla recorre un
eje del suelo) o `"screen"` (dirección de pantalla); `stickMapping` acepta lo mismo (por defecto `"screen"`).
Ajustes del modo vehículo en `forklift`: `reverseSpeed`, `driveTurnRate`, `headingAssistDeg` (0 = sin ayuda de alineación).

## Arquitectura

```
src/
  core/        contratos compartidos (tipos, math, store)
  config/      gameConfig.json — todos los parámetros ajustables
  themes/      paletas (Theme). Nuevo tema = nuevo archivo + entrada en THEMES (themes/index.ts)
  data/        validateLevel.ts + levels/*.json
  logic/       simulación pura (sin three / DOM / audio) + tests
  render/      escena three.js, cámara, mallas, feedback
  audio/       música generativa + SFX procedurales (Web Audio, sin assets)
  ui/          overlay React (HUD, título, tarjeta de fin)
  storage/     progreso, mejores tiempos, ranking local
  game/        bucle, input, orquestación
```

Detalle de contratos y dirección creativa: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Brief: [docs/BRIEF.md](docs/BRIEF.md).

## Ampliar

- **Nuevo nivel:** añadir `src/data/levels/level-XX.json` (esquema `LevelData`, validado al cargar y en tests).
- **Nuevo tema visual:** crear `src/themes/<id>.ts` que exporte un `Theme`, añadirlo al mapa `THEMES` de `themes/index.ts` y poner `"theme": "<id>"` en el nivel. El tema cubre la escena 3D, el fondo y los tokens de la UI; un id sin registrar hace fallar `src/integration/themes.test.ts`.
- **Nuevo tipo de caja:** añadir el id a `BOX_KINDS` (`core/types.ts`) y su constructor de malla en el registro de cajas de `render/`.
- **Ranking local:** `ProgressStore.getRanking(levelId)` ya guarda el top‑5 por nivel.
