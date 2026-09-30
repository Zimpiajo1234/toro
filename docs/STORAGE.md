# Almacenaje común: estanterías, camiones y los aspectos que vengan

**Estado: fase 1 de 7** (diseño y red de seguridad). El juego no ha cambiado: el código sigue con las dos
implementaciones de abajo. Este documento fija el modelo al que van, sus reglas y contratos, y cómo se comprueba que
por el camino nada cambia. Lo propio de cada aspecto sigue en docs/RACKS.md (estanterías almacenables) y docs/DOCKS.md
(muelles de carga).

Ojo con el nombre: `src/storage/` es el progreso guardado (ProgressStore), nada que ver con esto. Lo nuevo va en
`src/core/storage.ts` y `src/render/storage/`.

## Decisiones

Petición (2026-09-30): «un sistema de almacenamiento que sea de lógica compartida pero el asset asignado sea
diferente… escalable… Quiero poder disponer de 3 camiones en un posible nivel sin preocuparme de un hardcoding»;
«quiero dejar bien planteado el sistema de almacenamiento, que lo hagamos antes de avanzar».

Decisiones (2026-09-30):
- **A. Lógica común, aspecto aparte.** Estantería y camión son dos **aspectos** (`skin`) de una misma unidad de
  almacenaje. El aspecto solo aporta el dibujo y unas pocas propiedades declaradas en una tabla (soporte, alturas,
  columnas, acceso, prefijo de id, relleno, sonido al dejar una caja). Añadir un aspecto = una fila + su dibujo.
- **B. Horquilla siempre con teclas** («para subir y bajar que sea con las teclas, nada automático»): F / V / rueda en
  toda unidad, también en el camión. En una pila solo se deja en su siguiente nivel libre y solo se coge la caja de
  arriba, con la horquilla a ese nivel. El suelo (pilas y zonas) sigue con la horquilla automática.
- **C. Un nivel sin pista es «libre»** en cualquier aspecto: vale cualquier caja y nunca es objetivo; nunca brilla, se
  bloquea, zumba ni se ilumina con las pistas (P). Cada columna del camión admite `min(2, limit)` cajas: sus pistas de
  abajo arriba y el resto, libre.
- **D. La gramática del `.level` no cambia**: una letra de la leyenda por unidad («3 camiones = T, U, V»: tres
  camiones, tres letras; la forma canónica de hoy escribe T, C, U, ver «Huecos», 1); `libre` escrito también vale en
  un camión.
- **E. Se queda todo lo aprobado**: camiones fuera de los muros norte y oeste, casillas de puerta, cartel sobre la
  puerta, barandillas naranjas con planta (docs/DOCKS.md); placas transparentes en los extremos de las estanterías,
  caja fija y zumbido (docs/RACKS.md); pistas P apagadas por defecto; la cámara nunca se reencuadra sola; la luz ámbar
  de marcha atrás.
- **F. El juego solo cambia en la fase 6.** Las fases 1–5 dejan el Benchmark exactamente igual (14 movimientos, el
  mismo plan, los mismos destinos, el mismo piloto frame a frame: «Red de seguridad»). La fase 6 trae B y C y vuelve a
  medir.

## Por qué: hoy hay dos implementaciones paralelas

| | Estantería (docs/RACKS.md) | Camión (docs/DOCKS.md) |
|---|---|---|
| Datos (`core/types.ts`) | `LevelRack`, `RackSlot` (sin pista = libre), `MAX_RACK_SLOTS` | `LevelTruck`, `TruckCue` (nunca libre), `MAX_TRUCK_LEVELS`, `MAX_TRUCK_COLUMNS`, `TRUCK_FACING` |
| Geometría | `core/racks.ts`: `rackCellOf`, `frontCellOf`, `slotsOf`, `slotIdOf` | `core/docks.ts`: `truckCellOf`, `truckFrontOf`, `truckColumnsOf`, `truckSlotsOf`, `truckSlotIdOf` (sobre la geometría de `core/racks`) |
| Gramática / validación | `readRack`, `RACK_CHARS`; `racks[i]…` | `readTruck`, `TRUCK_CHARS`; `trucks[i]…` |
| Estado | `snapshot.slots` (`SlotState`), `box.slotId`, `hint.rack` | `snapshot.truckSlots?` (`TruckSlotState`), `box.truckSlotId?`, `hint.dropTruckSlotId?` |
| Eventos | `fromSlotId`, `slotId` | `fromTruckSlotId`, `truckSlotId` |
| Lógica (`GameState`) | `refreshRackAim`, `refreshRackPassage`, `stepForkLevel`, `dropInSlot`, `refreshSlot`; `RACK_FACE_*`, `RACK_HOLD_*`, `RACK_DROP_REACH` | `refreshTruckAim`, `refreshDoorPassage`, `loadInDoor`, `dropOnTruck`, `refreshTruckColumn`; `TRUCK_FACE_*`, `TRUCK_HOLD_*`, `TRUCK_REACH` |
| Rejilla / colisión | `grid.columns`, `slotBox`; `setRackOpen`, `RACK_WALL`, `softenRack` | `grid.truckColumns` (pilas fuera del mapa); `setDoorOpen`, `doorWalls`, `doorCells`, `DOOR_JAMB`, `DOOR_POCKET`, `railRect` |
| Interacción | `RackAim.column` / `reach` / `travel` | `RackAim.truck` / `doorway` |
| Solver (`data/levels/solver.ts`) | hueco = `cellCount + hueco`, `isSlot`, `slotFront`, `columnSlots` | columna = `bedBase + columna`, `isBed`, `bedFront`, `bedAtPose`, `bedLevels` |
| Métricas | `huecos` | `camion` |
| Render | `LevelView.buildRacks`, `RackView`, `builders/rack.ts`, `SlotMarker` | `LevelView.buildTrucks`, `TruckView`, `builders/truck.ts` |
| UI / audio | `UIState.racks` (fila F V), `ForkStepWatcher`; `slotDrop`, `slotLift` | nada en la UI; `truckDrop`, `pickup` |

Ya compartido: `SlotLight` y `RackBay` (views/RackView), las pegatinas (`buildCueFace`, `createCueMaterial`),
`views/success`, `cueFits` / `isDestined` / `satisfiesTarget` / `assignmentsOf` / `targetsOf` / `levelDestinies`
(core/sorting), `columnFrame` / `inwardHeading` (core/racks) y la puerta de reglas `usesTargetRules` (core/docks).

## Modelo

```ts
// core/types.ts (fase 2). LevelData.storage?: LevelStorage[] (ausente sin almacenaje; su orden: regla 12).
type StorageSkin = 'rack' | 'truck';                // el aspecto: dibujo + propiedades declaradas
type StorageSupport = 'shelves' | 'stack';          // baldas: cada nivel aparte · pila: de abajo arriba
type StorageAccess =
  | { kind: 'front'; facing: Facing }               // estantería: desde la casilla de delante; su celda, sólida
  | { kind: 'door'; wall: WallSide };               // camión: desde su casilla de puerta; su celda, tras el muro
interface LevelStorage {
  id: string;                                       // r1, r2… / t1, t2… (idPrefix + nº dentro de su aspecto)
  skin: StorageSkin;
  x: number; z: number;                             // primera casilla: de la estantería / primera de puerta
  w: number;                                        // columnas, una por casilla
  access: StorageAccess;
  columns: (ZoneCriteria | null)[][];               // por columna, de abajo arriba; null = «libre»
}

// core/storage.ts (fase 2): una fila por aspecto; añadir uno = una fila + su render.
const STORAGE_SKINS = {
  rack:  { support: 'shelves', maxLevels: 3, maxColumns: Infinity, access: 'front', idPrefix: 'r',
           chars: 'RSTUVWXYZKLMNO', fillToMax: false, sound: 'metal' },
  truck: { support: 'stack',   maxLevels: 2, maxColumns: 3,        access: 'door',  idPrefix: 't',
           chars: 'TCUVWXYZKLMNO',  fillToMax: true,  sound: 'wood'  },
} as const;
// fillToMax: la columna se completa con «libre» hasta min(maxLevels, limit) (fase 6). chars: letras de la forma
// canónica, las de hoy (RACK_CHARS / TRUCK_CHARS; ver «Huecos», 1).

// core/types.ts (fase 3): snapshot.storageSlots, unidad a unidad, columna a columna, de abajo arriba.
interface StorageSlotState {
  id: string;                     // `${unitId}:${column}:${level}` (slotIdOf, el mismo para todos los aspectos)
  unitId: string; skin: StorageSkin;
  column: number; level: number;  // level 0 = la balda de abajo / la plataforma
  cell: CellPos;                  // su celda: la de la estantería (dentro) o la de la caja del camión (fuera del mapa)
  front: CellPos;                 // desde dónde se carga: el frente / la casilla de puerta
  facing: Facing;                 // el lado desde el que se carga (TRUCK_FACING[wall] en el camión)
  pos: Vec2;                      // centro de `cell`
  accepts: ZoneCriteria | null;   // la pista; null = «libre»
  destined: ColorSymbol | null;   // null = «libre»
  occupiedBy: string | null;
  satisfied: boolean;
  loadable: boolean;              // regla 8
}
// BoxState.slotId: el nivel donde descansa, en cualquier aspecto (desaparece truckSlotId). Eventos: slotId / fromSlotId.
```

**Soporte** (lo decide la fila del aspecto, nunca el aspecto en sí):
- **Baldas** (`shelves`, estantería): cada nivel es un hueco aparte con su balda; se llenan y vacían en cualquier orden
  y cada uno se cumple solo. En el solver, una posición por nivel, de capacidad 1.
- **Pila** (`stack`, camión): las cajas una sobre otra, de abajo arriba. Un nivel se cumple solo si todos los de debajo
  se cumplen, y el siguiente se carga encima de una caja fija. En el solver, una posición por columna, de capacidad
  sus niveles.

**Acceso** (tabla `STORAGE_ACCESS` en `logic/`; sin casos por muro fuera de ella):

| | `front` (estantería) | `door` (camión) |
|---|---|---|
| Se encara | rumbo ≤ 30° hacia dentro; punto de horquilla a ≤ 0,35 del eje, de 0,8 delante de la cara a 1 dentro | el cuerpo en línea con su casilla de puerta; ≤ 30°; ≤ 0,5 del eje; de 0,8 delante de la línea del muro a 1 más allá |
| Se mantiene | 50°, 0,75, 1,3 | 45°, 0,6, el cuerpo aún en línea |
| Coger / dejar | horquilla en el nivel elegido (±0,25); para dejar, su punto a ≤ 0,55 delante de la cara (`RACK_DROP_REACH`) | punto de horquilla ≥ 0,3 más allá del muro (`TRUCK_REACH`); con la carga en la puerta sin llegar, nada (`doorway`) |
| Paso de la carga | la columna encarada se abre con la horquilla en su nivel y el hueco vacío; dentro, panel y montantes (`RACK_WALL`); cierra suave (`softenRack`) | el tramo de puerta de la columna encarada (`doorCells`) entre jambas (`DOOR_JAMB`) hacia el bolsillo (`DOOR_POCKET`); barandillas `dockRailsOf` |
| Rumbo fijo | con la carga dentro del hueco | con la carga pasada la línea del muro (`loadInDoor`) |
| Celda | dentro del mapa, sólida para el cuerpo y las cajas del suelo | fuera del mapa (`z = -1` / `x = -1`); la casilla de puerta es suelo |

## Reglas

1. **Unidad**: una fila recta de 1 a `maxColumns` columnas (una por casilla), cada una de 1 a `maxLevels` niveles; en
   una pila, nunca más de `limit`.
2. **Soporte**: baldas o pila (arriba).
3. **Pista** de cada nivel: color = ese color; símbolo = ese símbolo; los dos = esa caja exacta. Sin pista = «libre».
4. **Objetivos**: las zonas y cada nivel con pista de cualquier unidad (`targetsOf`: zonas y luego los niveles con pista
   en el orden de las unidades). Exactamente un reparto completo (`assignmentsOf` = 1, lo exige `validateLevel`);
   `levelDestinies` da el tipo destinado de cada objetivo. Solo su caja destinada lo cumple.
5. **Cumplido y caja fija**: un nivel con pista se cumple con su caja destinada (en una pila, además, con todo lo de
   debajo cumplido); entonces brilla y su caja queda **fija** (`locked`: no se coge). En baldas no hay «encima»; en una
   pila el nivel de encima sí se carga.
6. **Zumbido**: una caja que queda en un nivel con pista sin cumplirlo (no es la suya, o en una pila sobre algo mal)
   da `boxDropped.wrongTarget` y el zumbido suave, y se puede volver a coger. Nada visual.
7. **«Libre»**: vale cualquier caja; nunca es objetivo; nunca brilla, se bloquea, zumba ni se ilumina con P;
   `recipeLength` 0. Camión: `min(maxLevels, limit)` niveles por columna, las pistas de abajo arriba y el resto libre
   (`fillToMax`, fase 6).
8. **Cargable** (`loadable`): baldas = vacío; pila = el nivel vacío más bajo de su columna con todo lo de debajo
   cumplido. Solo decide la luz (pistas P, tono de la vista previa), nunca si se puede dejar: en una pila se deja encima
   mientras quepa, aunque lo de debajo esté mal o fijo.
9. **Horquilla por teclas** (fase 6 en el camión; hoy va sola allí): F / V / rueda (mando X / B) eligen el nivel
   (`forkLevel`) de la columna encarada; coger y dejar, solo con la horquilla en ese nivel. Baldas: cualquier hueco.
   Pila: solo el siguiente nivel libre (dejar) y la caja de arriba (coger); con la horquilla en otro nivel no hay vista
   previa ni se suelta y, si va baja, la carga choca con la caja de la plataforma, como en una estantería. Suelo: sola.
10. **Pistas P** (apagadas por defecto): con una caja en la horquilla laten los niveles `loadable` cuya pista encaja
    (`cueFits`), y si ninguno libre la toma, muy suave los ocupados que encajan sin brillar. Apagadas, nada. Nunca un
    «libre».
11. **Ids** (ninguno cambia en las fases 1–7): unidad = `idPrefix` + nº dentro de su aspecto, en orden de leyenda;
    nivel = `unidad:columna:nivel` desde 0; una estantería y un camión nunca comparten id. Cajas `b1…`: las del suelo,
    luego las de las unidades, unidad a unidad, columna a columna, de abajo arriba.
12. **Orden de las unidades**: estanterías y luego camiones (aspecto a aspecto, en el orden de `STORAGE_SKINS`; dentro
    de cada aspecto, el de la leyenda). Es el orden de hoy en ids de caja, `targetsOf`, `snapshot` y posiciones del
    solver: cambiarlo cambia el plan del Benchmark.
13. **Movimientos**: coger y dejar en otro sitio = 1 (`snapshot.moves` = la métrica `movimientos`); dejarla donde estaba
    (el mismo nivel, o la misma casilla y altura) no cuenta.

## Contratos por capa

- **core** (fase 2): `core/storage.ts` con `STORAGE_SKINS`, `storageOf(level)`, `hasStorage(level)` (hoy
  `usesTargetRules`) y la geometría genérica: `cellOf(unit, col)`, `frontOf(unit, col)`, `facingOf(unit)`,
  `inwardHeading`, `slotIdOf`, `storageColumnsOf`, `storageSlotsOf` (reutilizan las cuentas de `core/racks` y
  `core/docks`). `dockRailsOf` es del acceso `door`. `core/sorting` saca objetivos y destinos de `storageSlotsOf`.
  `racksOf` / `trucksOf` / `slotsOf` / `truckSlotsOf` quedan como envoltorios hasta la fase 7.
- **data**: `asciiLevel.ts` con la misma gramática (`estantería frente …`, `camión muelle …`), una letra por unidad y la
  misma forma canónica; produce `level.storage` (fase 2); `libre` en camiones (fase 6). `validateLevel.ts`: las reglas
  comunes salen de la fila del aspecto (niveles, columnas, pila ≤ `limit`, reparto único) y aparte van las propias de
  cada acceso (`front`: el frente es suelo; `door`: la fila 0 / columna 0, las casillas laterales con obstáculo, nada
  de ventana en la puerta); los mensajes en inglés, intactos (asciiLevel los traduce y los coloca).
- **logic**: un solo enganche (`refreshStorageAim` + `STORAGE_ACCESS`), un solo paso de carga (aberturas genéricas por
  columna en `CollisionWorld`, la celda dentro o fuera del mapa), un solo camino de coger / dejar y `refreshColumn`
  según el soporte; `LevelGrid` con columnas dentro o fuera del mapa; `snapshot.storageSlots`, `box.slotId`, eventos
  con `slotId`; el hint del nivel elegido sirve a toda unidad y dice su aspecto (hoy `hint.rack` y
  `hint.dropTruckSlotId`). Hasta la fase 6, un `autoForks` temporal deja el camión como está.
- **solver / métricas / informe / piloto** (fase 4): una tabla de posiciones tras las casillas, en el orden de las
  unidades (baldas: una por nivel; pila: una por columna); `lockedAt`, `validDrop`, `carrySearch`, `carryBackTo` y
  `pickupStarts` según el soporte y el acceso; las cotas siguen admisibles y consistentes (`levels/docks.test.ts`);
  `huecos` y `camion` dan los mismos números; el informe nombra cada unidad por su aspecto y su letra; el piloto pulsa
  F / V en toda unidad (fase 6).
- **render** (fase 5): registro `src/render/storage/` con una interfaz común por aspecto: construir la unidad (grupo,
  luz por nivel con `SlotLight`, marcador del nivel elegido, `fitBox` estático, fantasma) y la altura de la horquilla
  según el soporte (`rackSlotY` en baldas, alturas de pila en el camión). `rack` y `truck` son adaptadores de
  `RackView` / `builders/rack.ts` y de `TruckView` / `builders/truck.ts` (cartel, umbral, camión, barandillas).
  `LevelView` construye desde el registro y recorre una sola lista.
- **UI**: `UIState.storage` en lugar de `racks`; la fila «F V subir / bajar horquilla · rueda» en todo nivel con
  almacenaje (fase 6).
- **audio**: dejar / coger según `STORAGE_SKINS[skin].sound` (`metal`: `slotDrop` / `slotLift`; `wood`: `truckDrop` /
  `pickup`); campana solo con `correct`, zumbido con `wrongTarget`; el clic de F / V (`ForkStepWatcher`) en toda unidad
  (fase 6).
- **game**: `Game.matchOf` por `slotId` (`zoneMatchKinds` ya indexa por id de nivel); F / V y su clic se abren con «el
  nivel tiene almacenaje», no «tiene estanterías» (fase 6).

## Cómo añadir un aspecto nuevo

1. **Fila en `STORAGE_SKINS`**: soporte, `maxLevels`, `maxColumns`, acceso (`front` / `door` u otro nuevo),
   `idPrefix` (distinto de los demás: los ids de nivel no pueden chocar), `chars`, `fillToMax`, `sound`.
2. **Gramática**: la cabeza de su entrada en la leyenda (`asciiLevel.ts`: como `estantería frente …` / `camión muelle
   …`); columnas `|`, niveles `/`, `pista [+ caja]` y `libre` ya son comunes. Forma canónica, un ejemplo en su doc y sus
   errores en español.
3. **Validación**: solo lo propio de su sitio en el mapa; lo común sale de la fila.
4. **Acceso**: si es nuevo, una fila en `STORAGE_ACCESS` (encarar, mantener, alcance, paso de la carga) y su abertura en
   `CollisionWorld`; si no, nada en la lógica.
5. **Render**: un adaptador en `src/render/storage/<aspecto>.ts` con la interfaz común y su registro; medidas en
   `dims.ts`, colores en `Theme.<aspecto>`.
6. **Audio**: un sonido en `sfx.ts` si `sound` es nuevo.
7. **Doc**: `docs/<ASPECTO>.md` con lo propio; lo común se queda aquí.
8. **Tests**: un nivel de prueba en `src/data/levels/pruebas/` y sus tests (como `storageFixture.test.ts`). La
   caracterización de abajo no se toca: un aspecto nuevo no cambia los que ya hay.

## Red de seguridad (fase 1)

- **Caracterización** (`src/integration/storageCharacterization.ts`, su `.test.ts` y su `.json`): lo que hacen hoy el
  Benchmark y el nivel de prueba, sección a sección, en términos que sobreviven al cambio (ids de unidad y de nivel,
  casillas `x,z@altura`, zonas `[z1]`, tipos `color/símbolo`; nunca un número de posición del solver ni la forma de una
  API):
  - `storage`: las unidades con la forma de `LevelStorage`, cada caja al empezar y cada nivel (celda, frente, lado,
    pista);
  - `targets`: la puerta de reglas, cada objetivo con su destino y su timbre, el nº de repartos (1);
  - `metrics`: las métricas de `npm run levels` (sin callejones: los miran `benchmark.test.ts` y
    `storageFixture.test.ts`);
  - `solver`: el resultado exacto y su plan, jugada a jugada;
  - `start`: el estado vivo al cargar (progreso, cada nivel, cada caja);
  - `autopilot60` / `autopilot20`: el piloto a 60 y 20 fps (movimientos, frames hasta terminar, pulsaciones de F / V,
    frames marcha atrás y cada movimiento de caja).
- **Regla para las fases 2–5**: esos tests no se tocan. Si una fase renombra o junta una API, adapta
  `storageCharacterization.ts`; el JSON se queda byte a byte igual. Si falla, algo cambió: se arregla el código.
- **Fase 6**: la única que lo regenera, a propósito, revisando el diff:
  `TORO_CARACTERIZAR=1 npx vitest run src/integration/storageCharacterization.test.ts -u` (PowerShell:
  `$env:TORO_CARACTERIZAR = '1'; npx vitest run src/integration/storageCharacterization.test.ts -u;
  Remove-Item Env:TORO_CARACTERIZAR`). Con la variable, el test solo reescribe el archivo; `-u` a secas no lo toca.
- Medido (2026-09-30, fase 1): Benchmark 14 movimientos (exacto, 0 estados: la cota ya da 14), piloto 13644 frames a
  60 fps y 4991 a 20, 7 pulsaciones de F / V; nivel de prueba 9 movimientos, 6463 y 2436 frames, 3 pulsaciones.
  Probado: un cambio de 0,1 en el fondo del bolsillo de la puerta (`DOOR_POCKET`) ya cambia los frames de los dos.

## Nivel de prueba: `src/data/levels/pruebas/tres-camiones.level`

Fuera del juego: el registro (`src/data/levels/index.ts`) solo lee `*.level` y `especiales/*.level`, y `npm run levels`
/ `levels:fmt` recorren esas dos carpetas. Su forma canónica, su validez y sus números los comprueba
`src/integration/storageFixture.test.ts` (y los congela la caracterización).

```
  012345678
0 pTTpCp.R.
1 .........
2 .a......b
3 p.....c..
4 U.......1
5 p.d.S.e..
6 ...f.^.g.

1 = zona coral ●
a = caja azul ■        b = caja azul ▲        c = caja coral ◆       d = caja menta ●
e = caja amarillo ✚    f = caja coral ●       g = caja lavanda ✚
R = estantería frente sur: lavanda ✚ / libre + caja lavanda ▲
S = estantería frente norte: ◆ / libre / lavanda
T = camión muelle norte: azul / ▲ | coral ◆   C = camión muelle norte: menta + caja menta ◆
U = camión muelle oeste: amarillo ■ + caja amarillo ■ / ✚
```

- 9×7, `limit: 2`, ventana oeste 1-2. Tres camiones: T (norte, 2 columnas de 2 y 1 niveles) y C (norte, 1 × 1),
  separados por la planta de (3,0), la casilla lateral de las dos puertas; U (oeste, 1 × 2). Seis barandillas, una
  planta detrás de cada una. R: estantería de 2 alturas contra el muro norte; S: de 3, en medio.
- 10 cajas, 10 objetivos (1 zona, 3 huecos con pista, 6 niveles de camión), un solo reparto (cadena en sus `nota:`).
  Carga equivocada: el menta ◆ en C (encaja en «menta», es del «◆» de S); el amarillo ■ empieza fijo abajo en U; el
  lavanda ▲ aparcado arriba en R.
- Medido: movimientos 9 (exacto, sin búsqueda), extra 0, bloqueos 1, trampas 6, repartos 1, huecos 5 (3 con pista),
  camión 6 (4 columnas, 3 camiones, 2 cargados), libre 78 %, callejones 0 en 60 estados. El piloto lo termina a 60 y
  20 fps (F / V en las dos estanterías, marcha atrás del camión C). El render construye los tres camiones sin que se
  toquen (0,2 entre los accesos de T y C) y las dos estanterías.

## Huecos para las fases siguientes (encontrados en la fase 1)

El código de hoy aguanta el nivel de prueba sin cambios: varios camiones, norte y oeste a la vez (`doorWalls`,
`dockWalls`), una planta compartida entre dos puertas, una estantería de 2 alturas. Nada que arreglar en la fase 1.
Queda anotado:
1. **Letras canónicas**: tres camiones se escriben T, C, U, no T, U, V (`TRUCK_CHARS = 'TCUVW…'`, después de las
   letras de las estanterías; con tres estanterías, C, U, V). Cualquier letra se lee; solo cambia cuál escribe
   `levels:fmt`. Decidir en la fase 2 (`chars` por aspecto); cambiarlo reescribe los niveles con 2 camiones o más (hoy
   ninguno del juego: solo el nivel de prueba y tests como el de `asciiLevel.docks.test.ts`, «T C»).
2. **Orden de las unidades** (regla 12): `level.storage` tiene que salir estanterías primero y luego camiones, no en el
   orden de la leyenda mezclado (un `.level` no canónico puede escribir el camión antes).
3. **Camión sin «libre» por todas partes** (fase 6): `TruckCue` nunca null, `TruckSlotState.accepts` nunca null, el
   cartel pide pista a cada nivel (`LevelView.buildTrucks` → `markOf(cue)`), `Game.matchOf` → `matchKind(accepts)`,
   `zoneMatchKinds`, `validateLevel` («must ask for something») y la gramática («no hay niveles libre»).
4. **F / V solo con estanterías**: `GameState.update` descarta `forkStep` si no hay columnas de estantería; `Game`
   solo con estanterías cuenta F / V como primera entrada del cronómetro, vigila los pasos (`ForkStepWatcher`) y enseña
   la fila F V (`UIState.racks`); `hint.rack` es null ante un camión y el marcador (`SlotMarker`) solo conoce huecos.
   La fase 6 abre todo eso a «tiene almacenaje».
5. **Altura de la horquilla en el dibujo**: `ForkliftView.sync(…, atRack)` cuenta huecos (`rackSlotY`) solo ante una
   estantería; en el camión son alturas de pila. El hint unificado tiene que decir el soporte.
6. **`loadable`** solo existe en el camión; en baldas será «vacío» (regla 8), que es lo que hoy mira el render para
   los huecos.
7. **`callejones`** no sirve de objetivo `dificultad:` mientras la búsqueda no recorra todos los estados (sale «≥ 0»):
   el Benchmark y el nivel de prueba lo comprueban en su test con `deadEnds`.

## Fases

Cada fase la hace un agente en su copia aparte, desde el commit anterior; se verifica y se trae a `feat/almacenaje`.
Base: `1142b68` (lo verificado de `feat/pulido-benchmark`).

1. **Diseño y red de seguridad** — hecho: este documento, la caracterización y el nivel de prueba con sus tests.
2. **Modelo común en core y datos** — pendiente: `core/storage.ts`, `level.storage`, objetivos y destinos desde ahí;
   `racksOf` / `trucksOf` como envoltorios; los ids no cambian.
3. **Lógica, colisión y estado** — pendiente: un enganche, un paso, un camino de coger / dejar, `refreshColumn` por
   soporte, `snapshot.storageSlots`, `box.slotId`; `autoForks` temporal en el camión.
4. **Solver, métricas, informe y piloto** — pendiente: una tabla de posiciones, `lockedAt` / `validDrop` /
   `carrySearch` por soporte, el informe por aspecto.
5. **Render, UI y audio por aspecto** — pendiente: registro `src/render/storage/`, `UIState.storage`, sonido por
   aspecto.
6. **Reglas nuevas** (el único cambio de juego) — pendiente: F / V en el camión (marcador en la casilla del cartel, la
   fila F V en todo nivel con almacenaje, el piloto pulsa F / V), «libre» en todos los aspectos, relleno a 2 en el
   camión, `libre` en la gramática; volver a medir el Benchmark (`npm run levels`, `--minimos`) y regenerar la
   caracterización. Los niveles 1–3 no cambian.
7. **Limpieza y documentación** — pendiente: quitar envoltorios y duplicados (`truckSlot*`, `TRUCK_*` repetidos,
   `hasRacks` como regla de UI); RACKS.md y DOCKS.md con lo propio de cada aspecto, apuntando aquí; LEVELS.md,
   ARCHITECTURE.md y README.

Verificación de cada fase: `npx tsc --noEmit`; `npx vitest run` dos veces; `npx vite build` a una carpeta fuera del
repo; `npm run levels:fmt -- --check`; `npm run levels` (Benchmark OK 8/8, 14 movimientos, repartos 1, callejones 0; el
nivel de prueba no sale); `npm run levels -- --minimos --check`. Fases 1–5: la caracterización intacta.
