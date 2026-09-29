# Mecánica: estanterías almacenables

Decisiones (2026-09-29, plan «estanterías almacenables + Benchmark»): el apilado acumulativo pasa a **estanterías
almacenables** con huecos a varias alturas y pistas de color / símbolo, con **solución única** por nivel. Los niveles
1–24 no cambian (las recetas de pila de 13–18 quedan como sistema heredado hasta el rediseño de niveles).

## Reglas
1. **Estantería almacenable** = mueble de 1 casilla de fondo, N casillas de ancho (una **columna** por casilla), de 1 a 3
   **huecos** de alto por columna (suelo + 2). Se **carga y descarga solo por el frente** (`facing`): la casilla de delante
   de cada columna es donde se pone la carretilla, mirando a la estantería. La **pista** de cada hueco (en su panel del
   fondo) **se ve desde las dos caras**: leerla no exige mirar el frente; el frente solo decide desde dónde se carga.
2. Se distinguen de las estanterías-obstáculo (madera + cajas kraft): son otro mueble (render, fase siguiente).
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
  deslizándose por la misma se conserva el nivel.
- **Nivel discreto**: `forkStep` cambia el hueco elegido (0‥huecos−1); `forkHeight` va hacia él con `forkRiseRate`.
  Con la carga dentro del hueco, el nivel queda bloqueado (no atraviesa una balda).
- **Paso de la carga** (patrón `refreshLoadPassage` / `LOAD_PASS_CLEARANCE`): la columna encarada se abre para la
  carga cuando la horquilla está a ±0,25 del hueco elegido y ese hueco está vacío, y sigue abierta mientras la carga
  esté en su casilla; abierta, la carga solo choca con el panel del fondo y los dos montantes (`RACK_WALL`), así que
  entra y sale recta. Con la carga dentro, el rumbo se bloquea (`setHeadingLock`): solo adelante / atrás (el stick
  empuja o tira a lo largo del rumbo). Las horquillas vacías no chocan (como con las estanterías de siempre).
- **Coger / dejar** en el hueco elegido, solo con la horquilla a su altura: coger su caja (si la hay) o dejar en él
  (si está vacío y la carga llega a la cara); si no, `actionIdle` suave. Encarando una columna nunca se deja en el suelo.

## Solver, métricas y piloto automático

- `src/data/levels/solver.ts`: cada hueco es una posición más (`cellCount + hueco`) con una caja como mucho. Se carga
  desde la casilla de detrás del frente con un paso adelante (cualquier hueco vacío de la columna) y una caja sacada de
  un hueco solo sale marcha atrás. En niveles con estanterías cada objetivo pide su tipo destinado (sin trampas). Las
  cotas de corredores y ciclos se apagan con estanterías (las simples siguen siendo admisibles y consistentes).
- Métricas: `repartos` (= 1 en niveles con estanterías: repartos por posición), `trampas` (pista que encaja pero no es
  el destino), `huecos` (total / con pista / libres), `callejones`.
- `src/integration/autopilot.ts`: elige el hueco con `forkStep` (una pulsación por hueco, como F / V), espera a la
  horquilla, mete la carga (o coge la caja) y sale marcha atrás.

## Para el render / UI (fase siguiente)

- Leer `snapshot.slots` (pista `accepts`, destino `destined`, `occupiedBy`, `satisfied`), `hint.rack` (hueco elegido,
  `ready`), `hint.dropCell`/`dropLevel` (casilla de la estantería + nivel del hueco), `forklift.forkHeight` (nivel del
  hueco n = altura n, como las pilas), `box.slotId`/`box.level`.
- Brillo: `slot.satisfied` (solo con la caja destinada). Respiración al llevar una caja: `cueFits(slot, caja)`.
- Audio: `boxDropped.slotId` + `Game.matchOf` (tipo de encaje de la pista del hueco), `zoneReleased.slotId`.
