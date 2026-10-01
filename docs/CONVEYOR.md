# Cinta transportadora (aspectos `beltIn` y `beltOut`)

**Estado: H1, H1b, H1c, H2, H2b y H2c hechos (2026-10-01); H3, pendiente.**

Una cinta lleva sola una caja desde su **entrada A**, donde la deja la carretilla, hasta su **salida final B**, que la
carretilla no alcanza. Encaja en el almacenaje común (docs/STORAGE.md): A y B son unidades de almacenaje de un hueco, y
B es un objetivo más (reparto único, caja fija, zumbido, pistas P, «Quedan N», pegatina). Lo nuevo es el transporte. Se
construye por hitos pequeños; hoy están hechos **H1**, la cinta recta del suelo de A a B, **H1b**, sus ajustes tras
probarla (la cinta es una **mesa a la altura del nivel 1** de una estantería, A se carga con F como ese hueco y B es el
último tramo de la mesa, con la pista pintada encima), **H1c**, los de después: la mesa sobre una **base cerrada**
negra (sin patas), A con **barandillas cerradas negras** a los lados, la línea de carga delante y un **icono** de dejar
la caja, B con un **rodapié** del color de su cinta, y la horquilla que **nunca atraviesa la mesa** (con las púas dentro
de A, F / V no hacen nada), **H2**, el **botón**, que **devuelve a A la última caja mal puesta** con la cinta al revés
(0 movimientos), **H2b**, el botón en el suelo: una **almohadilla** junto a A, del color y el estilo de la de A, con
una **flecha de vuelta** pintada encima, a la que la carretilla **se sube** para pulsar Espacio, y **H2c**, la
almohadilla **justo al lado de la máquina** (se pulsa con cualquier rumbo, también de cara a A) y una pulsación que la
**ilumina mucho más**, con un halo de luz en el suelo alrededor, encendida mientras la caja vuelve. Solo el Benchmark
(y dos niveles de prueba) lleva una cinta; los niveles 1–3 no cambian.

## Decisiones

Petición (2026-09-30): «una cinta que va de un punto A a un punto B, y en el benchmark para probar que el otro extremo
sea un slot de una caja que no se pueda acceder con el toro»; en el ASCII, «un cuadrado de inicio y otro de final»; y
una cinta puede derivar en diferentes salidas en función de la caja.

Decisiones del usuario (2026-09-30 / 10-01):
- **A. Desvíos**: la cinta tiene salidas laterales; la caja sale por la **primera salida libre cuya pista encaja**
  según avanza y, si no hay ninguna, sigue hasta la final (H3).
- **B. Una caja a la vez** (H1).
- **C. Fuera de alcance**: las salidas no están al alcance de la carretilla; un **botón junto a A** invierte la cinta
  y devuelve a A la última caja mal puesta (H2). Hasta entonces, una caja mal puesta **se queda allí con el zumbido**
  (H1).
- **D. Se distingue** visualmente de todo lo demás, **clara y minimalista** (H1).
- **E. El botón lleva el color de su A**, para emparejarlos con varias cintas (H1 ya da a cada cinta su color de
  identidad; desde H1b, solo en A: el botón llega en H2).
- **F. Forma de trabajar**: «pequeños milestones… ir testeando poco a poco las implementaciones»; «cuando yo verifique
  el sistema de cinta de suelo, me preguntas por el de techo».

Decisiones de H1 (2026-10-01, al construirlo; para revisar):
- **G. Dos aspectos**: `beltIn` (la entrada) y `beltOut` (la salida final), cada uno con su fila en `STORAGE_SKINS` y
  `STORAGE_WORDS` (en vez de un solo aspecto `conveyor`): así ids, letras, palabras, objetivos y el registro de render
  salen de sus filas, sin casos. La cinta en sí va en `level.conveyors`, que enlaza las dos unidades por id.
- **H. Un acceso nuevo, `belt`** (el de B): la carretilla nunca lo engancha (`STORAGE_ACCESS.belt.engages: false`): ni
  lo encara, ni coge, ni deja; su casilla es un obstáculo; su hueco está sellado para siempre (solo su cinta lo llena).
- **I. El modelo del solver solo manda por la cinta la caja destinada a B**: sin el botón, una caja equivocada en B ya
  no vuelve (sería un callejón). En el juego sí se puede hacer (zumba y se queda; R reinicia). Desde H2 esto vale solo
  para una cinta **sin** botón; con botón el modelo manda cualquier caja (decisión AD).
- **J. «libre» en B** lo admite la gramática (`cinta final: libre`), pero hoy una caja allí no vuelve: el solver nunca
  lo usa. Tendrá sentido con el botón. Desde H2, con botón, una B «libre» es un aparcamiento fuera del suelo (el nivel de
  prueba del botón).

Tras probar H1 (2026-10-01), el usuario:
- «El letrero de la cinta no hace falta que sea vertical, podemos hacer que el símbolo esté directamente en el suelo,
  pero ese slot tenga unas vallitas naranjas rodeándolo (muy bajas).»
- «Hagamos que la cinta en vez de estar completamente en el suelo, esté elevada una altura para así visualmente no
  chirríe tanto. Sería como una mesa con la cinta.»
- «El color de la cinta un gris algo más claro con rayas blancas para enfatizar el movimiento de la cinta.»
- Y eligió la altura de la mesa: «La superficie de la cinta a la altura del primer hueco de una estantería. Para cargar
  en A subes la horquilla una vez con F y dejas la caja, igual que en una estantería, sin nada automático»; y B sobre la
  mesa: «B es el último tramo de la mesa, a la misma altura, con la pista pintada encima y una vallita naranja baja en
  su borde. La caja se queda arriba». El botón pasa a ser el siguiente hito (H2) y los desvíos, el de después (H3).

Decisiones de H1b (2026-10-01, al construirlo; para revisar):
- **K. Una mesa a nivel 1**: la cinta de suelo es una mesa cuya superficie está donde tiene el suelo el hueco de nivel 1
  de una estantería (`rackSlotY(1)`). Lo dicen los datos: cada casilla lleva su `height` = 1 (`FLOOR_BELT_LEVEL`,
  core/conveyors). La gramática del `.level` no cambia: una cinta de suelo siempre es esa mesa, así que su altura sale de
  la pieza y no se escribe (la de techo traerá las suyas).
- **L. A como un hueco de nivel 1, con F**: la carretilla llega a A con la horquilla en el nivel 0, como a cualquier
  unidad (nada automático); con la horquilla abajo la carga choca con la cara de la mesa, como con un hueco lleno de una
  estantería, y no se deja nada (ni en el suelo de delante); F la sube al nivel 1 y entonces se deja. Coger de vuelta
  de A (con B llena), igual: a nivel 1. V vuelve al 0; F en el 1 no hace nada (es el de arriba).
- **M. El nivel base, en el modelo común** (docs/STORAGE.md «Nivel base»): una unidad puede tener sus huecos a partir de
  un nivel (`LevelStorage.baseLevel`; 0 = el suelo, todas las estanterías y camiones). Las dos puntas de una cinta
  están a la altura de su cinta (validateLevel lo rellena desde sus casillas), así que su hueco es el de nivel 1 en
  todo: su id (`e1:0:1`, `s1:0:1`), el `level` de su caja, el nivel de la horquilla que lo alcanza, la pista de la
  horquilla (`hint.storage`, que debajo no tiene hueco: `slotId` null) y la posición del solver. Así, el piloto y la
  regla de F / V no saben nada de cintas.
- **N. B, el último tramo de la mesa**: fuera el cartelito (y la bandeja). Su pista va **pintada plana** encima (la
  pegatina de las estanterías, boca arriba, alineada con el mundo como el glifo de una zona) y una **vallita naranja muy
  baja** (el naranja y las tapas crema de las barandillas del muelle, a mucha menor escala: un quinto de la altura de
  una caja) la rodea por sus tres lados abiertos, nunca por el que da a la cinta. Fuera también su ribete del color de
  identidad: la vallita ya marca B; A conserva el color de su cinta (en su almohadilla), que emparejará con el botón.
- **O. La banda**: un gris algo más claro, con **rayas blancas** que se deslizan solo mientras corre (el aviso del
  movimiento); quietas con la cinta parada.
- **P. El marcador del nivel elegido** (el marco de las estanterías) también en A: plano sobre la mesa, alrededor de su
  almohadilla, solo con la horquilla en el nivel 1 (en el 0 no hay hueco que enmarcar). En B, nunca.

Tras probar H1b (2026-10-01), el usuario:
- «Las barandillas naranjas ponlas del mismo verde del slot del principio de la cinta, y que sean macizas en vez de una
  barandillita, que parezca un rodapiés.»
- «El slot donde dejas la caja, no debe dejarte bajar las palas si están arriba, y tampoco subirlas si estás abajo, ya
  que ahora traspasa.»
- «Pon las marcas que tienes en las estanterías para entender por dónde hay que cargar, y métele en los lados unas
  barandillas cerradas de color negro para visualmente entender que por ahí no se carga.»
- «La cinta prefiero que no tenga patas, sea como una pared lateral cerrada, así visualmente ocupa más. El color del
  lateral que sea el mismo negro.»
- «El slot de donde dejas la caja, que tenga algún icono visual de dejar ahí una caja.»

Decisiones de H1c (2026-10-01, al construirlo; para revisar):
- **Q. Sin patas: una base cerrada.** La mesa es un bloque macizo del suelo al tablero, de la cara de A a la espalda de
  B, con los laterales en un **negro suave** (`Theme.conveyor.side` `#474d52`, L ≈ 32: grafito frío, de la familia de
  las ruedas y las estanterías, nunca un negro puro; renderizado se lee negro) y el tablero claro encima (se ve como un
  canto claro fino); la base, `BELT.base.inset` (1,2 cm) dentro del tablero: un hilo de sombra. Fuera patas, faldón y
  travesaños. Ocupa sus casillas a la vista.
- **R. A, «por aquí no se carga» y «aquí se deja»**: dos **barandillas cerradas** (paneles macizos, el mismo negro de la
  base) en sus dos lados (los que no son la cara de carga ni la unión con la cinta), de la unión con la cinta al frente
  de la mesa, 0,12 sobre el tablero (`BELT_GUARD`: menos de un quinto de caja: nunca tapan la caja que se deja ni el
  icono); su cara de dentro a `BASE_GUARD.inset` (0,06) del borde de la casilla, donde también las encuentran las púas.
  Delante, en el suelo, la **línea de carga** de las estanterías (la misma función, `addLoadingLines`, antes
  `addRackLines`: el pizarra suave `Theme.rack.line`). En la almohadilla, el **icono de dejar** (`BELT_ICON`): una flecha
  gruesa desde la cara de carga hacia dentro (hacia la cinta) y, a su punta, el contorno de una caja vista desde arriba,
  en crema (`Theme.conveyor.icon`), girado con A: la flecha va por donde entra la carretilla, así que dice lo mismo desde
  cualquier giro de cámara (una flecha «abajo» se leería «arriba» desde detrás). Una caja encima lo tapa (decisión: con
  caja no hace falta invitar a dejar otra; vuelve a verse en cuanto la cinta se la lleva). El marcador del nivel elegido
  pasa al borde de la almohadilla (`BELT_MARKER.halfW` 0,43), entre las barandillas.
- **S. B, un rodapié**: una tira maciza continua y baja (`BELT_SKIRTING`: 0,06 sobre la cubierta, 0,03 de grueso, un
  décimo de caja: nunca tapa la caja ni la pista) por sus tres lados abiertos, nunca por el que da a la cinta, en el
  **color de identidad de su cinta** (el de la almohadilla de A: con varias cintas, cada A con su B). Fuera la vallita
  naranja. La pista pintada, la luz al llegar y la caja fija, como en H1b.
- **T. La horquilla nunca atraviesa la mesa en A** (en el modelo común, docs/STORAGE.md «Nivel base»: la base maciza de
  toda unidad de frente con nivel base): por debajo de su nivel base, la **cara de carga de A para las púas vacías** (un
  círculo en sus puntas, `TineCircle`, contra la `SolidBase` de A) y para la carga (su celda cerrada, y ahora también
  mientras la horquilla sube: la carga y la acción esperan a la horquilla ya en el tablero, no a 0,25 de él); y mientras
  las púas o la carga **están dentro de A**, sobre la mesa, **F / V / rueda no hacen nada**, la horquilla **no baja sola**
  (tampoco al acabar el nivel) y las púas vacías **mantienen el rumbo** (recto adentro o afuera, como la carga en un
  hueco): se sale marcha atrás y entonces se baja. Encima del tablero, las púas encuentran las barandillas de A.
- **U. Por los lados, como hasta ahora (para revisar)**: las púas vacías solo chocan con la cara de carga de A (y por
  encima con sus barandillas); por los lados de la mesa, en sus casillas de cinta y en B pasan como por una pared o una
  estantería (ninguna de ellas las para). Si chocaran con toda la mesa, la carretilla no podría ponerse de morro en la
  casilla de al lado (las púas llegan a 1,2 de su centro) y los caminos del solver y del piloto, contados en casillas,
  dejarían de valer (probado: el piloto se atascaba en el Benchmark girando junto a A). Desde la cámara por defecto
  apenas se ve (la mesa las tapa); girando, se ven entrar en el lateral negro.
- **V. El piloto** sube la horquilla una casilla antes de A (fuera de ella, como siempre), entra, deja, sale marcha atrás
  a la casilla de la que venía y allí la baja con V (`forkStepsAt.beltIn` = 2): nunca usa F / V dentro de A.
- **W. Sin fantasma**: la mesa cerrada (0,78 de alto, más baja que la carretilla) no se vuelve fantasma; una caja pegada
  detrás puede quedar tapada desde la cámara por defecto (se ve girando con Q/E). Si molesta, se le da un `Occluder`.

Para H2 (el botón), el usuario (2026-10-01): una caja equivocada se queda en su salida con el zumbido «hasta que se usa
el botón»; «un botón junto a A invierte la cinta y devuelve a A la última caja mal puesta»; «El botón debe ser del mismo
color que el punto A, para saber que el A y el botón son el mismo (esto es para cuando haya diferentes cintas)». Tras
probar H1: «si te equivocas no hay opción a volver». El botón, «una seta en un poste»: la seta del color de identidad de
la cinta (el verde azulado de la almohadilla de A y del rodapié de B), el poste del negro suave de la mesa; la cinta,
«clara y minimalista»; la horquilla, siempre a mano (F / V) en las unidades.

Decisiones de H2 (2026-10-01, al construirlo; para revisar):
- **X. El botón, una pieza más de la cinta**: en la leyenda `o = cinta botón`, con el id de su cinta (`cinta botón
  (c2)`) cuando el nivel tiene varias (con una, sobra); como mucho uno por cinta. En los datos, `LevelConveyor.button`
  (su casilla). En H2 su casilla era un obstáculo entero; desde H2b es una almohadilla en el suelo (decisiones AI y AJ).
- **Y. Pulsar** (H2): encarándolo como a la columna de una estantería para coger. Desde H2b, **estando encima** de la
  almohadilla (decisión AK); Espacio sigue pulsando y nada más (ni coge ni deja: `hint.button`, sin destino de caja).
- **Z. Cuándo funciona** (en este orden): la cinta **parada** (nada asentándose ni viajando, en ningún sentido), el
  hueco de **A vacío**, **nada de la carretilla dentro de A** (púas o carga) y **una caja que devolver**. Si no, un «no»
  suave (un clic más sordo y un zumbido corto, `beltButton` con su motivo: `busy`, `input`, `forks`, `nothing`) y nada se
  mueve. Lo que se ve al pulsar, desde H2b: decisión AM.
- **AA. Qué devuelve**: la **última caja que llegó** a una de sus salidas sin quedar fija allí (una equivocada en una B
  con pista, cualquiera en una «libre»): una lista LIFO por cinta (`ConveyorSystem.keep` / `takeLast`). Con una sola
  salida (H2) es la de B; la lista ya sirve para las salidas laterales de H3. Una caja fija (la suya) nunca vuelve.
- **AB. El viaje de vuelta**: la caja pasa al hueco de A en el acto (sellado: ni se coge ni se deja otra mientras
  viaja), el botón responde (`CONVEYOR.pressSec`, 0,3 s) y la cinta corre **al revés** con el mismo viaje suave
  (la misma curva cerrada, en espejo: determinista a 60 y 20 fps), las rayas hacia atrás (`ConveyorState.travel`
  disminuye, `direction` −1). Al llegar (`beltReturned`) es una caja más en A: se coge con la horquilla en el nivel 1.
  No vuelve a salir sola (la cinta solo arranca al dejar una caja); cogida de A y dejada otra vez en A, viaja de nuevo a
  B sin contar movimiento (es «dejarla donde estaba»).
- **AC. Contadores**: pulsar y la vuelta cuentan **0 movimientos**; «Quedan N» no cambia (la caja no cumplía nada) y una
  vuelta nunca completa el nivel.
- **AD. El solver, sin aristas gratis**: el botón se pliega en el movimiento que sigue. Una caja en B «se levanta de B»
  (`canLift`: la cinta tiene botón, A vacía, la caja no está fija; `pickupStarts`: la carretilla llega a una casilla
  desde la que se pulsa, desde H2b la almohadilla misma (AN), y luego a la de delante de A) y se deja donde podría
  dejarse una caja levantada de A: un
  movimiento (pulsar no cuenta), como en el juego. Con botón **cualquier caja** puede ir por la cinta (`validDrop`): una
  equivocada aparca en B fuera del suelo; sin botón, como en H1, solo su caja destinada. Con una salida por cinta el
  orden de llegada no hace falta guardarlo (vuelve la que hay); con las laterales (H3) entrará en el estado. La cota
  sigue admisible y consistente (`levels/conveyor.test.ts` lo comprueba sobre **todos** los estados del nivel de prueba,
  con una búsqueda exhaustiva).
- **AE. El piloto**: para una jugada «desde B» pulsa el botón (desde H2b, subido a la almohadilla: decisión AP), espera
  la vuelta y coge la caja de A como cualquier caja que espera en A: **una casilla antes**, F allí (las púas fuera) y
  dentro. Un trayecto en vacío ya nunca pisa la casilla de delante de A de frente a A con la horquilla abajo (la cara de
  la mesa lo pararía).
- **AF. El Benchmark**: el botón en (7,2), a la izquierda de A, junto a su barandilla oeste. Desde H2b, en **(7,3)**
  (decisión AQ); desde H2c, otra vez en **(7,2)** (decisión AS).
- **AG. La seta en un poste** (H2): fuera en H2b, con su geometría y sus constantes (decisión AI).
- **AH. Una cinta sin botón** sigue el modelo de H1 (una caja equivocada en B nunca vuelve; el solver no la manda): los
  callejones no la cuentan. Toda cinta de un nivel debería llevar el suyo (hoy, la del Benchmark; el nivel de prueba de
  H1 sigue sin él, para probar H1).

Tras probar H2 (2026-10-01), el usuario: «hagamos un botón más adaptado al estilo visual. un slot en el suelo con un
icono de flecha hacia atrás, y que el toro deba ponerse dentro y pulsar. Del mismo color que la base A. el pivote con el
botón en alto descartado».

Decisiones de H2b (2026-10-01, al construirlo; para revisar):
- **AI. El botón, una almohadilla en el suelo**: la de A otra vez (`BELT_BUTTON` = `BELT.pad`: el mismo cuadrado
  redondeado, 0,43 de medio lado y 0,08 de radio, igual de grueso, 0,02, la misma goma y el mismo color de identidad),
  en el suelo de su casilla, con una **flecha de vuelta** crema pintada encima (`BELT_BUTTON_ICON`, el crema del icono
  de A, `Theme.conveyor.icon`): un giro en U grueso cuya cola va por la cinta hacia B, da la vuelta y apunta de vuelta
  hacia A (con la cinta subiendo en pantalla, ↶: la caja que vuelve). Girada con su cinta, como el icono de A; un giro
  nunca es un espejo, así que se lee igual desde la cámara por defecto y girándola. Fuera el poste y la seta (geometría,
  constantes y textos; el tema no tenía colores propios del botón).
- **AJ. Suelo, no obstáculo**: la carretilla pasa por encima, vacía o con carga (ni el cuerpo, ni la carga, ni las púas
  encuentran nada: `CollisionWorld` ya no le pone estático). **Ninguna caja descansa nunca en ella**: con el punto de
  horquilla sobre la almohadilla, Espacio no deja nada (el `actionIdle` suave de siempre, sin vista previa) y nunca es
  una casilla candidata para dejar (`LevelGrid.padAt`, `canTakeBox`). validateLevel rechaza una caja o una zona que
  empiece en ella y una almohadilla en la casilla desde la que se carga una unidad (delante de una estantería o de una
  entrada de cinta, o en la puerta de un camión: allí Espacio pulsaría en vez de cargar); la carretilla tampoco empieza
  encima (empezaría pulsando, y en el mapa cada casilla dibuja una sola cosa). Necesita una casilla de suelo libre a su
  lado para subir a ella.
- **AK. Encima = dentro**: la carretilla está en el botón cuando el **centro de su cuerpo** está dentro de su casilla, a
  `BUTTON_PAD.margin` (0,15) de cada borde (un cuadrado de 0,7 en el centro: `logic/conveyor` `onButtonPad`), con
  **cualquier rumbo** y la horquilla vacía o cargada. Entrando recto desde al lado, un poco después de pisar el borde.
  Ahí **Espacio siempre pulsa** (`hint.button`): ni coge ni deja, aunque haya una caja delante o se lleve una; en el
  borde que queda (los 0,15 de cada lado) y fuera, Espacio es lo de siempre.
- **AL. Las reglas, las de H2** (decisión Z, en el mismo orden): la cinta parada, A vacía, nada de la carretilla dentro
  de A y algo que devolver. Encima de una almohadilla pegada a A y de cara a A, las púas entran en A (por su lado pasan,
  decisión U): se rechaza («forks»); se pulsa de cara a otro lado. Desde H2c, eso ya no se rechaza: decisión AT.
- **AM. Respuesta**: mientras la carretilla está encima, la almohadilla **brilla un poco** en su color
  (`BUTTON_FEEL.standGlow`, 0,24: sustituye al brillo tenue de encarar la seta); la pulsación aceptada la **ilumina**
  (0,55, se apaga en 0,75 s) y la **hunde** un poco en el suelo (`BELT_BUTTON.dip`, 1 cm: bajada rápida, subida suave);
  la rechazada, solo un **destello apagado** (`refusedFlash`, +0,1 durante 0,3 s), sin hundirla. La carretilla tapa casi
  toda la almohadilla mientras está encima: el brillo se ve en su borde. Los sonidos, los de H2. La pista de controles
  sigue diciendo «Espacio recoger / dejar / pulsar» solo en los niveles con botón. Desde H2c, la luz es otra: decisión
  AV.
- **AN. El solver**: la almohadilla es suelo que nunca es aparcamiento ni objetivo (`LevelGrid.pads`): `validDrop` nunca
  la da por destino, `pickupStarts` nunca coge desde ella y ninguna jugada termina con la carretilla encima
  (`carrySearch`, `chainTo`, `carryBackTo`): allí Espacio pulsaría. Se pulsa estando encima: `pressFrom` = la
  almohadilla, que tiene que estar en la región de la carretilla. El modelo es más estricto que el juego (en el borde de
  la almohadilla el juego sí deja coger y dejar). Las cotas no cambian y siguen admisibles y consistentes (las mismas
  comprobaciones, la exhaustiva del nivel de prueba incluida); la búsqueda tarda lo mismo (Benchmark: 19 ms la exacta y
  ≈ 3,2 s con los 60 estados de callejones, antes y después).
- **AO. Las métricas**, como suelo: «estrechas» cuenta su casilla como suelo (con carga se gira por encima) y «libre»
  como libre (no hay estantería, planta ni caja). En el Benchmark vuelven a los números de H1c: estrechas 9 → 8 ((7,1)
  recupera sus cuadrados de 2×2) y libre 74 % → 75 % (el objetivo `libre<=75` se cumple justo); en el nivel de prueba
  del botón, estrechas 6 → 7 (la almohadilla misma, en su bolsillo de plantas) y libre 39 % → 42 %.
- **AP. El piloto**: sube a la almohadilla recto desde una casilla libre a su lado, por el camino más corto que deja las
  púas fuera de A (si no queda otro lado, entra de cara a A y gira encima, con las púas vacías, antes de pulsar); pulsa,
  sale marcha atrás a esa casilla y espera la vuelta; luego coge de A como cualquier caja que espera allí. Nunca coge ni
  deja estando encima (el plan nunca se lo pide). Desde H2c, pulsa con cualquier rumbo, sin girar: decisión AW.
- **AQ. El Benchmark: el botón pasa de (7,2) a (7,3)** (para revisar). En (7,2), al oeste de A, la mesa y la barandilla
  oeste de A quedan entre la almohadilla y la cámara por defecto (que mira desde el sureste) y tapan su esquina noreste:
  cerca del 40 % de la almohadilla y la vuelta de su flecha. La regla de «nada escondido desde la cámara» (que mira ahora
  también los botones: `levels.test.ts`, `benchmark.test.ts`) la marca. En (7,3), a la izquierda de la casilla de
  delante de A (su línea de carga), se ve entera en cuanto se aparta el amarillo ● (que la tapa un poco al empezar) y
  sigue del lado izquierdo de A, como en H2. Las métricas son las mismas en las dos (15 exacto, estrechas 8, libre 75 %,
  callejones 0, el mismo plan). El precio: estando encima no se coge el amarillo ● de (8,3) (Espacio pulsa): se coge
  desde (8,4) o (9,3), o desde el oeste antes de pisarla (la horquilla ya la alcanza); el piloto lo coge desde (8,4) y
  tarda algo más (15449 / 5636 frames; con la almohadilla en (7,2), los 15229 / 5560 de H1c). Volver a (7,2) es mover la
  «o» del mapa. Desde H2c, de vuelta en (7,2), a petición del usuario (decisión AS).
- **AR. Los niveles de prueba**: `cinta-boton.level` no cambia de mapa (su almohadilla (4,2) se sube desde (4,3), de cara
  al norte; su plan de 3 movimientos sigue usando el botón a 60 y 20 fps); `cinta.level`, sin botón, no cambia.

Tras probar H2b (2026-10-01), el usuario: «bien, solo poner botón justo al lado de la máquina, que cuando le des click se
ilumine mucho más».

Decisiones de H2c (2026-10-01, al construirlo; para revisar):
- **AS. El botón, justo al lado de la máquina** (para revisar): en el Benchmark vuelve a **(7,2)**, pegado al lado oeste
  de A (a su barandilla oeste), como en H2. La petición manda sobre AQ: desde la cámara por defecto la mesa de A le tapa
  la esquina noreste (cerca del 40 %), pero se ven sus lados sur y oeste, también con la carretilla encima, y encendida
  su luz se derrama por el suelo de alrededor (AV), que se ve. La regla de «nada escondido desde la cámara»
  (`benchmark.test.ts`) lo admite a propósito, y solo eso: hacia la cámara, la mesa de A al este; al sur y al sureste,
  suelo. Se sube desde (7,3), (6,2) o (7,1). Las métricas no cambian (15 exacto, estrechas 8, libre 75 %, callejones 0,
  el mismo plan) y el piloto vuelve a los frames de H1c (la almohadilla deja libre la casilla (7,3), desde la que coge
  el amarillo ● de (8,3)).
- **AT. «forks», solo con el hueco de A ocupado**: la pulsación se rechaza solo si las púas vacías o la carga **ocupan el
  hueco de A, donde aterriza la caja que vuelve**: dentro de su celda con la horquilla en su nivel base o más arriba,
  sobre su tablero (`GameState.forksInInput`). Las púas que entran en su celda por un lado **por debajo del tablero**
  (pasan su base como una pared, decisión U) no lo ocupan: la caja vuelve por encima. Así, de cara a A desde una
  almohadilla pegada a ella se pulsa (en el Benchmark, desde (7,2) mirando al este), con cualquier rumbo. Genérico:
  cualquier cinta, cualquier almohadilla. El caso de verdad (las púas o la carga sobre el tablero de A) se sigue
  rechazando, aunque desde una almohadilla ya casi no se da (F / V solo suben la horquilla en una columna encarada y
  fuera de toda almohadilla, y las barandillas de A no dejan entrar por los lados unas púas subidas): el test pone la
  horquilla en el nivel 1 a mano.
- **AU. Nada entra en el hueco de A mientras vuelve una caja**: de la pulsación aceptada a que la caja descansa en A, la
  cara de carga de A para también las púas vacías **por encima de su nivel base** (`CollisionWorld.shutBase`): no se
  meten bajo la caja que viene; al llegar es una caja más en A (se entra bajo ella y se coge como siempre). La carga ya
  no entraba (el hueco está ocupado). Y las púas vacías **dentro de la base** de A (por un lado, por debajo del tablero)
  **no suben**: F / V no hacen nada y la horquilla no sube sola (`GameState.tinesInSolid`, `CollisionWorld.inSolidBase`);
  se sale y entonces se sube. Cierra también un hueco de H1c: girando en la casilla de delante de A, las púas entraban
  por un lado y F las subía a través del tablero. El bloqueo de H1c (las púas o la carga dentro de A sobre el tablero:
  F / V / rueda quietas, la horquilla sin bajar, el rumbo fijo) sigue igual. Con AT, la caja que vuelve nunca encuentra
  la horquilla.
- **AV. La luz** («que se ilumine mucho más»): la pulsación aceptada enciende la almohadilla **con fuerza** (su brillo
  hasta `BUTTON_FEEL.litGlow` 1,3, más que el 0,8 del destello de un objetivo cumplido) y, alrededor, un **halo de luz en
  el suelo** (`BELT_BUTTON_HALO`: un cuadrado redondeado difuminado desde el borde de la almohadilla hasta 0,7 más allá,
  más de tres veces el halo de una zona, casi opaco junto a ella: `litHalo` 0,95), en su color de identidad un poco más
  claro (`haloLift`: +0,12 de luminosidad, el mismo tono y la misma saturación). Sube en `litRise` (0,2 s), **sigue
  encendida mientras la cinta va al revés** y se apaga suave en `litFade` (0,9 s) cuando la caja llega a A, con curva
  suave en las dos puntas (sin parpadeo); el hundido de 1 cm, igual. Se ve desde la cámara por defecto con la carretilla
  encima: ella tapa la luz que le queda detrás y la mesa de A la de su lado; la del sur y el oeste, no (comprobado en el
  navegador). Con la carretilla encima, el brillo suave de siempre (0,24) y un **halo tenue** (`standHalo` 0,3), que se
  ve alrededor de la carretilla. La rechazada, igual de discreta: +0,1 en la almohadilla y +0,12 en el halo durante
  0,3 s. Apagada, la almohadilla y su flecha, como en H2b. El halo es un objeto propio en el suelo (no se hunde con la
  almohadilla) y no cuenta para el encuadre.
- **AW. El piloto pulsa con cualquier rumbo**: sube a la almohadilla por el camino más corto desde cualquier lado libre,
  pulsa tal cual llega (también de cara a A: ya no gira encima), sale marcha atrás a esa casilla y espera la vuelta. En
  el Benchmark sube desde (7,3), de cara al norte; en un nivel del test cuya almohadilla, pegada a A, solo se sube desde
  el lado contrario (`conveyorButtonFixture.test.ts`), pulsa de cara a A.
- **AX. Los niveles de prueba** no cambian: `cinta-boton.level` (su almohadilla se sube solo desde (4,3), de cara al
  norte; su plan de 3 movimientos sigue usando el botón a 60 y 20 fps) ni `cinta.level`, sin botón.

## Las tres piezas

Una cinta es una lista ordenada de casillas, cada una con su **pieza** y su **altura** (`ConveyorCell.piece` /
`height`, en niveles como un hueco), desde el primer hito, para no rehacer los datos:
- **`suelo`** (H1, H1b, H1c, hecho): una mesa sobre una base cerrada con la banda encima, su superficie a nivel 1
  (`FLOOR_BELT_LEVEL`).
- **`rampa`** y **`techo`** (después, a preguntar al usuario): la rampa subiría la caja a la altura del techo; la de
  techo colgaría con tirantes. La gramática ya los lee (`cinta rampa`, `cinta techo`) y validateLevel los rechaza con un
  mensaje claro («la cinta en rampa llega más adelante…»). Sus alturas saldrán de sus casillas; las puntas de la cinta,
  a la altura de la casilla que tocan (su nivel base).

## Hitos

- **H1 · Cinta recta A → B — hecho (2026-10-01).** Datos con las 3 piezas (solo `suelo` en uso); gramática de A, `~` y
  B; validación; lógica del viaje, una caja a la vez y contadores; solver y piloto (dejar en A, B como objetivo); dibujo
  con el color de identidad y sonido; este documento; el Benchmark con una cinta corta y B fuera de alcance.
- **H1b · La mesa — hecho (2026-10-01).** Los ajustes del usuario tras probar H1 (decisiones K–P): la mesa a nivel 1, A
  con F como un hueco de nivel 1, el nivel base en el modelo común, B al final de la mesa con la pista pintada y la
  vallita naranja, la banda gris clara con rayas blancas.
- **H1c · La base cerrada — hecho (2026-10-01).** Los ajustes tras probar H1b (decisiones Q–W): la mesa sin patas sobre
  una base cerrada negra, A con barandillas cerradas negras, la línea de carga y el icono de dejar, B con un rodapié del
  color de su cinta, la horquilla que nunca atraviesa la mesa (la cara de A para las púas, F / V quietas dentro de A) y
  el piloto que sale marcha atrás antes de bajarla.
- **H2 · Botón — hecho (2026-10-01).** Decisiones X–AH: `o = cinta botón` en la gramática, una seta del color de A en
  un poste junto a A; Espacio de frente lo pulsa (0 movimientos); con la cinta parada, A vacía y nada de la carretilla
  dentro, la cinta corre al revés y devuelve a A la última caja mal puesta (LIFO); si no, un «no» suave. El solver lo
  pliega en el movimiento que sigue y manda cualquier caja por una cinta con botón; el piloto lo pulsa; el Benchmark lo
  lleva en (7,2) y un nivel de prueba nuevo, `pruebas/cinta-boton.level`, lo necesita.
- **H2b · El botón en el suelo — hecho (2026-10-01).** Decisiones AI–AR, tras probar H2: el botón es una almohadilla en
  el suelo como la de A, con una flecha de vuelta; la carretilla se sube a ella (el centro de su cuerpo dentro, cualquier
  rumbo) y Espacio pulsa (antes que coger o dejar); suelo para pasar, nunca para una caja; brilla un poco con la
  carretilla encima, se ilumina y se hunde al aceptar. El solver la trata como suelo que nunca es aparcamiento ni sitio
  de trabajo; el piloto sube, pulsa y sale marcha atrás; en el Benchmark, en (7,3).
- **H2c · El botón junto a la máquina — hecho (2026-10-01).** Decisiones AS–AX, tras probar H2b: en el Benchmark, de
  vuelta en (7,2), justo al lado de A; «forks» solo con las púas o la carga en el hueco de A, sobre su tablero (de cara a
  A desde una almohadilla pegada a ella, se pulsa); mientras vuelve una caja nada entra en ese hueco y las púas metidas
  en la base no suben; la pulsación aceptada ilumina la almohadilla con fuerza, con un halo de luz en el suelo, encendida
  durante la vuelta y apagándose suave al llegar la caja; el piloto pulsa con cualquier rumbo.
- **H3 · Desvíos** (pendiente, lo siguiente): salidas laterales con pista, la primera que encaje según avanza la caja,
  B como final; caja que se queda en A si no hay sitio; el botón devuelve la última que llegó a cualquiera de ellas (la
  lista LIFO de AA ya está; el solver tendrá que guardar el orden de llegada); en el Benchmark, 1 o 2 desvíos y una
  trampa de pista parcial. Con el OK del usuario, el PR de la cinta del suelo.
- **Después**: el sistema de techo (rampa + cinta de techo).

## Reglas (H1, H1b, H1c, H2, H2b, H2c)

1. **Cinta** = una tirada recta (una fila o una columna): A, **al menos una** casilla de cinta y B, seguidas y en línea.
   A y B son unidades 1×1 (aspectos `beltIn` y `beltOut`) que **miran al lado contrario a la cinta**. Toda ella es una
   **mesa** a la altura del nivel 1 de una estantería, de la cara de A a la espalda de B, sobre una base cerrada.
2. **A, la entrada**: «libre» (nunca objetivo, nunca zumba), un hueco **sobre la mesa, a nivel 1**, que se carga **de
   frente**, desde la casilla de delante (la del lado contrario a la cinta), como el hueco de nivel 1 de una estantería:
   acceso `front`, se encara igual; F / V eligen el nivel (0, la cara de la mesa; 1, el hueco: nada automático), y vista
   previa y marcador igual. Con la horquilla por debajo del 1 (en el 0, o subiendo), la carga y las púas vacías chocan
   con la cara de la mesa y no se deja ni se coge nada. **Con las púas o la carga dentro de A** (sobre la mesa), F / V /
   rueda no hacen nada, la horquilla no baja y el rumbo se mantiene: se sale marcha atrás y entonces se cambia de nivel.
   Con las púas vacías metidas en su base por un lado, por debajo del tablero (H2c), F / V tampoco hacen nada y la
   horquilla no sube: nunca atraviesa el tablero. Sus lados están cerrados (barandillas); su frente es suelo.
3. **B, la salida final**: el último tramo de la mesa, a la misma altura; su pista (color, símbolo, los dos o «libre»)
   como un hueco; con pista es un objetivo del reparto único. La carretilla nunca trabaja en B (acceso `belt`, decisión
   H).
4. **El viaje**: dejar una caja en A con B libre la pone en camino: se asienta en A `settleSec` (su planeo de dejar
   aterriza antes), la cinta arranca suave, la lleva a `speed`, nivelada sobre la mesa, y la para suave en el centro de
   B (`rampSec` en cada extremo). **Una caja a la vez**: mientras se asienta o viaja, el hueco de A queda **sellado** (no
   se coge, no se deja otra).
5. **Llegada**: su caja destinada cumple B (brilla, campana) y queda **fija**; cualquier otra **zumba** y se queda en
   B hasta que se pulsa el botón (regla 9; una cinta sin botón no la devuelve nunca).
6. **B llena**: una caja dejada en A **se queda en A**, con el zumbido suave (`beltBlocked`), y se puede volver a coger
   (con la horquilla en el nivel 1).
7. **Contadores**: dejar en A cuenta **1 movimiento**; el viaje, **0**; pulsar el botón y la vuelta, **0**. Una caja en A
   o viajando sigue contando en «Quedan N» hasta que cumple B; una vuelta no cambia «Quedan N» y nunca completa el nivel.
8. **Obstáculos**: las casillas de cinta, A y B (la mesa entera), para el cuerpo y para la carga; para las púas vacías,
   la cara de carga de A por debajo de su nivel base y sus barandillas por encima (decisión U: por los lados, como una
   pared, no las paran), y su cara también por encima mientras el botón le devuelve una caja (H2c); nada empieza ni se
   deja encima de una casilla de cinta, y una cinta empieza vacía. El botón no es un obstáculo (H2b): es suelo, pero
   nunca lleva una caja (ni empieza ni se deja ninguna en él).
9. **El botón** (H2, H2b, H2c): una almohadilla en el suelo, en una casilla propia junto a A (como mucho uno por cinta),
   del color y el estilo de la de A, con una flecha de vuelta. Con la carretilla **encima** (el centro de su cuerpo
   dentro, cualquier rumbo, vacía o cargada), **Espacio** lo pulsa, y solo eso: con la cinta parada, A vacía, nada de la
   carretilla en el hueco de A (las púas o la carga en su celda sobre el tablero; metidas en su base por un lado, por
   debajo, no cuentan) y alguna caja que devolver, la cinta corre **al revés** y la **última caja que llegó** a su salida
   sin quedar fija vuelve al hueco de A (sellado mientras viaja, también para las púas; luego, una caja más en A). La
   almohadilla se ilumina con fuerza, con su halo en el suelo, mientras la caja vuelve. Si no, un «no» suave y nada se
   mueve. Nunca va en la casilla desde la que se carga una unidad.

## En el archivo `.level`

Cada pieza de una cinta es una entrada de la leyenda. En el mapa: las casillas de cinta (`~` en la forma canónica) en
línea recta, la letra de la entrada pegada a un extremo y la de la salida final pegada al otro, en línea; su botón, en
una casilla propia de suelo (junto a A, nunca en la de delante de A). La altura no se escribe: una cinta de suelo es una
mesa a nivel 1 (decisión K).

```
cinta    = "cinta" [pieza]                    (una casilla de cinta; sin pieza, la de suelo)
pieza    = "suelo" | "rampa" | "techo"        (hoy solo se construye la de suelo)
entrada  = "cinta entrada" [id]               (A: «libre», no lleva nada más)
final    = "cinta final" [id] ":" pista       (B: una sola pista)
botón    = "cinta botón" [id]                 (su botón, H2: el id de su cinta, si el nivel tiene varias)
pista    = "libre" | color [símbolo] | símbolo
id       = "(" texto ")"                      (el id de la cinta, en una de sus dos puntas o en su botón)
```

- La cabeza es `cinta` (también `belt` / `conveyor`). Cada grupo conectado de un carácter de cinta es una cinta: recto,
  con una entrada y una salida final que lo tocan en línea (una entrada al costado, o una final que no sigue la línea,
  es un error). Dos cintas pegadas llevan caracteres distintos (`- = cinta`); dos cintas separadas pueden compartir sus
  tres entradas de la leyenda.
- Ids: cintas `c1, c2…` por el orden de sus entradas (orden de la leyenda y luego de lectura), o el que lleve una de sus
  puntas (`cinta entrada (c7)` o `cinta final (c7): …`; si las dos, el mismo). Las unidades: entradas `e1, e2…`,
  salidas `s1, s2…`, después de estanterías y camiones (regla 12 de docs/STORAGE.md). Una cinta empieza vacía: `+
  caja` no va en ninguna de sus puntas.
- El botón (`cinta botón`, también `button`): una casilla, como mucho uno por cinta; con varias cintas lleva el id de la
  suya (`o = cinta botón (c2)`), con una sobra.
- Forma canónica: `~` en toda casilla de suelo, una letra por punta (entradas `A D F J`, salidas `B E G K`), sus
  entradas después de las de estanterías y camiones y `~ = cinta` tras ellas, y luego los botones (`o`, `O`…: `o = cinta
  botón`, con su id solo si hay varias cintas); el id de la cinta solo en la entrada y solo si no es el generado. Un nivel
  sin cintas no usa `~`.
- Salidas laterales (`cinta salida`): «llegan en el siguiente hito».

Ejemplo (canónico; lo comprueba `asciiLevel.conveyor.test.ts`):

```
# 1 · Cinta de ejemplo
id: cinta-ejemplo
limit: 1

  0123456
0 .pBp...
1 ..~....
2 ..~.1..
3 .oA....
4 .a.....
5 ...^.b.

1 = zona menta
a = caja azul ●          b = caja menta ▲
A = cinta entrada        B = cinta final: azul    ~ = cinta                o = cinta botón
```

Una cinta de dos casillas de (2,3) al norte hasta (2,0), entre dos plantas: B solo se alcanza por la cinta. La azul ●,
que solo cabe en B, se deja en A desde (2,4) mirando al norte, con la horquilla en el nivel 1; la cinta la lleva a B. 2
movimientos. Su botón «o» (1,3), una almohadilla a la izquierda de A, devolvería a A una caja equivocada que llegase a
B.

Errores (en español, `archivo:línea:columna`): pieza desconocida (con sugerencia), entrada con pista o con caja, final
sin dos puntos, sin pista, con más de una o con caja («la cinta empieza vacía…»), cinta que no es recta, sin entrada o
sin salida final, con dos, entrada al costado, final fuera de línea, punta que no toca ninguna cinta o que toca dos,
ids distintos en las dos puntas, id en un carácter de varias cintas, id repetido. Del botón (H2): algo detrás de
`cinta botón [(id)]` («… sobra: el botón de una cinta se escribe «cinta botón»…»), un botón sin cinta en el nivel, un
id que no es de ninguna cinta («ninguna cinta lleva el id «c7»…»), sin id con varias cintas («hay 2 cintas: el botón
lleva el id de la suya, p. ej. «o = cinta botón (c1)»»), un segundo botón en la misma cinta («la cinta «c1» ya lleva un
botón (en la x,z)…»). Los de validateLevel (abajo) se señalan donde hay que arreglar: la pieza de rampa o de techo en su
entrada de la leyenda; la entrada sin sitio delante, en la entrada («la entrada de cinta «A» se carga por delante, por
el lado contrario a su cinta…»); la cuenta de cajas con las salidas («… y 1 salidas de cinta con pista»); más de un
reparto, en la salida final; un botón sin ningún lado libre, en su casilla («el botón de la cinta es una almohadilla
del suelo a la que la carretilla se sube desde una casilla de suelo a su lado, y no le queda ninguna libre…»); un botón
en la casilla desde la que se carga una unidad, en su casilla («el botón de la cinta no va en la casilla desde la que
se carga una unidad…»).

## Datos y validación

```ts
// core/types.ts
interface LevelConveyor { id: string; input: string; output: string; cells: ConveyorCell[];   // LevelData.conveyors?
                          button?: CellPos }   // H2: la casilla de su botón (H2b: una almohadilla en el suelo)
interface ConveyorCell { x: number; z: number; piece: ConveyorPiece; height: number }          // de la entrada a la final
// El botón: core/conveyors hasBeltButtons (algún botón en el nivel), buttonEntriesOf (sus lados libres, para subir a él).
type ConveyorPiece = 'suelo' | 'rampa' | 'techo';                                                  // CONVEYOR_PIECES
// height: el nivel de su superficie (como un hueco); una cinta de suelo, FLOOR_BELT_LEVEL = 1 (core/conveyors).
// Sus puntas, en LevelData.storage (después de estanterías y camiones), a la altura de la casilla que tocan:
//   { id: 'e1', skin: 'beltIn',  x, z, w: 1, access: { kind: 'front', facing }, columns: [[null]],   baseLevel: 1 }
//   { id: 's1', skin: 'beltOut', x, z, w: 1, access: { kind: 'belt',  facing }, columns: [[pista]],  baseLevel: 1 }
// facing = el lado contrario a la cinta (en las dos). Su hueco: `e1:0:1` / `s1:0:1`, nivel 1. core/conveyors.ts:
// conveyorsOf, hasConveyors, beltUnitsOf, beltEndLevels (el nivel de cada punta), beltPathOf, conveyorOfUnit.
```

`validateLevel` (mensajes en inglés **exactos**; `validateLevel.conveyor.test.ts`): `conveyors[i]` con `id` (por defecto
`c${i+1}`; `duplicate conveyor id "…"`), `input` / `output` (`conveyors[i].input "…" is not a belt input (a storage
unit of skin beltIn)`, igual con `output` / `belt exit` / `beltOut`; una punta en dos cintas: `beltInputs[j] belongs to
conveyors[k] and to conveyors[i]: …`; una punta sin cinta: `beltInputs[j] belongs to no conveyor: …`) y `cells`
(`conveyors[i] needs at least one belt cell between its input and its end exit`; `conveyors[i].cells[j].piece must be
suelo, rampa, techo`; `conveyors[i].cells[j] is a rampa piece: only floor belts («suelo») are built so far`; la altura,
1 por defecto: `conveyors[i].cells[j] has height 0: a floor belt («suelo») is a table at level 1 (the floor of a rack's
level-1 slot)`). El nivel base de sus puntas lo pone validateLevel (la altura de la casilla de al lado: `beltEndLevels`);
uno distinto en el nivel crudo: `beltExits[j].baseLevel must be 1: a belt's input and end exit stand at their belt's
height`; en cualquier otra unidad, solo 0: `racks[j].baseLevel must be 0: only a conveyor belt's input and end exit stand
above the floor`. La línea: `conveyors[i] is not a straight run from its input to its end exit at x,z`; los lados:
`beltInputs[j] must face south: a belt input is loaded from the side away from its belt` y `beltExits[j] must face south:
a belt's end exit takes its box from the belt's last cell`. Las casillas, dentro y libres (`conveyors[i] overlaps another
obstacle at x,z`; después, bloqueadas: cajas, zonas y carretilla dan `… is inside an obstacle`). Una entrada con pista:
`beltInputs[j] asks for a cue: a belt input is «libre» (any box set down there rides its belt)`; sin sitio delante:
`beltInputs[j] column 0 has no room in front: cell x,z is …`. Una caja al empezar en una punta: `box "…" starts on
beltInputs[j]: a conveyor belt starts empty (…)`. Con cintas, la cuenta de cajas: `a level with storage needs one box per
target (n boxes, z zones, h slots with a cue, t truck levels, s belt exits with a cue)`; más de un reparto nombra la
salida como `beltExits[j].columns[0][0]`. El botón (H2; H2b: una almohadilla en el suelo, nunca un obstáculo),
opcional: `conveyors[i].button.x must be an integer` (igual `z`), `conveyors[i].button leaves the warehouse at x,z`,
`conveyors[i].button overlaps another obstacle at x,z` (una planta, una estantería, una casilla de cinta…: su casilla es
suya), `conveyors[i].button is at x,z, where the button of conveyors[k] is: every button has a cell of its own`, y en la
casilla desde la que se carga una unidad (su frente o la puerta de un camión), `conveyors[i].button at x,z is where
racks[j] column c is loaded from: the forklift stands there to load it, and standing on a button the action presses it`;
con todos los obstáculos ya puestos, `conveyors[i].button at x,z has no free floor beside it to drive onto it from`. Lo
que guarda una caja no empieza en él: `box "…" starts on conveyors[i].button at x,z: no box ever rests on a belt button
(the forklift drives onto it to press it)` y `zone "…" is on conveyors[i].button at x,z: …`; ni la carretilla:
`forklift starts on conveyors[i].button at x,z: it starts beside the button`. Los mensajes de altura y de nivel base
solo pueden venir de un nivel JSON (un `.level` no los escribe).

## Lógica (`src/logic/conveyor.ts`, `GameState`)

- `ConveyorSystem`, una por nivel (`GameState.belts`), un estado por cinta en `snapshot.conveyors`
  (`ConveyorState`: `id`, `phase` = `idle` | `settling` | `running`, `boxId`, `progress` 0–1 de A a B, `running`,
  `direction` 1 | −1 (−1 mientras el botón la hace volver, H2), `travel` = casillas que ha avanzado su superficie, con
  signo: baja mientras corre al revés, y el dibujo mueve las franjas con ella; `presses` / `accepted`, las pulsaciones
  de su botón y las aceptadas: el dibujo hunde la almohadilla o la hace destellar con ellas, sin repetir nada al cargar
  un nivel, y la mantiene iluminada mientras `direction` es −1, H2c).
- **Cargar A** (el hueco de nivel 1, como uno de estantería: `LevelGrid` cuenta los niveles desde el suelo, y debajo del
  nivel base no hay hueco): al llegar a A la horquilla está en el nivel 0 y `hint.storage` dice `{ level: 0, levels: 2,
  slotId: null, ready: false }`; su celda no se abre para la carga (no hay hueco en el 0: `refreshStoragePassage`), así
  que la carga choca con la cara de la mesa, y Espacio no deja nada (`findDrop`: `canStore` en el 0 es falso). F sube al
  1 (`stepForkLevel`, hasta `LevelGrid.topLevel`), la celda se abre con la horquilla ya en el tablero (H1c: `atLevel` de
  `refreshStorageAim` pide `forkHeight` ≥ el nivel base; en una estantería basta con estar a 0,25 del nivel) y el hueco
  vacío, y la carga se deja en cuanto el punto de horquilla está a 0,55 de la cara, como en una estantería (la caja planea
  hasta el centro).
- **La horquilla y la base cerrada** (H1c, docs/STORAGE.md «Nivel base», en el modelo común): las púas vacías son un
  círculo en sus puntas (`TINES` de core/types, el mismo dibujo de builders/forklift; radio 0,188, a 1,028 del centro del
  cuerpo: su frente, en las puntas, a 1,216) que `CollisionWorld` solo enfrenta a las `SolidBase` (una por columna de
  frente con nivel base: la entrada de cada cinta): por debajo de su nivel base, su cara de carga (`face`, encontrada
  desde fuera y solo como un roce, `TINE_CATCH`); por encima, sus barandillas (`walls`, `BASE_GUARD.inset`).
  `GameState.forksOverSolid` dice si las púas (o la carga, con su colisionador) están dentro de esa celda a la altura de
  su tablero o más: entonces `stepForkLevel` no cambia el nivel, `stepForkHeight` nunca baja de su tablero (tampoco al
  completar el nivel) y, con las púas vacías, el rumbo se mantiene (`setHeadingLock`, como con la carga en un hueco).
  Desde H2c, `GameState.tinesInSolid` (`CollisionWorld.inSolidBase`) dice si las púas vacías están dentro de esa celda
  **por debajo** de su tablero (metidas por un lado, en su base): entonces `stepForkLevel` tampoco cambia el nivel y
  `stepForkHeight` nunca sube; el rumbo, libre (por los lados pasan). Y mientras el botón le devuelve una caja, su cara
  para las púas también por encima del tablero (`CollisionWorld.shutBase`, `SolidBase.column`).
- **Dejar en A** (`GameState.dropInStorage`): la caja entra en el hueco de A como en cualquier hueco (`boxDropped`, con
  `skin: 'beltIn'`, `level: 1`, nunca `wrongTarget`) y cuenta su movimiento. Si B está libre, el hueco de A se sella
  (`LevelGrid.seal`: `liftableAt` = −1) y la cinta la carga (`load`); si no, evento `beltBlocked` y la caja se queda (se
  coge con la horquilla en el 1, entrando las púas vacías bajo ella).
- **Cada frame** (`GameState.update`, antes de la pista): `settling` → `running` a los `settleSec` (el sobrante del
  frame pasa al viaje: a 60 y 20 fps la misma curva) con el evento `beltStarted` (`runSec`, `rampSec`: el audio los usa);
  en `running`, la posición de la caja es una función cerrada del tiempo (subida y bajada senoidales, crucero), escrita
  en `box.pos` (sigue en el hueco de A, a su nivel); al llegar al centro de B, `GameState.deliver`: fuera del hueco de A
  (que se abre) y dentro del de B, a su nivel base, `beltDelivered` (`correct`, `wrongTarget` si B tiene pista y no la
  cumple, `satisfiedCount` / `total`) y, si era el último objetivo, `levelComplete`. El viaje no cuenta movimientos. Una
  caja que no queda fija en B (la equivocada; cualquiera en una B «libre») entra en la lista de su botón
  (`ConveyorSystem.keep`).
- B nunca se engancha (`refreshStorageAim` salta los accesos que no `engages`; `refreshStoragePassage` nunca le abre
  paso): su casilla es un estático de `CollisionWorld` (como las de la cinta). El botón, desde H2b, no: es suelo (un
  nivel con botón choca exactamente como sin él).
- **Encima del botón** (H2b, `GameState.standingOnButton`): en un nivel con botón, la carretilla está encima cuando el
  centro de su cuerpo está dentro de la almohadilla (`logic/conveyor` `onButtonPad`: a `BUTTON_PAD.margin` de cada borde
  de su casilla), con cualquier rumbo, vacía o cargada. Mientras tanto `hint.button` = el id de su cinta (el campo solo
  existe en los niveles con botón), sin caja que coger ni destino (`dropCell` / `dropZoneId` null), y **Espacio pulsa**
  (`act` → `pressButton`) en vez de coger o dejar.
- **Ninguna caja en la almohadilla** (H2b): `LevelGrid.padAt` la conoce y `canTakeBox` nunca la da; con el punto de
  horquilla sobre ella, `Interaction.findDrop` no deja nada (Espacio da el `actionIdle` suave, sin vista previa), y entre
  las casillas candidatas de alrededor nunca está.
- **Pulsar** (`GameState.pressButton`): `buttonRefusal` (pura, en `logic/conveyor.ts`) mira en orden la cinta parada
  (`busy`: nada asentándose ni viajando, en ningún sentido), A vacía (`input`), nada de la carretilla en el hueco de A
  (`forks`: la carga con su colisionador o el círculo de las púas dentro de su celda con la horquilla en su nivel base o
  más, `forksInInput`; desde H2c, por debajo del tablero no cuenta) y una caja que devolver (`nothing`). Rechazada:
  `beltButton` con `accepted: false` y su `reason`, y nada se mueve. Aceptada: la última de la lista (`takeLast`, LIFO)
  sale del hueco de B, entra en el de A en el acto, sellado (`LevelGrid.seal`) y cerrado a las púas
  (`CollisionWorld.shutBase`, H2c), el progreso se recuenta (no cambia: no cumplía nada), `ConveyorSystem.reverse` y
  `beltButton` con `accepted: true`, `boxId`, `fromSlotId`. Toda pulsación suma `presses` (y la aceptada, `accepted`). 0
  movimientos.
- **La vuelta**: `settling` durante `pressSec` (la almohadilla se ilumina y se hunde), luego `beltStarted` con
  `reverse: true` y el mismo `runSec` (el audio pone el mismo zumbido) y el mismo viaje en espejo: la caja va de B a A
  por la misma curva cerrada (`progress` de 1 a 0). Al llegar al centro de A, `GameState.returned`: el hueco se abre (es
  una caja más en A, que se coge con la horquilla en el nivel 1; abierto otra vez a las púas) y `beltReturned`
  (`conveyorId`, `boxId`, `slotId`, `skin: 'beltIn'`, `level`). Ni movimiento, ni objetivo, ni `levelComplete`. No
  vuelve a salir sola: la cinta solo arranca al dejar una caja en A.
- Determinista: la llegada difiere menos de un frame entre 60, 20 y 7 fps (`GameState.conveyor.test.ts`, que también
  prueba la cara de la mesa a nivel 0, F y V en A y coger de vuelta a nivel 1, a 60 y 20 fps; desde H1c, también las
  púas vacías contra la cara a nivel 0 y subiendo, F / V quietas con las púas o la carga dentro, el rumbo fijo, la carga
  que espera en la cara mientras sube la horquilla y la horquilla arriba al completar el nivel con las púas dentro;
  `collision.test.ts`, las `SolidBase`; desde H2, `GameState.conveyorButton.test.ts`, el botón y la vuelta a 60 y 20
  fps, y desde H2b también estar dentro o justo fuera de la almohadilla, cualquier rumbo, Espacio que pulsa antes que
  coger o dejar y dejar sobre ella rechazado; desde H2c, pulsar de cara a A desde la almohadilla de al lado (aceptado, las
  púas en su base durante toda la vuelta), con cualquier rumbo nunca «forks», el «forks» de verdad (las púas sobre el
  tablero), las púas paradas en la cara de A mientras vuelve la caja (y dentro después) y F que no las sube metidas en
  la base; `collision.test.ts`, `shutBase` e `inSolidBase`). Nada se reserva por frame.

## Solver, métricas, informe y piloto

- **Modelo** (`levels/solver.ts`): la entrada y la final son posiciones de almacenaje de un hueco (`POS_SHELF`); la
  final no tiene pose que la trabaje (sin `columnAtPose`) y comparte el frente y la dirección de su entrada; `feeds`
  (entrada → final) y `fedBy` (final → entrada) las enlazan; cinta y puntas, sólidas. El modelo no necesita la altura:
  como el hueco de nivel 1 de una estantería, A se carga con un paso adelante desde detrás de su frente; su nivel solo
  nombra el hueco (`levelAt` = 1, `positionOfSlot('e1:0:1')`). Con ese paso, `carrySearch` ofrece A y, a través de ella,
  B. `validDrop`: a B, con A vacía y B con sitio, solo su caja destinada en una cinta sin botón (decisión I) y
  cualquiera en una con botón (decisión AD); en A solo con B llena (la caja se queda). La cota sigue admisible y
  consistente (`levels/conveyor.test.ts`): B es un objetivo de un movimiento, como un hueco. El mínimo del Benchmark no
  cambia (15): ni la mesa ni el botón cambian sus jugadas.
- **El botón en el modelo** (H2, decisión AD; H2b, decisión AN): su casilla es suelo (`pads`: nunca un destino, ni
  una casilla desde la que coger o dejar); `pressFrom` (por posición, en la B de una cinta con botón) = su almohadilla.
  `canLift` de B: la cinta tiene botón, la caja no está fija y A está vacía; `pickupStarts` de B: la almohadilla está en
  la región de la carretilla y, como de A, la pose del frente de A mirando adentro (B comparte frente y dirección con
  A). Así, «levantar de B» es pulsar +
  coger de A en un solo movimiento, sin aristas de coste 0, y lo que siga (dejarla donde se podría dejar una caja de A)
  es el mismo movimiento. Con una salida por cinta vuelve la que hay en B (sin orden de llegada en el estado). Las cotas
  no cambian (una caja equivocada en B cuenta como cualquier caja fuera de su sitio: un movimiento al menos);
  `levels/conveyor.test.ts` comprueba que siguen admisibles y consistentes en **todos** los estados del modelo del nivel
  de prueba del botón (búsqueda exhaustiva), y consistentes en el Benchmark con su botón.
- **Métricas**: `belts = { belts, cells, floor, exits, cued, buttons }`; la métrica publicada **`cinta`** = cintas
  (alias `cintas`); en el informe «cinta 1 (2 casillas de suelo; 1 salida final con pista; 1 botón)» (el botón solo si
  hay) y la columna «cinta» = cintas / casillas. Los **callejones** cuentan con el botón: una caja equivocada en B ya no
  es un callejón si su cinta tiene botón (en el Benchmark, 0 con los 60 estados del informe; probado a mano con 600,
  ninguno ni dudoso). La almohadilla (H2b) es suelo para «estrechas» y «libre» (decisión AO).
- **Informe**: el plan nombra la cinta por sus letras: «caja azul ● (1,3) → cinta A (3,3) → final B (3,0)»; una caja
  que se queda en A, «(aparcar: su final está lleno)»; una que va a B sin ser su caja, «caja azul ● (1,5) → cinta A
  (3,2) → final B (aparcar: vuelve con el botón) (3,0)»; y la que vuelve, «caja azul ● (3,0), final B, botón o (4,2) de
  vuelta a A (3,2) → zona 1 (1,0)». La fila «cinta» añade «su botón devuelve a la entrada la última mal puesta (0
  movimientos)».
- **Piloto** (`integration/autopilot.ts`): una jugada a B se conduce hasta A (`fedBy`); como en toda unidad, se para una
  casilla antes, elige el nivel del hueco con F (`selectLevel(1)`: una pulsación, que cuenta `forkStepsAt.beltIn`) y
  entra; tras dejarla (H1c, en toda unidad con nivel base), sale marcha atrás a la casilla de detrás de su frente, de la
  que venía, y solo allí baja la horquilla con V (otra pulsación: 2 en A); nunca pulsa F / V dentro de A. Mientras la caja
  va de camino, el plan ya la ve en B (`liveStacks`, por `feeds`, solo hacia B: una que vuelve ya está en A), y la
  siguiente jugada en esa cinta (o el final del nivel) espera a que llegue (`waitForBelts`), como haría un jugador.
- **Piloto y botón** (H2, decisión AE; H2b, decisión AP; H2c, decisión AW): una jugada «desde B» es primero
  `pressButton`: sube a la almohadilla recto desde una casilla libre a su lado, por el camino más corto (desde H2c,
  también de cara a A, sin girar encima: las púas en la base de la mesa no ocupan su hueco), comprueba que `hint.button`
  lo nombra, pulsa (0 movimientos; una pulsación rechazada es un fallo del piloto), sale marcha atrás a la casilla de la
  que venía y espera la vuelta (`waitForBelts`); luego la misma jugada sigue «desde A». Coger de A (una caja que
  espera o que volvió): se para en la casilla de detrás de su frente, sube con F allí (las púas fuera) y entra. Ningún
  trayecto en vacío pisa el frente de A mirando a A con la horquilla abajo (`emptyPath` con `closed`: la cara de la mesa
  pararía las púas), salvo el que va a coger de la propia A (que se para antes, en la casilla de detrás).

## Dibujo (`src/render`)

Un adaptador para los dos aspectos (`render/storage/conveyor.ts`: `BELT_IN_RENDER`, `BELT_OUT_RENDER`), con
`builders/conveyor.ts` y `views/ConveyorView.ts`. Todo a la altura de la cinta: la superficie de la mesa está donde
tiene el suelo un hueco de su nivel (`beltTopY(nivel)` = `rackSlotY`, nivel 1: 0,78), donde descansa la caja de un
soporte de baldas, así que la caja va nivelada de la horquilla (en el nivel 1) a la mesa y de A a B.
- **Mesa** (`buildBeltTable`, con la unidad de A): un tablero claro (`Theme.conveyor.top`) de la cara de A a la espalda
  de B sobre su **base cerrada** (H1c): un solo bloque macizo del suelo al tablero, `BELT.base.inset` dentro de sus
  bordes, con los laterales en el negro suave `Theme.conveyor.side`; sin patas, faldón ni travesaños (ocupa sus casillas
  a la vista). Con la horquilla abajo, la carga y las púas chocan con su cara (la de A). Sin rodillos ni nada más.
- **Banda** (`buildBeltBand`): goma gris clara (`belt`) sobre el tablero, de la orilla de A a la de B, entre dos cantos
  finos claros (`edge`) un poco más altos. **Rayas blancas** (`BeltStripes`, `stripe`), cada `BELT.stripe.period`; se
  deslizan con la superficie (`ConveyorState.travel`) y **solo mientras corre**, hacia B o, cuando el botón la hace
  volver, hacia A; recortadas en las dos orillas. Una geometría por cinta que se mueve en su sitio.
- **A** (`buildBeltPad`, `buildBeltIcon`, `buildBeltGuards`): una almohadilla redondeada del **color de identidad** de su
  cinta sobre el tablero, con el **icono de dejar** pintado plano encima (`BELT_ICON`: una flecha gruesa desde la cara de
  carga hacia dentro, a un contorno de caja, en crema `Theme.conveyor.icon`; girado con A, tapado por una caja que
  descanse encima), y sus dos **barandillas cerradas** en el negro de la base (`BELT_GUARD`: 0,12 sobre el tablero, de la
  unión con la cinta al frente de la mesa, su cara de dentro a `BASE_GUARD.inset` del borde de la casilla), abierta por
  su cara de carga. En el suelo de delante, la **línea de carga** de las estanterías (`BELT_IN_RENDER.paintFloor` →
  builders/rack `addLoadingLines`, la de toda unidad de frente). El **marcador del nivel elegido**
  (`buildBeltMarkerGeometry`, `BELT_MARKER`: el marco de `views/SlotMarker`, plano sobre el borde de la almohadilla,
  entre las barandillas) sale con la horquilla en su nivel (`markerAt`: su hueco, a `beltTopY`); en el 0, ninguno. La
  vista previa de dejar, sobre la almohadilla (la de un hueco de baldas).
- **B** (`buildBeltDeck`, `buildBeltCue`, `buildBeltGlowGeometry`, `buildBeltSkirting`): el último tramo del tablero
  (su cubierta, que brilla: el panel de `SlotLight`), con la **pegatina** de su pista (la de las estanterías,
  `buildCueFace`, `BELT_CUE`) **pintada plana**, boca arriba y alineada con el mundo (como el glifo de una zona: se lee
  desde la cámara por defecto y girándola, siempre por encima del rodapié), una banda de luz plana alrededor de donde
  descansa la caja (`BELT_GLOW`) y el **rodapié** (`BELT_SKIRTING`: una tira maciza de 0,06 sobre la cubierta y 0,03 de
  grueso, un décimo de caja: nunca tapa la caja ni la pista) en el color de identidad de su cinta, por la espalda y los
  dos lados, abierto hacia la cinta. Su luz es la de un hueco (`SlotLight`), al momento: la caja ya ha entrado
  deslizándose (`landDelay` 0); latido con las pistas P, destello y efecto de acierto (`burstAt`, a la altura de la
  mesa) como en todo el almacenaje. Una B «libre», cubierta lisa.
- **El botón** (H2b; `buildBeltButtonPad`, `buildBeltButtonIcon`, `BELT_BUTTON`, `BELT_BUTTON_ICON`; lo dibuja la
  unidad de A, en su propia casilla): «un slot en el suelo con un icono de flecha hacia atrás». La almohadilla de A otra
  vez, en el suelo (el mismo cuadrado redondeado, el mismo grosor, la misma goma), en el **color de identidad** de su
  cinta con su propio material (brilla en ese color), y encima, hija suya (se hunde con ella), la **flecha de vuelta**
  en el crema del icono de A, plana y girada con la cinta (su cola hacia B, su punta de vuelta hacia A). Nada se levanta
  del suelo: la carretilla pasa por encima. Alrededor (H2c), el **halo de su luz** en el suelo
  (`buildBeltButtonHaloGeometry`, `BELT_BUTTON_HALO`): anillos de un cuadrado redondeado desde justo debajo del borde de
  la almohadilla hasta 0,7 más allá, con el alfa de sus paradas (1 → 0,8 → 0,38 → 0: difuminado), un objeto propio
  (no hija de la almohadilla: no se hunde), con su propio material de capa del suelo (`createOverlayMaterial`, en el
  tono de `buttonLightTone`: la identidad `haloLift` más clara) y fuera de los límites de la unidad (no mueve el
  encuadre); apagado, oculto. `views/ConveyorView.ts` `BeltButton` sigue `presses` / `accepted` de su `ConveyorState`,
  su sentido (`direction` −1 y no `idle`: vuelve una caja) y `hint.button`: con la carretilla encima **brilla un poco**
  (`BUTTON_FEEL.standGlow`) con un **halo tenue** (`standHalo`), al ritmo `standRate`; la pulsación aceptada la **hunde**
  en el suelo `BELT_BUTTON.dip` (bajada rápida, subida suave: `downSec` / `upSec`) y la **ilumina con fuerza**, la
  almohadilla (`litGlow`) y el halo (`litHalo`): sube en `litRise`, **sigue encendida mientras la cinta va al revés** y
  se apaga en `litFade` cuando la caja llega a A (un paso fijo por segundo, mostrado con curva suave: igual a 60 y a 20
  fps, sin parpadeo); la rechazada solo da un **destello apagado** de las dos (`refusedFlash`, `refusedHalo`,
  `refusedSec`), sin hundirla. Un nivel cargado con pulsaciones ya contadas la muestra en reposo (no repite nada).
- **Colores** (`themes.test.ts`): el de **identidad** (`Theme.conveyor.identity`, por el orden de la cinta en el nivel),
  en la almohadilla de A, el rodapié de B y la almohadilla del botón (se emparejan): verde azulado, ciruela, musgo,
  añil; nunca un tono de caja ni de zona, ni el naranja de las barandillas del muelle, ni el ámbar de la luz de marcha
  atrás, nunca rojo, bien lejos del negro de la base y del tablero claro. El negro de la base y de las barandillas
  (`side`): poco croma, L entre 18 y 35 (≈ 32), mucho más oscuro que la banda. El icono de A y la flecha del botón
  (`icon`): crema, L > 90, ≥ 30 puntos de L sobre cada color de identidad. La banda: gris claro de poco croma (L ≈ 57,5),
  más oscuro que toda cara de caja y a ΔE2000 > 13 de cada una (una caja encima siempre se lee); las rayas, blancas,
  ≈ 39 puntos de L más claras (más de 30); el tablero, neutro.
- Nada de la cinta se vuelve fantasma (una mesa más baja que la carretilla: decisión W) ni mueve el encuadre (su
  `fitBox` es estático). Opcionales en `StorageUnitView`: `landDelay` (cuándo se enciende tras el evento) y `animate`
  (lo que se mueve cada frame).

## Sonido (`src/audio`)

Su fila dice `sound: 'belt'` (`audio.test.ts`):
- Dejar en A → `SfxPlayer.beltDrop`, al aterrizar: un «tup» suave de goma, sin subgrave (A es «libre»: nunca campana).
- Mientras corre → `beltHum` (con `beltStarted`, para todo el viaje): un zumbido eléctrico suave, nunca de combustión,
  que entra y sube de tono con la cinta (`BELT_HUM_HZ` 140 → 196 Hz, con una octava tenue), se mantiene y baja al
  parar, con el susurro de la goma; muy por debajo de la música.
- Llegada a B → `beltLand`, en el momento: un golpe suave, más flojo que dejar; la campana solo con su caja destinada
  (el timbre de su pista); con otra caja, el zumbido suave después.
- B llena (`beltBlocked`) → el zumbido suave tras el «tup». Coger de A → el `pickup` de siempre (desde su nivel, 1).
  Cada paso de F / V en A, el clic de retén de toda unidad (con las púas dentro de A no hay paso, ni clic).
- **El botón** (H2, `beltButton`): aceptado → `buttonClick`, un clic mecánico suave de la almohadilla que cede bajo la
  carretilla (un golpe corto de ruido en banda y un tono pequeño) y, `BUTTON_CLICK.release` después, vuelve (más agudo y
  más flojo); rechazado →
  `buttonRefused`, un clic más sordo y, justo después, el «no» suave de una caja mal puesta, más corto y más flojo
  (`refusedBuzz`): nunca una alarma. La vuelta (`beltStarted` con `reverse`) → el mismo zumbido; al llegar a A
  (`beltReturned`) → el «tup» de goma de dejar, al momento (la caja entra deslizándose).

## Nivel de prueba y Benchmark

- **`src/data/levels/pruebas/cinta.level`** (fuera del juego; `integration/conveyorFixture.test.ts`): 10×6, una cinta
  de dos casillas de A (3,3) a B (3,0) entre dos plantas, una mesa a nivel 1; B pide «azul»; zonas ■ y menta; cajas azul
  ●, azul ■ (encaja en «azul»: trampa) y menta ▲. 3 movimientos (exacto), repartos 1, callejones 0. El piloto lo termina
  a 60 y 20 fps, con una pulsación de F en A (fuera de ella) y, tras salir marcha atrás, una de V (el test mira dónde
  estaban las puntas de las púas en cada pulsación: siempre fuera de A). El test comprueba también el dibujo: la mesa
  sobre su base cerrada negra, la banda y sus rayas, la almohadilla con su icono entre las barandillas negras, la
  cubierta de B con su pista plana y el rodapié del color de la cinta (bajo, abierto hacia la cinta, nunca sobre la
  caja); render/storage/storage.test.ts, la base de un solo bloque, las barandillas solo en los lados de A, el rodapié
  solo en los lados abiertos de B, la línea de carga delante de A y el icono, en dos cintas que corren en direcciones
  distintas. No lleva botón (decisión AH): sigue probando el modelo de H1.
- **`src/data/levels/pruebas/cinta-boton.level`** (H2, fuera del juego; `integration/conveyorButtonFixture.test.ts`):
  6×6, un cambio de dos cajas sin sitio en el suelo (el menta ▲ en la zona azul, al fondo de un pasillo de una casilla;
  el azul ● en la zona menta): aparcar una en el suelo estorba a la otra. La cinta, de A (3,2) a B (3,0) «libre», es el
  aparcamiento y su botón «o» (4,2), una almohadilla junto a A, se sube solo desde (4,3). **3 movimientos con el botón**
  (sin él, 5):
  el azul ● a B por la cinta, el menta ▲ a su zona, el botón (0) y el azul ● de A a su zona; repartos 1, callejones 0
  con **todos** los estados explorados. El piloto lo termina a 60 y 20 fps con una pulsación aceptada, encima de la
  almohadilla; 3 pulsaciones de F / V en A (F para dejar, V tras salir, F para coger de vuelta), todas con las puntas de
  las púas fuera de A. El test mira también el dibujo: la almohadilla del color y el tamaño de la de A, en el suelo, con
  la flecha crema encima (su punta hacia A), sin poste ni seta; que brilla un poco con la carretilla encima, se hunde con
  la aceptada y solo destella con la rechazada, en reposo al cargar; y las rayas que van hacia A mientras vuelve. Desde
  H2c, también el halo (oculto en reposo, plano en el suelo y centrado en la almohadilla, más de 0,6 más allá de su
  borde, difuminado hasta 0, en un tono más claro de la identidad), el halo tenue con la carretilla encima, el destello
  apagado de los dos con la rechazada, y la luz en el tiempo a 60 y 20 fps: con la aceptada, arriba en `litRise` sin
  saltos, fija mientras la cinta va al revés y apagándose suave en `litFade` al llegar la caja; y lo mismo a través de la
  partida del piloto (una vista del nivel sobre su propio juego, frame a frame). Y el piloto que, con el único lado
  libre de la almohadilla enfrente de A, sube de cara a A y pulsa sin girar. `logic/GameState.conveyorButton.test.ts`
  prueba las reglas en el juego (a 60 y 20 fps): la vuelta a A (cogida en el nivel 1, 0 movimientos, «Quedan N» igual),
  los rechazos (nada que devolver, cinta ocupada en los dos sentidos, A ocupada), la caja fija que nunca vuelve, estar
  dentro o justo fuera (solo dentro pulsa), cualquier rumbo, vacía o cargada, Espacio que pulsa antes que coger o dejar,
  y dejar con el punto de horquilla sobre la almohadilla rechazado; desde H2c, de cara a A desde la almohadilla de al lado
  (aceptado, las púas en la base de A durante toda la vuelta), con cualquier rumbo nunca «forks», el «forks» de verdad
  (las púas sobre el tablero de A), nada entra en A mientras vuelve la caja (con una cinta más larga) y F que no sube las
  púas metidas en la base.
- **Benchmark** (`especiales/benchmark.level`, docs/RACKS.md): la cinta va de **A (8,2)** a **B (8,0)** por una casilla
  (8,1), pegada al muro norte junto a la estantería de madera; B pide **coral ✚** (exacto), y el coral ✚ (7,7) es su
  caja: también encaja en la zona coral (trampa). El amarillo ● empieza delante de A (8,3): hay que apartarlo antes de
  usarla. Se quitó la planta de (10,0): la esquina noreste queda libre para maniobrar (con ella, el informe hallaba
  callejones). Al este de B queda suelo (9,0): la carretilla puede ponerse al lado, pero nunca la engancha. Ni la mesa
  (H1b) ni su base cerrada (H1c) pidieron cambiar el mapa: ocupan las mismas casillas. Su **botón**, una almohadilla
  (H2b) en **(7,2)**, justo al lado de A, pegada a su barandilla oeste (H2c, decisión AS; en H2b, en (7,3); en H2, la
  seta en (7,2)): se sube desde (7,3), (6,2) o (7,1), y encima se pulsa con cualquier rumbo, también de cara a A.
  `benchmarkPlayable.test.ts`: con el amarillo ● mandado a B primero (una caja equivocada: el «no»), el piloto se sube a
  la almohadilla (desde (7,3), de cara al norte), pulsa, sale marcha atrás, la recoge de A y termina el nivel en **16**
  movimientos (los 15 y el envío equivocado), a 60 y 20 fps.
- **Medido** (2026-10-01, H2c): las métricas, las de H2b (movimientos 15 exacto, obligadas 13, extra 2, bloqueos 5,
  trampas 13, ambiguas 12, estrechas 8, libre 75 %, repartos 1, callejones 0 (60), huecos 12, camion 4, cinta 1 con
  1 botón; el mismo plan). El piloto vuelve a los números de H1c: **15229** frames a 60 fps y **5560** a 20 (en H2b,
  15449 / 5636), **2348 / 772** frames marcha atrás (en H2b, 2246 / 738), 10 pulsaciones de F / V (7 + 1 + 2) y 0 del
  botón: con la almohadilla en (7,2) vuelve a coger el amarillo ● de (8,3) desde (7,3), de cara al este.
- **Medido** (2026-10-01, H2b): movimientos **15** (exacto; el plan no usa el botón), obligadas 13, extra 2, bloqueos 5
  (el amarillo ● cierra el paso a A), trampas 13, ambiguas 12, estrechas **8** (en H2, 9), libre **75 %** (en H2,
  74 %), repartos 1, callejones 0, huecos 12, camion 4, cinta 1 (1 botón); la búsqueda exacta, 19 ms, y el informe
  entero del nivel, ≈ 3,2 s (igual que en H2). El piloto: **15449** frames a 60 fps y **5636** a 20 (en H2, 15184 /
  5543: ahora coge el amarillo ● de (8,3) desde (8,4) y no desde (7,3), la almohadilla; con ella en (7,2) serían los
  15229 / 5560 de H1c, como sin botón), **10** pulsaciones de F / V (7 en las estanterías, 1 en el camión y 2 en A),
  **2246 / 738** frames marcha atrás (en H2, 2348 / 772), 0 pulsaciones del botón. En H1b eran 14984 / 5474 frames y
  2242 / 736 marcha atrás (H1c añadió, tras dejar en A, la marcha atrás a la casilla de la que venía y la bajada de la
  horquilla con V allí).

## Ajustes (seguros de tocar)

| Qué | Dónde | Valor | Efecto |
|---|---|---|---|
| Altura de la cinta de suelo | `core/conveyors.ts` `FLOOR_BELT_LEVEL` | 1 | el nivel de su mesa (y de sus puntas: su nivel base) |
| Asentarse en A | `logic/conveyor.ts` `CONVEYOR.settleSec` | 0,5 s | lo que espera la caja antes de arrancar (su planeo aterriza antes) |
| Velocidad | `CONVEYOR.speed` | 0,9 casillas/s | crucero de la cinta y de la caja |
| Arranque / parada | `CONVEYOR.rampSec` | 0,6 s | subida y bajada senoidales; un viaje dura largo / speed + rampSec |
| Pulsar el botón | `CONVEYOR.pressSec` | 0,3 s | de la pulsación aceptada a que la cinta arranca al revés (la almohadilla se ilumina y se hunde antes) |
| Encima del botón | `logic/conveyor.ts` `BUTTON_PAD.margin` | 0,15 | cuánto tiene que entrar el centro de la carretilla en la casilla para pulsar (un cuadrado de 0,7) |
| Mesa | `builders/conveyor.ts` `BELT` | `halfW` 0,47, `endGap` 0,03, tablero 0,045 + 0,02, `base.inset` 0,012 | tablero y su base cerrada (el hilo de sombra bajo el tablero) |
| Banda | `BELT.band`, `BELT.edge` | 0,4; cantos 0,03 × 0,025 | la goma y sus cantos |
| Rayas | `BELT.stripe` | cada 0,25, 0,07 de ancho | ritmo visual del movimiento |
| A | `BELT.pad`, `BELT_GUARD`, `BELT_ICON`, `BELT_MARKER` | almohadilla 0,43; barandillas 0,12 de alto; icono; marcador 0,43 | almohadilla, barandillas, icono de dejar, marcador |
| B | `BELT_SKIRTING`, `BELT_CUE`, `BELT_GLOW`, `BELT_BURST` | rodapié 0,06 × 0,03 | rodapié, pegatina, luz, acierto |
| Botón | `builders/conveyor.ts` `BELT_BUTTON`, `BELT_BUTTON_ICON` | almohadilla 0,43 de medio lado, radio 0,08, 0,02 de grueso (la de A); `dip` 0,01; flecha: vuelta de 0,14 de radio y 0,075 de trazo, cola desde −0,2, punta 0,11 × 0,14 | la almohadilla, su flecha, cuánto se hunde |
| Halo del botón | `builders/conveyor.ts` `BELT_BUTTON_HALO` | desde 0,02 bajo el borde de la almohadilla; paradas (más allá del borde → alfa) 0 → 1, 0,2 → 0,8, 0,45 → 0,38, 0,7 → 0; a 0,004 del suelo; 6 tramos por esquina | cuánto se derrama la luz por el suelo y cómo se difumina |
| Respuesta del botón | `views/ConveyorView.ts` `BUTTON_FEEL` | baja `downSec` 0,1 s, sube `upSec` 0,3 s; encendida: `litRise` 0,2 s, `litFade` 0,9 s, `litGlow` 1,3, `litHalo` 0,95, tono `haloLift` +0,12; encima: `standGlow` 0,24, `standHalo` 0,3, `standRate` 10; rechazo: `refusedFlash` +0,1, `refusedHalo` +0,12, `refusedSec` 0,3 s | el hundido; la luz al aceptar (la almohadilla y su halo, su tono, cuánto tarda en encenderse y en apagarse al llegar la caja; mientras vuelve, fija); el brillo y el halo tenue con la carretilla encima (`standGlow` / `standHalo` 0 los quitan); el destello al rechazar |
| Lados cerrados de A | `core/storage.ts` `BASE_GUARD.inset` | 0,06 | la cara de dentro de las barandillas, para el dibujo y para las púas |
| Púas | `core/types.ts` `TINES`; `logic/collision.ts` `TINE_CATCH` | puntas a 0,38 cajas del punto de horquilla, 0,15 ± 0,038; 0,05 | dónde llegan las púas (dibujo y colisión) y cuánto roce las para |
| Colores | `Theme.conveyor` | `belt`, `stripe`, `edge`, `top`, `side`, `icon`, `identity` (4) | banda, rayas, cantos, tablero, base y barandillas, icono de A y flecha del botón, colores de identidad (A, B y el botón) |
| Zumbido | `audio/sfx.ts` `BELT_HUM_HZ`, `BELT_HUM_OCTAVE`, `BELT_HUM_LEVEL`, `BELT_HUM_WHISPER`, `BELT_HUM_LOWPASS_HZ` | 140 → 196 Hz, 0,28, 0,014, 0,6, 760 Hz | tono, octava, volumen, susurro y calidez |
| Golpes | `SfxPlayer.beltDrop` / `beltLand` | — | el «tup» de A (también al volver) y el golpe de B |
| Clic del botón | `audio/sfx.ts` `BUTTON_CLICK` | 1650 Hz (q 2,4), tono 520 Hz, 0,16, sube a 0,11 s; rechazo 900 Hz, «no» a 0,06 s y 0,6 | el clic de la almohadilla y el «no» suave |

Reglas con decisión propia, fáciles de cambiar en un solo sitio: qué caja va por la cinta en el modelo (con botón,
cualquiera; sin él, solo la destinada: `solver.ts` `validDrop`), B llena = la caja se queda en A
(`GameState.dropInStorage`), una caja a la vez (`ConveyorSystem.load` / `LevelGrid.seal`), la fila de B en
`STORAGE_ACCESS` (`engages: false`), la altura de la mesa (`FLOOR_BELT_LEVEL`; las puntas a la de su casilla:
`beltEndLevels`, que validateLevel escribe como su `baseLevel`), qué para a las púas vacías (solo la cara de carga de A
y sus barandillas: `CollisionWorld.fromLevel` `solidBases`, decisión U), la horquilla quieta dentro de A
(`GameState.forksOverSolid`) y sin subir con las púas metidas en su base (`GameState.tinesInSolid`, H2c) y, del botón
(H2), cuándo funciona y en qué orden se rechaza (`buttonRefusal`), qué cuenta como «forks» (el hueco de A sobre su
tablero: `GameState.forksInInput`, H2c), que nada entra en A mientras vuelve una caja (`CollisionWorld.shutBase`, H2c),
qué caja vuelve (la última: `ConveyorSystem.takeLast`), cuándo se está encima (`logic/conveyor.ts` `onButtonPad`, con
`BUTTON_PAD.margin`), que nunca lleva una caja (`LevelGrid.canTakeBox`, `Interaction.findDrop`, el `pads` del solver),
desde qué casillas se sube (`core/conveyors.ts` `buttonEntriesOf`) y cuándo está encendida (mientras su cinta va al
revés: render/storage/conveyor `animate`).
