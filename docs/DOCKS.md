# Mecánica: muelles de carga (camiones)

Petición (2026-09-30): «hagamos unos muelles de carga donde pueda cargarse directamente en el camión las cajas que
pertoquen, ahí no deja de ser un sistema igual que el de amontonarlas en el suelo, pero estéticamente es diferente».

Decisiones (2026-09-30): un **muelle** es una puerta en el muro norte u oeste (como las ventanas) con un **camión**
aparcado en ella. Su caja de carga ocupa casillas del mapa pegadas al muro y se carga **como una pila del suelo**
(horquilla automática, de abajo arriba), pero cada nivel de cada columna tiene su **pista** (como un hueco de
estantería) y es un **objetivo** del reparto único. Hoy solo el Benchmark (docs/RACKS.md) puede llevar camiones; los
niveles 1–3 no cambian.

## Reglas
1. **Muelle** = puerta en el muro **norte** u **oeste** con un camión aparcado. La **caja del camión** (su plataforma)
   ocupa una **tirada recta de casillas pegada al muro**, 1 casilla de fondo: en el muelle norte, casillas de la fila
   `z = 0`; en el oeste, de la columna `x = 0`. Una **columna** por casilla. La puerta del muro es esa misma tirada: no
   se declara aparte (no puede descuadrarse del camión).
2. Las casillas de la caja son **sólidas** para la carretilla. Se carga y descarga **solo por delante**: desde la casilla
   de suelo de delante de cada columna (fila 1 en el norte, columna 1 en el oeste; `TRUCK_FACING`), mirando al camión.
   Exactamente como dejar en el suelo o sobre una pila: **horquilla automática** por altura de pila, las cajas una
   sobre otra **de abajo arriba**, hasta los **niveles** de la columna (1–3, nunca más que `limit`). F / V, la rueda y
   X / B no hacen nada delante de un camión.
3. **Pista de cada nivel**: color = pide ese color; símbolo = pide ese símbolo; color + símbolo = esa caja exacta.
   **No hay niveles «libre»** (decisión: el camión solo lleva las cajas que le tocan; para aparcar está el suelo o un
   hueco libre de estantería): todo nivel del camión es un objetivo.
4. **Solución única**: objetivos = zonas + huecos con pista + **niveles de camión**. Cada uno tiene **una** caja
   destinada y existe exactamente un reparto completo (cajas idénticas son intercambiables): lo comprueba
   `validateLevel`, lo da `levelDestinies`, como con las estanterías.
5. **Nivel cumplido** = tiene su caja destinada **y** todos los niveles de debajo de su columna están cumplidos (la
   columna está bien desde la plataforma). Solo entonces brilla.
6. **Caja fija**: la caja de un nivel cumplido queda **fija** (`locked`): no se coge (la acción da el `actionIdle` suave),
   **pero sí se carga el nivel de encima** de su columna (a diferencia de zonas y huecos, donde nada va encima de una
   caja fija). Como las cumplidas siempre están abajo, una columna solo se descarga desde arriba hasta la primera caja
   fija. Una caja que empieza cargada en su destino (con todo lo de debajo bien) ya empieza fija.
7. **Objetivo equivocado**: toda caja que queda en un nivel del camión **sin cumplirlo** suena con el **zumbido suave**
   de docs/RACKS.md (regla 12) y sigue cogible: la que no es su destino (también la «trampa» que encaja en la pista) y
   la destinada puesta encima de un nivel sin cumplir (decisión: la columna está mal desde abajo; es la misma regla que
   en zonas y huecos, «el objetivo no quedó cumplido»). Nada visual: ni rojo ni texto.
8. **Latido**: mientras llevas una caja laten, en el tono de la caja y con la fuerza de los huecos (`INVITE_*` de
   docs/RACKS.md), los niveles **`loadable`** (el siguiente de su columna, con todo lo de debajo cumplido) cuya pista
   encaja (`cueFits`: pista, no solución).
9. **Acierto**: como en un hueco (docs/RACKS.md, regla 10): destello del objetivo, pequeño efecto de acierto, la campana
   según la pista, brillo suave en reposo y la caja pasa despacio a su **tono hondo**.
10. **Niveles con camiones** siguen todas las reglas de «niveles con estanterías» de docs/RACKS.md (zonas de una sola
    caja, destinos, cajas fijas, zumbido, latido fuerte, «los símbolos no apilan» levantado), tengan o no estanterías.
    Los niveles sin estanterías ni camiones: exactamente como antes.
11. **Pistas a la vista**: en un **cartel del camión**, una pegatina por nivel (la de abajo, abajo), a pleno color,
    nunca atenuada ni tapada por la carga, legible desde dentro del almacén y desde los 4 ángulos de cámara (ver
    «Render»).

## En el archivo `.level`

Un camión es un carácter de la leyenda. En el mapa ocupa una **tirada recta pegada a su muro**: en el muelle norte,
casillas seguidas de la fila 0; en el oeste, de la columna 0. Cada grupo conectado de ese carácter es un camión.

```
camión   = cabeza muro [id] ":" columna { "|" columna }
cabeza   = "camión" ["muelle"] | "camión en el muelle" | "muelle"      (también truck / dock)
muro     = "norte" | "oeste"                                            (también north / west)
columna  = nivel { "/" nivel }                                          (de abajo arriba, de 1 a 3 niveles)
nivel    = pista [ "+" caja ]                                           (la caja cargada al empezar)
pista    = color [símbolo] | símbolo                                    (nunca «libre»)
caja     = "caja" color [símbolo] ["tipo" tipo] [id]
```

- Las columnas van de oeste a este (muelle norte) o de norte a sur (muelle oeste): una por casilla, en ese orden,
  separadas por `|`. Los niveles de cada columna, de abajo arriba, separados por `/`.
- Una caja cargada al empezar va sobre otra (o sobre la plataforma): en una columna, un nivel con caja lleva caja en
  todos los de debajo.
- La puerta del muro es la tirada del camión: no hay clave de cabecera. `ventanas:` no puede pisarla.
- Ids: camiones `t1, t2…` en orden de leyenda (y de lectura si un carácter se usa en varios); las cajas del camión se
  numeran **después** de las de las estanterías, camión a camión, columna a columna, de abajo arriba. Un camión y una
  estantería nunca comparten id (sus niveles y huecos se llaman los dos `id:columna:nivel`).
- Forma canónica: `camión muelle norte: …` / `camión muelle oeste: …`, una letra por camión (`T C U…`, después de las
  de las estanterías), su entrada después de las de las estanterías.

Ejemplo (canónico; lo comprueba `asciiLevel.docks.test.ts`):

```
# 1 · Muelle de ejemplo
id: muelle-ejemplo
limit: 2
ventanas: oeste 2-3

  01234567
0 ..TT....
1 ........
2 .....1..
3 .a..b...
4 ....^.c.

1 = zona ■
a = caja azul ▲        b = caja amarillo ■    c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲
```

Un camión en el muelle norte (puerta en las casillas 2–3 del muro norte), de 2 columnas que se cargan desde la fila 1.
Columna 1: abajo «azul», encima «cualquier ▲». Columna 2: «coral ◆» exacto, con la menta ▲ cargada por error. Único
reparto: la única azul (la azul ▲) abajo en la columna 1, así que el «▲» de encima es de la menta ▲; el coral ◆ a su
nivel y el amarillo ■ a la zona. La azul ▲ encaja en el «▲» pero no es su destino (una «trampa» amable), y la menta ▲
hay que descargarla antes de poner el coral ◆.

Errores (en español, `archivo:línea:columna`): muro que falta o que no es norte / oeste, dos puntos que faltan o
repetidos, más de 3 niveles, nivel vacío, «libre», pista desconocida, caja mal escrita tras el `+`, caja sin nada
debajo, `/ | :` fuera de una estantería o un camión, camión que no es recto, que no está pegado a su muro o cuyas
columnas no cuadran con sus casillas, id propio en un carácter usado por varios camiones, id repetido con una
estantería. Los de `validateLevel` (abajo) se señalan en la columna o la caja que hay que arreglar.

`parseLevelDraft(texto)` da el objeto crudo que `parseLevel` pasa a `validateLevel` (mapa y leyenda comprobados, sin
valores por defecto): los tests de la gramática lo usan para no depender de la validación.

## Datos (`src/core/types.ts`)

- `LevelData.trucks?: LevelTruck[]` (ausente sin camiones; en `validateLevel`, justo después de `racks`).
  `LevelTruck { id, wall, x, z, w, columns: TruckCue[][] }`: `wall` = `'north' | 'west'` (`WallSide`); (x, z) es la
  primera casilla (muelle norte: `z = 0`, la más al oeste; oeste: `x = 0`, la más al norte); `columns[col][nivel]`,
  nivel 0 = sobre la plataforma; `TruckCue = ZoneCriteria` (color y / o símbolo, al menos uno). `MAX_TRUCK_LEVELS` = 3.
- `TRUCK_FACING = { north: 'south', west: 'east' }`: el lado desde el que se carga. Con él un camión se lee como una
  estantería en `core/racks`: `rackCellOf({ x, z, facing: TRUCK_FACING[wall] }, col)` es la casilla de la columna,
  `frontCellOf` la de delante, `inwardHeading` el rumbo hacia el camión y `columnFrame` el marco de la columna.
- Caja cargada al empezar: `LevelBox` con (x, z) = su casilla de camión y `level` = su nivel.
- Estado: `GameSnapshot.truckSlots?: TruckSlotState[]` (camión a camión, columna a columna, de abajo arriba; **ausente**
  en niveles sin camiones: se lee `snapshot.truckSlots ?? []`). `TruckSlotState { id, truckId, column, level, cell,
  front, wall, facing, pos, accepts, destined, occupiedBy, satisfied, loadable }`: id `t1:columna:nivel` (desde 0);
  `accepts` nunca es `null`; `satisfied` = regla 5; `loadable` = vacío, el siguiente de su columna y todo lo de debajo
  cumplido (regla 8). Los campos que comparte con `SlotState` significan lo mismo: `cueFits`, `isDestined` y
  `satisfiesTarget` sirven para los dos.
- `BoxState.truckSlotId?: string | null`: el nivel de camión donde descansa (entonces `cell` = su casilla de camión,
  `level` = su nivel, `zoneId` y `slotId` `null`). `GameState` lo pone en todas las cajas de un nivel con camiones
  (`null` fuera del camión) y lo deja sin definir en los demás. `BoxState.locked` en el camión = regla 6 (no se coge;
  sí se carga encima). `correct` = su nivel `satisfied`.
- `InteractionHint.dropTruckSlotId?: string | null`: llevando una caja, el nivel de camión donde caería (`dropCell` =
  casilla de camión, `dropLevel` = el nivel, `dropZoneId` `null`); sin definir en niveles sin camiones.
  `hint.rack` es siempre `null` delante de un camión. Con la horquilla vacía, `targetBoxId` es la caja de arriba de la
  columna si no está fija.
- Eventos (la misma forma; campos opcionales solo cuando tocan un camión, así que sin camiones son idénticos):
  `boxPicked.fromTruckSlotId` (`fromZoneId: null`, `level` = su nivel); `boxDropped.truckSlotId` (`zoneId: null`,
  `cell` = casilla de camión, `level` = su nivel, `recipeLength` 1, `correct` = el nivel quedó cumplido, `wrongTarget:
  true` si no, regla 7; `satisfiedCount` / `total` cuentan los niveles de camión). `zoneReleased.truckSlotId` existe por
  simetría pero hoy no ocurre (las cumplidas están fijas y cargar encima no descumple nada).
- `progress`: zonas + huecos con pista + todos los niveles de camión.

## Solución única y destinos (`src/core/sorting.ts`, `src/core/docks.ts`)

Hecho (2026-09-30; lo comprueba `core/docks.test.ts`):

- `core/docks.ts` (puro): `trucksOf(level)`, `hasTrucks(level)`, `truckFacing(truck)`, `truckCellOf(truck, col)`,
  `truckFrontOf(truck, col)`, `truckInwardHeading(truck)`, `truckSlotIdOf(truckId, col, nivel)`
  (= `${truckId}:${col}:${nivel}`), `truckColumnsOf(level): TruckColumnRef[]` (`{ truck, truckIndex, column, cell,
  front, facing, cues, firstSlot }`, camión a camión, columna a columna), `truckSlotsOf(level): TruckSlotRef[]`
  (`{ id, truck, truckIndex, column, level, cell, front, cue }`, el orden de `snapshot.truckSlots`) y
  `usesTargetRules(level)` = `hasRacks(level) || hasTrucks(level)`: la puerta de todas las reglas de la regla 10.
- `targetsOf`: zonas, luego huecos con pista, luego **niveles de camión** (orden de `truckSlotsOf`), con
  `kind: 'truck'`. `levelDestinies(level)` deja de ser `null` con camiones y trae `trucks: Sortable[]` (uno por nivel
  de camión, orden de `truckSlotsOf`; `[]` sin camiones). `usesSymbols` y `zoneMatchKinds` (timbre de la campana, por
  id de nivel) cuentan también las pistas del camión.

## Validación (`src/data/validateLevel.ts`)

Reglas (con los mensajes en inglés **exactos** que `asciiLevel` ya traduce y coloca; el resto cae en «nivel no
válido: …»):

- `trucks[i]`: `wall` norte u oeste; `id` por defecto `t${i + 1}`, `w` por defecto = columnas y si no, igual; de 1 a
  `MAX_TRUCK_LEVELS` niveles por columna; cada nivel con color o símbolo (colores y símbolos conocidos). Muelle norte:
  `z = 0`; oeste: `x = 0`. Dentro del mapa.
- Sus casillas son obstáculo (`blocked`): no pisan estanterías, plantas, estanterías almacenables ni otro camión; ni
  zonas ni la carretilla encima; las cajas del suelo tampoco (una caja en una casilla de camión lleva `level`).
- Delante de cada columna, suelo libre: `trucks[${i}] column ${j} has no room in front: cell ${x},${z} is a shelf, a
  plant, a rack or another truck`.
- Ids distintos entre camiones y distintos de los de las estanterías.
- Ventanas: `decor.windows[${i}] overlaps the dock door of trucks[${j}]` (mismo muro y alguna casilla en común).
- Cajas en el camión: `level` de 0 a niveles − 1, una por nivel y **seguidas desde 0**: `box "${id}" is on
  trucks[${i}] column ${j} at level ${k} with no box below it`.
- Altura: una columna de más de 1 nivel cuenta como apilar (el `limit` por defecto pasa a `stack.maxHeight`) y con un
  `limit` explícito: `trucks[${i}].columns[${j}] has ${n} levels, more than stackLimit ${limit}`.
- Con camiones valen las reglas de los niveles con estanterías: zonas sin receta, una caja por objetivo (sin camiones,
  el mensaje de siempre; con camiones: `a level with storage racks or trucks needs one box per target (${cajas} boxes,
  ${zonas} zones, ${huecos} slots with a cue, ${niveles} truck levels)`), exactamente un reparto (el mensaje de
  siempre, que nombra el nivel como `trucks[${i}].columns[${j}][${k}]`: `more than one complete assignment:
  trucks[0].columns[1][0] may take blue/circle or blue/triangle`), sin empezar resuelto (cada objetivo con su tipo
  destinado; en el camión basta eso, porque entonces todo lo de debajo también lo está).
- También (para niveles JSON; el `.level` ya lo impide antes): `trucks[i] is in the north wall: its bed runs along row
  z = 0` (u oeste / `x = 0`), `trucks[i] leaves the warehouse at x,z`, `trucks[i] overlaps another obstacle at x,z`,
  `duplicate truck id`, `trucks[i] has the id "…" of a rack`, `trucks[i].columns[j][k] must ask for something`,
  `box "…" is on a truck bed cell: give it its truck level`, `box "…" is on level k of trucks[i] column j, which has n
  levels`, `two boxes share level k of trucks[i] column j`. Lo comprueba `validateLevel.docks.test.ts`.
- El frente de una estantería no puede caer en una casilla de camión (se comprueba después de colocar los camiones).

## Lógica (`src/logic`)

Hecho (2026-09-30; `GameState.docks.test.ts`):

- `LevelGrid` (`logic/grid.ts`): `truckColumns` (`TruckColumn { truckIndex, truckId, column, cell, front, facing, levels,
  firstSlot }`, orden de `truckColumnsOf`), `truckColumnAt(x, z)`, `capacity(x, z)` (niveles de la columna en una casilla
  de camión, `stackLimit` en el suelo). La casilla de camión guarda su pila como una del suelo (de abajo arriba), pero
  `canTakeBox` / `isFree` la excluyen: solo se carga desde el frente.
- `CollisionWorld`: las casillas de camión son obstáculos **solo para el cuerpo** (`bodyOnly`); la carga y el punto de
  la horquilla pasan por encima como por el suelo y solo chocan con las cajas cargadas (la de abajo de la pila, que se
  abre para la carga como cualquier pila con sitio). `clearance` no las cuenta.
- **Frente** (`GameState.refreshTruckAim`, compartido con `Interaction` en `RackAim.truck`): rumbo a ≤ 30° de «hacia
  el camión» (`TRUCK_FACE_ANGLE`), punto de horquilla a ≤ 0,5 del eje de la columna (`TRUCK_FACE_LATERAL`: toda su
  anchura, gana la más cercana) y entre 0,8 delante de la cara y 1 dentro; se mantiene con 45° y 0,6
  (`TRUCK_HOLD_*`) para que un pequeño giro no haga parpadear la vista previa. Coger / dejar en el camión solo cuando
  el punto de la horquilla está a ≤ 0,55 de la cara (`TRUCK_REACH`, desde la casilla de delante). Mientras se trabaja en
  una estantería, nunca hay camión encarado.
- **Dejar** (`Interaction.findDrop`): encarando una columna a su alcance, encima de su pila mientras quepa (`dropLevel`
  = cajas de la columna, **aunque la de arriba esté fija**) y si está llena, nada (`actionIdle`; decisión: nunca el
  suelo de al lado mientras se mira el camión de cerca). Una casilla de camión nunca es una casilla de suelo para dejar
  (de lado no se ofrece). `hint.dropTruckSlotId` = el nivel donde caería.
- **Coger** (`Interaction.findPickTarget`): una caja de camión solo es objetivo en la columna encarada, la de arriba y si
  no está fija. `boxPicked.fromTruckSlotId`.
- **Altura automática**: la de las pilas del suelo (`clearLevel`, `refreshLoadPassage`): para la carga, una caja fija
  del camión es una pila normal (la horquilla sube sobre ella), con tope = los niveles de la columna. F / V no hacen nada
  (sin estanterías ni se leen; con estanterías, `hint.rack` es `null` delante del camión).
- `refreshTruckColumn` (al empezar y tras cada coger / dejar en el camión): `satisfied` de abajo arriba (regla 5),
  `locked` y `correct` de sus cajas = su nivel cumplido, `loadable` = el nivel vacío más bajo con todo lo de debajo
  cumplido, `box.truckSlotId`.
- `dropOnTruck`: `boxDropped` con `truckSlotId`, `zoneId: null`, `recipeLength: 1`, `correct` = el nivel quedó cumplido
  y si no `wrongTarget: true` (regla 7). `zoneReleased.truckSlotId` está escrito por simetría pero no puede ocurrir.
- La puerta de «reglas de objetivos» (zonas con destino, zumbido en una zona) es `usesTargetRules`: un nivel solo con
  camión las sigue igual que uno con estanterías.

## Solver, métricas y piloto automático (`src/data/levels`, `src/integration`)

Hecho (2026-09-30; `levels/docks.test.ts`, `integration/docksPlayable.test.ts`):

- **Modelo** (`solver.ts`): la casilla de camión es sólida (`solid`) y es una posición con pila (`bedLevels`,
  `bedFront`, `bedDir`, `isBed`, `capacity`); sus `steps` son los tipos destinados de sus niveles, de abajo arriba (como
  una zona con receta). Se carga con un paso adelante desde la casilla de detrás de su frente, mirando al camión (como un
  hueco), encima de la pila mientras quepa; una caja sacada de él solo sale marcha atrás; nunca de lado ni girando.
  `lockedAt` en un camión = toda su pila en su prefijo correcto (la de arriba no se levanta), pero `validDrop` y
  `carrySearch` siguen ofreciendo el nivel de encima. `grid.targets` (= `usesTargetRules`) enciende destinos fijos y
  bloqueos, como `grid.racks` antes.
- **Cota de la búsqueda exacta** (niveles con estanterías o camiones): Σ costes de hueco + 1 por **ciclo** de cajas
  que descansan en el destino de la siguiente (zonas y huecos; los camiones, pilas, quedan fuera). Admisible y
  consistente (lo comprueba el test en el ejemplo, el muelle oeste y el Benchmark). Gracias a ella el Benchmark sale
  exacto en 17 estados.
- **Callejones**: dejar la caja destinada en su nivel (fija) no se deshace, así que pasa la comprobación completa. Un
  rincón donde solo se sale marcha atrás (p. ej. entre el camión y una estantería) es un callejón si la casilla de detrás
  se puede llenar con una caja fija: una zona no va ahí (lo vigila el test del Benchmark).
- **Métricas**: `repartos` y `trampas` como con estanterías (las pistas del camión cuentan: `trampas` por tipo de
  pista, `ambiguas` por pista y nivel), `bloqueos` (la caja equivocada de un camión tapa su nivel; un camión se alcanza
  desde su frente) y la nueva **`camion`** = niveles de camión (alias `camiones`; en el informe «3 (2 columnas, 1 camión;
  1 cargado al empezar)» y columna «camión» = columnas / niveles).
- **Informe**: el plan nombra «camión T (x,z), nivel n» al cargar y «(x,z), camión T, nivel n» al sacar.
- **Piloto automático**: sin cambios de código: `liveStacks` ya ordena por nivel y `posOf` da la casilla del camión; el
  camión se carga yendo recto hasta su frente y se descarga marcha atrás (sin F / V).

## Render (`src/render`)

Hecho (2026-09-30; `views/TruckView.test.ts`, maquetas en línea):

- **Puerta** (`builders/walls.ts`): un hueco en el muro sobre la tirada del camión, desde el suelo hasta `DOCK.doorTop`
  (2,02: cabe una columna de 3 niveles), `DOCK.doorInset` (0,03) más estrecho que la tirada por cada lado; el muro
  sigue por debajo hasta `DOCK.sillTop` (−0,07: la plataforma pasa por encima) y por encima (dintel). Marco pizarra por
  las dos caras, persiana enrollada en lo alto del hueco (rollo crema y el perfil de abajo), burletes de goma por fuera
  (lados y cabeza) y dos topes al pie de las jambas; el zócalo se corta en la puerta. Nunca coincide con una ventana
  (lo impide la validación).
- **Camión** (`builders/truck.ts`, medidas en `TRUCK`): un camión rígido pequeño, crema y pizarra, low poly y a
  escuadra como las estanterías, aparcado marcha atrás contra la puerta, con la cabina mirando hacia fuera. Se construye
  en el espacio local de su muro («dock-local»: x a lo largo del muro, z hacia dentro; solo giro + traslación, nunca
  espejo).
  - Dentro (`buildTruckBed`, en el mundo, plano: nunca estorba): la trasera de la plataforma de tablas en las casillas
    del camión, **a ras del suelo** (`DOCK.bedTop` 0,02; el foso del muelle está fuera), así las cajas del camión
    descansan a las alturas de una pila del suelo (nivel n = n · alto de caja) y la horquilla no necesita nada
    especial; bordillos bajos (`railTop` 0,07, nunca tapan una caja), el umbral y la **rampa niveladora** que pisa el
    suelo del frente, donde se carga.
  - Fuera (`buildTruckOutside`, en el espacio de su muro): el resto de la plataforma (`bedOut` 1,25 más allá del muro:
    más corta y la cabina desaparece del todo tras el muro visto desde dentro), el testero, el chasis, las ruedas, la
    cabina con ventanas, franja, calandra, faros y retrovisores, y el vial un escalón más abajo (`DOCK.apronTop` −0,44)
    con la cara del foso y dos líneas guía. Desde la cámara por defecto se ven la puerta y el techo de la cabina asomando
    sobre el muro.
- **Cartel de pistas** (`CUE_BOARD`, `buildTruckBoardBays`, `buildTruckCuePanel`, `buildTruckCue`): uno por columna, de
  pie al fondo de su casilla (lado del muro) y **por encima de la pila completa** de la columna (`truckBoardBottom` =
  niveles · alto de caja + `clear` 0,06; `pitch` 0,42 por nivel), con postes y barras pizarra y un panel crema por
  nivel (su propia malla, para brillar). **Una pegatina por nivel**, la de abajo abajo: la de las estanterías
  (`buildCueFace(look, dims)`, ahora exportada y compartida en `builders/rack.ts`) un poco más pequeña (`TRUCK_CUE`)
  para que quepan tres, sin luz y opaca (`createCueMaterial`: a pleno color, nunca atenuada), en las **dos caras** del
  panel, cada una derecha y sin espejo para quien la mira: se lee desde dentro del almacén y desde detrás del muro. Una
  caja cargada nunca la tapa (todas las cámaras miran hacia abajo y el cartel está detrás y encima de la pila). Altura:
  con 3 niveles el cartel llega a ≈ 3,3 y asoma sobre el muro de 2,2; con el `limit: 2` del Benchmark, ≈ 2,24.
- **`views/TruckView.ts`**: uno por camión. `group` (mundo): la plataforma y el cartel de cada columna como un
  `RackBay`, que se vuelve fantasma por su cuenta como una bahía de estantería cuando tapa la carretilla, una caja o una
  zona (solo ocurre con su muro hundido, la cámara fuera); sus pegatinas nunca. `outside` (espacio de su muro): el resto
  del camión **se hunde y sube con su muro** (`follow`), así nunca queda delante del almacén, y `fitBox` solo lo mantiene
  en el encuadre mientras el muro está en pie. Decisión (encuadre en calma): lo que el camión asoma más allá del muro
  entra y sale del encuadre con la altura del muro, suavizada (`FIT_REACH_EASE` 3: 1 − (1 − s)³), a lo largo de todo el
  hundimiento, nunca con su grosor (que solo se mueve en el último 20 % y metía de golpe todo el fondo del camión: un
  zoom de 2,4 % por fotograma en la órbita lenta). Con el Benchmark el peor paso es ≈ 1,1 % (apaisado) / 1,4 % (vertical)
  y el camión nunca se sale del encuadre (test en `views/TruckView.test.ts`); con 1 sería algo más suave, pero a media
  bajada el camión se saldría un poco por el borde.
- **Brillo y latido**: cada nivel usa la luz de un hueco tal cual (`RackView` `SlotLight`, ahora exportada): solo con
  `satisfied`, destello al aterrizar la caja, `SuccessBurst` (anillo alrededor del volumen de su caja y destellos, en la
  cara que ve la cámara), reposo suave, y la caja fija pasa a su tono hondo (`BoxState.locked`). Banda de luz
  (`TRUCK_GLOW`, `buildTruckGlowGeometry`, sobre `buildGlowFrameGeometry`, compartida con los huecos) alrededor del
  volumen de la caja del nivel, por la cara de carga y por detrás. Llevando una caja **solo late el nivel `loadable`**
  de cada columna cuya pista encaja (`cueFits`), con la fuerza de los huecos (`INVITE_*`) y en el tono de la caja.
- **Vista previa** (`DropPreview`): en la casilla de camión a `hint.dropLevel` (también encima de una caja fija: ahí sí
  se carga). Decisión: toma el tono de la caja solo si el nivel es `loadable` **y** su pista encaja, es decir, «la
  pista encaja y es el nivel que se carga ahora», nunca «es su destino»: igual que en los huecos, es una pista y no la
  solución, así que una caja trampa que encaja (en el Benchmark, la azul ▲ o la azul ■ ante el nivel «azul» vacío de la
  columna 1) se tiñe, late y, al dejarla, zumba (`wrongTarget`).
- **Niveles con camiones y sin estanterías**: zonas con destino, destello, efecto de acierto, tono hondo y latido fuerte
  se encienden igual (`LevelView.targetRules` = `usesTargetRules`). Al terminar, los niveles de camión entran en la ola
  (una columna, de abajo arriba, como una pila).
- **Colores**: `Theme.truck` (`cab`, `cabAccent`, `roof`, `glass`, `lamp`, `deck`, `deckLine`, `trim`, `board`, `wheel`,
  `hub`, `leveller`, `apron`, `apronEdge`, `apronLine`, `doorFrame`, `shutter`, `rubber`); nunca un color de caja, nunca
  rojo ni negro (lo comprueba el test). Las pegatinas usan `Theme.rack.cue*` y los colores de caja, como las de las
  estanterías.
- Sin camiones todo se dibuja exactamente como antes (lo comprueba el test). Nada se crea por frame y todo se libera al
  descargar el nivel (test). Límite: dos muelles contiguos solo llevan un pequeño desfase de altura en sus viales (sin
  parpadeo donde se tocan).

## Audio (`src/audio`)

Hecho (2026-09-30; `audio.test.ts`):

- `boxDropped.truckSlotId` → `SfxPlayer.truckDrop`, a `DROP_LAND_SEC` (cuando la caja toca): un «tunk» hueco de madera,
  distinto del «toc» metálico de las estanterías y del golpe de fieltro del suelo (sin subgrave). Dos modos graves de
  las tablas (`TRUCK_BED_MODES`: 150 y 286 Hz, inarmónicos, suenan a caja de tablas, nunca a nota) que bajan un poco
  (`TRUCK_BED_SAG` × 0,82) bajo un paso bajo cálido (`TRUCK_BED_LOWPASS_HZ` 900), la resonancia hueca del remolque
  (`TRUCK_BED_CAVITY_HZ` 330) y el contacto de la caja. Sobre otra caja del camión el contacto es el «toc» más ligero,
  todo suena un poco más agudo por nivel y la plataforma responde más débil (`TRUCK_LEVEL_DAMP` 0,55 por nivel).
- La campana (según el `matchKind` de la pista: `zoneMatchKinds` incluye los niveles de camión; `Game.matchOf` cae a la
  pista de `snapshot.truckSlots` si faltara) suena **solo** con `correct`; el último objetivo lleva el segundo golpe y el
  arpegio de siempre. `wrongTarget` → `SfxPlayer.wrongBuzz`, como en los huecos (docs/RACKS.md).
- `boxPicked.fromTruckSlotId` → el `pickup` del suelo (golpe de madera). Nada al pasar por delante.
- La horquilla delante del camión es automática: su subida y bajada suenan con la bomba y el tono suave de bajada, y el
  «clonc» de fin de recorrido calla cerca de coger o dejar (docs/ARCHITECTURE.md, «Audio direction»).

## Nivel Benchmark (solo Modo prueba)

- `src/data/levels/especiales/benchmark.level` (sigue en 10×9, `limit: 2`, ventanas norte 7-8 y oeste 2-4): el camión
  **T** ocupa las casillas (0,0) y (1,0) del muro norte, donde antes había una planta y la estantería de madera del
  lado oeste de R (queda la del lado este; el hueco (2,0) sigue libre para las pistas laterales de R). Se carga desde la
  fila 1; la fila 2 (detrás del frente) queda libre. Columna 1: «azul» abajo y «■» encima; columna 2: «amarillo ✚»
  (color, símbolo y exacta). La zona ▲ pasa de (1,2) a (1,3): en (1,2) cerraría el camión y en (2,2) encerraría una caja
  aparcada en el rincón (2,0) entre T y R (el modelo lo veía como callejón).
- Nuevas cajas: azul ✚ (5,1), amarillo ✚ (5,7) y el amarillo ■ cargado **abajo** en la columna 1 (su destino es el
  nivel de encima: se aparca, entra el azul ✚, queda fijo, y el amarillo ■ va encima de él). 12 cajas, 12 objetivos (3
  zonas + 6 huecos con pista + 3 niveles de camión), un solo reparto; cadena de deducción en sus `nota:`.
- Medido (`npm run levels -- benchmark`): movimientos 14 (exacto, 17 estados), extra 2 (el cambio de las mentas y la
  carga equivocada), bloqueos 4, trampas 12, repartos 1, huecos 12, camion 3, libre 76 %, callejones 0 en 60 estados
  (~3 s). Piloto automático a 60 y 20 fps con F / V y marcha atrás (`benchmarkPlayable.test.ts`).

## Ajustes

- Gramática y datos: `MAX_TRUCK_LEVELS` (types.ts), letras `TRUCK_CHARS` y ejemplo `TRUCK_EXAMPLE` (asciiLevel.ts).
- Reglas con decisión propia, fáciles de cambiar en un solo sitio de la lógica: sin «libre» (regla 3), zumbido también
  con la destinada sobre una base mal (regla 7: `GameState.dropOnTruck`, `!state.satisfied`), latido solo en los
  `loadable` (regla 8), columna llena = nada (`Interaction.findDrop`, rama `aim.truck`).
- Lógica (`GameState.ts`): `TRUCK_FACE_ANGLE` 30°, `TRUCK_FACE_LATERAL` 0,5, `TRUCK_FACE_NEAR` 0,8, `TRUCK_FACE_FAR` 1,
  `TRUCK_HOLD_ANGLE` 45°, `TRUCK_HOLD_LATERAL` 0,6, `TRUCK_REACH` 0,55.
- Modelo (`solver.ts`): carga solo recta desde detrás del frente y salida solo marcha atrás (conservador, como los
  huecos); la cota de ciclos está en `MoveSearch.destTerm` / `targetDestinations`.
- Render: puerta y alturas en `dims.ts` `DOCK` (`doorTop`, `sillTop`, `doorInset`, `bedTop`, `apronTop`); camión en
  `builders/truck.ts` `TRUCK` (largo fuera `bedOut`, bordillos, rampa, cabina, ruedas, vial), cartel `CUE_BOARD`
  (`clear`, `pitch`…), pegatina `TRUCK_CUE`, banda de luz `TRUCK_GLOW`; colores en `Theme.truck`. La fuerza del latido
  y del destello es la de los huecos (`views/success.ts` `INVITE_*`, `FLASH_*`); el tono de la vista previa, en
  `LevelView` (`dropTruck.loadable && cueFits`); el encuadre del camión al hundirse su muro, `views/TruckView.ts`
  `FIT_REACH_EASE`.
- Audio: `sfx.ts` `TRUCK_BED_MODES`, `TRUCK_BED_SAG`, `TRUCK_BED_LOWPASS_HZ`, `TRUCK_BED_CAVITY_HZ`, `TRUCK_LEVEL_DAMP`.
