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
npm run levels     # mapas y métricas de dificultad de todos los niveles (npm run levels -- 23: uno en detalle)
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
| U (inicio) | Activar / desactivar el **Modo prueba**: todos los niveles abiertos (también el interruptor del pie de la pantalla de inicio) |
| RePág / AvPág · las dos teclas a la derecha de la P ([ / ] en teclado inglés; también con AltGr) | Solo en Modo prueba: nivel anterior / siguiente (al instante; si ya has movido una caja, mantén pulsada la tecla un momento, como R) |

**Modo prueba** (ajuste guardado, apagado por defecto): abre todos los niveles desde el título sin tocar el progreso
real; al apagarlo vuelven los candados de siempre. Los tiempos se guardan con normalidad en los niveles ya
desbloqueados; un nivel abierto solo por el Modo prueba no guarda tiempo (guardarlo desbloquearía el siguiente) y
la tarjeta final lo dice: solo "Tiempo" y "Modo prueba · este tiempo no se guarda".

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
  data/        niveles: levels/*.level (texto), asciiLevel.ts (parser), validateLevel.ts, solver y métricas
  logic/       simulación pura (sin three / DOM / audio) + tests
  render/      escena three.js, cámara, mallas, feedback
  audio/       música generativa + SFX procedurales (Web Audio, sin assets)
  ui/          overlay React (HUD, título, tarjeta de fin)
  storage/     progreso, mejores tiempos, ranking local
  game/        bucle, input, orquestación
```

Detalle de contratos y dirección creativa: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Brief: [docs/BRIEF.md](docs/BRIEF.md).

## Apilar (niveles 13–18)

Cualquier caja apoyada admite otra encima, hasta `stackLimit` por nivel (máx. `stack.maxHeight` = 3 en
`gameConfig.json`; los niveles 1–12 no apilan). Sin teclas nuevas: Espacio coge la caja de arriba de la pila de enfrente y deja encima de la
pila de destino si cabe. Una zona con `recipe` (colores de abajo arriba) se cumple cuando su pila coincide
exactamente; la receta se dibuja en la zona como una mini pila de escalones de color. Reglas completas: [docs/STACKING.md](docs/STACKING.md).

## Clasificar por color y símbolo (niveles 19–24)

Cada caja lleva un color y un símbolo (● ▲ ■ ◆ ✚) en la tapa. Cada zona pide un color (almohadilla de ese color),
un símbolo (grabado grande sobre una almohadilla neutra) o los dos (esa caja exacta). Cuenta cualquier zona que
acepte la caja; si otra se queda sin sitio, mueve la primera: mientras llevas una caja respiran las zonas libres que
la aceptan y, si no queda ninguna, respiran muy suave las ocupadas que la aceptarían. Sin teclas nuevas. Encajar por
color suena a campana, por símbolo a madera y la exacta a las dos. El nivel 23 («La muestra») reúne los tres tipos y
la trampa clásica. Reglas completas: [docs/SORTING.md](docs/SORTING.md).

## Ampliar

- **Nuevo nivel:** añadir `src/data/levels/level-XX.level`, un archivo de texto con el mapa dibujado y una leyenda
  (formato completo, métricas y pasos en [docs/LEVELS.md](docs/LEVELS.md)):

  ```
  # 25 · Mi nivel
  id: mi-nivel
  limit: 1
  ventanas: norte 2-4

    0123456
  0 p......
  1 .1..2..
  2 .......
  3 .a..b..
  4 ...^..p

  1 = zona azul      2 = zona menta ▲
  a = caja azul      b = caja menta ▲
  ```

  `.` suelo, `#` estantería, `p` planta, `^ > v <` carretilla; el resto se explica en la leyenda: `caja`, `pila azul,menta`
  (de abajo arriba), `zona azul` / `zona ▲` / `zona azul ■` / `zona pila azul,menta`, combinaciones como
  `zona azul + caja coral`, `estantería 3 alturas`. El `id` guarda los mejores tiempos: no lo cambies. Se valida al
  cargar y en `npm test`; `npm run levels -- 25` enseña sus métricas (movimientos mínimos, extra, bloqueos…) y un plan,
  y `dificultad: extra>=2` fija objetivos que los tests comprueban. Añadir o quitar niveles: actualiza la lista
  `SHIPPED` de `src/data/levels/levels.test.ts`. Los `.json` antiguos (esquema `LevelData`) siguen cargando.
- **Nuevo tema visual:** crear `src/themes/<id>.ts` que exporte un `Theme`, añadirlo al mapa `THEMES` de `themes/index.ts` y poner `"theme": "<id>"` en el nivel. El tema cubre la escena 3D, el fondo y los tokens de la UI; un id sin registrar hace fallar `src/integration/themes.test.ts`.
- **Nuevo tipo de caja:** añadir el id a `BOX_KINDS` (`core/types.ts`) y su constructor de malla en el registro de cajas de `render/`.
- **Ranking local:** `ProgressStore.getRanking(levelId)` ya guarda el top‑5 por nivel.
