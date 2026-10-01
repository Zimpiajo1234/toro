# Estanterías almacenables (aspecto `rack`)

El aspecto `rack` del almacenaje común: una estantería de metal con huecos a varias alturas, cada uno con su pista de
color / símbolo, que se carga por su frente (acceso `front`, soporte `shelves`: `STORAGE_SKINS.rack`). Las reglas que
comparte con todo el almacenaje (objetivos y solución única, caja fija, zumbido, «libre», horquilla con F / V, pistas P,
la luz y el sonido de un acierto) están en docs/STORAGE.md; aquí, lo propio de la estantería: su mueble, su acceso, su
gramática, su dibujo y su sonido. Hoy solo el nivel especial **Benchmark** (Modo prueba, abajo) usa estanterías: el
juego trae los niveles 1–3, sin almacenaje (los niveles 4–24 se retiraron el 2026-09-30 para rehacerlos; las recetas de
pila que usaban 13–18 quedan como sistema heredado).

## Decisiones

- 2026-09-29 (plan «estanterías almacenables + Benchmark»): el apilado acumulativo pasa a **estanterías almacenables**
  con huecos a varias alturas y pistas de color / símbolo, con **solución única** por nivel.
- 2026-09-30: la caja destinada queda **fija**, una caja en un objetivo que no es su destino da un **zumbido suave** y,
  mientras llevas una caja, los objetivos cuya pista encaja **brillan mucho más** (docs/STORAGE.md, reglas 5, 6 y 10).
- 2026-09-30 («los hint cuando coges una caja, hagamos que sea desactivable, que se use como pista si el user
  quiere»): ese latido es una **pista opcional**, solo con las pistas encendidas (**P**, apagadas por defecto).
- 2026-09-30 (cajas a la vista): las estanterías **no tienen paredes laterales macizas**, que tapaban las cajas de sus
  huecos. Cada extremo lleva solo una **placa translúcida** muy tenue (opacidad 0,2) que sostiene las pistas del
  lateral; las cajas de la columna del extremo se ven a través. Las pistas no cambian: mismo sitio, mismo tamaño, color
  entero, nunca atenuadas ni en espejo, en los dos extremos.

## El mueble

1. Una **estantería almacenable** mide 1 casilla de fondo y N de ancho (una **columna** por casilla), con 1 a 3
   **huecos** por columna (suelo + 2). Cada hueco es aparte (soporte `shelves`): se llena y se vacía en cualquier orden.
2. Se **carga y descarga solo por el frente** (`facing`): la casilla de delante de cada columna es donde se pone la
   carretilla, mirando a la estantería. La **pista** de cada hueco (en su panel del fondo) **se ve desde las dos caras**
   y, en las columnas de los extremos, también **en el lateral** (sobre su placa translúcida), hueco a hueco: la
   estantería se lee desde los 4 ángulos de cámara; el frente solo decide desde dónde se carga. Si una estantería te da
   la espalda, se rodea para cargarla.
3. Es otro mueble que las estanterías-obstáculo (madera + cajas kraft): metal pizarra con vigas crema, formas simples
   (sin travesaños diagonales), huecos abiertos, extremos abiertos con su placa translúcida, la pista en el panel del
   fondo y una línea de carga pintada en el suelo del frente.
4. **Límite**: en estanterías de más de 2 columnas, las columnas del medio no tienen cara lateral: sus pistas solo se
   leen en el panel del fondo (por delante y por detrás).

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
desconocida, «libre» con otra cosa, caja mal escrita tras el `+`, `/ | :` fuera de una estantería o un camión,
estantería que no es recta o cuyas columnas no cuadran con sus casillas, sin sitio delante de una columna, una
estantería cargada desde la puerta de un camión (a través de su barandilla), zona con pila, cajas ≠ objetivos, sin
reparto completo (señala la caja) o con más de uno (señala la zona o el hueco y las dos cajas posibles).

En los datos es una unidad `rack` de `LevelData.storage` (docs/STORAGE.md «Modelo»): `access: { kind: 'front',
facing }`, (x, z) su primera casilla (la más al oeste de un frente norte / sur, la más al norte de uno este / oeste) y
`columns[col][nivel]`, nivel 0 = abajo (`null` = libre). Una caja que empieza en un hueco es una `LevelBox` con (x, z) =
su casilla de estantería y `level` = el hueco. Un nivel JSON antiguo la escribía en `racks` (`{ id, x, z, w, facing,
columns }`, «libre» = `{}`): validateLevel lo sigue leyendo.

## El acceso `front`

La tabla del acceso y lo común de la lógica: docs/STORAGE.md («Acceso», «Contratos por capa»). Lo que hace en una
estantería:

- **Celdas sólidas** para el cuerpo y para las cajas del suelo (`LevelGrid`, `CollisionWorld`). Las cajas de los huecos
  no chocan solas (`shelfSlots`): su columna lo hace.
- **Encarar una columna**: rumbo a ≤ 30° de «hacia dentro», punto de horquilla a ≤ 0,35 de su eje y entre 0,8 delante
  de la cara y 1 dentro. Se mantiene (margen: 50°, 0,75, 1,3) para que un pequeño giro no baje la horquilla; al salir,
  el hueco elegido vuelve a 0 y la horquilla a automático. En otra estantería se empieza abajo; deslizándose por la
  misma se conserva el nivel. Con la horquilla vacía, una caja del **suelo** que la acción cogería ahí (p. ej. una pila
  aparcada en la casilla del frente) se coge como fuera de las estanterías: `hint.storage` es `null`, la altura es
  automática (la de esa caja) y F / V no hacen nada. Encarando la columna, la horquilla vacía nunca baja de lo que pide
  una pila de delante (no se hunde en ella).
- **Nivel**: F / V cambian el hueco elegido (0‥huecos−1) y `forkHeight` va hacia él con `forkRiseRate`. Con la carga
  dentro del hueco, el nivel no cambia (no atraviesa una balda). Un paso de nivel cierra el hueco abierto; si la carga
  apenas asomaba en él, sale suave (`CollisionWorld.soften`, al ritmo de `BOX_SETTLE_SPEED`), nunca de golpe.
- **Paso de la carga**: la columna encarada se abre para la carga cuando la horquilla está a ±0,25 del hueco elegido y
  ese hueco está vacío, y sigue abierta mientras la carga esté en su casilla; abierta, la carga solo choca con el panel
  del fondo y los dos montantes (`RACK_WALL`), así que entra y sale recta. Con la carga dentro (`loadInOpening`), el
  rumbo se bloquea (`setHeadingLock`): solo adelante / atrás. Las horquillas vacías no chocan (como con las estanterías
  de siempre).
- **Coger / dejar** en el hueco elegido, solo encarada y con la horquilla a su altura: coger su caja (si la hay y no
  está fija) o dejar en él (si está vacío y la carga llega a la cara: `dropReach`); si no, `actionIdle` suave.
  Encarando una columna nunca se deja en el suelo, tampoco mientras la horquilla va hacia el hueco elegido (entonces no
  hay vista previa: `StorageAim.blocked`). Sí se puede aparcar encima de una pila de la casilla del frente cuando la
  horquilla está sobre ella (más alta que el hueco elegido), y en la casilla del frente si la carga no llega a la cara.
- **Solver** (docs/STORAGE.md «Contratos por capa»): una posición por hueco, de capacidad 1 (`POS_SHELF`); se carga con
  un paso adelante desde la casilla de detrás del frente (cualquier hueco vacío de la columna: la horquilla elige el
  nivel) y una caja sacada de un hueco solo sale marcha atrás. Por eso su casilla del frente y la de detrás tienen que
  ser suelo libre, sin zona (validateLevel mira la del frente; los tests de solubilidad, el resto).

## Dibujo (`src/render`)

El adaptador `render/storage/rack.ts` (`RACK_RENDER`) construye cada estantería desde su unidad con `builders/rack.ts` y
`views/RackView.ts`; sus alturas son las del soporte `shelves` (`SUPPORT_LOOK`: `rackSlotY`).

- **Mueble** (`buildRackBays`): low poly y sin travesaños diagonales (todas las caras a escuadra): montantes pizarra,
  cubierta abajo, vigas crema bajo cada hueco y encima de cada columna, el suelo de cada hueco de arriba (dos barras,
  abierto, para que la pista del hueco de abajo asome por un hueco vacío) y el panel liso de los huecos «libre». **Sin
  pared lateral**: en cada extremo solo hay una **placa translúcida** (`END_PLATE`, entre los montantes, hasta la viga
  de arriba de la columna del extremo), una geometría aparte al final de las de `buildRackBays` (marcada con su columna,
  `endPlateColumn`; una sola para las dos puntas de una estantería de una columna). Colores en `Theme.rack` (`frame`,
  `beam`, `panel` —también la placa—, `deck`, `line`, y los de la pista `cueFill`, `cueRim`, `cueInk`; nunca un tono
  funcional). La línea de carga del frente (`addLoadingLines`, `paintFloor`; la misma delante de la entrada de una cinta,
  docs/CONVEYOR.md) es pintura del suelo. Medidas en `dims.ts`
  `RACK` (`base`, `pitch` 0,74, `beam`, `forkRest`, `forkCarry`) y `rackSlotY(nivel)`: el suelo del hueco n está a
  `base + n·pitch` (más alto que un piso de pila, así la carga pasa sobre la viga del hueco de encima).
- **Pista** (`buildSlotCue`, `CUE`): una **pegatina** plana, grande (casi todo el panel) y **sin iluminar**
  (`createCueMaterial`: `MeshBasicMaterial`, sin tone mapping, opaca; ni luces ni sombras la oscurecen): el frente de
  una caja con el **color exacto de la caja** que pide (`theme.boxes[color].base`, borde en su `ink`), o la pegatina
  neutra (`rack.cueFill`, borde `rack.cueRim`) si solo pide símbolo, y en medio el glifo **en negrita** en `rack.cueInk`
  (tono cálido profundo, nunca negro; ≥ 3,5:1 sobre cada color): el símbolo que pide, o el glifo de su color en niveles
  sin símbolos; solo color = sin glifo. «Libre» = panel liso. Va en las **dos caras del panel del fondo** y, si la
  columna cierra un extremo (`cueEndSides`), en la **cara exterior de la placa de ese extremo**, a la altura de su hueco:
  cada una derecha y sin espejo para quien la mira (solo giros). Más una cinta de su color en el labio delantero del
  hueco (`LIP`). Una geometría por aspecto y extremos; el panel liso de detrás (`buildSlotPanel`) es aparte, para
  brillar.
- **Placa del extremo** (`RackBay.addPlate`, `END_PLATE_OPACITY` 0,2): va con la columna de su extremo, con material
  propio (el del armazón, iluminado), **nunca escribe profundidad**, no proyecta sombra sobre las cajas y no tiene
  prepaso de profundidad, así lo que queda detrás (cajas, armazón) se sigue dibujando. Con la columna sólida se dibuja
  después de la estantería sólida, de las cajas y de los brillos del suelo, banda y marco (`renderOrder` 2,5); con la
  columna fantasma se desvanece con ella (0,2 × su opacidad), justo después de su pasada de color.
- **`views/RackView.ts`**: una por estantería: armazón fusionado, un panel con su material de brillo por hueco con pista,
  la pista de cada hueco (fuera de la columna) y su **banda de luz** (`buildSlotGlowGeometry`, `SLOT_GLOW`: un marco
  suave con borde difuminado justo por fuera del hueco en las dos caras, sobre montantes y vigas, que nunca tapa una
  pista ni el paso de la carga). La luz de cada hueco es un `SlotLight` (docs/STORAGE.md «Lo que se ve y se oye»): el
  panel brilla con su emisivo y la pegatina aclara su propio color. Cada columna se vuelve fantasma por separado
  (prepaso de profundidad, como `ShelfView`): del todo (0,35) cuando tapa la carretilla o su carga, y entonces las cajas
  de sus huecos se desvanecen con ella (`hidesActorAt`); solo un poco (0,6) cuando tapa cajas en reposo o zonas. **Sin
  atenuante**: el fantasma desvanece el armazón, los paneles lisos y la placa del extremo, nunca las pistas (tampoco las
  del lateral), que siguen opacas y con su color entero. Las cajas de sus propios huecos, o la carga que entra, nunca la
  vuelven fantasma. Su `fitBox` es el de toda la estantería (más alta que el resto): siempre entera en el encuadre.
- **Marcador del hueco elegido** (`buildSlotMarkerGeometry`, `markerAt`; `views/SlotMarker`): un marco fino sobre la
  bahía del hueco, por delante y por detrás, con dos pestañas en los montantes a media altura. La **vista previa**
  (`DropPreview`) flota en el suelo del hueco, algo más pequeña (entre los montantes). El **efecto de acierto** de un
  hueco añade un anillo que crece alrededor de su boca, en la cara que ve la cámara (`burstAt`).
- **Horquilla y cajas** (soporte `shelves`): delante de una columna `forkHeight` cuenta huecos (`rackSlotY`) y la
  horquilla va justo sobre el suelo del hueco elegido (`forkRest` vacía, `forkCarry` con carga); el paso entre alturas
  de suelo / pila y de hueco se suaviza (`ForkliftView` `RACK_BLEND_LAMBDA`) y el cabeceo casi desaparece, para que la
  carga entre nivelada. Una caja (`BoxView`) reposa a `rackSlotY(level)`; al cogerla de un hueco, salto y elevación de
  objetivo más pequeños (no tocan la viga de encima); dejar en un hueco no hunde nada debajo (cada hueco tiene su
  viga).

## Sonido (`src/audio`)

Su fila dice `sound: 'metal'`:

- Dejar en un hueco → `SfxPlayer.slotDrop`: un «toc» metálico suave (el golpe de la caja + dos armónicos de metal
  cortos, sin nota, ≤ 2,4 kHz), un poco más agudo por nivel, sin grave de suelo y más suave que dejar sobre otra caja; a
  `DROP_LAND_SEC`, como en el suelo. La campana y el zumbido, como en todo el almacenaje (docs/STORAGE.md).
- Coger de un hueco → `SfxPlayer.slotLift`: un golpe más ligero que coger del suelo, un tono de metal tenue y un pequeño
  deslizamiento. La subida de la carga la pone la bomba de la horquilla (`MotorSound`); sacar la carga de un hueco
  marcha atrás suena el pitido de marcha atrás.

## Nivel Benchmark (solo Modo prueba)

- Archivo: `src/data/levels/especiales/benchmark.level` (id `benchmark`, orden 100, 11×9, `limit: 2`, ventanas norte 8-9
  y oeste 2-4). El registro lo carga aparte (`SPECIAL_LEVELS`, `getSpecialLevel(BENCHMARK_ID)`; docs/LEVELS.md): nunca
  entra en `LEVELS` ni en ProgressStore (tiempos y desbloqueos van por los ids de `LEVELS`). Contenido y cadena de
  deducción: sus líneas `nota:`; lo comprueban `benchmark.test.ts` y `benchmarkPlayable.test.ts` (piloto automático a
  60 y 20 fps con F / V y marcha atrás). Reúne las estanterías, un camión (docs/DOCKS.md «Nivel Benchmark») y una
  cinta transportadora (docs/CONVEYOR.md): 13 cajas, 13 objetivos (3 zonas + 6 huecos con pista + 3 niveles de camión con
  pista + la salida final de la cinta), un solo reparto.
- Sus estanterías: **R** (frente sur, contra el muro norte, mira a la cámara) y **S** (frente norte, en medio, le da la
  espalda: sus pistas se leen por detrás o girando con Q / E, y se carga rodeándola), de 2 columnas de 3 huecos, con una
  estantería de madera a una casilla de cada una para comparar. La trampa (el menta ◆ en el hueco «menta», que es del
  «◆» de encima), el hueco equivocado (el menta ▲ en el «◆»: se cambian aparcando uno en el hueco libre de arriba) y un
  coral ◆ aparcado arriba en S.
- Medido (`npm run levels -- benchmark`, 2026-10-01, ya con la cinta y su botón): movimientos 15 (exacto), extra 2,
  bloqueos 5, trampas 13, repartos 1, huecos 12 (6 con pista, 6 libres), camión 4 (3 con pista, 1 libre), cinta 1 (1
  botón), estrechas 8, libre 75 %, ambiguas 12, callejones 0 en 60 estados; sus 9 objetivos `dificultad:` se cumplen.
  Mínimo del contador de movimientos: 15 (`levelMinimums.json`). Antes de la cinta: 14 movimientos, bloqueos 4, trampas
  12, libre 78 %. La mesa de la cinta (H1b, a nivel 1: su entrada se carga con F como un hueco de nivel 1) no cambió
  ninguna cifra; su botón (H2, en (7,2), junto a A) era una casilla más ocupada (estrechas 8 → 9 y libre 75 % → 74 %),
  y desde H2b es una almohadilla en el suelo en (7,3), suelo para las métricas: estrechas 8 y libre 75 % otra vez; desde
  H2c, la misma almohadilla otra vez en (7,2), justo al lado de A: las mismas cifras.
- **Entrada**: botón «Benchmark» del pie del título, junto al interruptor, solo con el Modo prueba encendido
  (`GameActions.startBenchmark()`; sin Modo prueba la acción no hace nada). Es un botón normal: Tab lo alcanza y
  Enter / Espacio lo pulsan. En el título el mando solo tiene A / Start = «Continuar» (igual que para los puntos de
  nivel y el interruptor), así que desde el mando se llega retomando un Benchmark en pausa.
- **No guarda nada**: ni mejor tiempo, ni desbloqueo, ni «Continuar» / último nivel; el cronómetro corre igual. HUD:
  «Benchmark» en vez de «Nivel N», con la etiqueta tenue «sin récord» (`UIState.benchmark`). Tarjeta: «Benchmark», solo
  «Tiempo» y «Modo prueba · sin récord», botón principal «Volver al inicio» (y «Repetir»).
- **Flujo** (`Game`): R / ↺ / «Repetir» lo recargan; RePág / AvPág y `[ ]` no hacen nada en él; al terminar, la tarjeta
  lleva al título con el nivel real de «Continuar». Esc lo deja en pausa detrás del título, como cualquier nivel: el pie
  del panel lo nombra («Benchmark · sin récord») y «Continuar» o el botón lo retoman; un punto de nivel carga ese nivel.
  Apagar el Modo prueba con el Benchmark en pausa lo descarta y enseña el nivel real de «Continuar».

## Ajustes

- Datos y gramática: `STORAGE_SKINS.rack` (`maxLevels` 3, letras `chars`), `STORAGE_WORDS.rack`, `COLUMN_WORDS.rack`
  y el ejemplo `RACK_EXAMPLE` (asciiLevel.ts).
- Acceso (`logic/storageAccess.ts` `STORAGE_ACCESS.front`): `faceAngle` 30°, `faceLateral` 0,35, `faceNear` 0,8,
  `faceFar` 1, `holdAngle` 50°, `holdLateral` 0,75, `holdNear` 1,3, `pickReach` −0,8, `dropReach` −0,55. Colisión
  (`collision.ts`): `RACK_WALL` 0,02 (panel y montantes del hueco abierto).
- Dibujo: `dims.ts` `RACK` y `rackSlotY`; `builders/rack.ts` (`RACK_PANEL`, `END_PLATE`, `CUE`, `LIP`, `LOADING_LINE`,
  `SLOT_GLOW`, el marcador); `views/RackView.ts` (`END_PLATE_OPACITY`, `CUE_GLOW_CAP`); `ForkliftView`
  (`RACK_BLEND_LAMBDA`, `RACK_LIFT_LAMBDA`, `RACK_PITCH_SHARE`); colores en `Theme.rack`.
- Sonido: `sfx.ts` `slotDrop` / `slotLift`.
