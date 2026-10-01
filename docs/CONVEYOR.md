# Cinta transportadora (aspectos `beltIn` y `beltOut`)

**Estado: H1 hecho (2026-10-01); H2 y H3, pendientes.**

Una cinta lleva sola una caja desde su **entrada A**, donde la deja la carretilla, hasta su **salida final B**, que la
carretilla no alcanza. Encaja en el almacenaje común (docs/STORAGE.md): A y B son unidades de almacenaje de un hueco, y
B es un objetivo más (reparto único, caja fija, zumbido, pistas P, «Quedan N», pegatina). Lo nuevo es el transporte. Se
construye por hitos pequeños; hoy está hecho **H1**, la cinta recta del suelo de A a B. Solo el Benchmark (y un nivel de
prueba) lleva una; los niveles 1–3 no cambian.

## Decisiones

Petición (2026-09-30): «una cinta que va de un punto A a un punto B, y en el benchmark para probar que el otro extremo
sea un slot de una caja que no se pueda acceder con el toro»; en el ASCII, «un cuadrado de inicio y otro de final»; y
una cinta puede derivar en diferentes salidas en función de la caja.

Decisiones del usuario (2026-09-30 / 10-01):
- **A. Desvíos**: la cinta tiene salidas laterales; la caja sale por la **primera salida libre cuya pista encaja**
  según avanza y, si no hay ninguna, sigue hasta la final (H2).
- **B. Una caja a la vez** (H1).
- **C. Fuera de alcance**: las salidas no están al alcance de la carretilla; un **botón junto a A** invierte la cinta
  y devuelve a A la última caja mal puesta (H3). Hasta entonces, una caja mal puesta **se queda allí con el zumbido**
  (H1).
- **D. Se distingue** visualmente de todo lo demás, **clara y minimalista** (H1).
- **E. El botón lleva el color de su A**, para emparejarlos con varias cintas (H1 ya da a cada cinta su color de
  identidad, en A y en el ribete de B; el botón llega en H3).
- **F. Forma de trabajar**: «pequeños milestones… ir testeando poco a poco las implementaciones»; «cuando yo verifique
  el sistema de cinta de suelo, me preguntas por el de techo».

Decisiones de H1 (2026-10-01, al construirlo; para revisar):
- **G. Dos aspectos**: `beltIn` (la entrada) y `beltOut` (la salida final), cada uno con su fila en `STORAGE_SKINS` y
  `STORAGE_WORDS` (en vez de un solo aspecto `conveyor`): así ids, letras, palabras, objetivos y el registro de render
  salen de sus filas, sin casos. La cinta en sí va en `level.conveyors`, que enlaza las dos unidades por id.
- **H. Un acceso nuevo, `belt`** (el de B): la carretilla nunca lo engancha (`STORAGE_ACCESS.belt.engages: false`): ni
  lo encara, ni coge, ni deja; su casilla es un obstáculo; su hueco está sellado para siempre (solo su cinta lo llena).
- **I. El modelo del solver solo manda por la cinta la caja destinada a B**: sin el botón, una caja equivocada en B ya
  no vuelve (sería un callejón). En el juego sí se puede hacer (zumba y se queda; R reinicia).
- **J. «libre» en B** lo admite la gramática (`cinta final: libre`), pero hoy una caja allí no vuelve: el solver nunca
  lo usa. Tendrá sentido con el botón.

## Las tres piezas

Una cinta es una lista ordenada de casillas, cada una con su **pieza** y su **altura** (`ConveyorCell.piece` /
`height`), desde el primer hito, para no rehacer los datos:
- **`suelo`** (H1, hecho): una banda baja sobre el suelo, a la altura de un hueco de nivel 0.
- **`rampa`** y **`techo`** (después, a preguntar al usuario): la rampa subiría la caja a la altura del techo; la de
  techo colgaría con tirantes. La gramática ya los lee (`cinta rampa`, `cinta techo`) y validateLevel los rechaza con un
  mensaje claro («la cinta en rampa llega más adelante…»).

## Hitos

- **H1 · Cinta recta A → B — hecho (2026-10-01).** Datos con las 3 piezas (solo `suelo` en uso); gramática de A, `~` y
  B; validación; lógica del viaje, una caja a la vez y contadores; solver y piloto (dejar en A, B como objetivo); dibujo
  con el color de identidad y sonido; este documento; el Benchmark con una cinta corta y B fuera de alcance.
- **H2 · Desvíos** (pendiente): salidas laterales con pista, la primera que encaje, B como final; caja que se queda en
  A si no hay sitio; en el Benchmark, 1 o 2 desvíos y una trampa de pista parcial.
- **H3 · Botón** (pendiente): del color de A, devuelve la última mal puesta; el solver y el piloto lo usan; Benchmark
  ajustado. Con el OK del usuario, el PR de la cinta del suelo.
- **Después**: el sistema de techo (rampa + cinta de techo).

## Reglas (H1)

1. **Cinta** = una tirada recta (una fila o una columna): A, **al menos una** casilla de cinta y B, seguidas y en línea.
   A y B son unidades 1×1 (aspectos `beltIn` y `beltOut`) que **miran al lado contrario a la cinta**.
2. **A, la entrada**: «libre» (nunca objetivo, nunca zumba), un hueco a ras del suelo (nivel 0) que se carga **de
   frente**, desde la casilla de delante (la del lado contrario a la cinta), como un hueco de estantería: acceso
   `front`, se encara igual, F / V y vista previa igual. Su frente es suelo.
3. **B, la salida final**: su pista (color, símbolo, los dos o «libre») como un hueco; con pista es un objetivo del
   reparto único. La carretilla nunca trabaja en B (acceso `belt`, decisión H).
4. **El viaje**: dejar una caja en A con B libre la pone en camino: se asienta en A `settleSec` (su planeo de dejar
   aterriza antes), la cinta arranca suave, la lleva a `speed` y la para suave en el centro de B (`rampSec` en cada
   extremo). **Una caja a la vez**: mientras se asienta o viaja, el hueco de A queda **sellado** (no se coge, no se
   deja otra).
5. **Llegada**: su caja destinada cumple B (brilla, campana) y queda **fija**; cualquier otra **zumba** y se queda en
   B (hasta el botón de H3; hoy, R reinicia).
6. **B llena**: una caja dejada en A **se queda en A**, con el zumbido suave (`beltBlocked`), y se puede volver a coger.
7. **Contadores**: dejar en A cuenta **1 movimiento**; el viaje, **0**. Una caja en A o viajando sigue contando en
   «Quedan N» hasta que cumple B.
8. **Obstáculos**: las casillas de cinta, A y B, para el cuerpo y para la carga; nada empieza ni se deja encima de una
   casilla de cinta, y una cinta empieza vacía.

## En el archivo `.level`

Cada pieza de una cinta es una entrada de la leyenda. En el mapa: las casillas de cinta (`~` en la forma canónica) en
línea recta, la letra de la entrada pegada a un extremo y la de la salida final pegada al otro, en línea.

```
cinta    = "cinta" [pieza]                    (una casilla de cinta; sin pieza, la de suelo)
pieza    = "suelo" | "rampa" | "techo"        (hoy solo se construye la de suelo)
entrada  = "cinta entrada" [id]               (A: «libre», no lleva nada más)
final    = "cinta final" [id] ":" pista       (B: una sola pista)
pista    = "libre" | color [símbolo] | símbolo
id       = "(" texto ")"                      (el id de la cinta, en una de sus dos puntas)
```

- La cabeza es `cinta` (también `belt` / `conveyor`). Cada grupo conectado de un carácter de cinta es una cinta: recto,
  con una entrada y una salida final que lo tocan en línea (una entrada al costado, o una final que no sigue la línea,
  es un error). Dos cintas pegadas llevan caracteres distintos (`- = cinta`); dos cintas separadas pueden compartir sus
  tres entradas de la leyenda.
- Ids: cintas `c1, c2…` por el orden de sus entradas (orden de la leyenda y luego de lectura), o el que lleve una de sus
  puntas (`cinta entrada (c7)` o `cinta final (c7): …`; si las dos, el mismo). Las unidades: entradas `e1, e2…`,
  salidas `s1, s2…`, después de estanterías y camiones (regla 12 de docs/STORAGE.md). Una cinta empieza vacía: `+
  caja` no va en ninguna de sus puntas.
- Forma canónica: `~` en toda casilla de suelo, una letra por punta (entradas `A D F J`, salidas `B E G K`), sus
  entradas después de las de estanterías y camiones y `~ = cinta` tras ellas; el id solo en la entrada y solo si no es
  el generado. Un nivel sin cintas no usa `~`.
- Salidas laterales (`cinta salida`) y botón (`cinta botón`): «llegan más adelante».

Ejemplo (canónico; lo comprueba `asciiLevel.conveyor.test.ts`):

```
# 1 · Cinta de ejemplo
id: cinta-ejemplo
limit: 1

  0123456
0 .pBp...
1 ..~....
2 ..~.1..
3 .aA....
4 .......
5 ...^.b.

1 = zona menta
a = caja azul ●          b = caja menta ▲
A = cinta entrada        B = cinta final: azul    ~ = cinta
```

Una cinta de dos casillas de (2,3) al norte hasta (2,0), entre dos plantas: B solo se alcanza por la cinta. La azul ●,
que solo cabe en B, se deja en A desde (2,4) mirando al norte; la cinta la lleva a B. 2 movimientos.

Errores (en español, `archivo:línea:columna`): pieza desconocida (con sugerencia), entrada con pista o con caja, final
sin dos puntos, sin pista, con más de una o con caja («la cinta empieza vacía…»), cinta que no es recta, sin entrada o
sin salida final, con dos, entrada al costado, final fuera de línea, punta que no toca ninguna cinta o que toca dos,
ids distintos en las dos puntas, id en un carácter de varias cintas, id repetido. Los de validateLevel (abajo) se
señalan donde hay que arreglar: la pieza de rampa o de techo en su entrada de la leyenda; la entrada sin sitio delante,
en la entrada («la entrada de cinta «A» se carga por delante, por el lado contrario a su cinta…»); la cuenta de cajas
con las salidas («… y 1 salidas de cinta con pista»); más de un reparto, en la salida final.

## Datos y validación

```ts
// core/types.ts
interface LevelConveyor { id: string; input: string; output: string; cells: ConveyorCell[] }   // LevelData.conveyors?
interface ConveyorCell { x: number; z: number; piece: ConveyorPiece; height: number }          // de la entrada a la final
type ConveyorPiece = 'suelo' | 'rampa' | 'techo';                                                  // CONVEYOR_PIECES
// Sus puntas, en LevelData.storage (después de estanterías y camiones):
//   { id: 'e1', skin: 'beltIn',  x, z, w: 1, access: { kind: 'front', facing }, columns: [[null]] }
//   { id: 's1', skin: 'beltOut', x, z, w: 1, access: { kind: 'belt',  facing }, columns: [[pista | null]] }
// facing = el lado contrario a la cinta (en las dos). core/conveyors.ts: conveyorsOf, hasConveyors, beltUnitsOf,
// beltPathOf (entrada, casillas, final), conveyorOfUnit.
```

`validateLevel` (mensajes en inglés **exactos**; `validateLevel.conveyor.test.ts`): `conveyors[i]` con `id` (por defecto
`c${i+1}`; `duplicate conveyor id "…"`), `input` / `output` (`conveyors[i].input "…" is not a belt input (a storage
unit of skin beltIn)`, igual con `output` / `belt exit` / `beltOut`; una punta en dos cintas: `beltInputs[j] belongs to
conveyors[k] and to conveyors[i]: …`; una punta sin cinta: `beltInputs[j] belongs to no conveyor: …`) y `cells`
(`conveyors[i] needs at least one belt cell between its input and its end exit`; `conveyors[i].cells[j].piece must be
suelo, rampa, techo`; `conveyors[i].cells[j] is a rampa piece: only floor belts («suelo») are built so far`;
`conveyors[i].cells[j] has height 1: a floor belt («suelo») lies on the floor (height 0)`). La línea:
`conveyors[i] is not a straight run from its input to its end exit at x,z`; los lados: `beltInputs[j] must face south:
a belt input is loaded from the side away from its belt` y `beltExits[j] must face south: a belt's end exit takes its
box from the belt's last cell`. Las casillas, dentro y libres (`conveyors[i] overlaps another obstacle at x,z`;
después, bloqueadas: cajas, zonas y carretilla dan `… is inside an obstacle`). Una entrada con pista: `beltInputs[j]
asks for a cue: a belt input is «libre» (any box set down there rides its belt)`; sin sitio delante: `beltInputs[j]
column 0 has no room in front: cell x,z is …`. Una caja al empezar en una punta: `box "…" starts on beltInputs[j]: a
conveyor belt starts empty (…)`. Con cintas, la cuenta de cajas: `a level with storage needs one box per target (n
boxes, z zones, h slots with a cue, t truck levels, s belt exits with a cue)`; más de un reparto nombra la salida como
`beltExits[j].columns[0][0]`.

## Lógica (`src/logic/conveyor.ts`, `GameState`)

- `ConveyorSystem`, una por nivel (`GameState.belts`), un estado por cinta en `snapshot.conveyors`
  (`ConveyorState`: `id`, `phase` = `idle` | `settling` | `running`, `boxId`, `progress` 0–1, `running`, `travel` =
  casillas que ha avanzado su superficie, que nunca vuelve atrás: el dibujo mueve las franjas con ella).
- **Dejar en A** (`GameState.dropInStorage`): la caja entra en el hueco de A como en cualquier hueco (`boxDropped`, con
  `skin: 'beltIn'`, nunca `wrongTarget`) y cuenta su movimiento. Si B está libre, el hueco de A se sella
  (`LevelGrid.seal`: `liftableAt` = −1) y la cinta la carga (`load`); si no, evento `beltBlocked` y la caja se queda.
- **Cada frame** (`GameState.update`, antes de la pista): `settling` → `running` a los `settleSec` (el sobrante del
  frame pasa al viaje: a 60 y 20 fps la misma curva) con el evento `beltStarted` (`runSec`, `rampSec`: el audio los usa);
  en `running`, la posición de la caja es una función cerrada del tiempo (subida y bajada senoidales, crucero), escrita
  en `box.pos`; al llegar al centro de B, `GameState.deliver`: fuera del hueco de A (que se abre) y dentro del de B,
  `beltDelivered` (`correct`, `wrongTarget` si B tiene pista y no la cumple, `satisfiedCount` / `total`) y, si era el
  último objetivo, `levelComplete`. El viaje no cuenta movimientos.
- B nunca se engancha (`refreshStorageAim` salta los accesos que no `engages`; `refreshStoragePassage` nunca le abre
  paso): su casilla es un estático de `CollisionWorld` (como las de la cinta).
- Determinista: la llegada difiere menos de un frame entre 60, 20 y 7 fps (`GameState.conveyor.test.ts`). Nada se
  reserva por frame.

## Solver, métricas, informe y piloto

- **Modelo** (`levels/solver.ts`): la entrada y la final son posiciones de almacenaje de un hueco (`POS_SHELF`); la
  final no tiene pose que la trabaje (sin `columnAtPose`) y comparte el frente y la dirección de su entrada; `feeds`
  (entrada → final) y `fedBy` (final → entrada) las enlazan; cinta y puntas, sólidas. Con un paso adelante desde detrás
  del frente de A, `carrySearch` ofrece A y, a través de ella, B. `validDrop`: a B solo su caja destinada, con A vacía
  y B con sitio (decisión I); en A solo con B llena (la caja se queda); `canLift` nunca de B. La cota sigue admisible
  y consistente (`levels/conveyor.test.ts`): B es un objetivo de un movimiento, como un hueco.
- **Métricas**: `belts = { belts, cells, floor, exits, cued }`; la métrica publicada **`cinta`** = cintas (alias
  `cintas`); en el informe «cinta 1 (2 casillas de suelo; 1 salida final con pista)» y la columna «cinta» = cintas /
  casillas.
- **Informe**: el plan nombra la cinta por sus letras: «caja azul ● (1,3) → cinta A (3,3) → final B (3,0)»; una caja
  que se queda en A, «(aparcar: su final está lleno)».
- **Piloto** (`integration/autopilot.ts`): una jugada a B se conduce hasta A (`fedBy`); mientras la caja va de camino,
  el plan ya la ve en B (`liveStacks`), y la siguiente jugada en esa cinta (o el final del nivel) espera a que llegue
  (`waitForBelts`), como haría un jugador.

## Dibujo (`src/render`)

Un adaptador para los dos aspectos (`render/storage/conveyor.ts`: `BELT_IN_RENDER`, `BELT_OUT_RENDER`), con
`builders/conveyor.ts` y `views/ConveyorView.ts`. Todo bajo, a la altura del suelo de un hueco de nivel 0 (`BELT.top` =
`RACK.base`): la caja va nivelada de la horquilla a la bandeja.
- **Banda** (`buildBeltBand`): goma grafito suave (`Theme.conveyor.belt`, más oscura que el metal pizarra y más fría
  que la madera) entre dos cantos finos claros (`edge`), de la orilla de A a la de B. Sin rodillos, postes ni nada
  encima.
- **Franjas** (`BeltStripes`): finas, un poco más claras (`stripe`), cada `BELT.stripe.period`; se deslizan con la
  superficie (`ConveyorState.travel`) y **solo mientras corre**; recortadas en las dos orillas. Una geometría por cinta
  que se mueve en su sitio.
- **A** (`buildBeltPad`): un cuadrado redondeado bajo del **color de identidad** de su cinta.
- **B** (`buildBeltTray`, `buildBeltBoard`, `buildBeltCue`): una bandeja baja abierta hacia la cinta, con un **ribete
  fino** del color de identidad, y al fondo un cartelito con la **pegatina** de su pista (la de las estanterías,
  `buildCueFace`) en las dos caras, derecha, nunca atenuada ni en espejo. Su luz es la de un hueco (`SlotLight`), al
  momento: la caja ya ha entrado deslizándose (`landDelay` 0); latido con las pistas P, destello y efecto de acierto
  (`burstAt`) como en todo el almacenaje. Una B «libre», cartel liso.
- **Color de identidad** (`Theme.conveyor.identity`, por el orden de la cinta en el nivel): verde azulado, ciruela,
  musgo, añil; nunca un tono de caja ni de zona, ni el naranja de las barandillas, ni el ámbar de la luz de marcha
  atrás, nunca rojo (`themes.test.ts`).
- Nada de la cinta se vuelve fantasma ni mueve el encuadre; no hay marcador del nivel elegido (un solo hueco, a ras
  del suelo). Nuevo y opcional en `StorageUnitView`: `landDelay` (cuándo se enciende tras el evento) y `animate` (lo que
  se mueve cada frame).

## Sonido (`src/audio`)

Su fila dice `sound: 'belt'` (`audio.test.ts`):
- Dejar en A → `SfxPlayer.beltDrop`, al aterrizar: un «tup» suave de goma, sin subgrave (A es «libre»: nunca campana).
- Mientras corre → `beltHum` (con `beltStarted`, para todo el viaje): un zumbido eléctrico suave, nunca de combustión,
  que entra y sube de tono con la cinta (`BELT_HUM_HZ` 140 → 196 Hz, con una octava tenue), se mantiene y baja al
  parar, con el susurro de la goma; muy por debajo de la música.
- Llegada a B → `beltLand`, en el momento: un golpe suave, más flojo que dejar; la campana solo con su caja destinada
  (el timbre de su pista); con otra caja, el zumbido suave después.
- B llena (`beltBlocked`) → el zumbido suave tras el «tup». Coger de A → el `pickup` de siempre.

## Nivel de prueba y Benchmark

- **`src/data/levels/pruebas/cinta.level`** (fuera del juego; `integration/conveyorFixture.test.ts`): 10×6, una cinta
  de dos casillas de A (3,3) a B (3,0) entre dos plantas; B pide «azul»; zonas ■ y menta; cajas azul ●, azul ■ (encaja
  en «azul»: trampa) y menta ▲. 3 movimientos (exacto), repartos 1, callejones 0. El piloto lo termina a 60 y 20 fps.
- **Benchmark** (`especiales/benchmark.level`, docs/RACKS.md): la cinta va de **A (8,2)** a **B (8,0)** por una casilla
  (8,1), pegada al muro norte junto a la estantería de madera; B pide **coral ✚** (exacto), y el coral ✚ (7,7) es su
  caja: también encaja en la zona coral (trampa). El amarillo ● empieza delante de A (8,3): hay que apartarlo antes de
  usarla. Se quitó la planta de (10,0): la esquina noreste queda libre para maniobrar (con ella, el informe hallaba
  callejones). Al este de B queda suelo (9,0): la carretilla puede ponerse al lado, pero nunca la engancha.
- **Medido** (2026-10-01): movimientos **15** (exacto; antes 14), obligadas 13, extra 2, bloqueos 5 (el amarillo ●
  cierra el paso a A), trampas 13, ambiguas 12, libre 75 %, repartos 1, callejones 0, huecos 12, camion 4, cinta 1. El
  piloto: 14960 frames a 60 fps y 5466 a 20 (antes 13842 / 5056), 8 pulsaciones de F / V.

## Ajustes (seguros de tocar)

| Qué | Dónde | Valor | Efecto |
|---|---|---|---|
| Asentarse en A | `logic/conveyor.ts` `CONVEYOR.settleSec` | 0,5 s | lo que espera la caja antes de arrancar (su planeo aterriza antes) |
| Velocidad | `CONVEYOR.speed` | 0,9 casillas/s | crucero de la cinta y de la caja |
| Arranque / parada | `CONVEYOR.rampSec` | 0,6 s | subida y bajada senoidales; un viaje dura largo / speed + rampSec |
| Banda | `builders/conveyor.ts` `BELT` | top = `RACK.base`, `halfW` 0,4, cantos 0,03 × 0,07 | medidas de la cinta |
| Franjas | `BELT.stripe` | cada 0,25, 0,07 de ancho | ritmo visual del movimiento |
| A / B | `BELT.pad`, `BELT.tray`, `BELT.board`, `BELT_CUE`, `BELT_GLOW`, `BELT_BURST` | — | almohadilla, bandeja, cartel, pegatina, luz, acierto |
| Colores | `Theme.conveyor` | `belt`, `stripe`, `edge`, `board`, `identity` (4) | banda, franjas, cantos, cartel y colores de identidad |
| Zumbido | `audio/sfx.ts` `BELT_HUM_HZ`, `BELT_HUM_OCTAVE`, `BELT_HUM_LEVEL`, `BELT_HUM_WHISPER`, `BELT_HUM_LOWPASS_HZ` | 140 → 196 Hz, 0,28, 0,014, 0,6, 760 Hz | tono, octava, volumen, susurro y calidez |
| Golpes | `SfxPlayer.beltDrop` / `beltLand` | — | el «tup» de A y el golpe de B |

Reglas con decisión propia, fáciles de cambiar en un solo sitio: solo la destinada por la cinta en el modelo
(`solver.ts` `validDrop`), B llena = la caja se queda en A (`GameState.dropInStorage`), una caja a la vez
(`ConveyorSystem.load` / `LevelGrid.seal`), la fila de B en `STORAGE_ACCESS` (`engages: false`).
