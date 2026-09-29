# Mecánica: estanterías almacenables

Decisiones (2026-09-29, plan «estanterías almacenables + Benchmark»): el apilado acumulativo pasa a **estanterías
almacenables** con huecos a varias alturas y pistas de color / símbolo, con **solución única** por nivel. Los niveles
1–24 no cambian (las recetas de pila de 13–18 quedan como sistema heredado hasta el rediseño de niveles). Hoy solo el
nivel especial **Benchmark** (Modo prueba, ver abajo) usa estanterías.

## Reglas
1. **Estantería almacenable** = mueble de 1 casilla de fondo, N casillas de ancho (una **columna** por casilla), de 1 a 3
   **huecos** de alto por columna (suelo + 2). Se **carga y descarga solo por el frente** (`facing`): la casilla de delante
   de cada columna es donde se pone la carretilla, mirando a la estantería. La **pista** de cada hueco (en su panel del
   fondo) **se ve desde las dos caras** y, en las columnas de los extremos, también **en el panel lateral**, hueco a
   hueco: leerla no exige mirar el frente (la estantería se lee desde los 4 ángulos de cámara); el frente solo decide
   desde dónde se carga.
2. Se distinguen de las estanterías-obstáculo (madera + cajas kraft): son otro mueble, de metal pizarra con vigas crema,
   formas simples (sin travesaños diagonales), huecos abiertos, paneles laterales macizos, pista en el panel del fondo y
   una línea de carga pintada en el suelo del frente (ver «Render»).
3. **Pista del hueco**: color = pide ese color; símbolo = pide ese símbolo; color + símbolo = esa caja exacta. Hueco
   **«libre»** (sin pista) = almacén sin destino: guarda cualquier caja y nunca cuenta como objetivo.
4. **Solución única**: cada zona y cada hueco con pista (los **objetivos**) tiene **una** caja destinada; las pistas se
   combinan para que exista exactamente un reparto completo (cajas idénticas son intercambiables). Lo comprueba
   `validateLevel`.
5. **Solo brilla con su caja**: un objetivo solo se cumple (brilla) con su caja destinada; otra caja que encaje en la
   pista lo deja neutro (nunca rojo ni texto). Al llevar una caja **respiran los huecos cuya pista encaja** (pista, no
   solución): `cueFits` frente a `isDestined`.
6. **Huecos independientes**: se llenan y vacían en cualquier orden (no hay que llenar el de abajo primero).
7. **Altura por huecos**: delante de una estantería, **F sube / V baja** un hueco, igual que la **rueda del ratón** (un
   paso de rueda = un hueco) y el mando (**X sube / B baja**). Fuera de las estanterías la horquilla es automática, como
   siempre.
8. **Suelo**: apilar en el suelo sigue permitido **solo como aparcamiento** (`limit:` o una pila inicial); las zonas de
   suelo piden una caja (sin recetas) y también siguen la regla «solo brilla con su caja».
9. Niveles sin estanterías: exactamente como antes.

## En el archivo `.level`

Una estantería es un carácter de la leyenda. En el mapa ocupa una **fila recta** (frente norte o sur) o una **columna
recta** (frente este u oeste), de 1 casilla de fondo; cada grupo conectado de ese carácter es una estantería.

```
estantería = "estantería" "frente" dirección [id] ":" columna { "|" columna }
dirección  = "norte" | "este" | "sur" | "oeste"          (también north / east / south / west)
columna    = hueco { "/" hueco }                          (de abajo arriba, de 1 a 3 huecos)
hueco      = pista [ "+" caja ]                           (la caja que empieza en ese hueco)
pista      = "libre" | color [símbolo] | símbolo
caja       = "caja" color [símbolo] ["tipo" tipo] [id]
```

- Las columnas van de oeste a este (frente norte / sur) o de norte a sur (frente este / oeste): una por casilla, en ese
  orden, separadas por `|`. Los huecos de cada columna, de abajo arriba, separados por `/`.
- Ids: estanterías `r1, r2…` en orden de leyenda (y de lectura si un carácter se usa en varias); las cajas de los huecos
  se numeran **después** de las del suelo, estantería a estantería, columna a columna, de abajo arriba.
- Forma canónica: una letra por estantería (`R S T…`), su entrada después de zonas y cajas.

Ejemplo (válido y canónico; lo comprueba `asciiLevel.racks.test.ts`):

```
# 1 · Estanterías de ejemplo
id: estanterias-ejemplo
limit: 1

  01234567
0 ........
1 ......R.
2 ......R.
3 .1......
4 ..a.b...
5 ....^...
6 ...c....

1 = zona ■
a = caja azul ▲        b = caja menta ▲       c = caja amarillo ■
R = estantería frente oeste: azul ● / ▲ + caja azul ● | menta ▲ / libre
```

Una estantería de 2 columnas de frente oeste (se carga desde x = 5). Columna 1 (arriba en el mapa): abajo «azul ●»
exacto, encima «cualquier ▲», donde empieza la azul ●. Columna 2: abajo «menta ▲» exacto, encima libre. Único reparto:
azul ● abajo en la columna 1 (sale de su hueco equivocado), azul ▲ al ▲, menta ▲ a su hueco exacto, amarillo ■ a la
zona. La menta ▲ encaja en la pista «▲» pero no es su destino: ahí no brillaría (una «trampa» amable).

Errores (en español, `archivo:línea:columna`): frente o dos puntos que faltan, más de 3 huecos, hueco vacío, pista
desconocida, «libre» con otra cosa, caja mal escrita tras el `+`, `/ | :` fuera de una estantería, estantería que no es
recta o cuyas columnas no cuadran con sus casillas, sin sitio delante de una columna, zona con pila, cajas ≠ objetivos,
sin reparto completo (señala la caja) o con más de uno (señala la zona o el hueco y las dos cajas posibles).

## Datos (`src/core/types.ts`)

- `LevelData.racks?: LevelRack[]` (ausente sin estanterías). `LevelRack { id, x, z, w, facing, columns: RackSlot[][] }`:
  (x, z) es la primera casilla; `columns[col][nivel]`, nivel 0 = abajo; `RackSlot { color?, symbol? }` (ninguno = libre).
- Caja que empieza en un hueco: `LevelBox` con (x, z) = su casilla de estantería y `level` = el hueco.
- Geometría compartida: `src/core/racks.ts` (`rackCellOf`, `frontCellOf`, `inwardHeading`, `slotsOf`, `slotIdOf`,
  `columnFrame`). Id de hueco: `r1:columna:nivel` (desde 0).
- Estado: `GameSnapshot.slots: SlotState[]` (estantería a estantería, columna a columna, de abajo arriba) con
  `id, rackId, column, level, cell, front, facing, pos, accepts` (pista, `null` = libre), `destined` (tipo de caja
  destinada, `null` = libre), `occupiedBy`, `satisfied`. `ZoneState.destined` (con estanterías; `null` sin ellas).
  `BoxState.slotId`. `InteractionHint.rack: RackHint | null` = `{ rackId, column, levels, level (elegido), slotId, ready }`.
- `InputFrame.forkStep?: -1 | 0 | 1`. Eventos con la misma forma y campos opcionales solo cuando tocan un hueco:
  `boxPicked.fromSlotId`, `boxDropped.slotId` (entonces `zoneId: null`, `cell` = casilla de la estantería, `level` =
  hueco, `recipeLength` 1 con pista / 0 libre), `zoneReleased { zoneId: null, slotId }` al sacar la caja destinada.

## Solución única y cajas destinadas

`core/sorting.ts`: objetivos = zonas + huecos con pista (`targetsOf`). `assignmentsOf(cajas, objetivos, límite)` cuenta
repartos completos (cada objetivo con una caja que cumple su pista, todas las cajas usadas) **por tipo de caja**, así
que cajas idénticas no cuentan dos veces: backtracking objetivo a objetivo con una comprobación de emparejamiento
(`assignBoxes`, caminos aumentantes) en cada paso, de modo que solo recorre ramas que acaban en reparto y para en el
límite. `validateLevel` exige nº de cajas = nº de objetivos y exactamente 1 reparto; `levelDestinies(level)` da el tipo
destinado de cada zona y hueco (lo usan GameState, el solver y las métricas; no se guarda en `LevelData`).

## Lógica (`src/logic`)

- Casillas de estantería sólidas para el cuerpo y para las cajas del suelo (`LevelGrid`, `CollisionWorld`). Las cajas
  de los huecos no chocan.
- **Delante de una columna** (`hint.rack`): rumbo a ≤ 30° de «hacia dentro», punto de horquilla a ≤ 0,35 de su eje y
  entre 0,8 delante de la cara y 1 dentro. Se mantiene (margen: 50°, 0,75, 1,3) para que un pequeño giro no baje la
  horquilla; al salir, el hueco elegido vuelve a 0 y la horquilla a automático. En otra estantería se empieza abajo;
  deslizándose por la misma se conserva el nivel. Con la horquilla vacía, una caja del **suelo** que la acción cogería
  ahí (p. ej. una pila aparcada en la casilla del frente) se coge como fuera de las estanterías: `hint.rack` es `null`,
  la altura es automática (la de esa caja) y F / V no hacen nada. Encarando la columna, la horquilla vacía nunca baja de
  lo que pide una pila de delante (no se hunde en ella).
- **Nivel discreto**: `forkStep` cambia el hueco elegido (0‥huecos−1); `forkHeight` va hacia él con `forkRiseRate`.
  Con la carga dentro del hueco, el nivel queda bloqueado (no atraviesa una balda). Un paso de nivel cierra la columna al
  momento; si la carga apenas asomaba en ella, sale suave (`CollisionWorld.softenRack`, al ritmo de `BOX_SETTLE_SPEED`),
  nunca de golpe.
- **Paso de la carga** (patrón `refreshLoadPassage` / `LOAD_PASS_CLEARANCE`): la columna encarada se abre para la
  carga cuando la horquilla está a ±0,25 del hueco elegido y ese hueco está vacío, y sigue abierta mientras la carga
  esté en su casilla; abierta, la carga solo choca con el panel del fondo y los dos montantes (`RACK_WALL`), así que
  entra y sale recta. Con la carga dentro, el rumbo se bloquea (`setHeadingLock`): solo adelante / atrás (el stick
  empuja o tira a lo largo del rumbo). Las horquillas vacías no chocan (como con las estanterías de siempre).
- **Coger / dejar** en el hueco elegido, solo con la horquilla a su altura: coger su caja (si la hay) o dejar en él
  (si está vacío y la carga llega a la cara); si no, `actionIdle` suave. Encarando una columna nunca se deja en el suelo,
  tampoco mientras la horquilla va hacia el hueco elegido (entonces no hay vista previa: `dropCell` es `null`). Sí se
  puede aparcar encima de una pila de la casilla del frente cuando la horquilla está sobre ella (más alta que el hueco
  elegido), y en la casilla del frente si la carga no llega a la cara.

## Solver, métricas y piloto automático

- `src/data/levels/solver.ts`: cada hueco es una posición más (`cellCount + hueco`) con una caja como mucho. Se carga
  desde la casilla de detrás del frente con un paso adelante (cualquier hueco vacío de la columna) y una caja sacada de
  un hueco solo sale marcha atrás. En niveles con estanterías cada objetivo pide su tipo destinado (sin trampas). Las
  cotas de corredores y ciclos se apagan con estanterías (las simples siguen siendo admisibles y consistentes).
- Métricas: `repartos` (= 1 en niveles con estanterías: repartos por posición), `trampas` (pista que encaja pero no es
  el destino), `huecos` (total / con pista / libres), `callejones`.
- `src/integration/autopilot.ts`: elige el hueco con `forkStep` (una pulsación por hueco, como F / V), espera a la
  horquilla, mete la carga (o coge la caja) y sale marcha atrás. `Outcome.controls` (`forkSteps`, `reverseFrames`)
  cuenta las pulsaciones de F / V y los frames marcha atrás, para que los tests comprueben que se usaron de verdad.

## Render (`src/render`)

- **Mueble** (`builders/rack.ts`, `buildRackBays`): low poly y sin travesaños diagonales (todas las caras a escuadra):
  montantes pizarra, cubierta abajo, vigas crema bajo cada hueco y encima de cada columna, el suelo de cada hueco de
  arriba (dos barras, abierto, para que la pista del hueco de abajo asome por un hueco vacío), un **panel lateral
  macizo** en cada extremo (`END_PANEL`, entre los montantes, hasta la viga de arriba de la columna del extremo) y el
  panel liso de los huecos «libre». Colores en `Theme.rack` (`frame`, `beam`, `panel`, `deck`, `line`, y los de la
  pista `cueFill`, `cueRim`, `cueInk`; nunca un tono funcional). La línea de carga del frente (`addRackLines`) es
  pintura del suelo. Medidas en `dims.ts` `RACK` (`base`, `pitch` 0,74, `beam`, `forkRest`, `forkCarry`) y
  `rackSlotY(nivel)`: el suelo del hueco n está a `base + n·pitch` (más alto que un piso de pila, así la carga pasa
  sobre la viga del hueco de encima).
- **Pista** (`buildSlotCue`, `CUE`): una **pegatina** plana, grande (casi todo el panel) y **sin iluminar**
  (`createCueMaterial`: `MeshBasicMaterial`, sin tone mapping, opaca; ni luces ni sombras la oscurecen): el frente de
  una caja con el **color exacto de la caja** que pide (`theme.boxes[color].base`, borde en su `ink`), o la pegatina
  neutra (`rack.cueFill`, borde `rack.cueRim`) si solo pide símbolo, y en medio el glifo **en negrita** en
  `rack.cueInk` (tono cálido profundo, nunca negro; ≥ 3,5:1 sobre cada color): el símbolo que pide, o el glifo de su
  color en niveles sin símbolos; solo color = sin glifo. «Libre» = panel liso. Va en las **dos caras del panel del
  fondo** y, si la columna cierra un extremo de la estantería (`cueEndSides`), en la **cara exterior de ese panel
  lateral**, a la altura de su hueco: cada una derecha y sin espejo para quien la mira (solo giros), así que la
  estantería se lee desde los 4 ángulos de cámara. Más una cinta de su color en el labio delantero del hueco. Una
  geometría por aspecto y extremos; el panel liso de detrás (`buildSlotPanel`) es aparte, para brillar.
- **Límite**: en estanterías de más de 2 columnas, las columnas del medio no tienen cara lateral: sus pistas solo se
  leen en el panel del fondo (por delante y por detrás). No hay geometría extra para ellas.
- **`views/RackView.ts`**: una por estantería (armazón fusionado + un panel con su material de brillo por hueco con
  pista, + la pista de cada hueco, fuera de la columna). Brillo **solo** con `slot.satisfied` (el ritmo de las zonas:
  sube a ≈ 0,35 y se queda en ≈ 0,15): el panel con su emisivo y la pegatina aclarando su propio color (× 1 +
  1,2 · brillo, nunca por debajo de × 1). Mientras
  llevas una caja respiran los huecos vacíos cuya pista encaja (`cueFits`); si ningún objetivo libre la acepta, los
  ocupados que encajan y no brillan respiran a ≈ ⅓ (la pista de intercambio de las zonas). Cada columna se vuelve
  fantasma por separado (prepaso de profundidad, como `ShelfView`): del todo (0,35) cuando tapa la carretilla o su carga,
  y entonces las cajas de sus huecos se desvanecen con ella; solo un poco (0,6) cuando tapa cajas en reposo o zonas.
  **Sin atenuante**: el fantasma desvanece el armazón y los paneles lisos, nunca las pistas, que siguen opacas y con su
  color entero (se dibujan en la pasada opaca, antes de cualquier fantasma, y escriben profundidad: el prepaso y el color
  del fantasma se paran en ellas). Las cajas de sus propios huecos, o la carga que entra, nunca la vuelven fantasma. Al
  terminar, los huecos con pista entran en la ola de las zonas, por distancia a la carretilla.
- **`views/SlotMarker.ts`**: marco suave alrededor del hueco elegido (`hint.rack`), por delante y por detrás: tenue al
  elegirlo, más claro con `ready`; tono neutro, o el de la caja si su pista encaja. La **vista previa** (`DropPreview`)
  flota en el suelo del hueco, algo más pequeña (entre los montantes), con el tono de la caja cuando `cueFits`.
- **Horquilla** (`ForkliftView.sync(…, atRack)`): delante de una columna `forkHeight` cuenta huecos (`rackSlotY`) y la
  horquilla va justo sobre el suelo del hueco elegido (`forkRest` vacía, `forkCarry` con carga); el paso entre alturas
  de suelo / pila y de hueco se suaviza (`RACK_BLEND_LAMBDA`) y el cabeceo casi desaparece, para que la carga entre
  nivelada. **Cajas** (`BoxView`): en reposo a `rackSlotY(level)`; al cogerlas de un hueco, salto y elevación de
  objetivo más pequeños (no tocan la viga de encima); la caída dura `DROP_GLIDE_SEC` (= `box.dropLandSec`, lo que
  espera el audio). Dejar en un hueco no hunde nada debajo (cada hueco tiene su viga).

## Audio (`src/audio`)

- `boxDropped.slotId` → `SfxPlayer.slotDrop`: «toc» metálico suave (el golpe de la caja + dos armónicos de metal
  cortos, sin nota, ≤ 2,4 kHz), un poco más agudo por nivel, sin grave de suelo y más suave que dejar sobre otra caja;
  a `DROP_LAND_SEC`, como en el suelo. La campana / madera según `Game.matchOf` (el `matchKind` de la pista) suena
  **solo** con `correct` (= el hueco tiene su caja destinada); una caja que solo encaja, o cualquiera en un «libre», da
  el toc y nada más. El último objetivo lleva el segundo golpe y el arpegio de siempre.
- `boxPicked.fromSlotId` → `SfxPlayer.slotLift`: un golpe más ligero que coger del suelo, un tono de metal tenue, un
  pequeño deslizamiento y el mismo motor de horquilla. Sacar la caja destinada (`zoneReleased.slotId`) da el tic
  neutro de siempre.
- Paso de horquilla → `AudioEngine.forkClick(nivel, dirección)`: un clic de retén a la mitad de volumen de un clic de
  UI, algo más agudo por nivel y más brillante al subir. Lo decide `Game` con `ForkStepWatcher` (`audio/forkSteps.ts`),
  solo en niveles con estanterías: suena cuando el jugador pidió un paso ese frame y `hint.rack.level` cambió en la
  misma columna (nada en el hueco de arriba del todo ni en el de abajo, fuera de una estantería, al llegar a una ni al
  pasar a una columna más baja; se reinicia al cargar el nivel).

## UI y flujo (`src/ui`, `src/game/Game.ts`)

- **Pista de controles** (`ControlHint`): fija en pantalla todo el rato que se juega, en todos los niveles (ya no se va
  tras la primera caja ni tras el primer nivel). En los niveles con estanterías (`UIState.racks`, que `Game` publica al
  cargar cada nivel) lleva debajo de la fila de mover una segunda fila, en el mismo panel suave: «F V subir / bajar
  horquilla · rueda · X B mando». Dos filas ordenadas, separadas por una línea fina; en el móvil cada fila puede partirse
  en dos líneas.
- Lo que leen render y audio: `snapshot.slots` (pista `accepts`, destino `destined`, `occupiedBy`, `satisfied`),
  `hint.rack` (hueco elegido, `ready`; `null` también al coger una caja del suelo delante de una columna),
  `hint.dropCell` / `dropLevel` (casilla de la estantería + nivel del hueco), `forklift.forkHeight` (nivel del hueco
  n = altura n, como las pilas), `box.slotId` / `box.level`. Brillo: `slot.satisfied`; respiración: `cueFits(slot, caja)`.

## Nivel Benchmark (solo Modo prueba)

- Archivo: `src/data/levels/especiales/benchmark.level` (id `benchmark`, orden 100, 10×9, `limit: 2`). El registro lo
  carga aparte (`SPECIAL_LEVELS`, `getSpecialLevel(BENCHMARK_ID)`; docs/LEVELS.md): nunca entra en `LEVELS` ni en
  ProgressStore (tiempos y desbloqueos van por los ids de `LEVELS`). Contenido y cadena de deducción: sus líneas
  `nota:`; lo comprueban `benchmark.test.ts` y `benchmarkPlayable.test.ts` (piloto automático a 60 y 20 fps con F / V
  y marcha atrás).
- **Entrada**: botón «Benchmark» del pie del título, junto al interruptor, solo con el Modo prueba encendido
  (`GameActions.startBenchmark()`; sin Modo prueba la acción no hace nada). Es un botón normal: Tab lo alcanza y
  Enter / Espacio lo pulsan. En el título el mando solo tiene A / Start = «Continuar» (igual que para los puntos de
  nivel y el interruptor), así que desde el mando se llega retomando un Benchmark en pausa.
- **No guarda nada**: ni mejor tiempo, ni desbloqueo, ni «Continuar» / último nivel; el cronómetro corre igual. HUD:
  «Benchmark» en vez de «Nivel N», con la etiqueta tenue «sin récord» (`UIState.benchmark`). Tarjeta: «Benchmark»,
  solo «Tiempo» y «Modo prueba · sin récord», botón principal «Volver al inicio» (y «Repetir»).
- **Flujo** (`Game`): R / ↺ / «Repetir» lo recargan; RePág / AvPág y `[ ]` no hacen nada en él; al terminar, la
  tarjeta lleva al título con el nivel real de «Continuar». Esc lo deja en pausa detrás del título, como cualquier
  nivel: el pie del panel lo nombra («Benchmark · sin récord») y «Continuar» o el botón lo retoman; un punto de nivel
  carga ese nivel. Apagar el Modo prueba con el Benchmark en pausa lo descarta y enseña el nivel real de «Continuar».
