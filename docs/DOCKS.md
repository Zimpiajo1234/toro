# Mecánica: muelles de carga (camiones)

Petición (2026-09-30): «hagamos unos muelles de carga donde pueda cargarse directamente en el camión las cajas que
pertoquen, ahí no deja de ser un sistema igual que el de amontonarlas en el suelo, pero estéticamente es diferente».

Decisiones (2026-09-30): un **muelle** es una puerta en el muro norte u oeste (como las ventanas) con un **camión**
aparcado en ella. Se carga **como una pila del suelo** (horquilla automática, de abajo arriba), pero cada nivel de cada
columna tiene su **pista** (como un hueco de estantería) y es un **objetivo** del reparto único. Hoy solo el Benchmark
(docs/RACKS.md) puede llevar camiones; los niveles 1–3 no cambian.

Decisiones (2026-09-30, «el camión nunca sobrepasa la puerta del gate, se quedan justo pegados por fuera»; «solo hasta
2 alturas, sin hierros de por medio»; leyenda en un cartel enmarcado sobre la puerta):
- **A. Fuera**: el camión espera fuera del edificio, con la trasera pegada a la cara de fuera del muro, en la puerta;
  nada del camión entra en el almacén.
- **B. Puerta = suelo**: las casillas del mapa que marca el camión son las **casillas de la puerta**, suelo normal
  delante de ella. La carretilla se pone en una mirando al muro; la horquilla y la carga cruzan la puerta hasta la
  columna de la caja del camión, justo detrás del muro; el cuerpo se para en la línea del muro.
- **C. Como una pila**: de abajo arriba, horquilla automática, **como mucho 2 niveles**, de **1 a 3 columnas** (la
  puerta mide de 1 a 3 casillas). Nada encima ni entre las columnas (ni postes, ni barras).
- **D. Cartel sobre la puerta**: enmarcado, una casilla por columna (de izquierda a derecha como las casillas de la
  puerta) y por nivel (la fila de abajo = nivel 0), pegatinas en las dos caras (las de las estanterías), nunca atenuadas
  ni en espejo.
- **E. Reglas de objetivo** como hasta ahora: caja fija, zumbido de objetivo equivocado, reparto único (una caja fija
  del camión todavía recibe el nivel de encima).

## Reglas
1. **Muelle** = puerta en el muro **norte** u **oeste** con un camión aparcado **fuera**. La puerta es una **tirada
   recta de casillas de puerta** pegada al muro, dentro del mapa: en el muelle norte, casillas de la fila `z = 0`; en el
   oeste, de la columna `x = 0`. Una **columna** del camión por casilla de puerta, **de 1 a 3** (`MAX_TRUCK_COLUMNS`),
   cada una justo detrás del muro, **fuera del mapa** (`z = -1` en el norte, `x = -1` en el oeste; `truckCellOf`). La
   puerta no se declara aparte (no puede descuadrarse del camión). Las casillas de puerta son **suelo**: sin muebles
   (estantería, planta, estantería almacenable, otra puerta) y, al empezar, sin zona, caja ni carretilla. Una puerta en
   un rincón o dos puertas pegadas valen.
2. **Se carga por la puerta**: desde la casilla de puerta de cada columna, mirando al muro (`TRUCK_FACING`: el camión se
   carga desde el sur en el muro norte y desde el este en el oeste). El cuerpo de la carretilla nunca pasa la línea del
   muro; la horquilla y la carga, solo por la puerta y **rectas** (con la carga en la puerta el rumbo no cambia, como en
   un hueco de estantería). Exactamente como dejar en el suelo o sobre una pila: **horquilla automática** por altura de
   pila, las cajas una sobre otra **de abajo arriba**, hasta los **niveles** de la columna (1–2, nunca más que
   `limit`). F / V, la rueda y X / B no hacen nada delante de un camión. Con la carga en la puerta pero sin llegar a la
   caja del camión no se deja nada (tampoco en el suelo de al lado).
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
8. **Latido** (pista opcional: solo con las **pistas** encendidas, P, apagadas por defecto; docs/RACKS.md): mientras
   llevas una caja laten, en el tono de la caja y con la fuerza de los huecos (`INVITE_*` de docs/RACKS.md), los niveles
   **`loadable`** (el siguiente de su columna, con todo lo de debajo cumplido) cuya pista encaja (`cueFits`: pista, no
   solución). Apagadas, el cartel no se ilumina al coger una caja; el destello y el brillo de un nivel cumplido, sí.
9. **Acierto**: como en un hueco (docs/RACKS.md, regla 10): destello del objetivo, pequeño efecto de acierto, la campana
   según la pista, brillo suave en reposo y la caja pasa despacio a su **tono hondo**.
10. **Niveles con camiones** siguen todas las reglas de «niveles con estanterías» de docs/RACKS.md (zonas de una sola
    caja, destinos, cajas fijas, zumbido, latido fuerte, «los símbolos no apilan» levantado), tengan o no estanterías.
    Los niveles sin estanterías ni camiones: exactamente como antes.
11. **Pistas a la vista, en el cartel sobre la puerta** (decisión D): un cartel enmarcado en la cara de dentro del muro,
    encima de la puerta, con una casilla por columna (justo encima de su casilla de puerta) y por nivel (abajo, el nivel
    0). Cada casilla lleva la pegatina de su nivel en las dos caras, a pleno color, nunca atenuada ni en espejo,
    legible desde dentro del almacén con la cámara por defecto y girándola. Nunca sobre la carga ni entre las columnas.

## En el archivo `.level`

Un camión es un carácter de la leyenda. En el mapa marca las **casillas de su puerta**: una **tirada recta pegada a su
muro** (en el muelle norte, casillas seguidas de la fila 0; en el oeste, de la columna 0). Cada grupo conectado de ese
carácter es un camión. La caja del camión no sale en el mapa: está fuera, detrás del muro.

```
camión   = cabeza muro [id] ":" columna { "|" columna }                 (1 a 3 columnas)
cabeza   = "camión" ["muelle"] | "camión en el muelle" | "muelle"      (también truck / dock)
muro     = "norte" | "oeste"                                            (también north / west)
columna  = nivel { "/" nivel }                                          (de abajo arriba, 1 o 2 niveles)
nivel    = pista [ "+" caja ]                                           (la caja cargada al empezar)
pista    = color [símbolo] | símbolo                                    (nunca «libre»)
caja     = "caja" color [símbolo] ["tipo" tipo] [id]
```

- Las columnas van de oeste a este (muelle norte) o de norte a sur (muelle oeste): una por casilla de puerta, en ese
  orden, separadas por `|`, como mucho 3. Los niveles de cada columna, de abajo arriba, separados por `/`.
- Una caja cargada al empezar va sobre otra (o sobre la plataforma): en una columna, un nivel con caja lleva caja en
  todos los de debajo. En los datos está en su casilla de caja, fuera del mapa.
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

Un camión fuera de la puerta norte (casillas de puerta 2–3 de la fila 0; su caja, en (2,-1) y (3,-1)), de 2 columnas
que se cargan desde esas casillas mirando al norte. Columna 1: abajo «azul», encima «cualquier ▲». Columna 2: «coral
◆» exacto, con la menta ▲ cargada por error. Único reparto: la única azul (la azul ▲) abajo en la columna 1, así que el
«▲» de encima es de la menta ▲; el coral ◆ a su nivel y el amarillo ■ a la zona. La azul ▲ encaja en el «▲» pero no
es su destino (una «trampa» amable), y la menta ▲ hay que descargarla antes de poner el coral ◆.

Errores (en español, `archivo:línea:columna`): muro que falta o que no es norte / oeste, dos puntos que faltan o
repetidos, más de 2 niveles, nivel vacío, «libre», pista desconocida, caja mal escrita tras el `+`, caja sin nada
debajo, `/ | :` fuera de una estantería o un camión, camión que no es recto, que no está pegado a su muro o cuyas
columnas no cuadran con sus casillas, id propio en un carácter usado por varios camiones, id repetido con una
estantería. Los de `validateLevel` (abajo) se señalan en la columna o la caja que hay que arreglar: entre ellos, más de
3 columnas (en la primera que sobra: «tiene 4 columnas y lleva como mucho 3: su puerta mide de 1 a 3 casillas…»).

`parseLevelDraft(texto)` da el objeto crudo que `parseLevel` pasa a `validateLevel` (mapa y leyenda comprobados, sin
valores por defecto): los tests de la gramática lo usan para no depender de la validación.

## Datos (`src/core/types.ts`)

- `LevelData.trucks?: LevelTruck[]` (ausente sin camiones; en `validateLevel`, justo después de `racks`).
  `LevelTruck { id, wall, x, z, w, columns: TruckCue[][] }`: `wall` = `'north' | 'west'` (`WallSide`); (x, z) es la
  primera **casilla de puerta** (muelle norte: `z = 0`, la más al oeste; oeste: `x = 0`, la más al norte); `w` = casillas
  de puerta = columnas; `columns[col][nivel]`, nivel 0 = sobre la plataforma; `TruckCue = ZoneCriteria` (color y / o
  símbolo, al menos uno). `MAX_TRUCK_LEVELS` = 2, `MAX_TRUCK_COLUMNS` = 3.
- `TRUCK_FACING = { north: 'south', west: 'east' }`: el lado desde el que se carga. Con él un camión se lee como una
  estantería cuyas casillas están un paso más allá del muro: `truckCellOf(truck, col)` = casilla de caja (fuera del mapa),
  `truckFrontOf(truck, col)` = casilla de puerta (la de delante), `inwardHeading` el rumbo hacia el camión y
  `columnFrame` el marco de la columna (profundidad 0 = la línea del muro).
- Caja cargada al empezar: `LevelBox` con (x, z) = su casilla de caja (fuera: `z = -1` / `x = -1`) y `level` = su nivel.
- Estado: `GameSnapshot.truckSlots?: TruckSlotState[]` (camión a camión, columna a columna, de abajo arriba; **ausente**
  en niveles sin camiones: se lee `snapshot.truckSlots ?? []`). `TruckSlotState { id, truckId, column, level, cell,
  front, wall, facing, pos, accepts, destined, occupiedBy, satisfied, loadable }`: id `t1:columna:nivel` (desde 0);
  `cell` = casilla de caja (fuera), `front` = casilla de puerta, `pos` = centro de la casilla de caja; `accepts` nunca
  es `null`; `satisfied` = regla 5; `loadable` = vacío, el siguiente de su columna y todo lo de debajo cumplido (regla
  8). Los campos que comparte con `SlotState` significan lo mismo: `cueFits`, `isDestined` y `satisfiesTarget` sirven
  para los dos.
- `BoxState.truckSlotId?: string | null`: el nivel de camión donde descansa (entonces `cell` = su casilla de caja,
  fuera; `pos` su centro; `level` = su nivel, `zoneId` y `slotId` `null`). `GameState` lo pone en todas las cajas de un
  nivel con camiones (`null` fuera del camión) y lo deja sin definir en los demás. `BoxState.locked` en el camión =
  regla 6 (no se coge; sí se carga encima). `correct` = su nivel `satisfied`.
- `InteractionHint.dropTruckSlotId?: string | null`: llevando una caja, el nivel de camión donde caería (`dropCell` =
  casilla de caja, fuera; `dropLevel` = el nivel, `dropZoneId` `null`); sin definir en niveles sin camiones.
  `hint.rack` es siempre `null` delante de un camión. Con la horquilla vacía, `targetBoxId` es la caja de arriba de la
  columna si no está fija.
- Eventos (la misma forma; campos opcionales solo cuando tocan un camión, así que sin camiones son idénticos):
  `boxPicked.fromTruckSlotId` (`fromZoneId: null`, `level` = su nivel); `boxDropped.truckSlotId` (`zoneId: null`,
  `cell` = casilla de caja, `level` = su nivel, `recipeLength` 1, `correct` = el nivel quedó cumplido, `wrongTarget:
  true` si no, regla 7; `satisfiedCount` / `total` cuentan los niveles de camión). `zoneReleased.truckSlotId` existe por
  simetría pero hoy no ocurre (las cumplidas están fijas y cargar encima no descumple nada).
- `progress`: zonas + huecos con pista + todos los niveles de camión.

## Solución única y destinos (`src/core/sorting.ts`, `src/core/docks.ts`)

Hecho (2026-09-30; lo comprueba `core/docks.test.ts`):

- `core/docks.ts` (puro): `trucksOf(level)`, `hasTrucks(level)`, `truckFacing(truck)`, `truckCellOf(truck, col)` (la
  casilla de caja, fuera del mapa), `truckFrontOf(truck, col)` (la casilla de puerta), `truckInwardHeading(truck)`,
  `truckSlotIdOf(truckId, col, nivel)` (= `${truckId}:${col}:${nivel}`), `truckColumnsOf(level): TruckColumnRef[]`
  (`{ truck, truckIndex, column, cell, front, facing, cues, firstSlot }`, camión a camión, columna a columna),
  `truckSlotsOf(level): TruckSlotRef[]` (`{ id, truck, truckIndex, column, level, cell, front, cue }`, el orden de
  `snapshot.truckSlots`) y `usesTargetRules(level)` = `hasRacks(level) || hasTrucks(level)`: la puerta de todas las
  reglas de la regla 10.
- `targetsOf`: zonas, luego huecos con pista, luego **niveles de camión** (orden de `truckSlotsOf`), con
  `kind: 'truck'`. `levelDestinies(level)` deja de ser `null` con camiones y trae `trucks: Sortable[]` (uno por nivel
  de camión, orden de `truckSlotsOf`; `[]` sin camiones). `usesSymbols` y `zoneMatchKinds` (timbre de la campana, por
  id de nivel) cuentan también las pistas del camión.

## Validación (`src/data/validateLevel.ts`)

Reglas (con los mensajes en inglés **exactos** que `asciiLevel` traduce y coloca cuando pueden darse en un `.level`; el
resto cae en «nivel no válido: …»). Lo comprueba `validateLevel.docks.test.ts`.

- `trucks[i]`: `wall` norte u oeste; `id` por defecto `t${i + 1}`, `w` por defecto = columnas y si no, igual; de 1 a
  `MAX_TRUCK_LEVELS` niveles por columna (`trucks[i].columns[j] must have 1 to 2 levels`); como mucho
  `MAX_TRUCK_COLUMNS` columnas (`trucks[${i}] has ${n} columns, more than 3: its dock door is 1 to 3 cells wide`); cada
  nivel con color o símbolo (colores y símbolos conocidos). Muelle norte: `z = 0`; oeste: `x = 0` (`trucks[i] is in the
  north wall: its door cells run along row z = 0`, u oeste / `x = 0`). Casillas de puerta dentro del mapa
  (`trucks[i] leaves the warehouse at x,z`).
- **Casillas de puerta = suelo**: sin estantería, planta, estantería almacenable ni la puerta de otro camión
  (`trucks[i] overlaps another obstacle at x,z`); nada más alrededor (una puerta en un rincón, dos pegadas o una planta
  justo detrás valen: si cierra la columna, lo dice el solver). El frente de una estantería sí puede ser una casilla de
  puerta.
- **Nada empieza en la puerta**: `zone "…" is on the dock door of trucks[i] (column j): the truck is loaded from there`
  (su caja fija cerraría esa columna para siempre), `forklift starts on the dock door of trucks[i] (column j): door
  cells start empty`, `box "…" starts on the dock door of trucks[i] (column j): door cells start empty (a box loaded on
  the truck is on its bed cell x,-1)`. En un `.level` no pueden darse: esas casillas llevan la letra del camión.
- Ids distintos entre camiones y distintos de los de las estanterías (`duplicate truck id`, `trucks[i] has the id "…"
  of a rack`).
- Ventanas: `decor.windows[${i}] overlaps the dock door of trucks[${j}]` (mismo muro y alguna casilla en común).
- Cajas en el camión, en su **casilla de caja** (fuera del mapa, la única casilla de fuera que se admite; cualquier otra
  es `box "…" out of bounds`): `level` de 0 a niveles − 1 (`box "…" is on a truck bed cell: give it its truck level`,
  `box "…" is on level k of trucks[i] column j, which has n levels`), una por nivel (`two boxes share level k of
  trucks[i] column j`) y **seguidas desde 0**: `box "${id}" is on trucks[${i}] column ${j} at level ${k} with no box
  below it`.
- Altura: una columna de más de 1 nivel cuenta como apilar (el `limit` por defecto pasa a `stack.maxHeight`) y con un
  `limit` explícito: `trucks[${i}].columns[${j}] has ${n} levels, more than stackLimit ${limit}`.
- Con camiones valen las reglas de los niveles con estanterías: zonas sin receta, una caja por objetivo (sin camiones,
  el mensaje de siempre; con camiones: `a level with storage racks or trucks needs one box per target (${cajas} boxes,
  ${zonas} zones, ${huecos} slots with a cue, ${niveles} truck levels)`), exactamente un reparto (el mensaje de
  siempre, que nombra el nivel como `trucks[${i}].columns[${j}][${k}]`: `more than one complete assignment:
  trucks[0].columns[1][0] may take blue/circle or blue/triangle`), sin empezar resuelto (cada objetivo con su tipo
  destinado; en el camión basta eso, porque entonces todo lo de debajo también lo está).

## Lógica (`src/logic`)

Hecho (2026-09-30; `GameState.docks.test.ts`, `collision.test.ts`):

- `LevelGrid` (`logic/grid.ts`): `truckColumns` (`TruckColumn { truckIndex, truckId, column, cell, front, facing,
  levels, firstSlot }`, orden de `truckColumnsOf`; `cell` fuera del mapa, `front` = casilla de puerta). Cada columna
  guarda su pila **aparte**, de abajo arriba; las consultas de pila (`height`, `boxAt`, `baseAt`, `stackAt`, `pushBox`,
  `popBox`, `capacity`) aceptan la casilla de caja de fuera y `truckColumnAt(x, z)` la reconoce (-1 en cualquier casilla
  del mapa). Las casillas de puerta son suelo normal; `canTakeBox` / `isFree` no ven nunca una casilla de fuera: el
  camión solo se carga por su puerta.
- `CollisionWorld`: el **cuerpo** choca con los muros enteros (`bounds`), también en la puerta: se para en la línea del
  muro. La **carga** y el **punto de la horquilla** ven los muros como losas gruesas por fuera (`loadWalls`,
  `doorWalls`) con cada puerta abierta entre sus **jambas** (`DOOR_JAMB` 0,02, como los montantes de un hueco) hacia un
  **bolsillo de 1 casilla** (`DOOR_POCKET`: la caja del camión), cerrado al fondo; entre las columnas de una misma puerta
  no hay nada. Allí la carga solo choca con las cajas cargadas (la base de la pila, que se abre para la carga como
  cualquier pila con sitio). Para la carga, además, el **tramo de puerta de cada columna** (`doorCells`: su casilla a
  lo largo del muro, de la línea del muro al fondo del bolsillo) está **cerrado como el muro** hasta que `GameState` lo
  abre (`setDoorOpen`, `refreshDoorPassage`): solo el de la columna encarada (abajo), como una columna de estantería, y
  se queda abierto mientras la carga está dentro (nunca se cierra sobre ella). Así, girando en una casilla de puerta,
  la carga choca con la puerta como con el muro hasta que la carretilla encara la columna en línea con su cuerpo, y
  nunca resbala por una puerta ancha hasta la columna de al lado (como en el modelo del solver: cada columna se carga
  desde su casilla de puerta, mirando al muro). La horquilla vacía pasa cualquier puerta. `clearance` mide contra esas losas
  (siempre mide para la horquilla o la carga; para la carga, también contra los tramos cerrados). Sin camiones,
  `loadWalls` no existe y todo es idéntico a antes (test).
- **Encarar** (`GameState.refreshTruckAim`, compartido con `Interaction` en `RackAim.truck`): el cuerpo **en línea con
  su casilla de puerta** (en ella o justo detrás: la misma columna `x` del mapa en el muelle norte, la misma fila `z` en
  el oeste), rumbo a ≤ 30° de «hacia el camión» (`TRUCK_FACE_ANGLE`), punto de horquilla a ≤ 0,5 del eje de la columna
  (`TRUCK_FACE_LATERAL`: toda su anchura) y entre 0,8 delante de la línea del muro y 1 más allá (`TRUCK_FACE_NEAR` /
  `TRUCK_FACE_FAR`); se mantiene con 45° y 0,6 (`TRUCK_HOLD_*`, el cuerpo aún en línea) para que un pequeño giro no
  haga parpadear la vista previa. Coger / dejar en el camión solo **con la horquilla al otro lado de la puerta**: el
  punto de la horquilla al menos 0,3 más allá de la línea del muro (`TRUCK_REACH`; con el cuerpo en el muro está a 0,5,
  en el centro de la caja; en el centro de la casilla de puerta, a 0,42), así que el cuerpo está entonces en su casilla
  de puerta: una columna nunca se trabaja desde la casilla de puerta de al lado. Mientras se trabaja en una estantería,
  nunca hay camión encarado.
- **Rumbo fijo**: con la carga al otro lado de la línea de un muro con puerta (`loadInDoor`: su borde a
  `RACK_INSIDE_MARGIN` más allá; solo puede ser por el tramo abierto de la columna encarada), el rumbo no cambia
  (`ForkliftController.setHeadingLock`, como con una carga en un hueco): entra y sale recta; de lado nunca se carga. La
  horquilla vacía no lo fija (no choca con nada). Girando en una casilla de puerta con carga, la puerta cerrada la para
  como el muro y la carretilla se aparta al girar (con una planta detrás, el giro no cabe); solo entra al quedar
  encarada (≤ 30°), en la columna de la casilla de puerta del cuerpo, y desde entonces el rumbo no cambia (tests, a 60
  y 20 fps, también en una puerta de 3).
- **En la puerta** (`RackAim.doorway`): llevando una caja con la carga en la puerta pero sin llegar a `TRUCK_REACH`, no
  se deja nada (`actionIdle`), tampoco en el suelo de al lado (sería teletransportarla).
- **Dejar** (`Interaction.findDrop`): encarando una columna con la horquilla dentro, encima de su pila mientras quepa
  (`dropLevel` = cajas de la columna, **aunque la de arriba esté fija**) y si está llena, nada (`actionIdle`; decisión:
  nunca el suelo de al lado mientras se mira el camión de cerca; con la columna llena la carga se queda en la puerta
  contra su caja). La caja aterriza en el centro de la casilla de caja, justo bajo la horquilla. `hint.dropTruckSlotId`
  = el nivel donde caería.
- **Coger** (`Interaction.findPickTarget`): una caja de camión solo es objetivo en la columna encarada con la horquilla
  dentro, la de arriba y si no está fija. `boxPicked.fromTruckSlotId`. Sale marcha atrás, recta.
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

- **Modelo** (`solver.ts`): cada columna de camión es una **posición más, después de los huecos** (`bedBase + columna`,
  `bedBase = cellCount + slotCount`, orden de `truckColumnsOf`), fuera del mapa: `isSlot` solo los huecos, `isBed` las
  columnas de camión, `posOf(x, z)` reconoce la casilla de caja de fuera, `cellOfPos(pos)` da la casilla de cualquier
  posición. Por posición: `bedLevels`, `bedFront` (la casilla de puerta), `bedDir` (hacia el muro), `capacity`, `steps`
  (los tipos destinados de sus niveles, de abajo arriba, como una zona con receta); `bedAtPose[casilla * 4 + dir]` = la
  columna que queda justo delante de esa pose (en su puerta, mirando al muro). Las casillas de puerta son suelo (no
  `solid`). Se carga con **un paso adelante desde la casilla de detrás de la puerta**, mirando al muro (la caja cruza la
  puerta; como un hueco desde detrás de su frente), encima de la pila mientras quepa; un giro nunca mete la caja en el
  camión; una caja sacada de él solo sale **marcha atrás**. `lockedAt` en un camión = toda su pila en su prefijo
  correcto (la de arriba no se levanta), pero `validDrop` y `carrySearch` siguen ofreciendo el nivel de encima.
  `grid.targets` (= `usesTargetRules`) enciende destinos fijos y bloqueos.
- **Cota de la búsqueda exacta** (niveles con estanterías o camiones): Σ costes de hueco + 1 por **ciclo** de cajas
  que descansan en el destino de la siguiente (zonas y huecos; los camiones, pilas, quedan fuera). Admisible y
  consistente (lo comprueba el test en el ejemplo, el muelle oeste y el Benchmark).
- **Callejones**: dejar la caja destinada en su nivel (fija) no se deshace, así que pasa la comprobación completa. Una
  zona o una caja fija justo detrás de una casilla de puerta cerraría esa columna (una planta ahí la deja sin acceso:
  «Sin acceso» en el test).
- **Métricas**: `repartos` y `trampas` como con estanterías (las pistas del camión cuentan: `trampas` por tipo de
  pista, `ambiguas` por pista y nivel), `bloqueos` (la caja equivocada de un camión tapa su nivel; un camión se alcanza
  desde su casilla de puerta), `libre` (las casillas de puerta son suelo) y **`camion`** = niveles de camión (alias
  `camiones`; en el informe «3 (2 columnas, 1 camión; 1 cargado al empezar)» y columna «camión» = columnas / niveles).
- **Informe**: el plan nombra el camión por su letra y su **casilla de puerta**: «→ camión T (x,0), nivel n» al cargar y
  «(x,0), camión T, nivel n → …» al sacar.
- **Piloto automático**: `liveStacks` pone cada caja en su posición (`posOf` reconoce la casilla de fuera), por nivel;
  para cargar va recto hasta la casilla de puerta (la carga cruza la puerta, el rumbo fijo) y deja; para descargar,
  desde la casilla de puerta mirando al muro coge y sale marcha atrás. Sin F / V. A 60 y 20 fps (tests).

## Render (`src/render`)

Diseño (2026-09-30, plan del render; medidas y constructores en `builders/truck.ts`, `dims.ts` `DOCK`):

- **Puerta** (`builders/walls.ts`): hueco en el muro sobre las casillas de puerta, desde `DOCK.sillTop` hasta
  `DOCK.doorTop` = **1,70** (la carga del nivel 1 llega a ≈ 1,62), `DOCK.doorInset` más estrecho por cada lado; marco
  pizarra por las dos caras, la persiana enrollada **por fuera**, encima de la puerta (la cara de dentro es del cartel),
  burletes y topes. Nunca coincide con una ventana (lo impide la validación).
- **Camión** (`TRUCK`, `buildTruckBody`): cabina y plataforma baja, **entero fuera**, con la trasera pegada a la cara de
  fuera del muro; plataforma a ras del suelo (`DOCK.bedTop`), así las cajas del camión descansan a las alturas de una
  pila del suelo; laterales bajos solo en los extremos y testero junto a la cabina; nada sobre ni entre las columnas.
  **Estático**: no se hunde con su muro (sus cajas son `BoxView` en `pos`: flotarían), siempre en el encuadre.
- **Umbral** (`DOCK_PLATE`, `buildDockPlate`): chapa plana de la puerta, a la altura del suelo, por debajo de la vista
  previa.
- **Cartel** (`DOCK_SIGN`, `SIGN_CUE`, `SIGN_GLOW`; `buildSignFrame`, `buildSignPanel`, `buildSignCue`): en la cara de
  dentro del muro, sobre la puerta; una casilla por columna (justo encima de su casilla de puerta) y por nivel (abajo,
  el nivel 0); con 2 niveles asoma ≈ 0,3 sobre el remate. Pegatina de estantería (`buildCueFace` + `createCueMaterial`)
  en las dos caras, sin espejo, nunca atenuada; sus dos escuadras, detrás de las barras de los extremos del marco, nunca
  tapan una pegatina desde ningún giro de cámara (test). Marco y paneles son un `RackBay` que se vuelve fantasma cuando
  tapa la carretilla, una caja o una zona (nunca por las cajas de su plataforma) y suave con el muro hundido; las
  pegatinas nunca.
- **Lo que el muro tapa no cuenta**: con el muro del muelle en pie, lo que queda al otro lado (las cajas de la
  plataforma, la parte de la carga que ya cruzó la puerta) nunca vuelve fantasma una estantería, un estante ni una caja
  apilada (`LevelView.clipToRoom`: el volumen se recorta a la sala; test en el Benchmark con la cámara por defecto).
- **Luz por nivel** (`SlotLight`): panel, pegatina y banda de la casilla del cartel (latido fuerte solo `loadable` y
  `cueFits`, destello al aterrizar, brillo en reposo); efecto de acierto y tono hondo en la caja de la plataforma; vista
  previa en la casilla de caja, a `hint.dropLevel` (tono de la caja solo si `loadable` y su pista encaja: una pista,
  nunca la solución).
- Sin camiones todo se dibuja exactamente como antes.

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

- `src/data/levels/especiales/benchmark.level` (11×9, `limit: 2`, ventanas norte 8-9 y oeste 2-4): el camión **T**
  espera fuera de la puerta norte, con las casillas de puerta (1,0) y (2,0) (su caja, en (1,-1) y (2,-1)), a la
  izquierda de R. Se carga desde esas casillas mirando al norte; la fila 1 (detrás de la puerta) queda libre. Columna 1:
  «azul» abajo y «■» encima; columna 2: «amarillo ✚» (color, símbolo y exacta). La zona ▲ en (2,3), fuera de las filas
  de carga (la de la puerta y la de detrás). El cartel va sobre la puerta.
- Cajas del muelle: azul ✚ (6,1), amarillo ✚ (6,7) y el amarillo ■ cargado **abajo** en la columna 1 (su destino es el
  nivel de encima: se aparca, entra el azul ✚, queda fijo, y el amarillo ■ va encima de él). 12 cajas, 12 objetivos (3
  zonas + 6 huecos con pista + 3 niveles de camión), un solo reparto; cadena de deducción en sus `nota:`.
- Medido (`npm run levels -- benchmark`, 2026-09-30, camión fuera): movimientos 14 (exacto), extra 2 (el cambio de las
  mentas y la carga equivocada), bloqueos 4, trampas 12, repartos 1, huecos 12, camion 3, estrechas 8, libre 80 % (las
  casillas de puerta son suelo: antes 78), callejones 0 en 60 estados. Piloto automático a 60 y 20 fps con F / V y
  marcha atrás (`benchmarkPlayable.test.ts`); mínimo del contador de movimientos 14 (`levelMinimums.json`).

## Ajustes

- Gramática y datos: `MAX_TRUCK_LEVELS` y `MAX_TRUCK_COLUMNS` (types.ts), letras `TRUCK_CHARS` y ejemplo
  `TRUCK_EXAMPLE` (asciiLevel.ts); las casillas de caja y de puerta, `truckCellOf` / `truckFrontOf` (core/docks.ts).
- Reglas con decisión propia, fáciles de cambiar en un solo sitio de la lógica: sin «libre» (regla 3), zumbido también
  con la destinada sobre una base mal (regla 7: `GameState.dropOnTruck`, `!state.satisfied`), latido solo en los
  `loadable` (regla 8), columna llena = nada (`Interaction.findDrop`, rama `aim.truck`), nada en la puerta
  (`RackAim.doorway`), puerta abierta solo para la columna encarada desde su casilla de puerta
  (`GameState.refreshDoorPassage`, `inLineWith`).
- Lógica (`GameState.ts`): `TRUCK_FACE_ANGLE` 30°, `TRUCK_FACE_LATERAL` 0,5, `TRUCK_FACE_NEAR` 0,8, `TRUCK_FACE_FAR` 1,
  `TRUCK_HOLD_ANGLE` 45°, `TRUCK_HOLD_LATERAL` 0,6, `TRUCK_REACH` 0,3 (más allá de la línea del muro), margen de «carga
  en la puerta» `RACK_INSIDE_MARGIN` 0,05. Colisión (`collision.ts`): `DOOR_JAMB` 0,02, `DOOR_POCKET` 1.
- Modelo (`solver.ts`): carga solo recta desde detrás de la puerta y salida solo marcha atrás (conservador, como los
  huecos); la cota de ciclos está en `MoveSearch.destTerm` / `targetDestinations`.
- Render: puerta y alturas en `dims.ts` `DOCK` (`doorTop`, `sillTop`, `doorInset`, `bedTop`, `apronTop`); camión, umbral
  y cartel en `builders/truck.ts` (`TRUCK`, `DOCK_PLATE`, `DOCK_SIGN`, `SIGN_CUE`, `SIGN_GLOW`); colores en
  `Theme.truck`. La fuerza del latido y del destello es la de los huecos (`views/success.ts` `INVITE_*`, `FLASH_*`).
- Audio: `sfx.ts` `TRUCK_BED_MODES`, `TRUCK_BED_SAG`, `TRUCK_BED_LOWPASS_HZ`, `TRUCK_BED_CAVITY_HZ`, `TRUCK_LEVEL_DAMP`.
