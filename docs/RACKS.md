# Mecánica: estanterías almacenables

Decisiones (2026-09-29, plan «estanterías almacenables + Benchmark»): el apilado acumulativo pasa a **estanterías
almacenables** con huecos a varias alturas y pistas de color / símbolo, con **solución única** por nivel. Hoy solo el
nivel especial **Benchmark** (Modo prueba, ver abajo) usa estanterías: el juego trae los niveles 1–3, sin estanterías
(los niveles 4–24 se retiraron el 2026-09-30 para rehacerlos; las recetas de pila que usaban 13–18 quedan como sistema
heredado).

Decisiones (2026-09-30), **solo en niveles con estanterías**: la caja destinada queda **fija** en su objetivo (reglas
10–11), una caja en un objetivo que no es su destino da un **zumbido suave** (regla 12) y, mientras llevas una caja, los
objetivos cuya pista encaja **brillan mucho más** que antes (regla 5). Los niveles sin estanterías no cambian.

Decisión (2026-09-30, muelles de carga, docs/DOCKS.md): un nivel con **camiones** sigue todas las reglas de «niveles con
estanterías» de este documento, tenga o no estanterías. En el código la puerta es `usesTargetRules(level)`
(`core/docks.ts`: estanterías o camiones); donde aquí se dice «con estanterías», léase «con estanterías o camiones».

Decisión (2026-09-30, cajas a la vista): las estanterías **ya no tienen paredes laterales macizas**, que tapaban las
cajas de sus huecos. Cada extremo lleva solo una **placa translúcida** muy tenue (opacidad 0,2) que sostiene las pistas
del lateral; las cajas de la columna del extremo se ven a través. Las **pistas no cambian**: mismo sitio, mismo tamaño,
color entero, nunca atenuadas ni en espejo, en los dos extremos (ver «Render»).

## Reglas
1. **Estantería almacenable** = mueble de 1 casilla de fondo, N casillas de ancho (una **columna** por casilla), de 1 a 3
   **huecos** de alto por columna (suelo + 2). Se **carga y descarga solo por el frente** (`facing`): la casilla de delante
   de cada columna es donde se pone la carretilla, mirando a la estantería. La **pista** de cada hueco (en su panel del
   fondo) **se ve desde las dos caras** y, en las columnas de los extremos, también **en el lateral** (sobre su placa
   translúcida), hueco a hueco: leerla no exige mirar el frente (la estantería se lee desde los 4 ángulos de cámara); el
   frente solo decide desde dónde se carga.
2. Se distinguen de las estanterías-obstáculo (madera + cajas kraft): son otro mueble, de metal pizarra con vigas crema,
   formas simples (sin travesaños diagonales), huecos abiertos, extremos abiertos (sin pared lateral: solo una placa
   translúcida que sostiene las pistas y deja ver las cajas), pista en el panel del fondo y una línea de carga pintada en
   el suelo del frente (ver «Render»).
3. **Pista del hueco**: color = pide ese color; símbolo = pide ese símbolo; color + símbolo = esa caja exacta. Hueco
   **«libre»** (sin pista) = almacén sin destino: guarda cualquier caja y nunca cuenta como objetivo.
4. **Solución única**: cada zona y cada hueco con pista (los **objetivos**) tiene **una** caja destinada; las pistas se
   combinan para que exista exactamente un reparto completo (cajas idénticas son intercambiables). Lo comprueba
   `validateLevel`.
5. **Solo brilla con su caja**: un objetivo solo se cumple (brilla) con su caja destinada; otra caja que encaje en la
   pista lo deja neutro (nunca rojo ni texto; solo el zumbido de la regla 12). Al llevar una caja **laten con claridad
   los objetivos cuya pista encaja** (pista, no solución: `cueFits` frente a `isDestined`), huecos y zonas, en el tono de
   la caja: un pulso unas 4 veces más fuerte que la respiración suave de antes, al mismo ritmo tranquilo.
6. **Huecos independientes**: se llenan y vacían en cualquier orden (no hay que llenar el de abajo primero).
7. **Altura por huecos**: delante de una estantería, **F sube / V baja** un hueco, igual que la **rueda del ratón** (un
   paso de rueda = un hueco) y el mando (**X sube / B baja**). Fuera de las estanterías la horquilla es automática, como
   siempre. La rueda es solo de la horquilla (acordado 2026-09-30): el zoom de cámara va con **+ / −**, pellizcar y
   **LT / RT**; solo Ctrl + rueda (lo que manda un pellizco en el trackpad) hace zoom.
8. **Suelo**: apilar en el suelo sigue permitido **solo como aparcamiento** (`limit:` o una pila inicial); las zonas de
   suelo piden una caja (sin recetas) y también siguen la regla «solo brilla con su caja».
9. Niveles sin estanterías: exactamente como antes (sin cajas fijas, sin zumbido, el brillo de siempre).
10. **Caja fija** (2026-09-30): la caja destinada, sola en su zona o en su hueco con pista, está **hecha**: al dejarla,
    el brillo del objetivo destella intenso, suena la campana de siempre y salta un pequeño efecto de acierto; el brillo
    se asienta suave y la caja pasa despacio a un **tono más hondo de su mismo color**. Desde entonces **no se puede
    coger** (la acción ahí da el `actionIdle` suave) y **no se deja ni apila nada encima**. Una caja que empieza en su
    destino ya empieza fija (sin efecto al cargar).
11. Como una caja fija no vuelve a salir, colocar una caja en su destino no se deshace: un nivel con estanterías no
    debe tener un destino que, ocupado, cierre el paso a lo que queda (`deadEnds` lo cuenta como callejón, ver «Solver»).
12. **Objetivo equivocado**: una caja que cae en una zona o en un hueco con pista que **no** es su destino (también la
    «trampa» que encaja en la pista) suena con un **zumbido de error suave** y se queda cogible, sin nada visual. Los
    huecos «libre» y el suelo sin zona nunca zumban.

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
zona. La menta ▲ encaja en la pista «▲» pero no es su destino: ahí no brillaría y sonaría el zumbido suave (una
«trampa» amable).

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
- `BoxState.locked: boolean` (2026-09-30): `true` mientras la caja descansa sola en su zona o su hueco destinado (el
  objetivo `satisfied`, reglas 10–11), también al empezar el nivel; siempre `false` en niveles sin estanterías. Una caja
  fija nunca es objetivo de coger (`targetBoxId`) ni de dejar o apilar (`dropCell`); en un hueco con una caja fija,
  `hint.rack.ready` es `false`.
- `InputFrame.forkStep?: -1 | 0 | 1`. Eventos con la misma forma y campos opcionales solo cuando tocan un hueco:
  `boxPicked.fromSlotId`, `boxDropped.slotId` (entonces `zoneId: null`, `cell` = casilla de la estantería, `level` =
  hueco, `recipeLength` 1 con pista / 0 libre), `zoneReleased { zoneId: null, slotId }` al sacar la caja destinada (ya
  no ocurre en niveles con estanterías: la caja destinada está fija; tampoco el `zoneReleased` de una zona).
- `boxDropped.wrongTarget?: true` (2026-09-30), solo en niveles con estanterías: la caja cayó en una zona o en un hueco
  con pista que no quedó cumplido con ella (no es su destino; la trampa que encaja en la pista, también). Nunca vale
  `false`: falta con su destino (`correct`), en un hueco «libre», en el suelo sin zona y en todo nivel sin estanterías,
  así que allí los eventos conservan su forma exacta.

## Solución única y cajas destinadas

`core/sorting.ts`: objetivos = zonas + huecos con pista (`targetsOf`). `assignmentsOf(cajas, objetivos, límite)` cuenta
repartos completos (cada objetivo con una caja que cumple su pista, todas las cajas usadas) **por tipo de caja**, así
que cajas idénticas no cuentan dos veces: backtracking objetivo a objetivo con una comprobación de emparejamiento
(`assignBoxes`, caminos aumentantes) en cada paso, de modo que solo recorre ramas que acaban en reparto y para en el
límite. `validateLevel` exige nº de cajas = nº de objetivos y exactamente 1 reparto; `levelDestinies(level)` da el tipo
destinado de cada zona y hueco (lo usan GameState, el solver y las métricas; no se guarda en `LevelData`). Con camiones
(docs/DOCKS.md) los niveles de camión son objetivos también (`targetsOf` los pone detrás de los huecos, `kind: 'truck'`)
y `levelDestinies` trae además `trucks` (`[]` sin camiones).

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
- **Cajas fijas** (`GameState.refreshSlot` / `refreshZone`): `locked` = hueco o zona `satisfied` con esa caja (una zona
  con estanterías pide una caja: su receta es de 1). Se calcula siempre que cambia el objetivo, así que una caja
  destinada que empieza debajo de otra (pila inicial en su zona) queda fija cuando se levanta la de encima. Coger la
  quita (`locked = false`), pero una caja fija no se coge: `Interaction.findPickTarget` la salta y `findDrop` nunca
  ofrece su casilla (ni suelo ni pila). Para la carga, una caja fija es como una pila llena: la horquilla no sube para
  pasar sobre ella y la carga no la atraviesa (`refreshLoadPassage`, `clearLevel`); la excepción es la carga que se
  acaba de levantar de encima de ella, que sigue alta hasta salir de su casilla, sin sacudidas.
- **Objetivo equivocado**: `dropCarried` / `dropInSlot` marcan `wrongTarget` cuando el objetivo sigue sin cumplir tras
  dejar la caja (zona: solo con estanterías; hueco: con pista). Nada más cambia: la caja se queda cogible.

## Solver, métricas y piloto automático

- `src/data/levels/solver.ts`: cada hueco es una posición más (`cellCount + hueco`) con una caja como mucho. Se carga
  desde la casilla de detrás del frente con un paso adelante (cualquier hueco vacío de la columna) y una caja sacada de
  un hueco solo sale marcha atrás. En niveles con estanterías cada objetivo pide su tipo destinado (sin trampas). Las
  cotas de corredores y de ciclos de intercambio (zonas del suelo) se apagan con estanterías; en su lugar (2026-09-30)
  va la cota de **ciclos de destinos**: Σ costes de hueco + 1 por ciclo de cajas que descansan cada una en el destino de
  la siguiente (zonas y huecos; `MoveSearch.destTerm` / `targetDestinations`), admisible y consistente (lo comprueba
  `levels/docks.test.ts`). Con ella el Benchmark sale exacto sin búsqueda: la cota ya da 14, lo que hace su primer plan.
- **Cajas fijas en el modelo**: `lockedAt(grid, stacks, pos)` (su caja destinada, sola en su zona o hueco; siempre
  `false` sin estanterías), `canLift` y `canStackOn` / `validDrop` / `carrySearch`: las búsquedas, la repetición de un
  plan (`applyMove`) y `deadEnds` nunca levantan una caja fija ni dejan nada sobre ella. Sin estanterías todo movimiento
  se deshace (marcha atrás) y `deadEnds` solo comprueba a fondo los que no; con estanterías, dejar una caja en su
  destino ya no se deshace, así que **cada** movimiento que fija una caja pasa la comprobación completa (voraz y luego
  exacta): un destino que, ocupado, cierra el paso a lo que queda sale como callejón.
- Métricas: `repartos` (= 1 en niveles con estanterías: repartos por posición), `trampas` (pista que encaja pero no es
  el destino), `huecos` (total / con pista / libres), `callejones`. Una caja fija desde el principio nunca cuenta como
  la que tapa el paso (`blockersOf`): no se va a mover; tampoco es un sitio al que haya que llegar, así que la caja que
  solo abre el paso hacia ella no cuenta. Benchmark (con su camión, 2026-09-30): `repartos` 1, `callejones` 0,
  14 movimientos (exacto), 12 objetivos (3 zonas + 6 huecos con pista + 3 niveles de camión).
- `src/integration/autopilot.ts`: elige el hueco con `forkStep` (una pulsación por hueco, como F / V), espera a la
  horquilla, mete la carga (o coge la caja) y sale marcha atrás. `Outcome.controls` (`forkSteps`, `reverseFrames`)
  cuenta las pulsaciones de F / V y los frames marcha atrás, para que los tests comprueben que se usaron de verdad.

## Render (`src/render`)

- **Mueble** (`builders/rack.ts`, `buildRackBays`): low poly y sin travesaños diagonales (todas las caras a escuadra):
  montantes pizarra, cubierta abajo, vigas crema bajo cada hueco y encima de cada columna, el suelo de cada hueco de
  arriba (dos barras, abierto, para que la pista del hueco de abajo asome por un hueco vacío) y el panel liso de los
  huecos «libre». **Sin pared lateral**: en cada extremo solo hay una **placa translúcida** (`END_PLATE`, entre los
  montantes, hasta la viga de arriba de la columna del extremo), una geometría aparte al final de las de
  `buildRackBays` (marcada con su columna, `endPlateColumn`; una sola para las dos puntas de una estantería de una
  columna). Solo sostiene las pistas del lateral; las cajas de la columna del extremo se ven a través. Colores en
  `Theme.rack` (`frame`, `beam`, `panel` —también la placa—, `deck`, `line`, y los de la pista `cueFill`, `cueRim`,
  `cueInk`; nunca un tono funcional). La línea de carga del frente (`addRackLines`) es pintura del suelo. Medidas en
  `dims.ts` `RACK` (`base`, `pitch` 0,74, `beam`, `forkRest`, `forkCarry`) y `rackSlotY(nivel)`: el suelo del hueco n
  está a `base + n·pitch` (más alto que un piso de pila, así la carga pasa sobre la viga del hueco de encima).
- **Pista** (`buildSlotCue`, `CUE`): una **pegatina** plana, grande (casi todo el panel) y **sin iluminar**
  (`createCueMaterial`: `MeshBasicMaterial`, sin tone mapping, opaca; ni luces ni sombras la oscurecen): el frente de
  una caja con el **color exacto de la caja** que pide (`theme.boxes[color].base`, borde en su `ink`), o la pegatina
  neutra (`rack.cueFill`, borde `rack.cueRim`) si solo pide símbolo, y en medio el glifo **en negrita** en
  `rack.cueInk` (tono cálido profundo, nunca negro; ≥ 3,5:1 sobre cada color): el símbolo que pide, o el glifo de su
  color en niveles sin símbolos; solo color = sin glifo. «Libre» = panel liso. Va en las **dos caras del panel del
  fondo** y, si la columna cierra un extremo de la estantería (`cueEndSides`), en la **cara exterior de la placa de
  ese extremo** (justo donde estaba la cara del antiguo panel lateral: mismo sitio, mismo tamaño, color entero), a la
  altura de su hueco: cada una derecha y sin espejo para quien la mira (solo giros), así que la estantería se lee desde
  los 4 ángulos de cámara. Más una cinta de su color en el labio delantero del hueco. Una geometría por aspecto y
  extremos; el panel liso de detrás (`buildSlotPanel`) es aparte, para brillar.
- **Límite**: en estanterías de más de 2 columnas, las columnas del medio no tienen cara lateral: sus pistas solo se
  leen en el panel del fondo (por delante y por detrás). No hay geometría extra para ellas.
- **Placa del extremo** (`RackBay.addPlate`, `END_PLATE_OPACITY` 0,2): va con la columna de su extremo, con material
  propio (el del armazón, iluminado), **nunca escribe profundidad**, no proyecta sombra sobre las cajas y no tiene
  prepaso de profundidad, así lo que queda detrás (cajas, armazón) se sigue dibujando. Con la columna sólida se dibuja
  después de la estantería sólida, de las cajas y de los brillos del suelo, banda y marco (`renderOrder` 2,5), para
  teñir lo que tiene detrás; con la columna fantasma se desvanece con ella (0,2 × su opacidad), justo después de su
  pasada de color.
- **`views/RackView.ts`**: una por estantería (armazón fusionado + un panel con su material de brillo por hueco con
  pista, + la pista de cada hueco, fuera de la columna, + su **banda de luz**: `buildSlotGlowGeometry`, `SLOT_GLOW`, un
  marco suave con borde difuminado justo por fuera del hueco en las dos caras, sobre montantes y vigas, que nunca tapa
  una pista ni el paso de la carga). Brillo **solo** con `slot.satisfied`: el destello y el reposo de
  `views/success.ts` (abajo). El panel brilla con su emisivo y la pegatina aclara su propio color (× 1 + 1,2 · brillo,
  nunca por debajo de × 1 ni por encima del tope `CUE_GLOW_CAP` 0,45: siempre un pastel de su color, nunca blanco).
  Mientras llevas una caja **laten** los huecos vacíos cuya pista encaja (`cueFits`): brillo `INVITE_BASE` 0,4 ±
  `INVITE_PULSE` 0,16 (0,24–0,56; antes 0,03–0,17) a `INVITE_RATE` 2,3, y la banda a 0,6 ± 0,25 de opacidad, todo en
  el tono de la caja llevada (`SlotTone`: banda = color de la caja, panel = brillo de zona de ese color), así una pista
  solo de símbolo no queda crema sobre crema. Si ningún objetivo libre la acepta, los ocupados que encajan y no brillan
  laten con la fuerza de la pista de intercambio de siempre (`RACK_SWAP_INVITE` 0,1). Cada columna se vuelve
  fantasma por separado (prepaso de profundidad, como `ShelfView`): del todo (0,35) cuando tapa la carretilla o su carga,
  y entonces las cajas de sus huecos se desvanecen con ella; solo un poco (0,6) cuando tapa cajas en reposo o zonas.
  **Sin atenuante**: el fantasma desvanece el armazón, los paneles lisos y la placa del extremo, nunca las pistas
  (tampoco las del lateral), que siguen opacas y con su color entero (se dibujan en la pasada opaca, antes de cualquier
  fantasma, y escriben profundidad: el prepaso y el color del fantasma se paran en ellas). Las cajas de sus propios
  huecos, o la carga que entra, nunca la vuelven fantasma. Al terminar, los huecos con pista entran en la ola de las
  zonas, por distancia a la carretilla.
- **`views/SlotMarker.ts`**: marco suave alrededor del hueco elegido (`hint.rack`), por delante y por detrás: tenue al
  elegirlo, más claro con `ready`; tono neutro, o el de la caja si su pista encaja. La **vista previa** (`DropPreview`)
  flota en el suelo del hueco, algo más pequeña (entre los montantes), con el tono de la caja cuando `cueFits`.
- **Horquilla** (`ForkliftView.sync(…, atRack)`): delante de una columna `forkHeight` cuenta huecos (`rackSlotY`) y la
  horquilla va justo sobre el suelo del hueco elegido (`forkRest` vacía, `forkCarry` con carga); el paso entre alturas
  de suelo / pila y de hueco se suaviza (`RACK_BLEND_LAMBDA`) y el cabeceo casi desaparece, para que la carga entre
  nivelada. **Cajas** (`BoxView`): en reposo a `rackSlotY(level)`; al cogerlas de un hueco, salto y elevación de
  objetivo más pequeños (no tocan la viga de encima); la caída dura `DROP_GLIDE_SEC` (= `box.dropLandSec`, lo que
  espera el audio). Dejar en un hueco no hunde nada debajo (cada hueco tiene su viga).
- **Zonas con estanterías** (`ZoneView`, `rack`): la almohadilla y su halo laten como los huecos (`INVITE_*`, halo hasta
  0,85) en el tono de la caja llevada (una zona «cualquier ▲» se enciende del color de la caja, no crema sobre crema) y,
  cumplida, brillan en el tono de su caja destinada. Sin estanterías, la respiración suave de siempre (0,1 ± 0,07).
- **Acierto y caja fija** (`views/success.ts`, solo con estanterías; `LevelView` lo dispara cuando una zona o un hueco
  pasa a `satisfied`, nunca al cargar). Desde que la caja aterriza (`DROP_GLIDE_SEC`):
  1. el objetivo **destella** a `FLASH_PEAK` 0,8 (subida rápida, `FLASH_RISE_SHARE` 14 %) y baja con calma al reposo
     `TARGET_REST` 0,15; todo el destello dura `FLASH_SEC` 0,85 s (en los huecos, panel, pegatina y banda a 0,9);
  2. a la vez, un **efecto de acierto** (`SuccessBurst`, `BURST_SEC` 0,65 s): 7 destellos pequeños (octaedros) del color
     de la caja, algo aclarado, que se abren y se apagan; en un hueco, además, un anillo redondeado que crece alrededor
     de la boca, en la cara que ve la cámara (la zona usa su propio anillo de suelo, un poco más fuerte: 0,65). Dos
     efectos en reserva, creados al cargar el nivel (nada se crea por frame) y liberados con él;
  3. tras el destello (`LOCK_DELAY` = `DROP_GLIDE_SEC` + `FLASH_SEC`), la caja pasa en `LOCK_SEC` 0,6 s a su **tono
     hondo** (`BoxPalette.locked`, `lockTintOf`: cada tono pintado de la caja × `locked / base`, así cinta y símbolo
     conservan su contraste) y su brillo tenue de «correcta» se apaga: se lee hecha y fija.
  Tonos hondos (`Theme.boxes[color].locked`, mismo matiz ≈ 8–9 puntos más oscuro, nunca negro ni rojo): azul `#76a4d7`,
  menta `#6cbf99`, amarillo `#e8c060`, coral `#e59ea9` (hacia rosa: nunca rojo, ni en un hueco en sombra), lavanda
  `#9e86cd`. Al cargar o reiniciar, una caja ya fija sale con su tono hondo sin repetir nada; la ola de nivel completo
  pasa también por las cajas fijas.
- **Cajas fijas en pantalla**: sin salto ni brillo de «la cogería» aunque una pista la nombre, el marco del hueco elegido
  se queda tenue (`ready` falso) y no hay vista previa encima (`dropsOnLocked`). Un objetivo equivocado no enseña nada:
  solo suena (ver «Audio»).

## Audio (`src/audio`)

- `boxDropped.slotId` → `SfxPlayer.slotDrop`: «toc» metálico suave (el golpe de la caja + dos armónicos de metal
  cortos, sin nota, ≤ 2,4 kHz), un poco más agudo por nivel, sin grave de suelo y más suave que dejar sobre otra caja;
  a `DROP_LAND_SEC`, como en el suelo. La campana / madera según `Game.matchOf` (el `matchKind` de la pista) suena
  **solo** con `correct` (= el hueco tiene su caja destinada); una caja que solo encaja, o cualquiera en un «libre», da
  el toc y nada más. El último objetivo lleva el segundo golpe y el arpegio de siempre.
- `boxPicked.fromSlotId` → `SfxPlayer.slotLift`: un golpe más ligero que coger del suelo, un tono de metal tenue y un
  pequeño deslizamiento. La subida de la carga la pone el zumbido continuo de la bomba de la horquilla (`MotorSound`,
  abajo); el deslizamiento de servo de una sola vez que llevaban `pickup` y `slotLift` se quitó (2026-09-30: se
  solapaba con la bomba). Sacar la caja destinada (`zoneReleased.slotId`) daba el tic neutro de siempre; con las cajas
  fijas ya no ocurre.
- **Zumbido de objetivo equivocado** (2026-09-30): `boxDropped` con `wrongTarget` y sin `correct` (`isWrongTarget`) →
  `SfxPlayer.wrongBuzz`, en zonas y en huecos con pista (la trampa que encaja, también). Suena después del golpe / toc
  de siempre, a `DROP_LAND_SEC` + `WRONG_AFTER_LAND_SEC` (0,05 s: donde sonaría la campana de la caja destinada). Un
  «no» suave y apagado de ≈ 0,2 s: un tono triangular grave (`WRONG_BUZZ_HZ` ≈ 185 Hz) y una sierra más floja a × 1,055
  (`WRONG_BUZZ_DETUNE`: un batido lento de ≈ 10 Hz, el «bzz»), los dos bajando un poco (hasta × 0,86) bajo un paso bajo
  cálido a 620 Hz; sin ruido, sin campana ni madera, con un pico por debajo del tic de «nada que hacer» y muy por debajo
  del golpe de la caja. Nunca en un «libre», en el suelo sin zona, con la caja destinada ni en niveles sin estanterías.
- Paso de horquilla → `AudioEngine.forkClick(nivel, dirección)`: un clic de retén a la mitad de volumen de un clic de
  UI, algo más agudo por nivel y más brillante al subir. Lo decide `Game` con `ForkStepWatcher` (`audio/forkSteps.ts`),
  solo en niveles con estanterías: suena cuando el jugador pidió un paso ese frame y `hint.rack.level` cambió en la
  misma columna (nada en el hueco de arriba del todo ni en el de abajo, fuera de una estantería, al llegar a una ni al
  pasar a una columna más baja; se reinicia al cargar el nivel).
- **Sonidos de la carretilla** (2026-09-30, `audio/motor.ts`, `audio/beeper.ts`; en todos los niveles): mientras la
  horquilla sube suena la bomba (`FORK.upHz` 150 Hz, algo más aguda por hueco), al bajar un tono más suave y grave
  (`FORK.downHz` 104 Hz) con un soplo leve, y al llegar al hueco un «clonc» pequeño (`CLUNK`: solo tras ≥ 0,15 s de
  recorrido, como mucho uno cada 0,3 s y nunca a < 0,8 s de coger o dejar una caja). Así un paso de F / V suena clic al
  empezar, bomba mientras va y clonc al llegar. Sacar la carga de un hueco marcha atrás suena el pitido de marcha atrás.
  Detalle y ajustes: docs/ARCHITECTURE.md («Audio direction»).

## UI y flujo (`src/ui`, `src/game/Game.ts`)

- **Pista de controles** (`ControlHint`): fija en pantalla todo el rato que se juega, en todos los niveles (ya no se va
  tras la primera caja ni tras el primer nivel). En los niveles con estanterías (`UIState.racks`, que `Game` publica al
  cargar cada nivel) lleva debajo de la fila de mover (que acaba en «+ − zoom») una segunda fila, en el mismo panel
  suave: «F V subir / bajar horquilla · rueda · X B mando». Dos filas ordenadas, separadas por una línea fina; en el
  móvil cada fila puede partirse en dos líneas.
- Lo que leen render y audio: `snapshot.slots` (pista `accepts`, destino `destined`, `occupiedBy`, `satisfied`),
  `hint.rack` (hueco elegido, `ready`; `null` también al coger una caja del suelo delante de una columna),
  `hint.dropCell` / `dropLevel` (casilla de la estantería + nivel del hueco), `forklift.forkHeight` (nivel del hueco
  n = altura n, como las pilas), `box.slotId` / `box.level`, `box.locked` (tono hondo, sin vista previa encima) y
  `boxDropped.wrongTarget` (solo el audio). Brillo y destello: `satisfied` de zonas y huecos; latido: `cueFits(slot, caja)`.

## Nivel Benchmark (solo Modo prueba)

- Archivo: `src/data/levels/especiales/benchmark.level` (id `benchmark`, orden 100, 11×9, `limit: 2`). El registro lo
  carga aparte (`SPECIAL_LEVELS`, `getSpecialLevel(BENCHMARK_ID)`; docs/LEVELS.md): nunca entra en `LEVELS` ni en
  ProgressStore (tiempos y desbloqueos van por los ids de `LEVELS`). Contenido y cadena de deducción: sus líneas
  `nota:`; lo comprueban `benchmark.test.ts` y `benchmarkPlayable.test.ts` (piloto automático a 60 y 20 fps con F / V
  y marcha atrás). Desde el 2026-09-30 lleva también un camión en el muelle norte (T, docs/DOCKS.md «Nivel
  Benchmark»): 12 cajas, 12 objetivos, 14 movimientos.
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
