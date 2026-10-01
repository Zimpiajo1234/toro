# Almacenaje común: estanterías, camiones y los aspectos que vengan

**Estado: hecho (fases 1–7, 2026-10-01).** Estanterías y camiones son dos **aspectos** (`skin`) de una misma unidad de
almacenaje: un solo modelo en los datos del nivel (`LevelData.storage`), un solo camino en la lógica, el solver, las
métricas, el piloto y el render, y las mismas reglas en toda unidad (la horquilla por teclas, los niveles «libre»). Este
documento es la referencia: el modelo, sus reglas, los contratos por capa, cómo añadir un aspecto y la red de
seguridad. Lo propio de cada aspecto (dibujo, medidas, detalles de su acceso, el Benchmark) está en docs/RACKS.md
(estanterías almacenables) y docs/DOCKS.md (muelles de carga).

Ojo con el nombre: `src/storage/` es el progreso guardado (ProgressStore), nada que ver con esto. El almacenaje vive en
`src/core/storage.ts` (sobre la geometría de sus accesos: `core/racks.ts` y `core/docks.ts`), `src/logic/storageAccess.ts`
y `src/render/storage/`.

## Decisiones

Petición (2026-09-30): «un sistema de almacenamiento que sea de lógica compartida pero el asset asignado sea
diferente… escalable… Quiero poder disponer de 3 camiones en un posible nivel sin preocuparme de un hardcoding»;
«quiero dejar bien planteado el sistema de almacenamiento, que lo hagamos antes de avanzar».

Decisiones (2026-09-30):
- **A. Lógica común, aspecto aparte.** El aspecto solo aporta el dibujo y unas pocas propiedades declaradas en una
  tabla (soporte, alturas, columnas, acceso, prefijo de id, letras, relleno, sonido) y sus palabras. Añadir un aspecto =
  una fila + su dibujo («Cómo añadir un aspecto nuevo»).
- **B. Horquilla siempre con teclas** («para subir y bajar que sea con las teclas, nada automático»): F / V / rueda en
  toda unidad, también en el camión. En una pila solo se deja en su siguiente nivel libre y solo se coge la caja de
  arriba, con la horquilla a ese nivel. El suelo (pilas y zonas) sigue con la horquilla automática.
- **C. Un nivel sin pista es «libre»** en cualquier aspecto: vale cualquier caja y nunca es objetivo; nunca brilla, se
  bloquea, zumba ni se ilumina con las pistas (P). Cada columna del camión admite `min(2, limit)` cajas: sus pistas de
  abajo arriba y el resto, libre.
- **D. La gramática del `.level` no cambia**: una letra de la leyenda por unidad («3 camiones = T, U, V»: tres
  camiones, tres letras; la forma canónica reparte las de siempre, T, C, U); `libre` escrito también vale en un camión.
- **E. Se queda todo lo aprobado**: camiones fuera de los muros norte y oeste, casillas de puerta, cartel sobre la
  puerta, barandillas naranjas con planta (docs/DOCKS.md); placas transparentes en los extremos de las estanterías
  (docs/RACKS.md); caja fija y zumbido; pistas P apagadas por defecto; la cámara nunca se reencuadra sola; la luz ámbar
  de marcha atrás.
- **F. El juego solo cambió en la fase 6** (B y C, con el Benchmark medido otra vez: 14 movimientos); las demás fases no
  lo tocaron, y lo prueba la caracterización («Red de seguridad»).

## Modelo

```ts
// core/types.ts. LevelData.storage?: LevelStorage[] (ausente sin almacenaje; su orden: regla 12).
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
type FrontUnit; type DoorUnit;                      // una unidad de ese acceso (isFrontUnit / isDoorUnit)

// core/storage.ts: una fila por aspecto en cada tabla; el tipo exige las dos.
const STORAGE_SKINS = {
  rack:  { support: 'shelves', maxLevels: 3, maxColumns: Infinity, access: 'front', idPrefix: 'r',
           chars: 'RSTUVWXYZKLMNO', fillToMax: false, sound: 'metal' },
  truck: { support: 'stack', maxLevels: 2, maxColumns: 3, access: 'door', idPrefix: 't',
           chars: 'TCUVWXYZKLMNO', fillToMax: true, sound: 'wood' },
};
const STORAGE_SKIN_ORDER = Object.keys(STORAGE_SKINS);   // ['rack', 'truck']: el orden de la regla 12
const STORAGE_WORDS = {                                   // cómo lo nombran los textos
  rack:  { name: 'estantería', the: 'la estantería', …, level: 'hueco', en: { list: 'racks', one: 'rack', … } },
  truck: { name: 'camión', the: 'el camión', …, level: 'nivel', en: { list: 'trucks', one: 'truck', … } },
};
// fillToMax: cada columna se completa con «libre» hasta min(maxLevels, limit) (validateLevel; la forma canónica no
// escribe esos «libre» sin caja). chars: las letras que reparte la forma canónica. sound: el de dejar y coger.
// La geometría, una para todos: facingOf(unit), cellOf(unit, col), frontOf(unit, col), slotIdOf(unitId, col, nivel),
// sobre la de cada acceso (core/racks: rackCellOf, frontCellOf, inwardHeading, columnFrame; core/docks: truckCellOf,
// truckFrontOf, dockRailsOf; core/types: TRUCK_FACING); y, aplanadas en el orden de la regla 12:
interface StorageColumnRef { unit; unitIndex; column; cell; front; facing; cues; firstSlot }   // storageColumnsOf
interface StorageSlotRef { id; unit; unitIndex; column; level; cell; front; facing; cue }       // storageSlotsOf

// core/types.ts: snapshot.storageSlots, unidad a unidad, columna a columna, de abajo arriba.
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
// BoxState.slotId: el nivel donde descansa, en cualquier aspecto. Eventos: boxPicked.fromSlotId, boxDropped.slotId,
// zoneReleased.slotId y, con cada uno, `skin` (el aspecto de su unidad: el audio y el render lo leen sin buscar el
// nivel).
// hint.storage: la columna donde trabaja y el nivel elegido, en toda unidad mientras la encara o la mantiene (y no
// levanta ahí una caja del suelo); `ready` = la acción funciona en ese nivel (en una pila, dejar solo en el siguiente
// libre y coger solo la de arriba).
interface StorageHint { unitId; skin; column; levels; level; slotId; ready }
// core/sorting: LevelTarget { kind: 'zone' | 'slot'; id; index; skin; criteria } (index en level.zones o en
// storageSlotsOf; skin null en una zona) y LevelDestinies { zones; slots } (slots en el orden de storageSlotsOf).
```

**Soporte** (lo decide la fila del aspecto, nunca el aspecto en sí):
- **Baldas** (`shelves`, estantería): cada nivel es un hueco aparte con su balda; se llenan y vacían en cualquier orden
  y cada uno se cumple solo. En el solver, una posición por nivel, de capacidad 1.
- **Pila** (`stack`, camión): las cajas una sobre otra, de abajo arriba. Un nivel se cumple solo si todos los de debajo
  se cumplen, y el siguiente se carga encima de una caja fija. En el solver, una posición por columna, de capacidad
  sus niveles.

**Acceso** (tabla `STORAGE_ACCESS` en `logic/storageAccess.ts`; sin casos por muro ni por aspecto fuera de ella). Sus
campos: `faceAngle` / `faceLateral` / `faceNear` / `faceFar` (se encara), `holdAngle` / `holdLateral` / `holdNear` (se
mantiene; lo más lejos, `faceFar`), `bodyInLine`, `actsHeld` (coge y deja también solo mantenida), `pickReach` /
`dropReach` (hondura del punto de horquilla para coger / dejar) y `doorway`. El orden de sus claves es la prioridad del
enganche (una estantería antes que un camión). La horquilla va por teclas en todo acceso.

| | `front` (estantería) | `door` (camión) |
|---|---|---|
| Se encara | rumbo ≤ 30° hacia dentro; punto de horquilla a ≤ 0,35 del eje, de 0,8 delante de la cara a 1 dentro | el cuerpo en línea con su casilla de puerta; ≤ 30°; ≤ 0,5 del eje; de 0,8 delante de la línea del muro a 1 más allá |
| Se mantiene | 50°, 0,75, 1,3 | 45°, 0,6, 0,8, el cuerpo aún en línea |
| Coger / dejar | solo encarada, horquilla en el nivel elegido (±0,25); para dejar, su punto a ≤ 0,55 delante de la cara (`dropReach` −0,55; `pickReach` −0,8: donde la encara) | encarada o mantenida, horquilla en el nivel elegido (±0,25); punto de horquilla ≥ 0,3 más allá del muro (`pickReach` = `dropReach` = 0,3); con la carga en la puerta sin llegar, o con la horquilla en otro nivel, nada (`doorway`) |
| Horquilla | F / V / rueda (`forkLevel`); con la carga dentro del hueco, el nivel no cambia | F / V / rueda; con la carga sobre las cajas de la columna, V no baja (nunca se hunde en ellas) |
| Paso de la carga | la columna encarada se abre con la horquilla en su nivel y el hueco vacío; dentro, panel y montantes (`RACK_WALL`); cierra suave (`CollisionWorld.soften`) | el tramo de puerta de la columna encarada (`doorCells`) entre jambas (`DOOR_JAMB`) hacia el bolsillo (`DOOR_POCKET`); barandillas `dockRailsOf` (por `unitId`) |
| Rumbo fijo | con la carga dentro del hueco abierto | con la carga pasada la línea del muro; los dos, una sola medida en vivo (`loadInOpening`: la columna enganchada, abierta, y el borde de la carga `INSIDE_MARGIN` pasada su cara) |
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
   (`fillToMax`: validateLevel los añade; la forma canónica no escribe los de arriba sin caja). En una pila un «libre»
   solo va encima de los niveles con pista (validateLevel), así que «todo lo de debajo cumplido» nunca juzga un «libre»;
   una caja en un «libre» de una pila nunca queda fija, se coge siempre que sea la de arriba y puede ir encima de una
   caja fija.
8. **Cargable** (`loadable`): baldas = vacío; pila = el nivel vacío más bajo de su columna con todo lo de debajo
   cumplido. Solo decide la luz (pistas P, tono de la vista previa), nunca si se puede dejar: en una pila se deja encima
   mientras quepa, aunque lo de debajo esté mal o fijo.
9. **Horquilla por teclas** en toda unidad: F / V / rueda (mando X / B) eligen el nivel (`forkLevel`) de la columna
   encarada; coger y dejar, solo con la horquilla en ese nivel. Baldas: cualquier hueco. Pila: solo el siguiente nivel
   libre (dejar) y la caja de arriba (coger); con la horquilla en otro nivel no hay vista previa ni se suelta y, si va
   baja, la carga choca con la caja de la plataforma, como con la cara de una estantería (F ahí la sube por encima); con
   la carga sobre las cajas de la pila, V no baja. El marcador del nivel elegido, en su hueco o en su casilla del
   cartel. Suelo: sola.
10. **Pistas P** (apagadas por defecto): con una caja en la horquilla laten los niveles `loadable` cuya pista encaja
    (`cueFits`), y si ninguno libre la toma, muy suave los ocupados que encajan sin brillar. Apagadas, nada. Nunca un
    «libre».
11. **Ids** (estables: el modelo común no cambió ninguno): unidad = `idPrefix` + nº dentro de su aspecto, en orden de
    leyenda; nivel = `unidad:columna:nivel` desde 0; una estantería y un camión nunca comparten id. Cajas `b1…`: las
    del suelo, luego las de las unidades, unidad a unidad, columna a columna, de abajo arriba.
12. **Orden de las unidades**: estanterías y luego camiones (aspecto a aspecto, en el orden de `STORAGE_SKINS`; dentro
    de cada aspecto, el de la leyenda). Es el orden de los ids de caja, `targetsOf`, `snapshot` y las posiciones del
    solver: cambiarlo cambia el plan del Benchmark.
13. **Movimientos**: coger y dejar en otro sitio = 1 (`snapshot.moves` = la métrica `movimientos`); dejarla donde estaba
    (el mismo nivel, o la misma casilla y altura) no cuenta.

Un nivel sin almacenaje juega exactamente como antes: sin destinos, cajas fijas ni zumbido, y F / V no hacen nada
(`hasStorage` es la puerta de todas estas reglas).

## Lo que se ve y se oye (común)

- **Luz de un nivel** (`views/RackView` `SlotLight`, uno por nivel con pista: el panel, la pegatina y la banda del hueco
  en una estantería, de la casilla del cartel en un camión). Brillo **solo** con `satisfied` (views/success.ts): al
  aterrizar la caja (`DROP_GLIDE_SEC`) destella a `FLASH_PEAK` 0,8 (subida `FLASH_RISE_SHARE` 14 %, todo el destello
  `FLASH_SEC` 0,85 s) y reposa en `TARGET_REST` 0,15; a la vez un **efecto de acierto** (`SuccessBurst`, `BURST_SEC`
  0,65 s: 7 destellos pequeños del color de la caja y un anillo en la cara que ve la cámara, donde lo pone su unidad:
  `burstAt`); tras el destello (`LOCK_DELAY`) la caja pasa en `LOCK_SEC` 0,6 s a su **tono hondo**
  (`Theme.boxes[color].locked`, mismo matiz ≈ 8–9 puntos más oscuro, nunca negro ni rojo). Al cargar o reiniciar, una
  caja ya fija sale así sin repetir nada. La pegatina aclara su propio color, nunca más allá de `CUE_GLOW_CAP` 0,45.
  Al terminar, los niveles con pista entran en la ola de las zonas, por distancia a la carretilla.
- **Latido** (solo con las pistas P): `INVITE_BASE` 0,4 ± `INVITE_PULSE` 0,16 a `INVITE_RATE` 2,3, en el tono de la
  caja llevada (`SlotTone`), en los niveles `loadable` cuya pista encaja y en las zonas que la tomarían; si ninguno libre
  la toma, los ocupados que encajan laten con `TARGET_SWAP_INVITE` 0,1. Las zonas de un nivel con almacenaje
  (`ZoneView` `targetRules`) laten y destellan igual y, cumplidas, brillan en el tono de su caja destinada.
- **Marcador del nivel elegido** (`views/SlotMarker`, uno por aspecto que lo tiene, donde lo pone su unidad: `markerAt`):
  tenue al elegir, claro con `ready`, del tono de la caja cuando la descarga la tomaría. **Vista previa** (`DropPreview`)
  en el nivel donde caería, con el tono de la caja cuando `cueFits` (en una pila, además, `loadable`). Sobre una caja
  fija, ni salto ni vista previa.
- **Sonido**: dejar / coger según `STORAGE_SKINS[skin].sound`; la campana (según `Game.matchOf`, el `matchKind` de la
  pista) solo con `correct`; el **zumbido** de objetivo equivocado (`isWrongTarget` → `SfxPlayer.wrongBuzz`, a
  `DROP_LAND_SEC` + `WRONG_AFTER_LAND_SEC` 0,05 s: un «no» suave de ≈ 0,2 s, `WRONG_BUZZ_HZ` ≈ 185 Hz con una sierra
  a × `WRONG_BUZZ_DETUNE` 1,055, bajando hasta × `WRONG_BUZZ_SAG` 0,86; nunca en un «libre», en el suelo sin zona ni
  con la caja destinada); cada paso de F / V que surte efecto, un clic de retén (`AudioEngine.forkClick`, por
  `ForkStepWatcher` sobre `hint.storage`: nada en el nivel de arriba del todo ni en el de abajo, ni al llegar a otra
  columna). La bomba y el «clonc» de la horquilla: docs/ARCHITECTURE.md («Audio direction»).
- **Pista de controles** (`ControlHint`): en todo nivel con almacenaje (`UIState.storage`), una segunda fila «F V
  subir / bajar horquilla · rueda».

## Contratos por capa

- **core**: `core/types.ts` (los tipos de «Modelo», `FrontUnit` / `DoorUnit` con `isFrontUnit` / `isDoorUnit`,
  `TRUCK_FACING`). `core/storage.ts`: `STORAGE_SKINS`, `STORAGE_SKIN_ORDER`, `STORAGE_WORDS`, `storageOf`,
  `hasStorage`, `slotIdOf`, `facingOf`, `cellOf`, `frontOf`, `storageColumnsOf`, `storageSlotsOf`. Debajo, sin ciclos, la
  geometría de cada acceso: `core/racks.ts` (`front`: `rackCellOf`, `frontCellOf`, `runsAlongX`, `FACING_X` /
  `FACING_Z`, `inwardHeading`, `columnFrame`) y `core/docks.ts` (`door`: `truckCellOf`, `truckFrontOf`, las barandillas
  `dockRailsOf` por `unitId`, `DOOR_JAMB`, `DOCK_RAIL`). `core/sorting` saca objetivos, destinos, `zoneMatchKinds`,
  `usesSymbols` y `cueOf` de `storageSlotsOf` / `storageOf`. Toda capa lee las unidades tal cual (`level.storage`) y las
  distingue por su acceso o su soporte, nunca por listas por aspecto.
- **data**: `asciiLevel.ts`, la misma gramática (`estantería frente …`, `camión muelle …`), una letra por unidad (de
  `STORAGE_SKINS[skin].chars`) y la misma forma canónica; lee las unidades aspecto a aspecto (regla 12, aunque la
  leyenda ponga antes un camión) y su borrador (`parseLevelDraft`) ya trae `storage`; `libre` en todo aspecto (escrito,
  o implícito hasta llenar una columna `fillToMax`). Sus mensajes nombran unidades y niveles con `STORAGE_WORDS` y las
  plantillas de una columna con `COLUMN_WORDS`. `validateLevel.ts` lee `storage` (la forma de `LevelData`:
  `validateLevel(level)` devuelve el nivel) o, de un nivel JSON antiguo, `racks` y `trucks` (nunca los dos a la vez),
  ordena las unidades por aspecto (orden estable) y da `storage`. Lo común sale de la fila del aspecto (niveles,
  columnas, id por defecto, ids únicos entre aspectos, pila ≤ `limit`, cajas una sobre otra, «libre» solo encima en una
  pila, el relleno `fillToMax`, reparto único) y aparte va lo de cada acceso (`front`: sus casillas y el frente es
  suelo; `door`: la fila 0 / columna 0, las casillas laterales con obstáculo, nada de ventana en la puerta, nada empieza
  en una casilla de puerta). Los mensajes, en inglés y fijos (asciiLevel los traduce y los coloca): cada unidad se
  nombra por su aspecto, `racks[i]` / `trucks[i]` = la i-ésima de ese aspecto, también desde `storage`
  (`STORAGE_WORDS[skin].en`).
- **logic**: `LevelGrid.columns` (`StorageColumn`: unidad, aspecto, soporte, acceso, celda dentro o fuera del mapa,
  `levels`, `firstSlot`), las cajas por soporte (en baldas una por nivel, `slotBox`; en pila, la pila de su columna, que
  responden las consultas de pila por celda: `height`, `boxAt`, `baseAt`, `stackAt`, `pushBox`, `popBox`, `capacity`,
  `isStackColumn`) y `columnAt`, `slotOf`, `canStore`, `liftableAt`, `putBox`, `takeBox`. Un enganche
  (`GameState.refreshStorageAim` sobre `STORAGE_ACCESS`), un paso de la carga (`refreshStoragePassage` sobre las
  aberturas de `CollisionWorld`: `StorageOpening` `front` = su celda con panel y montantes, `door` = su tramo de puerta;
  `setOpen`, `isOpen`, `opening`, `soften`, `openingInset`), una medida de «la carga está dentro» (`loadInOpening`), un
  camino de coger / dejar (`Interaction.findPickTarget` / `findDrop` sobre `StorageAim`: `column`, `level`, `reach`,
  `blocked`; `GameState.pick` / `dropInStorage`) y `refreshColumn` según el soporte. La horquilla: `forkLevel` con F / V
  (`stepForkLevel`; con la carga dentro de un hueco no cambia, y nunca hunde la carga en una pila: `sinksIntoStack`);
  fuera de una columna, automática (`clearLevel`, que en una pila de almacenaje no sube por adelantado). El orden de la
  colisión se conserva a propósito: los tramos de puerta cerrados justo tras los muros de carga, las celdas de estantería
  tras los estáticos (en un empate de hondura gana el primero, así que cambiarlo podría cambiar un empuje); `soften` solo
  vale para una abertura `front` (una puerta nunca se cierra sobre la carga).
- **solver / métricas / informe / piloto** (`data/levels`, `integration/autopilot.ts`): una tabla de posiciones tras las
  casillas, columna a columna en el orden de `storageColumnsOf` (baldas: una por nivel, capacidad 1; pila: una por
  columna, capacidad sus niveles, nunca el `limit`). Por posición, `kind` (`POS_FLOOR` / `POS_SHELF` / `POS_STACK`),
  `capacity`, `front`, `inward` y `steps` (el tipo destinado de cada nivel, leído por su índice en `storageSlotsOf`; en
  una pila, solo sus niveles con pista: un «libre» es aparcamiento); por pose, `columnAtPose`. Consultas: `isStorage`,
  `columnOfPos`, `posOf`, `positionOfSlot` (por id de nivel), `levelAt` / `slotAt`, `cellOfPos`, `accessOf`, `inMap`.
  `lockedAt`, `validDrop`, `carrySearch`, `chainTo`, `carryBackTo`, `pickupStarts` y `deadEnds`, por soporte y acceso:
  una columna se carga solo con un paso adelante desde la casilla de detrás de su frente, mirando hacia dentro, y una
  caja sacada de ella solo sale marcha atrás. La cota de ciclos de destinos (`MoveSearch.destTerm`,
  `targetDestinations`: una pila nunca es nodo de un ciclo), admisible y consistente (`levels/docks.test.ts`). Métricas:
  un recuento por aspecto (`storageCounts`: unidades, columnas, niveles, con pista, cargados al empezar);
  `huecos` y `camion` son sus dos vistas publicadas; `trampas` y `ambiguas`, por tipo de pista `[aspecto, color,
  símbolo]` (en una pila, también su altura). El informe nombra cada unidad por sus palabras (`STORAGE_WORDS`) y su
  letra, según su soporte: una balda es un sitio («hueco 2 de R»), una pila nombra la unidad y la altura («camión T
  (1,0), nivel 2»). El piloto pone las cajas por `positionOfSlot`, elige el nivel con F / V en toda unidad (`selectLevel`)
  y cuenta las pulsaciones por aspecto (`Outcome.controls.forkStepsAt`).
- **render** (`src/render/storage/`): `STORAGE_RENDER` (`index.ts`), una entrada por fila de `STORAGE_SKINS` (el tipo
  lo obliga): `StorageSkinRender` = `builder(ctx)` y, opcionales, `paintFloor` y `markerGeometry`. Cada unidad en
  pantalla es un `StorageUnitView` (`types.ts`): `group` (su id en `userData`), `bounds`, `fitBox` estático,
  `occluders`, `beyondWall` (el muro tras el que queda), `syncSlot` / `playWave` (por id de nivel), `burstAt`,
  `markerAt` y `hidesActorAt`. `StorageBuildContext` es lo que presta LevelView; `common.ts`, lo que comparten los
  aspectos (metal pintado, `cueLookOf`, `levelLightOf`, `yawTowardCamera`). Las alturas salen del soporte
  (`SUPPORT_LOOK`: `shelves` = `rackSlotY`, `stack` = alturas de pila) para `BoxView`, `ForkliftView.sync(…, support)` y
  la vista previa. Los constructores de cada aspecto leen la unidad tal cual (`builders/rack.ts`, una `FrontUnit`;
  `builders/truck.ts` y `builders/walls` `dockSpan`, una `DoorUnit`); la puerta de un muelle la abre el muro por el
  acceso (`wallLayouts`: toda unidad `door`). LevelView construye cada unidad desde el registro y recorre una sola lista
  (`snapshot.storageSlots`) para luces, `satisfied`, estallido y ola final.
- **UI / audio / game**: `UIState.storage` = `hasStorage` (la fila de F / V); `Game` publica esa bandera al cargar,
  cuenta F / V como primera entrada del cronómetro, deja sonar su clic (`ForkStepWatcher`) y da a cada evento su
  `matchKind` (`matchOf`, por `slotId`); el audio elige el sonido por `STORAGE_SKINS[skin].sound` (`metal`: `slotDrop`
  / `slotLift`; `wood`: `truckDrop` / `pickup`).

## Cómo añadir un aspecto nuevo

1. **Sus filas en `core/storage.ts`**: en `STORAGE_SKINS`, soporte, `maxLevels`, `maxColumns`, acceso (`front` /
   `door` u otro nuevo), `idPrefix` (distinto de los demás: los ids de nivel no pueden chocar), `chars`, `fillToMax`,
   `sound`; en `STORAGE_WORDS`, su nombre y su concordancia en español (leyenda, mensajes, informe), la palabra de uno
   de sus niveles y, en `en`, las palabras inglesas de validateLevel (su lista JSON, que da nombre a `lista[i]`).
2. **Gramática** (`asciiLevel.ts`): la cabeza de su entrada en la leyenda (como `estantería frente …` / `camión muelle
   …`) y las plantillas de una de sus columnas en `COLUMN_WORDS`; columnas `|`, niveles `/`, `pista [+ caja]` y `libre`
   ya son comunes (en una pila, solo encima; con `fillToMax`, implícito y fuera de la forma canónica). Forma canónica,
   un ejemplo en su doc y sus errores en español.
3. **Validación**: solo lo propio de su sitio en el mapa; lo común sale de la fila. Si trae mensajes nuevos, su sitio
   en `explainValidation`.
4. **Acceso**: si es nuevo, una fila en `STORAGE_ACCESS` (encarar, mantener, alcance, paso de la carga), su abertura en
   `CollisionWorld` (`StorageOpening`) y su geometría (`cellOf` / `frontOf` / `facingOf`); si no, comparte la del suyo
   (core/racks para `front`, core/docks para `door`) y nada cambia en la lógica.
5. **Render** (`src/render/storage/`):
   - sus constructores en `src/render/builders/<aspecto>.ts` (y, si hace falta, su vista en `views/`), que leen la
     unidad tal cual (`null` = «libre»); medidas en `dims.ts`, colores en `Theme.<aspecto>`;
   - un adaptador `src/render/storage/<aspecto>.ts` que exporte su `StorageSkinRender`: `builder(ctx)` devuelve un
     constructor que, unidad a unidad (en el orden del almacenaje), crea su `StorageUnitView`, con un `SlotLight` por
     nivel con pista (`common.ts` `levelLightOf`, pegatina con `cueLookOf`); opcionales `paintFloor` (pintura en el
     suelo) y `markerGeometry` (su marcador del nivel elegido: sin él, sus unidades no enseñan qué nivel eligió F / V);
   - su entrada en `STORAGE_RENDER`. Las alturas salen del soporte (`SUPPORT_LOOK`): con un soporte que ya existe,
     LevelView, BoxView y ForkliftView no cambian; uno nuevo trae su fila allí y su rama de la vista previa
     («Pendiente», 7);
   - si su acceso es `door`, la puerta del muro ya la abre `builders/walls`.
6. **Audio**: un sonido en `sfx.ts` si `sound` es nuevo.
7. **Métricas**: se cuenta solo (`storageCounts`); para salir en `npm run levels` o en `dificultad:`, su métrica y su
   columna del informe («Pendiente», 6).
8. **Doc**: `docs/<ASPECTO>.md` con lo propio; lo común se queda aquí.
9. **Tests**: un nivel de prueba en `src/data/levels/pruebas/` y sus tests (como `storageFixture.test.ts`). La
   caracterización de abajo no se toca: un aspecto nuevo no cambia los que ya hay.

## Red de seguridad

- **Caracterización** (`src/integration/storageCharacterization.ts`, su `.test.ts` y su `.json`): lo que hacen el
  Benchmark y el nivel de prueba, sección a sección, en términos que sobreviven a un cambio de código (ids de unidad y
  de nivel, casillas `x,z@altura`, zonas `[z1]`, tipos `color/símbolo`; nunca un número de posición del solver ni la
  forma de una API):
  - `storage`: las unidades con la forma de `LevelStorage`, cada caja al empezar y cada nivel (celda, frente, lado,
    pista);
  - `targets`: la puerta de reglas, cada objetivo con su destino y su timbre, el nº de repartos (1);
  - `metrics`: las métricas de `npm run levels` (sin callejones: los miran `benchmark.test.ts` y
    `storageFixture.test.ts`);
  - `solver`: el resultado exacto y su plan, jugada a jugada;
  - `start`: el estado vivo al cargar (progreso, cada nivel, cada caja);
  - `autopilot60` / `autopilot20`: el piloto a 60 y 20 fps (movimientos, frames hasta terminar, pulsaciones de F / V
    en total y por aspecto, frames marcha atrás y cada movimiento de caja).
- **Regla**: el JSON solo cambia con un cambio de reglas deliberado. Si un test de la caracterización falla sin él,
  algo cambió sin querer y se arregla el código; una API renombrada se adapta en `storageCharacterization.ts`, nunca en
  el JSON. Se regenera revisando el diff (así lo hizo la fase 6):
  `TORO_CARACTERIZAR=1 npx vitest run src/integration/storageCharacterization.test.ts -u` (PowerShell:
  `$env:TORO_CARACTERIZAR = '1'; npx vitest run src/integration/storageCharacterization.test.ts -u;
  Remove-Item Env:TORO_CARACTERIZAR`). Con la variable, el test solo reescribe el archivo; `-u` a secas no lo toca.
- **Medido** (2026-10-01, desde la fase 6): Benchmark 14 movimientos (exacto, 0 estados: la cota ya da 14), piloto
  13842 frames a 60 fps y 5056 a 20, 8 pulsaciones de F / V (7 en las estanterías y 1 en el camión); nivel de prueba 9
  movimientos, 6684 y 2512 frames, 5 pulsaciones (3 + 2). Un cambio de 0,1 en el fondo del bolsillo de la puerta
  (`DOOR_POCKET`) ya cambia los frames de los dos.
- **Verificación** de un cambio en el almacenaje: `npx tsc --noEmit`; `npx vitest run` dos veces; `npx vite build` a
  una carpeta fuera del repo; `npm run levels:fmt -- --check`; `npm run levels` (Benchmark OK 8/8, 14 movimientos,
  repartos 1, callejones 0; el nivel de prueba no sale); `npm run levels -- --minimos --check`; la caracterización
  intacta.

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

- 9×7, `limit: 2`, ventana oeste 1-2. Tres camiones: T (norte, 2 columnas de 2 niveles: la segunda escrita con uno,
  encima un «libre») y C (norte, 1 columna: «menta» y encima un «libre»), separados por la planta de (3,0), la casilla
  lateral de las dos puertas; U (oeste, 1 × 2). Seis barandillas, una planta detrás de cada una. R: estantería de 2
  alturas contra el muro norte; S: de 3, en medio.
- 10 cajas, 10 objetivos (1 zona, 3 huecos con pista, 6 niveles de camión con pista), un solo reparto (cadena en sus
  `nota:`). Carga equivocada: el menta ◆ en C (encaja en «menta», es del «◆» de S); el amarillo ■ empieza fijo abajo en
  U; el lavanda ▲ aparcado arriba en R.
- Medido: movimientos 9 (exacto, sin búsqueda), extra 0, bloqueos 1, trampas 6, repartos 1, huecos 5 (3 con pista),
  camión 8 (6 con pista, 2 libres; 4 columnas, 3 camiones, 2 cargados), libre 78 %, callejones 0 en 60 estados. El
  piloto lo termina a 60 y 20 fps (F / V en las dos estanterías y en T y U, marcha atrás del camión C). El render
  construye los tres camiones sin que se toquen (0,2 entre los accesos de T y C) y las dos estanterías.

## Historia de la migración

Cada fase la hizo un agente en su copia aparte, desde el commit anterior, y se trajo a `feat/almacenaje` una vez
verificada (base: `1142b68`, lo verificado de `feat/pulido-benchmark`). Antes había dos implementaciones paralelas
(`LevelRack` / `LevelTruck`, `slots` / `truckSlots`, `slotId` / `truckSlotId`, `refreshRackAim` / `refreshTruckAim`,
huecos y plataformas aparte en el solver, `buildRacks` / `buildTrucks`, constantes `RACK_*` / `TRUCK_*` sueltas).

1. **Diseño y red de seguridad** (2026-09-30): este documento, la caracterización y el nivel de prueba con sus tests.
   Medido: Benchmark 14 movimientos, piloto 13644 / 4991 frames (60 / 20 fps), 7 pulsaciones de F / V.
2. **Modelo común en core y datos** (2026-09-30): `LevelData.storage` en lugar de `racks?` / `trucks?`, `core/storage.ts`
   (la tabla, el orden, la geometría, las listas aplanadas), asciiLevel y validateLevel sobre él (validateLevel acepta
   aún `racks` / `trucks` de un JSON antiguo); objetivos y destinos desde `storageSlotsOf`. Las vistas por aspecto
   (`racksOf`, `trucksOf` y sus listas) quedaron como envoltorios temporales. Las letras canónicas no cambian.
3. **Lógica, colisión y estado** (2026-09-30): `snapshot.storageSlots`, `box.slotId`, `hint.storage`, eventos con
   `slotId` y `skin`; `LevelGrid.columns` con las cajas por soporte; un enganche (`STORAGE_ACCESS`), una abertura por
   columna en `CollisionWorld`, un camino de coger / dejar (`StorageAim`), `refreshColumn` por soporte. El camión
   conservó su horquilla automática con un `autoForks` temporal.
4. **Solver, métricas, informe y piloto** (2026-09-30): una tabla de posiciones por soporte, reglas por soporte y
   acceso, un recuento por aspecto, el informe por las palabras del aspecto; el mismo trabajo y el mismo tiempo.
5. **Render, UI y audio** (2026-09-30): el registro `src/render/storage/` (adaptadores `rack` y `truck`, alturas por
   soporte), `UIState.storage`; capturas y el piloto reproducido en el navegador, idénticos byte a byte.
6. **Reglas nuevas** (2026-10-01, el único cambio de juego): F / V en toda unidad (el marcador en la casilla del cartel,
   la fila de F / V en todo nivel con almacenaje, el piloto pulsa F / V en el camión; fuera `autoForks`), «libre» en
   todo aspecto (relleno a `min(2, limit)` en el camión, `libre` en la gramática, forma canónica sin los implícitos),
   una sola medida `loadInOpening`. La caracterización, regenerada a propósito (los niveles «libre» del camión, las
   pulsaciones en el camión y la parada para elegir el nivel: 13842 / 5056 frames); el Benchmark sigue en 14
   (`camion=3` → `camion=4`); los niveles 1–3, sin cambios.
7. **Limpieza y documentación** (2026-10-01): fuera las vistas y los duplicados (`racksOf`, `trucksOf`, `slotsOf`,
   `truckSlotsOf`, `truckColumnsOf`, `hasRacks`, `hasTrucks`, `usesTargetRules`, `truckFacing`, `truckInwardHeading`,
   `truckSlotIdOf`; `LevelRack`, `LevelTruck`, `RackSlot`, `TruckCue`, `RackShape`, `DockShape`; `MAX_RACK_SLOTS`,
   `MAX_TRUCK_LEVELS`, `MAX_TRUCK_COLUMNS`, ahora solo en `STORAGE_SKINS`): los constructores y los tests leen las
   unidades (`storageOf`, `storageColumnsOf`, `storageSlotsOf`, `FrontUnit` / `DoorUnit`). Una tabla de palabras por
   aspecto (`STORAGE_WORDS`, en lugar de `UNIT_WORDS`, `SKIN_WORDS` y `PLAN_WORDS`), `positionOfSlot` en los tests del
   piloto, los nombres de las reglas de objetivo en el render (`ZoneView` `targetRules`, `TARGET_SWAP_INVITE`, …) y
   esta documentación. El juego, igual: la caracterización intacta.

## Pendiente

1. **La horquilla vacía atraviesa una caja en una pila**: con las púas dentro de una columna del camión bajo dos cajas,
   F las sube hasta la de arriba pasando por la de abajo (en el dibujo: las púas vacías no chocan con nada, como al
   pasar de un hueco ocupado al de encima en una estantería), y V, con ellas bajo la de arriba, las baja pasando por la
   de debajo. El piloto no lo hace (solo coge del camión en el nivel 0). Arreglarlo como V con la carga (que F / V no
   muevan las púas a través de una caja de la pila) cambia cómo se coge la caja de arriba: hoy se entra a nivel 0 y F
   sube por dentro (`GameState.docks.test.ts`, «picks only the top box…»); con la regla habría que elegir el nivel
   antes de meter las púas (y el piloto, lo mismo). Decisión de diseño; la fase 7 no lo cambió.
2. **`loadable` de un «libre» en una pila**: sale `true` cuando es el siguiente con todo lo de debajo cumplido y `false`
   tras otro «libre» (un «libre» nunca se cumple). Solo decide la luz (regla 8) y un «libre» no tiene: da igual hoy; un
   soporte nuevo con varios «libre» seguidos podría querer otra regla.
3. **El mensaje `…needs one box per target (… truck levels)`** cuenta los niveles de camión con pista (los objetivos);
   en inglés sigue diciendo «truck levels» (los mensajes en inglés no cambian); el español ya dice «con pista».
4. **La entrada al camión con caja en la plataforma tarda algo más**: la horquilla solo empieza a subir con F al
   enganchar la columna (desde la fila de detrás), y la carga espera a que llegue (`GameState.docksDriving.test.ts`:
   cotas 3,2 s y mediana 1,65 s en vez de 3 y 1,5). Es la regla de la estantería; si se quiere más ágil, el enganche de
   la puerta podría empezar antes (`faceNear`).
5. **Mensajes con nombres de aspecto**: las palabras de cada unidad salen de `STORAGE_WORDS`, pero algunos textos de
   `validateLevel` siguen siendo de estantería o de camión (`a level with storage racks or trucks needs one box per
   target (…)`, `a level needs at least one zone or rack slot with a cue`, `…in a level with storage racks floor stacks
   only park boxes`, `…is a wall, a shelf, a plant or another rack`). Con dos aspectos basta; un tercero traería sus
   casos en `explainValidation`.
6. **Una métrica por aspecto**: el recuento es uno (`storageCounts`), pero `huecos` es la de la estantería y `camion` la
   del camión (`DifficultyMetric`, `metricRange`, fila y columna del informe). Un aspecto nuevo se cuenta solo; para
   salir en `npm run levels` o en `dificultad:` trae su métrica.
7. **La vista previa, en dos ramas por soporte**: `LevelView` distingue «sobre una balda» (el suelo de la balda, la
   escala del hueco, el tono con `cueFits`) de «en una pila» (`loadable` y `cueFits`), y `takesNow` mira `occupiedBy`
   en las baldas y `loadable` en las pilas. Un soporte nuevo traería su rama o una propiedad más en `SUPPORT_LOOK`;
   igual `ForkliftView`, con dos regímenes de horquilla (suelo / pila y balda).
8. **`callejones`** no sirve de objetivo `dificultad:` mientras la búsqueda no recorra todos los estados (sale «≥ 0»):
   el Benchmark y el nivel de prueba lo comprueban en su test con `deadEnds`.
9. **Nombres de aspecto en lo que es de un acceso o de un soporte**: la geometría de `front` se llama `rackCellOf` /
   `frontCellOf` y la de `door` `truckCellOf` / `truckFrontOf` / `TRUCK_FACING`; `RACK_WALL` (collision) es de toda
   abertura `front`, y `RACK_*_LAMBDA` / `RACK_PITCH_SHARE` (`ForkliftView`) del soporte `shelves`. Con un solo aspecto
   por acceso da igual; un segundo aspecto de un mismo acceso los compartiría con esos nombres.
