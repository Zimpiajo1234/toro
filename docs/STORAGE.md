# Almacenaje común: estanterías, camiones y los aspectos que vengan

**Estado: fase 5 de 7** (render, UI y audio por aspecto). El juego no ha cambiado. Los datos del nivel son un solo modelo
(`LevelData.storage`, `core/storage.ts`, «Fase 2: lo entregado»); la lógica, un solo camino para todo aspecto (un
enganche por la tabla `STORAGE_ACCESS`, una abertura por columna, un coger / dejar y un estado: `snapshot.storageSlots`,
`box.slotId`, `hint.storage`, «Fase 3»); el solver, las métricas y el piloto, una tabla de posiciones por soporte
(«Fase 4»); y el render, un registro de aspectos (`src/render/storage/`, «Fase 5»). Quedan las reglas nuevas (fase 6)
y la limpieza (fase 7: `racksOf` / `trucksOf` siguen como vistas de `level.storage`). Este documento fija el modelo, sus
reglas y contratos, y cómo se comprueba que por el camino nada cambia. Lo propio de cada aspecto sigue en docs/RACKS.md
(estanterías almacenables) y docs/DOCKS.md (muelles de carga).

Ojo con el nombre: `src/storage/` es el progreso guardado (ProgressStore), nada que ver con esto. Lo nuevo va en
`src/core/storage.ts`, `src/logic/storageAccess.ts` y `src/render/storage/`.

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
  camiones, tres letras; la forma canónica escribe T, C, U, ver «Huecos», 1); `libre` escrito también vale en un
  camión.
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
Las filas Datos (fase 2), Estado, Eventos, Lógica, Rejilla / colisión e Interacción (fase 3) ya son una sola; quedan
Solver y Métricas (fase 4) y Render y UI (fase 5).

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
  columns: (ZoneCriteria | null)[][];               // por columna, de abajo arriba; null = «libre» (nunca `{}`)
}

// core/storage.ts (fase 2): una fila por aspecto; añadir uno = una fila + su render.
const STORAGE_SKINS: { readonly [S in StorageSkin]: StorageSkinRow } = {
  rack:  { support: 'shelves', maxLevels: MAX_RACK_SLOTS /* 3 */, maxColumns: Infinity, access: 'front',
           idPrefix: 'r', chars: 'RSTUVWXYZKLMNO', fillToMax: false, sound: 'metal' },
  truck: { support: 'stack', maxLevels: MAX_TRUCK_LEVELS /* 2 */, maxColumns: MAX_TRUCK_COLUMNS /* 3 */,
           access: 'door', idPrefix: 't', chars: 'TCUVWXYZKLMNO', fillToMax: true, sound: 'wood' },
};
const STORAGE_SKIN_ORDER = Object.keys(STORAGE_SKINS);   // ['rack', 'truck']: el orden de la regla 12
// fillToMax: la columna se completa con «libre» hasta min(maxLevels, limit) (fase 6). sound: fase 5. chars: letras de
// la forma canónica, las de antes (RACK_CHARS / TRUCK_CHARS; ver «Huecos», 1).
// La geometría, una para todos (fase 2): facingOf(unit), cellOf(unit, col), frontOf(unit, col), inwardHeading(facing),
// slotIdOf; y, aplanadas en el orden de la regla 12:
interface StorageColumnRef { unit; unitIndex; column; cell; front; facing; cues; firstSlot }   // storageColumnsOf
interface StorageSlotRef { id; unit; unitIndex; column; level; cell; front; facing; cue }       // storageSlotsOf

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
// BoxState.slotId: el nivel donde descansa, en cualquier aspecto (desaparece truckSlotId).
// Eventos (fase 3): boxPicked.fromSlotId, boxDropped.slotId, zoneReleased.slotId y, con cada uno, `skin` (el aspecto
// de su unidad: el audio y el render lo leen sin buscar el nivel).
// hint.storage (fase 3, en lugar de hint.rack y hint.dropTruckSlotId): la columna donde trabaja y el nivel elegido.
interface StorageHint { unitId; skin; column; levels; level; slotId; ready }
// Estantería: mientras la encara o la mantiene (y no levanta ahí una caja del suelo), el nivel de F / V. Camión (hasta
// la fase 6, `autoForks`): solo cuando la carga caería ahí, a su nivel, con `ready` true; si no, null.
// core/sorting (fase 3): LevelTarget { kind: 'zone' | 'slot'; id; index; skin; criteria } (index en level.zones o en
// storageSlotsOf; skin null en una zona) y LevelDestinies { zones; slots } (slots en el orden de storageSlotsOf).
```

**Soporte** (lo decide la fila del aspecto, nunca el aspecto en sí):
- **Baldas** (`shelves`, estantería): cada nivel es un hueco aparte con su balda; se llenan y vacían en cualquier orden
  y cada uno se cumple solo. En el solver, una posición por nivel, de capacidad 1.
- **Pila** (`stack`, camión): las cajas una sobre otra, de abajo arriba. Un nivel se cumple solo si todos los de debajo
  se cumplen, y el siguiente se carga encima de una caja fija. En el solver, una posición por columna, de capacidad
  sus niveles.

**Acceso** (tabla `STORAGE_ACCESS` en `logic/storageAccess.ts`, fase 3; sin casos por muro fuera de ella). Sus campos:
`faceAngle` / `faceLateral` / `faceNear` / `faceFar` (se encara), `holdAngle` / `holdLateral` / `holdNear` (se
mantiene; lo más lejos, `faceFar`), `bodyInLine`, `actsHeld` (coge y deja también solo mantenida), `pickReach` /
`dropReach` (hondura del punto de horquilla para coger / dejar), `doorway` y el temporal `autoForks`. El orden de sus
claves es la prioridad del enganche (una estantería antes que un camión, como siempre):

| | `front` (estantería) | `door` (camión) |
|---|---|---|
| Se encara | rumbo ≤ 30° hacia dentro; punto de horquilla a ≤ 0,35 del eje, de 0,8 delante de la cara a 1 dentro | el cuerpo en línea con su casilla de puerta; ≤ 30°; ≤ 0,5 del eje; de 0,8 delante de la línea del muro a 1 más allá |
| Se mantiene | 50°, 0,75, 1,3 | 45°, 0,6, 0,8, el cuerpo aún en línea |
| Coger / dejar | solo encarada, horquilla en el nivel elegido (±0,25); para dejar, su punto a ≤ 0,55 delante de la cara (`dropReach` −0,55; `pickReach` −0,8: donde la encara) | encarada o mantenida; punto de horquilla ≥ 0,3 más allá del muro (`pickReach` = `dropReach` = 0,3); con la carga en la puerta sin llegar, nada (`doorway`) |
| Horquilla | por teclas: F / V / rueda (`forkLevel`) | sola, como en una pila del suelo: `autoForks`, TEMPORAL hasta la fase 6 |
| Paso de la carga | la columna encarada se abre con la horquilla en su nivel y el hueco vacío; dentro, panel y montantes (`RACK_WALL`); cierra suave (`CollisionWorld.soften`) | el tramo de puerta de la columna encarada (`doorCells`) entre jambas (`DOOR_JAMB`) hacia el bolsillo (`DOOR_POCKET`); barandillas `dockRailsOf` (por `unitId`) |
| Rumbo fijo | con la carga dentro del hueco abierto (`loadInside`) | con la carga pasada la línea del muro (`loadInDoor`); los dos, `loadInOpening` |
| Celda | dentro del mapa, sólida para el cuerpo y las cajas del suelo; sus cajas no chocan solas | fuera del mapa (`z = -1` / `x = -1`); la casilla de puerta es suelo; sus cajas, una pila como la del suelo |

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

- **core** (fase 2, hecho): `core/storage.ts` con `STORAGE_SKINS`, `STORAGE_SKIN_ORDER`, `storageOf(level)`,
  `hasStorage(level)` y la geometría genérica: `cellOf(unit, col)`, `frontOf(unit, col)`, `facingOf(unit)`,
  `inwardHeading(facing)` y `slotIdOf` (los de `core/racks`, reexportados), `storageColumnsOf`, `storageSlotsOf`
  (sobre `rackCellOf` / `frontCellOf` / `truckCellOf` / `truckFrontOf` / `TRUCK_FACING`). `core/storage` está por
  encima de `core/racks` y `core/docks` (sin ciclos): sus envoltorios leen `level.storage` a mano y
  `usesTargetRules` (core/docks) es la misma prueba que `hasStorage`, con su nombre de antes. `dockRailsOf` es del
  acceso `door`: recorre las unidades con puerta (`truckIndex` = su índice entre ellas = el de `trucksOf`).
  `core/sorting` saca objetivos, destinos, `zoneMatchKinds` y `usesSymbols` de `storageSlotsOf` / `storageOf`, con las
  formas de antes (`LevelTarget.kind` `'slot'` / `'truck'` según el aspecto, `index` dentro de su aspecto;
  `LevelDestinies.slots` / `.trucks`) hasta la fase 3. `racksOf` / `trucksOf` / `hasRacks` / `hasTrucks` / `slotsOf` /
  `truckSlotsOf` / `truckColumnsOf` quedan como vistas de `level.storage` hasta la fase 7 (derivadas en cada llamada;
  un «libre» sale `{}`); `LevelRack` / `LevelTruck` / `RackSlot` / `TruckCue`, solo como sus tipos.
- **data** (fase 2, hecho): `asciiLevel.ts` con la misma gramática (`estantería frente …`, `camión muelle …`), una
  letra por unidad (de `STORAGE_SKINS[skin].chars`) y la misma forma canónica; lee las unidades aspecto a aspecto (regla
  12, aunque la leyenda ponga antes un camión) y su borrador (`parseLevelDraft`) ya trae `storage`; `libre` en camiones
  (fase 6). `validateLevel.ts` lee `storage` (la forma de `LevelData`: `validateLevel(level)` devuelve el nivel) o, de
  un nivel JSON antiguo, `racks` y `trucks` (nunca los dos a la vez), ordena las unidades por aspecto (orden estable) y
  da `storage`; las reglas comunes salen de la fila del aspecto (niveles, columnas, id por defecto, ids únicos entre
  aspectos, pila ≤ `limit` y cajas una sobre otra según el soporte, reparto único) y aparte van las propias de cada
  acceso (`front`: sus casillas y el frente es suelo; `door`: la fila 0 / columna 0, las casillas laterales con
  obstáculo, nada de ventana en la puerta). Los mensajes en inglés, intactos (asciiLevel los traduce y los coloca):
  cada unidad se nombra por su aspecto (`racks[i]` / `trucks[i]` = la i-ésima de ese aspecto, también desde `storage`;
  sus palabras en `SKIN_WORDS`). Nuevos, solo para `storage`: `storage and the legacy racks / trucks lists do not mix…`,
  `storage[i].skin must be rack or truck`, `racks[i].access.kind must be "front"…`, `racks[i].access.facing …` /
  `trucks[i].access.wall …`. Hasta la fase 6, un camión sin pista sigue siendo un error (`must ask for something`).
- **logic** (fase 3, hecho): un solo enganche (`GameState.refreshStorageAim` + `STORAGE_ACCESS`), un solo paso de
  carga (`refreshStoragePassage` sobre las aberturas de `CollisionWorld`), un solo camino de coger / dejar
  (`Interaction.findPickTarget` / `findDrop` sobre `StorageAim`; `GameState.pick` / `dropInStorage`) y `refreshColumn`
  según el soporte; `LevelGrid.columns`, una lista de columnas dentro o fuera del mapa; `snapshot.storageSlots`,
  `box.slotId`, eventos con `slotId` / `fromSlotId` y `skin`; `hint.storage` sirve a toda unidad y dice su aspecto (en
  lugar de `hint.rack` y `hint.dropTruckSlotId`). Hasta la fase 6, `STORAGE_ACCESS.door.autoForks` deja el camión como
  está. Detalle y decisiones: «Fase 3: lo entregado».
- **solver / métricas / informe / piloto** (fase 4): una tabla de posiciones tras las casillas, en el orden de las
  unidades (baldas: una por nivel; pila: una por columna); `lockedAt`, `validDrop`, `carrySearch`, `carryBackTo` y
  `pickupStarts` según el soporte y el acceso; las cotas siguen admisibles y consistentes (`levels/docks.test.ts`);
  `huecos` y `camion` dan los mismos números; el informe nombra cada unidad por su aspecto y su letra; el piloto pulsa
  F / V en toda unidad (fase 6).
- **render** (fase 5, hecho): registro `src/render/storage/` (`STORAGE_RENDER`) con una interfaz común por unidad:
  construirla desde su `LevelStorage` y sus niveles (grupo, luz por nivel con `SlotLight`, sitio del marcador del nivel
  elegido, `fitBox` estático, piezas que se vuelven fantasma, sitio del estallido) y la altura por soporte
  (`SUPPORT_LOOK`: `rackSlotY` en baldas, alturas de pila en el camión) para la caja, la horquilla y la vista previa.
  `rack` y `truck` son adaptadores de `RackView` / `builders/rack.ts` y de `TruckView` / `builders/truck.ts` (cartel,
  placa, camión, barandillas; la puerta, en el muro por el acceso `door`). `LevelView` construye desde el registro y
  recorre una sola lista. Detalle: «Fase 5: lo entregado».
- **UI** (fase 5, hecho): `UIState.storage` en lugar de `racks` (el nivel tiene unidades con la horquilla por teclas:
  `logic/storageAccess` `hasKeyedForks`); la fila «F V subir / bajar horquilla · rueda» en todo nivel con almacenaje
  llega sola cuando la fase 6 quite `autoForks`.
- **audio**: dejar / coger según `STORAGE_SKINS[skin].sound` (`metal`: `slotDrop` / `slotLift`; `wood`: `truckDrop` /
  `pickup`; hecho en la fase 3: el evento trae `slotId` y `skin`); campana solo con `correct`, zumbido con
  `wrongTarget`; el clic de F / V (`ForkStepWatcher`, sobre `hint.storage`) donde la horquilla va por teclas (fase 5:
  `hasKeyedForks`; en toda unidad, fase 6).
- **game**: `Game.matchOf` por `slotId` (hecho en la fase 3: `zoneMatchKinds` ya indexa por id de nivel); F / V y su
  clic se abren con «el nivel tiene unidades con la horquilla por teclas» (`hasKeyedForks`, fase 5), no «tiene
  estanterías»; con la fase 6, «tiene almacenaje».

## Cómo añadir un aspecto nuevo

1. **Fila en `STORAGE_SKINS`**: soporte, `maxLevels`, `maxColumns`, acceso (`front` / `door` u otro nuevo),
   `idPrefix` (distinto de los demás: los ids de nivel no pueden chocar), `chars`, `fillToMax`, `sound`.
2. **Gramática**: la cabeza de su entrada en la leyenda (`asciiLevel.ts`: como `estantería frente …` / `camión muelle
   …`) y sus palabras en `UNIT_WORDS` (el nombre, el artículo, la concordancia); columnas `|`, niveles `/`,
   `pista [+ caja]` y `libre` ya son comunes. Forma canónica, un ejemplo en su doc y sus errores en español.
3. **Validación**: solo lo propio de su sitio en el mapa; lo común sale de la fila. Sus palabras en inglés en
   `SKIN_WORDS` (`validateLevel.ts`) y, si trae mensajes nuevos, su sitio en `explainValidation`.
4. **Acceso**: si es nuevo, una fila en `STORAGE_ACCESS` (encarar, mantener, alcance, paso de la carga) y su abertura en
   `CollisionWorld`; si no, nada en la lógica.
5. **Render** (el registro `src/render/storage/`, fase 5):
   - sus constructores en `src/render/builders/<aspecto>.ts` (y, si hace falta, su vista en `views/`), que leen la
     unidad tal cual (como `RackShape` / `DockShape`: `null` = «libre»); medidas en `dims.ts`, colores en
     `Theme.<aspecto>`;
   - un adaptador `src/render/storage/<aspecto>.ts` que exporte su `StorageSkinRender`: `builder(ctx)` devuelve un
     constructor que, unidad a unidad (en el orden del almacenaje), crea su `StorageUnitView`: `group` (con su id en
     `userData`), `bounds`, `fitBox` estático, `occluders`, `beyondWall` (si queda tras un muro), `syncSlot` / `playWave`
     (un `SlotLight` por nivel con pista, por id: `common.ts` `levelLightOf`, pegatina con `cueLookOf`), `burstAt`,
     `markerAt` (null si su horquilla no va por teclas) y `hidesActorAt`; opcionales `paintFloor` (pintura en el suelo)
     y `markerGeometry` (su marcador del nivel elegido, uno por aspecto);
   - su entrada en `STORAGE_RENDER` (`src/render/storage/index.ts`): el tipo obliga a tener una por fila de
     `STORAGE_SKINS`. Las alturas salen del soporte (`SUPPORT_LOOK`); un soporte nuevo, una fila allí. LevelView, BoxView
     y ForkliftView no cambian;
   - si su acceso es `door`, la puerta del muro ya la abre `builders/walls` (`wallLayouts`, por acceso).
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
  `storageCharacterization.ts`; el JSON se queda byte a byte igual. Si falla, algo cambió: se arregla el código. (Fase
  2: `storageSection` lee ya `storageOf` / `storageSlotsOf` y `targetsSection`, `hasStorage`; el JSON y su test, tal
  cual, y pasan: el modelo nuevo da justo las unidades y los niveles congelados en la fase 1. Fase 3: `boxAt` lee
  `box.slotId`; `targetsSection` cuenta huecos y niveles de camión por `skin` y lee `destinies.slots`; `startSection`,
  `snapshot.storageSlots` (con `loadable` solo en las pilas, como antes); el registro del piloto, `slotId`. El JSON, tal
  cual, y pasa entero: los mismos frames del piloto a 60 y 20 fps.)
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

## Fase 2: lo entregado (2026-09-30)

- **Datos**: `LevelData.storage?: LevelStorage[]` es la única fuente del almacenaje en los datos del nivel (en lugar de
  `racks?` / `trucks?`, en su sitio: justo después de `shelves`). Los tipos de «Modelo», en `core/types.ts`.
- **core**: `core/storage.ts` y `core/storage.test.ts` (la tabla, el orden, `storageOf` / `hasStorage`, la geometría y
  las listas aplanadas, probadas con un nivel sintético de cuatro estanterías, los cuatro frentes, y dos camiones, los
  dos muros; las vistas y `core/sorting` contra él). `core/racks` y `core/docks`: sus funciones de nivel, vistas de
  `level.storage`. `core/sorting`: desde `storageSlotsOf`.
- **data**: `asciiLevel.ts` (una sola lectura de unidades, `checkRun` por acceso, las letras y los ids por la tabla) y
  `validateLevel.ts` (las dos formas de entrada, reglas por fila y por acceso); `src/data/levelStorage.test.ts`.
- **Lecturas directas de `level.racks` / `level.trucks`** fuera de core y data: solo dos (`GameState`, `dockWalls`;
  `LevelView`, las estanterías), ahora `trucksOf` / `racksOf`; en `scripts/` y `dev/`, ninguna.
- **Tests** adaptados a mano, sin cambiar nada de lo que comprueban: cada lectura de `level.racks` / `level.trucks`,
  por `racksOf` / `trucksOf` (también dos líneas de `storageFixture.test.ts`); los niveles escritos a mano con
  `racks:` / `trucks:`, con `storage` (los tests de core/racks, core/docks, `collision.test.ts` y el `NORTH_LEVEL` de
  `asciiLevel.docks.test.ts`); el orden de claves, `storage`. Los niveles JSON con `racks` / `trucks` (`makeLevel`, los
  tests de validateLevel) siguen igual.
- **Decidido**: las letras canónicas no cambian («Huecos», 1); «libre» se escribe `null` en `storage` (`{}` también se
  lee: la forma antigua) y las vistas lo devuelven `{}`; un JSON trae `storage` o `racks` / `trucks`, nunca los dos.
- **Medido**: como en la fase 1. 1111 tests (los 1091 de antes y 20 nuevos), dos veces; `npm run levels`, la misma
  tabla (solo cambian los ms), Benchmark OK 8/8, 14 movimientos, repartos 1, callejones 0 (60); `levels:fmt`, los 4
  canónicos; los mínimos, al día.

## Fase 3: lo entregado (2026-09-30)

- **Estado** (`core/types.ts`): `StorageSlotState` y `snapshot.storageSlots` (en lugar de `SlotState` / `slots` y
  `TruckSlotState` / `truckSlots?`; sin el `wall` del camión: lo dice su `facing`), un solo `BoxState.slotId` (sin
  `truckSlotId`), `StorageHint` / `hint.storage` (en lugar de `RackHint` / `hint.rack` y `hint.dropTruckSlotId`) y los
  eventos con `slotId` / `fromSlotId` + `skin` (sin `truckSlotId` / `fromTruckSlotId`). Ya no hay campos opcionales
  «solo en niveles con camión»: sin almacenaje, `storageSlots` vacío, `hint.storage` null y todo `slotId` null.
- **core/sorting**: `LevelTarget` con `kind` `'zone'` / `'slot'` y `skin`, `index` en `storageSlotsOf`; `LevelDestinies`
  = `{ zones, slots }`. **core/docks**: `DockRail.unitId` (en lugar de `truckIndex`).
- **Rejilla** (`logic/grid.ts`): `LevelGrid.columns` (`StorageColumn`: unidad, aspecto, soporte, acceso, celda dentro o
  fuera del mapa, `levels`, `firstSlot`) en lugar de `columns` + `truckColumns`. Las cajas, por soporte: en baldas una
  por nivel (`slotBox`); en pila, la pila de su columna, que responden las consultas de pila por celda (`height`,
  `boxAt`, `baseAt`, `stackAt`, `pushBox`, `popBox`, `capacity`; `isStackColumn`) como una del suelo. Nuevos:
  `columnAt` (cualquier celda), `canStore`, `putBox`, `takeBox`.
- **Enganche** (`GameState.refreshStorageAim`): un solo `engaged` / `facing` / `forkLevel` para toda columna, acceso a
  acceso en el orden de `STORAGE_ACCESS` (encarar antes que mantener, como antes: la estantería gana). `StorageAim`
  (`logic/interaction.ts`, en lugar de `RackAim`): `column`, `level` (el de F / V, o donde va sola la horquilla:
  `autoLevel`), `reach` y `blocked` (antes `travel` o `doorway`).
- **Colisión** (`logic/collision.ts`): una abertura por columna de almacenaje (`StorageOpening`: `front` = su celda con
  panel y montantes, `door` = su tramo de puerta) y una API: `columnCount`, `opening`, `setOpen`, `isOpen`, `soften`,
  `openingInset` (en lugar de `rackCell` / `setRackOpen` / `softenRack` / `rackInset` y `doorCell` / `setDoorOpen` /
  `doorCount`). El constructor recibe `StorageColliders` (`openings`, `doors`, `shelfSlots`). Una caja no choca sola si
  descansa en una balda (`shelfSlots`); en una pila (el camión), su base choca como en el suelo.
- **Coger / dejar**: `Interaction` solo deja coger la caja que el aim señala (en baldas, la del nivel; en pila, la de
  arriba) y dejar en `canStore`; `GameState.pick` / `dropInStorage` para todo aspecto; `refreshColumn` por soporte
  (baldas: nivel a nivel, `loadable` = vacío; pila: acumulado, el siguiente sobre una caja fija, `loadable`).
- **Horquilla**: `forkLevel` y F / V donde la horquilla va por teclas (hoy, las estanterías: `forkKeys`, `forksKeyed`);
  `STORAGE_ACCESS.door.autoForks` (TEMPORAL, marcado para quitar en la fase 6) deja la del camión sola, con sus ramas en
  `GameState` (`autoLevel`, `fillStorageHint`, `forksKeyed`).
- **Consumidores**, a mano y sin cambiar nada: `LevelView` (las luces por aspecto, las alturas y fantasmas por soporte
  con `shelfSlots`; `hint.storage`), `BoxView` (`shelfSlots`: `rackSlotY` solo en baldas), `ForkliftView`
  (`atRack` = hint de soporte `shelves`), `SlotMarker` / `RackView` (`StorageSlotState`), `AudioEngine`
  (`STORAGE_SKINS[skin].sound`), `ForkStepWatcher` (`StorageAt`, por `unitId`), `Game.matchOf` (por `slotId`), el
  piloto (`hint.storage`), el solver (compila: lee los destinos por id), métricas (`trampas` por `skin`) y
  `validateLevel` (niveles de camión por `skin`, barandillas por `unitId`).
- **Decidido**: los eventos llevan `skin` junto al id (el audio no lee el nivel; el render mira `shelfSlots`); el hint
  del camión solo existe con una descarga posible, como el `dropTruckSlotId` de antes (la fase 6 lo abre a «enganchado»,
  como la estantería); `loadInside` (estantería) y `loadInDoor` (camión) siguen siendo dos medidas del «la carga está
  dentro», con la aritmética de antes, para que los frames del piloto no cambien.
- **Tests**: adaptados a los nombres nuevos sin cambiar lo que comprueban (también seis líneas de
  `storageFixture.test.ts`: barandillas por `unitId`, objetivos por `skin`, destinos en `slots`, eventos por `skin`);
  nuevos: `logic/grid.test.ts` (la lista de columnas y las cajas por soporte), `logic/storageAccess.test.ts` (la tabla)
  y, en `collision.test.ts`, las cajas en baldas y en pila.
- **Medido**: la caracterización, tal cual y en verde (el JSON sin tocar); 1116 tests (los 1111 de antes y 5 nuevos),
  dos veces; `npm run levels`, la misma tabla (Benchmark OK 8/8, 14 movimientos, repartos 1, callejones 0 (60));
  `levels:fmt`, los 4 canónicos; los mínimos, al día. En el navegador (servidor propio en el puerto 4186, pestaña
  propia): el piloto grabado a 20 fps (4991 frames) reproducido en el `Game` real sobre el Benchmark lo termina, 14
  movimientos y 12/12 objetivos, hasta la tarjeta final, sin un error en la consola.

## Fase 4: lo entregado (2026-09-30)

- **Una tabla de posiciones** (`data/levels/solver.ts`, `LevelGrid`): tras las casillas, cada columna de
  `storageColumnsOf` en su orden (regla 12), según el soporte de su unidad: baldas, una posición por nivel (capacidad
  1); pila, una por columna (capacidad = sus niveles, nunca el `limit`). Así salen los mismos números de antes
  (estanterías, hueco a hueco, y luego camiones, columna a columna): los mismos textos de estado, el mismo orden de
  búsqueda. `grid.columns` (`GridColumn`: `ref` = su `StorageColumnRef`, `support`, `positions`) y un solo juego de
  datos por posición: `kind` (`POS_FLOOR` / `POS_SHELF` / `POS_STACK`), `capacity` (el `limit` en el suelo), `front`
  (la casilla desde la que se carga), `inward` (la dirección hacia dentro) y `steps` (el tipo destinado de cada nivel,
  leído por su índice en `storageSlotsOf`: `LevelDestinies.slots[firstSlot + nivel]`, nunca por aspecto ni por id); por
  pose, `columnAtPose` (la columna que se carga desde esa pose: su frente, mirando hacia dentro). Consultas:
  `isStorage`, `columnOfPos`, `posOf`, `positionOfSlot` (por id de nivel), `levelAt` / `slotAt` (posición + altura →
  nivel / índice en `storageSlotsOf`), `cellOfPos`, `accessOf`, `inMap`. Fuera: `slotCount`, `bedBase`, `racks`,
  `columnAt`, `columnDir`, `columnSlots`, `slotCell` / `slotFront` / `slotDir`, `bedLevels`, `bedFront`, `bedDir`,
  `bedCells`, `bedAtPose`, `isSlot`, `isBed` y `capacity()` (ahora un array).
- **Reglas por soporte** (sin un caso por aspecto): `lockedAt`, en una zona o una balda, su caja destinada sola; en una
  pila, toda su pila en su prefijo correcto (y no vacía). `validDrop`: nunca lleno (`capacity`); en el suelo, ni celda
  sólida ni encima de una caja fija; en almacenaje, siempre que quepa (una pila carga su siguiente nivel sobre una caja
  fija). **Por acceso** (el frente de la columna, `front` / `inward`, igual en `front` y en `door`): `carrySearch` carga
  una columna solo con un paso adelante desde la casilla de detrás de su frente, mirando hacia dentro (cualquier balda
  vacía de la columna, encima de una pila con sitio; nunca con un giro ni de lado); una caja recién sacada
  (`columnAtPose[pose] ≥ 0`) solo sale marcha atrás; `chainTo`, `carryBackTo`, `pickupStarts` y `deadEnds`, lo mismo.
  Las cotas (`destTerm`, `targetDestinations`: una pila nunca es nodo de un ciclo) no cambian: admisibles y consistentes
  (`levels/docks.test.ts`).
- **Métricas** (`metrics.ts`): un recuento por aspecto, igual para todos (`storageCounts`: unidades, columnas,
  niveles, con pista, cargados al empezar); `huecos` y `camion` son sus dos vistas publicadas (los mismos números).
  `trampas` y `ambiguas`, por tipo de pista `[aspecto, color, símbolo]` (en una pila, también su altura), sin ramas por
  aspecto; `hasStorage` en lugar de `usesTargetRules` (también en el solver).
- **Informe** (`report.ts`): cada unidad por la palabra de su aspecto y su letra (`PLAN_WORDS`: la letra de su casilla,
  o de su frente si queda tras el muro) y según su soporte: una balda es un sitio («hueco 2 de R»), una pila nombra la
  unidad y la altura («camión T, nivel 2»). El mismo texto de antes.
- **Piloto** (`integration/autopilot.ts`): `liveStacks` por `slotId` (`positionOfSlot`), la caja a coger por su nivel
  (la de arriba en una pila) y F / V donde la horquilla va por teclas (`!STORAGE_ACCESS[acceso].autoForks`; el nivel,
  genérico: `slotAt(posición, altura)`). El camión, sin teclas hasta la fase 6: los mismos frames.
- **Mínimos**: nada que cambiar (solo usan `minMoves`).
- **Caracterización**: `solverSection` nombra las posiciones con `slotAt` (el nivel en que queda o de donde sale la
  caja); el JSON, tal cual, y pasa entero.
- **Tests**: adaptados sin cambiar lo que comprueban (`docks.test.ts`, `racks.test.ts`, `benchmark.test.ts` y siete
  líneas de `storageFixture.test.ts`: pilas por `kind`, unidades por `columnOfPos`); nuevo `data/levels/storage.test.ts`
  (8): la tabla del nivel de prueba (columnas, posiciones seguidas, capacidades 1,1,1,1,1,2,1,1,2, frente y dirección,
  una pose por columna, ida y vuelta nivel ↔ posición, destinos por índice) y un nivel mixto (estantería de 2 alturas y
  camión de 2 columnas): bloqueo y descargas por soporte, salida solo marcha atrás, carga solo por el frente, 3
  movimientos exactos, métricas e informe.
- **Medido**: 1124 tests (los 1116 de antes y 8 nuevos), dos veces; la caracterización en verde sin tocar el JSON;
  `npm run levels`, la misma tabla y el mismo plan de 14 movimientos (Benchmark OK 8/8, repartos 1, callejones 0 (60));
  `levels:fmt`, los 4 canónicos; los mínimos, al día. Tiempo: el mismo trabajo (callejones: 49 360 estados, 274
  comprobaciones completas) y, alternando solver viejo y nuevo en un mismo proceso, tiempo de CPU nuevo / viejo 1,00;
  el absoluto depende de la carga del equipo (el Benchmark tardó 2,5–2,8 s al empezar y ~10–13 s después, con los dos).

## Fase 5: lo entregado (2026-09-30)

- **Registro** (`src/render/storage/`): `STORAGE_RENDER` (`index.ts`), una entrada por fila de `STORAGE_SKINS`
  (`StorageSkinRender`: `builder(ctx)` y, opcionales, `paintFloor` y `markerGeometry`), y una interfaz común por unidad
  (`StorageUnitView`, `types.ts`): `group` (con `rackId` / `truckId`), `bounds` (sombras), `fitBox` estático,
  `occluders` (bahías de la estantería, cartel del camión), `beyondWall` (el muro tras el que queda: acceso `door`),
  `syncSlot` / `playWave` (un `SlotLight` por nivel con pista, por id), `burstAt`, `markerAt` (null donde la horquilla
  no va por teclas) y `hidesActorAt` (la caja de una balda se vuelve fantasma con su pieza). `StorageBuildContext` es
  lo que LevelView presta (nivel, tema, materiales, `ResourceBag`, `depthOnly`, retardo de aterrizaje, altura de caja,
  tonos, `markOf`, `wall(side)`); `common.ts`, lo que comparten los aspectos (metal pintado, `cueLookOf`,
  `levelLightOf`, `yawTowardCamera`). Un constructor por aspecto y nivel: sus unidades comparten geometrías.
- **Alturas por soporte** (`support.ts`, `SUPPORT_LOOK`): `shelves` = cada nivel una balda propia (`levelY` =
  `rackSlotY`), `stack` = alturas de una pila del suelo (`nivel · altura de caja`). `BoxView` (soporte por id de nivel,
  en lugar de `shelfSlots`), `ForkliftView.sync(…, support)` (en lugar de `atRack`) y la vista previa de `LevelView`
  leen de ahí, nunca el aspecto.
- **Adaptadores**: `rack.ts` sobre `builders/rack` y `views/RackView` (bahías, paneles del fondo, placas transparentes
  de los extremos, pegatinas, bandas, la línea de carga del suelo y el marcador `SlotMarker`); `truck.ts` sobre
  `builders/truck` y `views/TruckView` (placa del muelle, camión fuera, cartel con sus casillas, barandillas de
  `dockRailsOf`; sigue a su muro). Los constructores leen `RackShape` / `DockShape` (una unidad, o `LevelRack` /
  `LevelTruck`, que valen igual), así que el adaptador les pasa la unidad tal cual. La puerta del muelle sigue en el
  muro (`builders/walls` `wallLayouts`), ahora por acceso: toda unidad `door` de `storageOf` (sin `trucksOf`).
- **LevelView**: `buildStorage` construye cada unidad por el registro, en el orden del almacenaje (sin `buildRacks` /
  `buildTrucks`, sin `racksOf` / `trucksOf` ni `dockRailsOf`, `hasStorage` en lugar de `usesTargetRules`); una sola
  lista (`snapshot.storageSlots`) para luces, `satisfied`, estallido y ola final, sin ramas por aspecto (las pistas P,
  igual); un marcador por aspecto que lo tiene (hoy, uno para las estanterías), donde lo pone su unidad; los muros de
  las unidades `beyondWall` recortan lo que queda tras ellos, como antes los del camión.
- **UI / game**: `UIState.storage` (en lugar de `racks`) = el nivel tiene unidades con la horquilla por teclas
  (`logic/storageAccess` `hasKeyedForks`: alguna unidad cuyo acceso no es `autoForks`; hoy, justo los niveles con
  estanterías). `Game` lo publica al cargar y con él cuenta F / V como primera entrada del cronómetro y deja sonar el
  clic de `ForkStepWatcher`. El audio ya elegía el sonido por `skin` (`STORAGE_SKINS[skin].sound`): tal cual.
- **Decidido**: la puerta del muelle se queda en el muro y la abre el acceso, no el aspecto (la lógica abre el muro a
  toda unidad `door`; si un aspecto quisiera otra puerta, pasaría al registro); el marcador es uno por aspecto (su
  geometría es del aspecto) y lo coloca la unidad (`markerAt`); el orden de construcción (unidad a unidad, y dentro de
  cada una el de antes) deja la escena y el orden de dibujo como estaban, así que los píxeles no cambian; un nivel
  «libre» de un camión (fase 6) ya no tiene luz y su casilla del cartel sale lisa (`buildSignFrame`), como el hueco
  «libre» de una estantería (hoy no ocurre: la validación exige pista); `hasKeyedForks` vive junto a `STORAGE_ACCESS`
  (lo lee `Game`) y el render decide el marcador por su registro, sin leer la lógica.
- **Tests**: nuevo `src/render/storage/storage.test.ts` (7: una entrada por aspecto y marcador solo donde la horquilla
  va por teclas; alturas y horquilla por soporte; las dos construyen cada unidad desde su `LevelStorage` y sus niveles;
  marcador y estallido; luces por id de nivel; un almacén sintético con cuatro camiones, dos en cada muro, y
  estanterías de 2 y 3 niveles, montado en `LevelView` desde cuatro cámaras; el marcador solo en una estantería, nunca
  en un camión); `logic/storageAccess.test.ts` (+1, `hasKeyedForks`). Adaptados: `Game.test.ts` y `Overlay.test.ts`
  (`storage` en lugar de `racks`). Los tests de `RackView`, `TruckView`, `LevelView`, las pistas y
  `storageFixture.test.ts`, sin tocar.
- **Medido**: la caracterización, tal cual y en verde (el JSON sin tocar); 1124 tests (los 1116 de antes y 8 nuevos),
  dos veces; `npm run levels` y los mínimos, al día. En el navegador (servidor propio en el puerto 4187, pestaña
  propia), antes (`5567137`) y después: el Benchmark y el nivel de prueba desde tres cámaras (45°, −45°, 135°), capturas
  idénticas byte a byte; y el piloto grabado del Benchmark reproducido en el `Game` real a 20 fps (5060 frames, la
  cámara girada tres veces por el camino): el hash de 1 de cada 5 frames (1012), idéntico, y seis capturas de momentos
  clave (marcador en una estantería, carga hacia el camión, primer nivel de camión y primer hueco encendidos, ola
  final), idénticas.

## Huecos para las fases siguientes

Encontrados en la fase 1. El código de entonces aguantaba el nivel de prueba sin cambios: varios camiones, norte y oeste
a la vez (`doorWalls`, `dockWalls`), una planta compartida entre dos puertas, una estantería de 2 alturas. Quedó
anotado:
1. **Letras canónicas** (decidido en la fase 2: se quedan): tres camiones se escriben T, C, U, no T, U, V
   (`STORAGE_SKINS.truck.chars = 'TCUVW…'`, después de las letras de las estanterías; con tres estanterías, C, U, V).
   Cualquier letra se lee; solo cambia cuál escribe `levels:fmt`, y así la forma canónica de todos los niveles sigue
   igual (el nivel de prueba, «T C» en `asciiLevel.docks.test.ts`).
2. **Orden de las unidades** (regla 12; hecho en la fase 2): `level.storage` sale estanterías primero y luego camiones
   aunque un `.level` no canónico escriba antes el camión (`asciiLevel` lee aspecto a aspecto, `validateLevel` ordena
   un `storage` dado a mano; lo prueba `levelStorage.test.ts`).
3. **Camión sin «libre» por todas partes** (fase 6): `TruckCue` nunca null, `TruckSlotState.accepts` nunca null,
   `Game.matchOf` → `matchKind(accepts)`, `zoneMatchKinds`, `validateLevel` («must ask for something») y la gramática
   («no hay niveles libre»). El cartel ya no (fase 5): lee `slot.accepts` y un nivel null sale casilla lisa.
4. **F / V solo con estanterías**: `GameState.update` descarta `forkStep` si ninguna columna va por teclas
   (`forkKeys`: hoy, sin estanterías); `Game` solo donde la horquilla va por teclas (`hasKeyedForks`, fase 5: hoy, con
   estanterías) cuenta F / V como primera entrada del cronómetro, vigila los pasos (`ForkStepWatcher`) y enseña la fila
   F V (`UIState.storage`); ante un camión `hint.storage` solo existe con una descarga posible y el camión no tiene
   marcador (`TRUCK_RENDER`: sin `markerGeometry`, `markerAt` null). La fase 6 abre todo eso a «tiene almacenaje».
5. **Altura de la horquilla en el dibujo** (hecho en la fase 5): `ForkliftView.sync(…, support)`, `BoxView` y la vista
   previa leen la altura del soporte (`render/storage` `SUPPORT_LOOK`: `rackSlotY` en baldas, alturas de pila en una
   pila), nunca el aspecto.
6. **`loadable`** (hecho en la fase 3): en baldas es «vacío» (regla 8). El render aún mira `occupiedBy === null` en las
   baldas y `loadable` en las pilas (`LevelView.takesNow`), igual que antes.
7. **`callejones`** no sirve de objetivo `dificultad:` mientras la búsqueda no recorra todos los estados (sale «≥ 0»):
   el Benchmark y el nivel de prueba lo comprueban en su test con `deadEnds`.

Encontrados en la fase 2:
8. **Vistas derivadas en cada llamada**: `racksOf` / `trucksOf` / `slotsOf` / `truckSlotsOf` / `truckColumnsOf` crean
   sus objetos cada vez. Hoy da igual (nada por frame). Fase 3: `GameState`, `LevelGrid` y `CollisionWorld` ya leen
   `storageColumnsOf` / `storageSlotsOf` una vez; quedan `LevelView` (fase 5) y el solver (fase 4). Fase 4: el solver
   lee `storageColumnsOf` una vez por `LevelGrid`, y métricas, informe y piloto, `storageSlotsOf` una vez por nivel.
9. **Un «libre» en un camión, a medias** (fase 6): `trucksOf` lo da como `{}`, una pista que no pide nada, y de ahí
   `truckSlotsOf` → `TruckSlotState.accepts` = `{}` (con `cueFits`, encaja cualquier caja) y el cartel pediría una
   pista vacía; `targetsOf` y `zoneMatchKinds` ya lo saltan (null). Antes de abrir «libre» en el camión, sus
   consumidores tienen que pasar a `storageSlotsOf` (null = «libre»).
10. **Objetivos con la forma de antes** (hecho en la fase 3): un solo índice en `storageSlotsOf`
    (`LevelTarget.skin`, `LevelDestinies.slots`). El solver aún los lee por id de nivel (`destinyOf`) y las métricas
    distinguen `trampas` por `skin` hasta la fase 4. Fase 4, hecho: el solver los lee por índice (`firstSlot + nivel`)
    y las métricas cuentan `trampas` por tipo de pista `[aspecto, color, símbolo]`, sin ramas por aspecto.
11. **Mensajes con nombres de aspecto**: `validateLevel` nombra `racks[i]` / `trucks[i]` y varios textos siguen siendo
    de estantería o de camión (`a level with storage racks or trucks needs one box per target (…)`, `a level needs at
    least one zone or rack slot with a cue`, `…in a level with storage racks floor stacks only park boxes`, `…is a
    wall, a shelf, a plant or another rack`); «must ask for something» va por el aspecto `truck` hasta la fase 6. Con dos
    aspectos basta; un tercero trae sus palabras (`SKIN_WORDS`, `UNIT_WORDS`) y, si hace falta, sus casos en
    `explainValidation`.
12. **Gramática por aspecto**: `RACK_WORDS` / `TRUCK_WORDS` (qué es un nivel, si vale «libre»): la fase 6 abre `libre`
    en el camión.
13. **`DockRail.truckIndex`** (hecho en la fase 3): `DockRail.unitId`.
14. **`STORAGE_SKINS.fillToMax`**, declarado y sin leer hasta la fase 6; `.sound` lo lee ya el audio (fase 3), `support`
    y `access`, la validación, la rejilla y la colisión.
15. **`usesTargetRules`** (core/docks) repite `hasStorage`: sus llamadas (`LevelView`, métricas, solver) cambian en sus
    fases (`GameState` ya usa `hasStorage`); la fase 7 lo quita. Fase 4: métricas y solver ya usan `hasStorage`; quedan
    `LevelView` (fase 5) y los tests de core.

Encontrados en la fase 3:
16. **`autoForks` y sus ramas** (fase 6 las quita): `STORAGE_ACCESS.door.autoForks` y, en `GameState`, `forkKeys` (F / V
    solo si alguna columna va por teclas), `autoLevel` (el nivel de `StorageAim` en el camión), `fillStorageHint` (el
    hint del camión solo con una descarga) y `forksKeyed` (`stepForkHeight`, `stepForkLevel`). Al quitarlo, el hint del
    camión pasa a «enganchado» como el de la estantería, y el render, el clic (`ForkStepWatcher` ya lo recibe) y el
    piloto lo leen igual.
17. **Dos medidas de «la carga está dentro»**: `loadInside` (en la columna encarada, por su hondura) y `loadInDoor`
    (por la línea de cada muro con puerta, `doorLines`). Podrían ser una por columna, pero la aritmética cambiaría en el
    último decimal y con ella los frames del piloto: mejor en la fase 6, que regenera la caracterización.
18. **Orden de la colisión**: `CollisionWorld` mira los tramos de puerta cerrados justo tras los muros de carga y las
    celdas de estantería tras los estáticos, como antes (en un empate de hondura gana el primero: cambiar el orden
    podría cambiar un empuje). `soften` solo vale para una abertura `front` (una puerta nunca se cierra sobre la carga).
19. **Render por aspecto a mano** (hecho en la fase 5): el registro `src/render/storage/` construye cada unidad y
    `LevelView` solo habla con su interfaz común; alturas, fantasmas y el «dip» de la pila, por soporte
    (`SUPPORT_LOOK`). Ya no lee `racksOf` / `trucksOf` / `usesTargetRules` (huecos 8 y 15, su parte).
20. **El solver con sus índices** (hecho en la fase 4: «Fase 4: lo entregado»): huecos (`cellCount + hueco`,
    `slotsOf`) y columnas de camión (`bedBase + columna`); lee `LevelDestinies.slots` por id de nivel. `solverSection`
    de la caracterización, igual.
21. **DOCKS.md y RACKS.md** nombran aún `refreshTruckAim`, `setDoorOpen`, `RackAim`, `hint.rack`, `truckSlots`… (una
    nota antes de sus «Reglas» avisa y apunta aquí): la fase 7 los deja con lo propio de cada aspecto apuntando aquí.

Encontrados en la fase 4:
22. **`autoForks` en el piloto** (fase 6): `autopilot.ts` pulsa F / V solo donde `STORAGE_ACCESS[acceso].autoForks` es
    false (`keyed`). Al quitarlo, las pulsará también en el camión con el nivel que ya calcula (`slotAt`: el de la caja
    de arriba al coger, el siguiente libre al dejar); `selectLevel` espera a `forkHeight ≈ nivel`, medido en huecos de
    estantería: en una pila hay que comprobarlo con sus alturas.
23. **«Libre» en una pila** (fase 6): el solver da un paso por nivel a cada columna de pila, y un nivel «libre» saldría
    hoy `{}` (cualquier caja lo cumple, cuenta como colocada y se bloquea con las de debajo), contra la regla 7. Con
    `libre` en el camión: `steps` solo con los niveles con pista (de abajo arriba) y `capacity` con todos; revisar
    `correctPrefix`, `lockedAt`, `misplacedCount`, `targetDestinations` y la cota. El informe ya pone «(libre:
    aparcar)» por altura frente a `steps`.
24. **Una métrica por aspecto**: el recuento es uno (`storageCounts`), pero `huecos` es la de la estantería y `camion`
    la del camión (`DifficultyMetric`, `metricRange`, fila y columna del informe). Un aspecto nuevo se cuenta solo; para
    salir en `npm run levels` o en `dificultad:` trae su métrica y su fila en `PLAN_WORDS` (report.ts).
25. **Tres tablas de palabras por aspecto**: `UNIT_WORDS` (asciiLevel), `SKIN_WORDS` (validateLevel) y `PLAN_WORDS`
    (report). Podrían ser una (fase 7).
26. **Posiciones a mano en tests**: `benchmarkPlayable.test.ts`, `moveCounter.test.ts` y `racksPlayable.test.ts` sacan
    la posición de un hueco como `cellCount + índice en slotsOf` (vale porque las estanterías van primero, regla 12); en
    la fase 7, `grid.positionOfSlot(id)`.
27. **DOCKS.md y RACKS.md** («Solver, métricas y piloto automático») describen aún el solver de antes (`bedBase`,
    `isSlot`, `isBed`, `bedLevels`, `bedAtPose`, `cellCount + hueco`, `usesTargetRules`): la fase 7, apuntando aquí.
28. **El registro del piloto** (`log`, solo para depurar) nombra una columna de pila `stack t1:0` (antes `bed x,z`).

Encontrados en la fase 5:
29. **Marcador del camión** (fase 6): `TRUCK_RENDER` no tiene `markerGeometry` y su `markerAt` da null. La fase 6 le da
    su geometría (del tamaño de una casilla del cartel) y su sitio (la casilla del nivel elegido: `dockColumnX`,
    `signRowY`, `signMidZ`); `LevelView` ya elige el marcador por aspecto y le pasa `ready` y el tono.
30. **«Libre» en el camión, el dibujo** (fase 6): un nivel null ya no tiene luz y su casilla del cartel sale lisa
    (`buildSignFrame`); falta que la gramática y la validación lo dejen escribir, y decidir si el cartel lo distingue de
    la casilla vacía de una columna más baja (hoy se ven igual).
31. **`GameState.forkKeys` repite `hasKeyedForks`** (la misma prueba, desde sus columnas): al quitar `autoForks` (fase
    6) sobran los dos y `UIState.storage` pasa a ser `hasStorage`.
32. **La vista previa, en dos ramas por soporte**: `LevelView` distingue «sobre una balda» (`intoShelf`: el suelo de la
    balda, la escala del hueco, el tono con `cueFits`) de «en una pila» (`onStack`: `loadable` y `cueFits`), y
    `takesNow` sigue mirando `occupiedBy` en las baldas (hueco 6). Un soporte nuevo traería su rama o una propiedad más
    en `SUPPORT_LOOK`; igual `ForkliftView`, con dos regímenes de horquilla (suelo / pila y balda: `shelf` elige).
33. **Documentos con los nombres de antes**: RACKS.md (`UIState.racks`, `ForkliftView.sync(…, atRack)`) y DOCKS.md
    (`LevelView.buildTrucks`), para la fase 7 con el hueco 21; ARCHITECTURE.md ya dice `UIState.storage` y el registro.
34. **`LevelRack` / `LevelTruck` en el render**: solo como base de los tipos `RackShape` / `DockShape` y en los tests
    (leen la geometría esperada con `racksOf` / `trucksOf`); la fase 7 puede cambiarlos por `LevelStorage`.

## Fases

Cada fase la hace un agente en su copia aparte, desde el commit anterior; se verifica y se trae a `feat/almacenaje`.
Base: `1142b68` (lo verificado de `feat/pulido-benchmark`).

1. **Diseño y red de seguridad** — hecho: este documento, la caracterización y el nivel de prueba con sus tests.
2. **Modelo común en core y datos** — hecho («Fase 2: lo entregado»): `core/storage.ts`, `level.storage`, objetivos y
   destinos desde ahí; `racksOf` / `trucksOf` como vistas; los ids no cambian.
3. **Lógica, colisión y estado** — hecho («Fase 3: lo entregado»): un enganche, un paso, un camino de coger / dejar,
   `refreshColumn` por soporte, `snapshot.storageSlots`, `box.slotId`, `hint.storage`; `autoForks` temporal en el camión.
4. **Solver, métricas, informe y piloto** — hecho («Fase 4: lo entregado»): una tabla de posiciones, `lockedAt` /
   `validDrop` / `carrySearch` por soporte, el informe por aspecto.
5. **Render, UI y audio por aspecto** — hecho («Fase 5: lo entregado»): registro `src/render/storage/` (adaptadores
   `rack` y `truck`, alturas por soporte), `UIState.storage` (`hasKeyedForks`); el sonido ya iba por aspecto.
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
