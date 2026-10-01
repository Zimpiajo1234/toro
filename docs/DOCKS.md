# Muelles de carga (aspecto `truck`)

El aspecto `truck` del almacenaje común: un camión aparcado **fuera** de una puerta del muro norte u oeste, que se carga
por la puerta **como una pila del suelo** (acceso `door`, soporte `stack`: `STORAGE_SKINS.truck`), con la pista de cada
nivel en un cartel enmarcado sobre la puerta. Las reglas que comparte con todo el almacenaje (objetivos y solución única,
un nivel cumplido solo sobre niveles cumplidos, caja fija que aún recibe el nivel de encima, zumbido, «libre»,
horquilla con F / V, pistas P, la luz y el sonido de un acierto) están en docs/STORAGE.md; aquí, lo propio del muelle:
su puerta, su acceso, su gramática, su validación, su dibujo y su sonido. Hoy solo el Benchmark (docs/RACKS.md) lleva un
camión; los niveles 1–3 no cambian.

## Decisiones

Petición (2026-09-30): «hagamos unos muelles de carga donde pueda cargarse directamente en el camión las cajas que
pertoquen, ahí no deja de ser un sistema igual que el de amontonarlas en el suelo, pero estéticamente es diferente».

Decisiones (2026-09-30, «el camión nunca sobrepasa la puerta del gate, se quedan justo pegados por fuera»; «solo hasta
2 alturas, sin hierros de por medio»; leyenda en un cartel enmarcado sobre la puerta):
- **A. Fuera**: el camión espera fuera del edificio, con la trasera pegada a la cara de fuera del muro, en la puerta;
  nada del camión entra en el almacén.
- **B. Puerta = suelo**: las casillas del mapa que marca el camión son las **casillas de la puerta**, suelo normal
  delante de ella. La carretilla se pone en una mirando al muro; la horquilla y la carga cruzan la puerta hasta la
  columna de la caja del camión, justo detrás del muro; el cuerpo se para en la línea del muro.
- **C. Como una pila**: de abajo arriba, **como mucho 2 niveles**, de **1 a 3 columnas** (la puerta mide de 1 a 3
  casillas). Nada encima ni entre las columnas (ni postes, ni barras).
- **D. Cartel sobre la puerta**: enmarcado, una casilla por columna (de izquierda a derecha como las casillas de la
  puerta) y por nivel (la fila de abajo = nivel 0), pegatinas en las dos caras (las de las estanterías), nunca atenuadas
  ni en espejo.
- **E. Reglas de objetivo** como en las estanterías: caja fija, zumbido de objetivo equivocado, reparto único (una caja
  fija del camión todavía recibe el nivel de encima).

Decisiones (2026-09-30, la caja «se encasquilla» al meterla en el camión; diseño del usuario, dibujado; «lo podemos
bloquear con assets, las flores con maceta que tienes»):
- **F. Barandillas**: cada puerta lleva, sola (no se escribe en el `.level`), una **barandilla naranja** baja a cada lado:
  sale de la cara de dentro del muro y entra recta en el almacén **una casilla**, sobre la **línea de la jamba** (su cara
  de dentro enrasada con el lado del hueco: barandillas y hueco forman un solo pasillo recto); 2 postes y 2 barras. Para
  obligar a entrar más recto.
- **G. Casilla lateral ocupada**: la casilla de al lado de cada extremo de la puerta, detrás de su barandilla, lleva un
  obstáculo fijo del mapa, una planta con maceta `p` (u otro obstáculo fijo). Sin trampilla en el suelo. Una puerta que
  llega a un rincón no tiene barandilla ni casilla lateral en ese lado: ya guía el otro muro.

Decisiones (2026-09-30, almacenaje común: docs/STORAGE.md decisiones B y C, hechas el 2026-10-01):
- **H. Horquilla por teclas** («para subir y bajar que sea con las teclas, nada automático»): F / V, la rueda y X / B
  eligen el nivel también delante del camión, como en una estantería. Se deja solo con la horquilla en el nivel
  elegido y si es el siguiente libre de la columna; se coge solo la caja de arriba, con la horquilla a su nivel. El
  nivel elegido se enmarca en su casilla del cartel.
- **I. Niveles «libre»**: cada columna del camión llega a `min(2, limit)` niveles; sus pistas van de abajo arriba y el
  resto es «libre» (se puede escribir `libre`, o dejarlo sin escribir: el camión llena solo la columna). Un «libre» solo
  va encima de los niveles con pista; en el cartel, casilla lisa.

## Reglas propias

1. **Muelle** = puerta en el muro **norte** u **oeste** con un camión aparcado **fuera**. La puerta es una **tirada
   recta de casillas de puerta** pegada al muro, dentro del mapa: en el muelle norte, casillas de la fila `z = 0`; en el
   oeste, de la columna `x = 0`. Una **columna** del camión por casilla de puerta, **de 1 a 3**, cada una justo detrás
   del muro, **fuera del mapa** (`z = -1` en el norte, `x = -1` en el oeste: `cellOf`). La puerta no se declara aparte
   (no puede descuadrarse del camión). Las casillas de puerta son **suelo**: sin muebles (estantería, planta, estantería
   almacenable, otra puerta) y, al empezar, sin zona, caja ni carretilla. Una puerta en un rincón vale; dos puertas
   pegadas, no (entre ellas van sus barandillas y un obstáculo: regla 5).
2. **Se carga por la puerta**: desde la casilla de puerta de cada columna, mirando al muro (`TRUCK_FACING`: el camión se
   carga desde el sur en el muro norte y desde el este en el oeste). El cuerpo de la carretilla nunca pasa la línea del
   muro; la horquilla y la carga, solo por la puerta y **rectas** (con la carga en la puerta el rumbo no cambia). Las
   cajas van una sobre otra **de abajo arriba**, hasta los **niveles** de la columna, con la horquilla por teclas: se
   deja solo en el **siguiente nivel libre** y se coge solo la **caja de arriba**, con la horquilla a su nivel. Con la
   horquilla en otro nivel no hay vista previa y Espacio no hace nada (el `actionIdle` suave); si va baja, la carga
   choca con la caja de la plataforma, como con la cara de una estantería (F ahí la sube por encima), y con la carga
   sobre las cajas de la columna V no baja. Con la carga en la puerta pero sin llegar a la caja del camión (o con la
   horquilla en otro nivel) no se deja nada, tampoco en el suelo de al lado.
3. **Pistas y «libre»**: cada nivel pide lo que dice su casilla del cartel (color, símbolo o los dos) o es «libre»; cada
   columna llega a `min(2, limit)` niveles, los de encima de sus pistas «libre». Un nivel con pista es un objetivo del
   reparto único; se cumple con su caja destinada **y** todo lo de debajo cumplido (la columna está bien desde la
   plataforma); su caja queda fija, **pero se sigue cargando el nivel de encima** (a diferencia de zonas y huecos), así
   que una columna solo se descarga desde arriba hasta la primera caja fija. Una caja en un «libre» nunca queda fija.
   Toda caja que queda en un nivel con pista sin cumplirlo zumba (también la destinada sobre una base mal: la columna
   está mal desde abajo) y sigue cogible. Late (con P) solo el nivel `loadable`: el siguiente de su columna con todo lo
   de debajo cumplido.
4. **Pistas a la vista, en el cartel sobre la puerta** (decisión D): un cartel enmarcado en la cara de dentro del muro,
   encima de la puerta, con una casilla por columna (justo encima de su casilla de puerta) y por nivel (abajo, el nivel
   0). Cada casilla lleva la pegatina de su nivel en las dos caras, a pleno color, nunca atenuada ni en espejo, legible
   desde dentro del almacén con la cámara por defecto y girándola. Nunca sobre la carga ni entre las columnas. La casilla
   de un nivel «libre» queda lisa. El nivel elegido con F / V se enmarca en su casilla.
5. **Barandillas** (decisiones F y G; `core/docks` `dockRailsOf`): a cada extremo de la tirada de la puerta, una
   barandilla fija sobre la línea de su jamba, desde la cara de dentro del muro hasta el final de las casillas de puerta
   (una casilla; nunca en la fila de detrás, donde se alinea la carretilla), gruesa hacia fuera, hacia la **casilla
   lateral**: la del mapa justo pasado ese extremo, a lo largo del muro, que lleva un **obstáculo fijo** (planta,
   estantería de madera o estantería almacenable que no dé a la puerta). Una puerta que llega a un rincón no la tiene en
   ese lado. Así la puerta solo se alcanza de frente, desde la fila de detrás; entre las columnas de una misma puerta no
   hay barandilla.

## En el archivo `.level`

Un camión es un carácter de la leyenda. En el mapa marca las **casillas de su puerta**: una **tirada recta pegada a su
muro** (en el muelle norte, casillas seguidas de la fila 0; en el oeste, de la columna 0). Cada grupo conectado de ese
carácter es un camión. La caja del camión no sale en el mapa: está fuera, detrás del muro. Las barandillas tampoco:
salen solas; lo que sí va en el mapa es el **obstáculo de cada casilla lateral** (normalmente una planta `p`), justo al
lado de cada extremo de la tirada, salvo en un rincón.

```
camión   = cabeza muro [id] ":" columna { "|" columna }                 (1 a 3 columnas)
cabeza   = "camión" ["muelle"] | "camión en el muelle" | "muelle"      (también truck / dock)
muro     = "norte" | "oeste"                                            (también north / west)
columna  = nivel { "/" nivel }                                          (de abajo arriba, 1 o 2 niveles)
nivel    = pista [ "+" caja ]                                           (la caja cargada al empezar)
pista    = "libre" | color [símbolo] | símbolo                          («libre», solo encima de las pistas)
caja     = "caja" color [símbolo] ["tipo" tipo] [id]
```

- Las columnas van de oeste a este (muelle norte) o de norte a sur (muelle oeste): una por casilla de puerta, en ese
  orden, separadas por `|`, como mucho 3. Los niveles de cada columna, de abajo arriba, separados por `/`.
- Una caja cargada al empezar va sobre otra (o sobre la plataforma): en una columna, un nivel con caja lleva caja en
  todos los de debajo. En los datos está en su casilla de caja, fuera del mapa.
- Cada columna llega sola a `min(2, limit)` niveles: los que no se escriben encima de sus pistas son «libre»
  (`validateLevel`). `libre` también se puede escribir (con una caja al empezar: `libre + caja …`), siempre encima de
  los niveles con pista. La forma canónica no escribe los «libre» de arriba sin caja (así una columna `coral ◆` con
  `limit: 2` sigue escribiéndose `coral ◆`) y deja al menos un nivel escrito (una columna toda libre es `libre`).
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
0 .pTTp...
1 ........
2 .....1..
3 .a..b...
4 ....^.c.

1 = zona ■
a = caja azul ▲        b = caja amarillo ■    c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲
```

Un camión fuera de la puerta norte (casillas de puerta 2–3 de la fila 0; su caja, en (2,-1) y (3,-1)), de 2 columnas
que se cargan desde esas casillas mirando al norte, con una barandilla a cada lado de la puerta y una planta detrás de
cada una, en (1,0) y (4,0). Columna 1: abajo «azul», encima «cualquier ▲». Columna 2: «coral ◆» exacto, con la menta ▲
cargada por error, y encima un nivel «libre» (sin escribir: `limit: 2`). Único reparto: la única azul (la azul ▲) abajo
en la columna 1, así que el «▲» de encima es de la menta ▲; el coral ◆ a su nivel y el amarillo ■ a la zona. La azul ▲
encaja en el «▲» pero no es su destino (una «trampa» amable), y la menta ▲ hay que descargarla antes de poner el coral
◆.

Errores (en español, `archivo:línea:columna`): muro que falta o que no es norte / oeste, dos puntos que faltan o
repetidos, más de 2 niveles, nivel vacío, «libre» con otra cosa, «libre» debajo de un nivel con pista («en un camión las
cajas van una sobre otra, así que los niveles «libre» van arriba…», en su columna), pista desconocida, caja mal escrita
tras el `+`, caja sin nada debajo, `/ | :` fuera de una estantería o un camión, camión que no es recto, que no está
pegado a su muro o cuyas columnas no cuadran con sus casillas, id propio en un carácter usado por varios camiones, id
repetido con una estantería. Los de `validateLevel` (abajo) se señalan en la columna o la caja que hay que arreglar:
entre ellos, más de 3 columnas (en la primera que sobra: «tiene 4 columnas y lleva como mucho 3: su puerta mide de 1 a
3 casillas…») y la casilla lateral sin obstáculo, en esa casilla («junto a la puerta del camión «T» va una barandilla
naranja (sale sola, no se escribe) y esta casilla, detrás de ella a lo largo del muro, tiene que ser un obstáculo fijo:
pon una planta «p» (o una estantería)»; dos puertas pegadas: «dos puertas de muelle no van pegadas…»; una estantería que
da a la puerta desde su lado, en su columna).

`parseLevelDraft(texto)` da el objeto crudo que `parseLevel` pasa a `validateLevel` (mapa y leyenda comprobados, sin
valores por defecto): los tests de la gramática lo usan para no depender de la validación.

En los datos es una unidad `truck` de `LevelData.storage` (después de las estanterías; docs/STORAGE.md «Modelo»):
`access: { kind: 'door', wall }` (`'north' | 'west'`), (x, z) su primera **casilla de puerta** (muelle norte: `z = 0`,
la más al oeste; oeste: `x = 0`, la más al norte), `w` = casillas de puerta = columnas y `columns[col][nivel]`, nivel 0 =
sobre la plataforma (`null` = «libre»). Una caja cargada al empezar es una `LevelBox` con (x, z) = su casilla de caja
(fuera: `z = -1` / `x = -1`) y `level` = su nivel. Un nivel JSON antiguo lo escribía en `trucks` (`{ id, wall, x, z, w,
columns }`, «libre» = `{}`): validateLevel lo sigue leyendo.

## Validación (`src/data/validateLevel.ts`)

Lo propio del acceso `door`, con los mensajes en inglés **exactos** que `asciiLevel` traduce y coloca cuando pueden
darse en un `.level` (el resto cae en «nivel no válido: …»; lo común de toda unidad: docs/STORAGE.md «Contratos por
capa»). Lo comprueban `validateLevel.docks.test.ts` y `levelStorage.test.ts`.

- `trucks[i]`: `wall` norte u oeste (`trucks[i].access.wall must be "north" or "west"`; en un JSON antiguo,
  `trucks[i].wall …`); de 1 a 2 niveles por columna
  (`trucks[i].columns[j] must have 1 to 2 levels`); como mucho 3 columnas (`trucks[${i}] has ${n} columns, more than 3:
  its dock door is 1 to 3 cells wide`); un «libre» solo encima de los que tienen pista (`trucks[i].columns[j][k] has a
  cue above a free level: in a stack the free levels go on top of the ones with a cue`); después, cada columna se llena
  con «libre» hasta `min(2, stackLimit)` (el `limit` por defecto se calcula con los niveles escritos). Muelle norte:
  `z = 0`; oeste: `x = 0` (`trucks[i] is in the north wall: its door cells run along row z = 0`, u oeste / `x = 0`).
  Casillas de puerta dentro del mapa (`trucks[i] leaves the warehouse at x,z`).
- **Casillas de puerta = suelo**: sin estantería, planta, estantería almacenable ni la puerta de otro camión
  (`trucks[i] overlaps another obstacle at x,z`); detrás, lo que sea (una planta justo detrás vale: si cierra la columna,
  lo dice el solver). El frente de una estantería sí puede ser una casilla de puerta (si la carga desde detrás de ella).
- **Casillas laterales** (regla 5, `dockRailsOf`): la de cada extremo de la tirada, un obstáculo fijo del mapa
  (estantería, planta o estantería almacenable): `trucks[i] needs a static obstacle beside its dock door at x,z (a
  plant, a shelf or a rack): its guard rail stands there`; si es la puerta de otro camión (dos puertas pegadas):
  `trucks[i] needs a static obstacle beside its dock door at x,z for its guard rail, but that is the dock door of
  trucks[j]: leave a cell with an obstacle between two dock doors`; una estantería ahí que se cargaría desde la casilla
  de puerta (la barandilla queda en medio): `racks[i] column j is loaded from the dock door of trucks[k], across its
  guard rail`. En un rincón no hay casilla lateral.
- **Nada empieza en la puerta**: `zone "…" is on the dock door of trucks[i] (column j): the truck is loaded from there`
  (su caja fija cerraría esa columna para siempre), `forklift starts on the dock door of trucks[i] (column j): door
  cells start empty`, `box "…" starts on the dock door of trucks[i] (column j): door cells start empty (a box loaded on
  the truck is on its bed cell x,-1)`. En un `.level` no pueden darse: esas casillas llevan la letra del camión.
- Ventanas: `decor.windows[${i}] overlaps the dock door of trucks[${j}]` (mismo muro y alguna casilla en común).
- Cajas en el camión, en su **casilla de caja** (fuera del mapa, la única casilla de fuera que se admite; cualquier otra
  es `box "…" out of bounds`): `level` de 0 a niveles − 1 (`box "…" is on a truck bed cell: give it its truck level`,
  `box "…" is on level k of trucks[i] column j, which has n levels`), una por nivel (`two boxes share level k of
  trucks[i] column j`) y **seguidas desde 0**: `box "${id}" is on trucks[${i}] column ${j} at level ${k} with no box
  below it`.
- Altura: una columna de más de 1 nivel cuenta como apilar (el `limit` por defecto pasa a `stack.maxHeight`) y con un
  `limit` explícito: `trucks[${i}].columns[${j}] has ${n} levels, more than stackLimit ${limit}`.
- Una caja por objetivo, con los niveles de camión aparte: `a level with storage racks or trucks needs one box per
  target (${cajas} boxes, ${zonas} zones, ${huecos} slots with a cue, ${niveles} truck levels)`; el mensaje de más de un
  reparto nombra el nivel como `trucks[${i}].columns[${j}][${k}]` (`more than one complete assignment:
  trucks[0].columns[1][0] may take blue/circle or blue/triangle`).

## El acceso `door`

La tabla del acceso y lo común de la lógica: docs/STORAGE.md («Acceso», «Contratos por capa»). Lo que hace en un muelle
(`GameState.docks.test.ts`, `collision.test.ts`):

- **Rejilla** (`logic/grid.ts`): cada columna del camión es una columna de soporte `stack` cuya celda está fuera del
  mapa; guarda su pila aparte, de abajo arriba, y las consultas de pila (`height`, `boxAt`, `baseAt`, `stackAt`,
  `pushBox`, `popBox`, `capacity`) aceptan su casilla de caja; `columnAt` la reconoce. Las casillas de puerta son suelo
  normal; `canTakeBox` / `isFree` no ven nunca una casilla de fuera: el camión solo se carga por su puerta.
- **Colisión**: el **cuerpo** choca con los muros enteros (`bounds`), también en la puerta: se para en la línea del
  muro. La **carga** y el **punto de la horquilla** ven los muros como losas gruesas por fuera (`loadWalls`,
  `doorWalls`) con cada puerta abierta entre sus **jambas** (`DOOR_JAMB` 0,02, como los montantes de un hueco) hacia un
  **bolsillo de 1 casilla** (`DOOR_POCKET`: la caja del camión), cerrado al fondo; entre las columnas de una misma
  puerta no hay nada. Allí la carga solo choca con las cajas cargadas (la base de la pila, que se abre para la carga
  con la horquilla a su altura). Para la carga, además, el **tramo de puerta de cada columna** (`doorCells`) está
  **cerrado como el muro** hasta que la carretilla encara esa columna en línea con su cuerpo, y se queda abierto
  mientras la carga está dentro (nunca se cierra sobre ella: un paso de nivel no lo cierra). Así, girando en una casilla
  de puerta, la carga choca con la puerta como con el muro y nunca resbala por una puerta ancha hasta la columna de al
  lado (como en el modelo del solver). La horquilla vacía pasa cualquier puerta. Sin camiones, `loadWalls` no existe y
  todo es idéntico a antes.
- **Barandillas** (`dockRailsOf`, `railRect`): estáticos más, como una planta: el cuerpo, la carga y el punto de la
  horquilla (`clearance`, también con la horquilla vacía) chocan con ellas. Su cara de dentro es la línea de la jamba
  (un solo pasillo recto con el hueco: la carga, con 0,02 de juego, no toca ni la una ni la otra; el cuerpo, con 0,06),
  de la cara de dentro del muro al final de las casillas de puerta: una carretilla en la fila de detrás solo puede rozar
  su extremo.
- **Encarar una columna**: el cuerpo **en línea con su casilla de puerta** (en ella o justo detrás: la misma columna `x`
  del mapa en el muelle norte, la misma fila `z` en el oeste), rumbo a ≤ 30° de «hacia el camión», punto de horquilla a
  ≤ 0,5 del eje de la columna (toda su anchura) y entre 0,8 delante de la línea del muro y 1 más allá; se mantiene con
  45° y 0,6 (el cuerpo aún en línea) para que un pequeño giro no haga parpadear la vista previa. Coger / dejar solo
  **con la horquilla al otro lado de la puerta**: el punto de la horquilla al menos 0,3 más allá de la línea del muro
  (con el cuerpo en el muro está a 0,5, en el centro de la caja; en el centro de la casilla de puerta, a 0,42), así que
  una columna nunca se trabaja desde la casilla de puerta de al lado. Mientras se trabaja en una estantería, nunca hay
  camión encarado.
- **Rumbo fijo**: con la carga pasada la línea del muro (`loadInOpening`; solo puede ser por el tramo abierto de la
  columna encarada), el rumbo no cambia: entra y sale recta; de lado nunca se carga. La horquilla vacía no lo fija.
  Girando en una casilla de puerta con carga, la puerta cerrada la para como el muro y la carretilla se aparta al girar
  (con una planta detrás, el giro no cabe); solo entra al quedar encarada (≤ 30°), en la columna de la casilla de puerta
  del cuerpo (tests, a 60 y 20 fps, también en una puerta de 3).
- **En la puerta** (`STORAGE_ACCESS.door.doorway`, `StorageAim.blocked`): llevando una caja con la carga en la puerta
  pero sin llegar al alcance, o con la horquilla en otro nivel, no se deja nada (`actionIdle`), tampoco en el suelo de
  al lado (sería teletransportarla).
- **Dejar**: encarando una columna con la horquilla dentro y en el nivel elegido, si ese nivel es el siguiente libre de
  su pila (`LevelGrid.canStore`: `dropLevel` = cajas de la columna, **aunque la de arriba esté fija**); en otro nivel, o
  con la columna llena, nada (con la columna llena la carga se queda en la puerta contra su caja). La caja aterriza en
  el centro de la casilla de caja, justo bajo la horquilla.
- **Coger**: una caja de camión solo es objetivo en la columna encarada con la horquilla dentro, la de arriba
  (`LevelGrid.liftableAt`: nunca una de debajo), con la horquilla a su nivel y si no está fija. Sale marcha atrás,
  recta.
- **Horquilla**: F / V eligen el nivel de la columna encarada y la horquilla va a él; al llegar a otro camión empieza
  abajo. Una pila del camión nunca sube la horquilla por adelantado (`clearLevel` la salta), así que la carga llevada más
  baja que el siguiente nivel libre choca con la caja de la plataforma (la base de su pila: solo se abre con la
  horquilla a su altura) y F ahí la sube por encima; con la carga sobre las cajas de la columna, V no baja
  (`sinksIntoStack`). Fuera del camión, la horquilla sigue sola, como en el suelo.

## Barandillas: conducir como un jugador (`logic/GameState.docksDriving.test.ts`)

El piloto automático entra siempre recto por el eje de la columna, y por eso no se vio el atasco. El test entra en cada
columna del Benchmark como lo haría un jugador: desde dos filas por detrás de la puerta (la carga justo antes de la
boca de las barandillas), desviada 0, ±0,05, ±0,1, ±0,2 o ±0,3 del eje y torcida 0°, ±5°, ±10°, ±15° o ±25°, solo con W
(el asistente de rumbo endereza por sí solo lo que está a menos de 8°), a 60 y 20 fps: con carga (pulsando F en cuanto
la carretilla está en una columna cuyo siguiente nivel libre queda por encima de la horquilla), con la horquilla vacía
(cogiendo la caja de la plataforma) y saliendo marcha atrás con S. Siempre: nada entra en (ni sale de) otra columna que
la de la casilla de puerta del cuerpo, y S siempre saca la carretilla. Alineada a ≤ 5°, sea cual sea el desvío, entra
recta en su columna: con carga en 1,33–3,07 s a 60 fps y 1,35–3,15 s a 20 fps (medianas 1,52 y 1,60 s; límites del test
`ENTRY_SEC` 3,2 y `ENTRY_MEDIAN_SEC` 1,65: la carga espera a la horquilla junto a la caja de la plataforma), con la
horquilla vacía en 1,33–1,6 s.

Medido (2026-09-30; por modo y fps, las dos columnas: 54 aproximaciones a ≤ 5° y 108 a ≥ 10°):

| | ≤ 5° (entra recta) | ≥ 10°: entra | a la otra columna | se para antes | se atasca dentro |
|---|---|---|---|---|---|
| con carga, sin barandillas (antes) | 54 · 1,33–1,70 s | 24, torcida | 32 | 46–48 | 4–6 |
| con carga, con barandillas | 54 · 1,33–2,9 s | 26, torcida | 34 | 32–34 | 14–16 |
| horquilla vacía, sin barandillas | 54 · 1,33–1,35 s | 10–12 | 13–14 | 83–84 | — |
| horquilla vacía, con barandillas | 54 · 1,33–1,6 s | 32–34 | 22–23 | 52–53 | — |

(«A la otra columna»: torcida, la carretilla deriva hasta la casilla de puerta de al lado y deja o coge allí, como
dice la regla; nunca en una columna que no sea la de su cuerpo. Con la horquilla por teclas, desde el 2026-10-01, los
recuentos no cambian.)

**Pendiente (decisión de diseño, sin hacer)**: con una barandilla de una casilla, su boca solo frena el cuerpo cuando la
carga ya ha cruzado la línea del muro (con el cuerpo a un lado, su costado toca el extremo de la barandilla después), y
con la carga en la puerta el rumbo queda fijo. Torcida 10° o más (lo que el asistente de rumbo ya no endereza) hacia la
columna vecina (o hacia la otra barandilla, en una puerta de 1), la barandilla sujeta el cuerpo y el tramo cerrado de
al lado (o la jamba) la carga: W ya no la mete y la puerta, que parece abierta, no dice por qué (S sí la saca). Pasa
también al girar dentro de una puerta de 2 o 3. Arreglos posibles:
- **Que la puerta enderece**: con la carga en la puerta, el rumbo, en vez de quedarse fijo, vuelve poco a poco a «hacia
  el camión» al avanzar o retroceder (nunca se gira a mano). Probado con un prototipo (no incluido) en la misma
  rejilla: con carga, atascos 14–16 → 2 y ninguna entrada torcida; las entradas lentas siguen.
- **Boca en embudo**: los extremos de las barandillas abiertos hacia fuera, para que una carga descentrada resbale
  hacia dentro en vez de frenarse de frente contra el extremo (las entradas lentas).
- **Encarar más estricto**: abrir el tramo solo a ≤ 6° (lo que cabe entre barandillas); nunca entraría torcida, pero
  habría que enderezar a mano antes de la puerta.

## Solver, métricas e informe

Lo común (la tabla de posiciones, las reglas por soporte y acceso, la cota): docs/STORAGE.md. En un muelle
(`levels/docks.test.ts`, `integration/docksPlayable.test.ts`):

- Cada columna de camión es **una posición** (`POS_STACK`) fuera del mapa, de capacidad sus niveles (nunca el `limit`),
  con los destinos de sus niveles con pista de abajo arriba (`steps`, como una zona con receta; un «libre» es
  aparcamiento); `lockedAt` = toda su pila en su prefijo correcto (la de arriba no se levanta), pero `validDrop` y
  `carrySearch` siguen ofreciendo el nivel de encima. Se carga con **un paso adelante desde la casilla de detrás de la
  puerta**, mirando al muro (la caja cruza la puerta), encima de la pila mientras quepa; un giro nunca mete la caja en
  el camión; una caja sacada de él solo sale **marcha atrás**. Las casillas de puerta son suelo (no `solid`). Una pila
  nunca es nodo de un ciclo de la cota.
- **Callejones**: una zona o una caja fija justo detrás de una casilla de puerta cerraría esa columna (una planta ahí la
  deja sin acceso: «Sin acceso» en el test).
- **Barandillas**: nada que cambiar en el modelo. Las casillas laterales ya son sólidas (su obstáculo) y cada barandilla
  va en el borde entre una casilla de puerta y una sólida: no corta ningún paso entre casillas libres. El giro en la fila
  de detrás que barrería una casilla lateral ya lo prohíbe su obstáculo (un giro de 90° pide libre la diagonal); el que
  barre una casilla de puerta pasa a 0,37 de la barandilla con la carga.
- **Métricas**: las pistas del camión cuentan en `repartos`, `trampas` (por tipo de pista) y `ambiguas` (por pista y
  nivel); en `bloqueos`, la caja equivocada de un camión tapa su nivel (una caja aparcada en un «libre» sobre niveles
  bien no tapa nada) y un camión se alcanza desde su casilla de puerta; `libre` cuenta las casillas de puerta como suelo;
  **`camion`** = todos los niveles de camión, con pista y «libre» (alias `camiones`; en el informe «4 (3 con pista, 1
  libre; 2 columnas, 1 camión; 1 cargado al empezar)» y columna «camión» = columnas / niveles).
- **Informe**: el plan nombra el camión por su letra y su **casilla de puerta**: «→ camión T (x,0), nivel n» al cargar y
  «(x,0), camión T, nivel n → …» al sacar.
- **Piloto automático**: para cargar se para en la fila de detrás de la puerta, elige el nivel con F / V, va recto hasta
  la casilla de puerta (la carga cruza la puerta, el rumbo fijo) y deja; para descargar, desde la casilla de puerta
  mirando al muro elige el nivel de la caja de arriba, la coge y sale marcha atrás. A 60 y 20 fps (tests).

## Dibujo (`src/render`)

El adaptador `render/storage/truck.ts` (`TRUCK_RENDER`) construye cada muelle desde su unidad con `builders/truck.ts` y
`views/TruckView.ts`; sus alturas son las del soporte `stack` (`SUPPORT_LOOK`: alturas de pila; la plataforma está a ras
del suelo). Medidas y constructores en `builders/truck.ts`, `dims.ts` `DOCK`:

- **Puerta** (`builders/walls.ts`, abierta por el acceso `door`): hueco en el muro sobre las casillas de puerta, desde
  `DOCK.sillTop` hasta `DOCK.doorTop` = **1,70** (la carga del nivel 1 llega a ≈ 1,62), `DOCK.doorInset` más estrecho por
  cada lado; marco pizarra por las dos caras, la persiana enrollada **por fuera**, encima de la puerta (la cara de
  dentro es del cartel), burletes y topes (`DOOR`). Nunca coincide con una ventana (lo impide la validación).
- **Camión** (`TRUCK`, `buildTruckBody`): cabina y plataforma baja, **entero fuera**, con la trasera pegada a la cara de
  fuera del muro; plataforma a ras del suelo (`DOCK.bedTop`), así las cajas del camión descansan a las alturas de una
  pila del suelo; laterales bajos solo en los extremos y testero junto a la cabina; nada sobre ni entre las columnas.
  **Estático**: no se hunde con su muro (sus cajas son `BoxView` en `pos`: flotarían), siempre en el encuadre (`fitBox`).
  Cada camión, su calzada un pelo más baja que la del anterior (dos muelles juntos nunca parpadean).
- **Umbral** (`DOCK_PLATE`, `buildDockPlate`): chapa plana de la puerta, a la altura del suelo, por debajo de la vista
  previa.
- **Barandillas** (`RAIL`, `buildDockRails`; `Theme.truck.rail` naranja suave, `railCap` crema): a cada extremo de la
  puerta, dentro de la huella que le da la lógica (`dockRailsOf`): un poste contra el marco de la puerta (que sobresale
  `DOOR.proud` del muro) y otro al final de las casillas de puerta, cada uno con su tapa crema, y dos barras entre ellos.
  Bajas (0,53, muy por debajo de la carga, ≈ 0,98) y abiertas: no tapan cajas, zonas ni el cartel. Estáticas: ni se
  hunden con el muro ni se vuelven fantasma; dan y reciben sombra. Una malla por camión, en su grupo
  (`userData.dockRails`).
- **Cartel** (`DOCK_SIGN`, `SIGN_CUE`, `SIGN_GLOW`; `buildSignFrame`, `buildSignPanel`, `buildSignCue`): en la cara de
  dentro del muro, sobre la puerta; una casilla por columna (justo encima de su casilla de puerta, `dockColumnX`) y por
  nivel (abajo, el nivel 0, `signRowY`); con 2 niveles asoma ≈ 0,3 sobre el remate. Pegatina de estantería
  (`buildCueFace` + `createCueMaterial`) en las dos caras, sin espejo, nunca atenuada; sus dos escuadras, detrás de las
  barras de los extremos del marco, nunca tapan una pegatina desde ningún giro de cámara (test). Marco y paneles son un
  `RackBay` que se vuelve fantasma cuando tapa la carretilla, una caja o una zona (nunca por las cajas de su plataforma)
  y suave con el muro hundido; las pegatinas nunca. La casilla de un nivel «libre», lisa y sin luz (`buildSignFrame`).
- **Luz por nivel** (`SlotLight`: panel, pegatina y banda de la casilla del cartel; docs/STORAGE.md «Lo que se ve y se
  oye»): latido solo en el `loadable` cuya pista encaja, destello al aterrizar, brillo en reposo; el efecto de acierto
  rodea la caja en la cara de su columna que ve la cámara (`TRUCK_BURST`) y la casilla del cartel destella con él; vista
  previa en la casilla de caja, a `hint.dropLevel`.
- **Marcador del nivel elegido** (`SIGN_MARKER`, `buildSignMarkerGeometry`, `markerAt`): el marco suave de las
  estanterías (`views/SlotMarker`), del tamaño de una casilla del cartel (una casilla de puerta de ancho, una fila de
  alto), sobre las barras de alrededor de la casilla del nivel elegido (`dockColumnX`, `signRowY`, `signMidZ`), en las
  dos caras, girado como el cartel.
- **Lo que el muro tapa no cuenta** (`beyondWall`): con el muro del muelle en pie, lo que queda al otro lado (las cajas
  de la plataforma, la parte de la carga que ya cruzó la puerta) nunca vuelve fantasma una estantería, un estante ni una
  caja apilada (`LevelView.clipToRoom`: el volumen se recorta a la sala; test en el Benchmark con la cámara por
  defecto).
- Sin camiones todo se dibuja exactamente como antes.

## Sonido (`src/audio`)

Su fila dice `sound: 'wood'` (`audio.test.ts`):

- Dejar en el camión → `SfxPlayer.truckDrop`, a `DROP_LAND_SEC` (cuando la caja toca): un «tunk» hueco de madera,
  distinto del «toc» metálico de las estanterías y del golpe de fieltro del suelo (sin subgrave). Dos modos graves de
  las tablas (`TRUCK_BED_MODES`: 150 y 286 Hz, inarmónicos, suenan a caja de tablas, nunca a nota) que bajan un poco
  (`TRUCK_BED_SAG` × 0,82) bajo un paso bajo cálido (`TRUCK_BED_LOWPASS_HZ` 900), la resonancia hueca del remolque
  (`TRUCK_BED_CAVITY_HZ` 330) y el contacto de la caja. Sobre otra caja del camión el contacto es el «toc» más ligero,
  todo suena un poco más agudo por nivel y la plataforma responde más débil (`TRUCK_LEVEL_DAMP` 0,55 por nivel).
- Coger del camión → el `pickup` del suelo (golpe de madera). Nada al pasar por delante.

## Nivel Benchmark (solo Modo prueba)

- `src/data/levels/especiales/benchmark.level` (docs/RACKS.md «Nivel Benchmark»): el camión **T** espera fuera de la
  puerta norte, con las casillas de puerta (1,0) y (2,0) (su caja, en (1,-1) y (2,-1)), a la izquierda de R, y una
  barandilla a cada lado de la puerta con una planta detrás, en (0,0) y (3,0). Se carga desde esas casillas mirando al
  norte; la fila 1 (detrás de la puerta) queda libre. Columna 1: «azul» abajo y «■» encima; columna 2: «amarillo ✚» y
  encima un nivel «libre» (sin escribir: `limit: 2`). La zona ▲ en (2,3), fuera de las filas de carga (la de la puerta y
  la de detrás). El cartel va sobre la puerta.
- Cajas del muelle: azul ✚ (6,1), amarillo ✚ (6,7) y el amarillo ■ cargado **abajo** en la columna 1 (su destino es el
  nivel de encima: se aparca, en el suelo o en el nivel libre de la columna 2 una vez cargado su amarillo ✚; entra el
  azul ✚, queda fijo, y el amarillo ■ va encima de él). Trampas del camión: el azul ▲ y el azul ■ encajan en «azul» (y
  el azul ■ en «■»), pero no brillan: zumban y se pueden sacar.
- Medido: 14 movimientos (exacto, el mismo plan desde que F / V van también en el camión: aparcar en el nivel libre o
  en el suelo es un movimiento igual), extra 2 (el cambio de las mentas y la carga equivocada), `camion` 4 (3 con
  pista, 1 libre). El piloto, a 60 y 20 fps, pulsa F / V una vez en el camión (7 en las estanterías) y saca marcha atrás
  la carga equivocada (`benchmarkPlayable.test.ts`).

## Ajustes

- Datos y gramática: `STORAGE_SKINS.truck` (`maxLevels` 2, `maxColumns` 3, letras `chars`, `fillToMax`),
  `STORAGE_WORDS.truck`, `COLUMN_WORDS.truck`, `TRUCK_HEADS` / `TRUCK_FILLERS` (las cabezas de la entrada) y el ejemplo
  `TRUCK_EXAMPLE` (asciiLevel.ts); las casillas de caja y de puerta, `truckCellOf` / `truckFrontOf` (core/docks.ts),
  `TRUCK_FACING` (core/types.ts).
- Reglas con decisión propia, fáciles de cambiar en un solo sitio: «libre» solo encima (validateLevel), relleno a
  `min(2, limit)` (`STORAGE_SKINS.truck.fillToMax`), zumbido también con la destinada sobre una base mal
  (`GameState.dropInStorage`, `!state.satisfied`), latido solo en los `loadable`, columna llena = nada
  (`Interaction.findDrop`, `LevelGrid.canStore`), nada en la puerta (`STORAGE_ACCESS.door.doorway`), puerta abierta solo
  para la columna encarada en línea con el cuerpo (`GameState.refreshStoragePassage`, `inLineWith`), V que no baja con
  la carga sobre las cajas de la columna (`GameState.sinksIntoStack`).
- Acceso (`logic/storageAccess.ts` `STORAGE_ACCESS.door`): `faceAngle` 30°, `faceLateral` 0,5, `faceNear` 0,8,
  `faceFar` 1, `holdAngle` 45°, `holdLateral` 0,6, `holdNear` 0,8, `pickReach` = `dropReach` 0,3 (más allá de la línea
  del muro); margen de «carga en la puerta» `INSIDE_MARGIN` 0,05 (GameState). Colisión: `DOOR_JAMB` 0,02 (core/docks),
  `DOOR_POCKET` 1 (collision.ts).
- Barandillas: `DOOR_JAMB` y `DOCK_RAIL.thickness` 0,06 (core/docks.ts: su línea y su grueso, una sola fuente para la
  validación, la colisión y el dibujo), `RAIL` (builders/truck.ts: postes, barras y tapas), `Theme.truck.rail` /
  `railCap`.
- Modelo (`solver.ts`): carga solo recta desde detrás de la puerta y salida solo marcha atrás (conservador, como los
  huecos); la cota de ciclos está en `MoveSearch.destTerm` / `targetDestinations`.
- Dibujo: puerta y alturas en `dims.ts` `DOCK` (`doorTop`, `sillTop`, `doorInset`, `bedTop`, `apronTop`); camión,
  umbral, cartel y marcador en `builders/truck.ts` (`TRUCK`, `DOCK_PLATE`, `DOCK_SIGN`, `SIGN_CUE`, `SIGN_GLOW`,
  `SIGN_MARKER`, `TRUCK_BURST`); colores en `Theme.truck`. La fuerza del latido y del destello es la de todo el
  almacenaje (`views/success.ts` `INVITE_*`, `FLASH_*`).
- Sonido: `sfx.ts` `TRUCK_BED_MODES`, `TRUCK_BED_SAG`, `TRUCK_BED_LOWPASS_HZ`, `TRUCK_BED_CAVITY_HZ`, `TRUCK_LEVEL_DAMP`.
