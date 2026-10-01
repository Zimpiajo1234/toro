# Niveles: formato `.level`, métricas y herramientas

Cada nivel es un archivo de texto `src/data/levels/*.level`: un mapa ASCII que se ve como el almacén, más una
leyenda. El registro (`src/data/levels/index.ts`) carga todos los `*.level` (y, por compatibilidad, los `*.json`
antiguos), los valida al importar y los ordena por su número. Los ids y los números no se pueden repetir.

**Hoy el juego trae los niveles 1–3.** Los niveles 4–24 se retiraron (2026-09-30) para rehacerlos; los sistemas que
usaban (recetas de pila, símbolos, estanterías almacenables) siguen en el juego, en el formato y en las métricas, y sus
tests usan disposiciones escritas en el propio test (entre ellas varias de los niveles retirados, como «La muestra» de
abajo). Un progreso guardado con los 24 niveles carga igual: lo desbloqueado y «Continuar» se quedan dentro de los
niveles que hay y los tiempos de los ids retirados se ignoran (`ProgressStore`; el documento guardado no se reescribe).
Al rehacerlos: usa **ids nuevos** (un id retirado recuperaría los tiempos guardados del nivel antiguo), y ten en cuenta
que ese progreso antiguo guarda «desbloqueado hasta el 24» como índice, así que abrirá los niveles nuevos hasta ese
número.

**Niveles especiales**: `src/data/levels/especiales/*.level`, mismo formato, fuera de la progresión del juego. El glob
de `LEVELS` no entra en subcarpetas, así que nunca llegan a `LEVELS`, a los tiempos guardados, a los desbloqueos ni a
«Continuar». El registro los carga aparte (`SPECIAL_LEVEL_SOURCES`, `SPECIAL_LEVELS`, `getSpecialLevel(id)`), los valida
igual y rechaza un id o un número que choque con un nivel del juego (`loadSpecialSources`), para que las herramientas
puedan nombrar cualquier nivel sin ambigüedad. Hoy solo hay uno: el **Benchmark** (`BENCHMARK_ID = 'benchmark'`, número
100), que se juega desde el Modo prueba y reúne todo el juego de estanterías almacenables (`docs/RACKS.md`) y del
muelle de carga (`docs/DOCKS.md`).

- Parser y renderer: `src/data/asciiLevel.ts` (texto → `validateLevel` → `LevelData`, y `LevelData` → texto canónico).
  Las estanterías almacenables y los camiones van juntos en `LevelData.storage` (docs/STORAGE.md: estanterías primero,
  luego camiones, cada grupo en el orden de la leyenda); un `*.json` lo trae en `storage` o, como antes, en `racks` /
  `trucks`.
- Modelo de rejilla y búsquedas: `src/data/levels/solver.ts` (el mismo para tests, piloto automático y métricas).
- Métricas: `src/data/levels/metrics.ts` · Informe: `src/data/levels/report.ts` · Objetivos: `src/data/difficulty.ts`.

## Un ejemplo: «La muestra» (el antiguo nivel 23)

```
# 23 · La muestra
id: la-muestra
limit: 1
ventanas: norte 2-4, oeste 3-4

  0123456789
0 p.........
1 .1.2.3.4..
2 ..........
3 ..........
4 ....b..a..
5 ..c.......
6 .....d.^.p

1 2 = zona ▲        3 = zona azul ■     4 = zona azul
a = caja azul ▲     b = caja azul ■     c = caja menta ▲    d = caja azul ●
```

Título con número y nombre, cabecera, mapa (con regla de columnas y números de fila) y leyenda. `x` crece hacia la
derecha, `z` hacia abajo; el norte (arriba) y el oeste (izquierda) son los muros con ventanas; la cámara mira desde
abajo a la derecha.

## Estructura del archivo

| Parte | Forma | Notas |
|---|---|---|
| Título | `# 23 · La muestra` | Primera línea. Número = orden de juego (admite decimales, `# 12.5 · …`, para meter un nivel entre dos). Separador `·`, `-`, `:` o espacio. |
| Cabecera | `clave: valor` (los dos puntos son opcionales: `limit 1` vale) | Ver tabla de claves. |
| Mapa | un bloque de filas sin líneas en blanco | El tamaño sale del mapa (3–40 por lado). Regla de columnas y números de fila opcionales (si hay regla, las filas van numeradas y alineadas). Solo ASCII. |
| Leyenda | `c = descripción` | Una o varias entradas por línea, separadas por **dos espacios o más**. `1 2 = zona ▲` define dos caracteres con la misma descripción. |

Claves de la cabecera (sin distinguir mayúsculas ni tildes):

| Clave | Ejemplo | Qué es |
|---|---|---|
| `id` | `id: la-muestra` | **Obligatorio.** Guarda los mejores tiempos: no cambia aunque cambie el nombre. |
| `limit` (`límite`) | `limit: 2` | Altura máxima de pila (1–3). Sin ella: 3 si el nivel apila (zona con pila o pila inicial), si no 1. |
| `ventanas` | `ventanas: norte 2-4, oeste 3` | Casillas del muro (norte: columnas `x`; oeste: filas `z`). En el orden escrito. |
| `rumbo` | `rumbo: 135` | Solo para un rumbo no cardinal, en grados. La flecha del mapa debe ser la dirección más cercana. |
| `tema` | `tema: default` | Tema visual registrado en `src/themes` (por defecto `default`). |
| `dificultad` | `dificultad: extra>=2, bloqueos>=1` | Objetivos medibles que los tests comprueban (ver abajo). |
| `nota` | `nota: la trampa clásica` | Texto libre; se puede repetir. El formateador la conserva (no hay comentarios `//`). |

Caracteres fijos del mapa (no se definen en la leyenda):

| Carácter | Significa |
|---|---|
| `.` | suelo |
| `#` | estantería de 2 alturas |
| `p` | planta (su variante es su posición en orden de lectura, como siempre) |
| `^ > v <` | carretilla: `^` norte (−z, 180°), `>` este (+x, 90°), `v` sur (+z, 0°), `<` oeste (−x, 270°) |

Cualquier otro carácter imprimible (letras, números, signos; nunca `=` ni `:`) se define en la leyenda.

## Leyenda: qué puede ser un carácter

```
descripción = elemento { "+" elemento }     (como mucho una zona y una caja o pila por carácter)
            | almacén                       (una estantería almacenable va sola)
            | camión                        (un camión de muelle va solo)
elemento    = caja | pila | zona | estantería | planta
caja        = "caja" color [símbolo] ["tipo" tipo] [id]
pila        = "pila" color [símbolo] [id] { "," color [símbolo] [id] }      (de abajo arriba)
zona        = "zona" [color] [símbolo] ["pila" color { "," color }] [id]   (al menos color o símbolo)
            | "zona" color "," color { "," color } [id]                   (atajo de «zona pila …»)
estantería  = "estantería" ["de"] [alturas ["alturas"]]                   (sin número: 2)
almacén     = "estantería" "frente" dirección [id] ":" columna { "|" columna }
columna     = hueco { "/" hueco }                                         (de abajo arriba, 1–3 huecos)
hueco       = ("libre" | color [símbolo] | símbolo) [ "+" caja ]
camión      = ("camión" ["muelle"] | "muelle") ("norte" | "oeste") [id] ":" niveles { "|" niveles }   (1 a 3 columnas)
niveles     = nivel { "/" nivel }                                         (de abajo arriba, 1 o 2 niveles)
nivel       = ("libre" | color [símbolo] | símbolo) [ "+" caja ]          («libre», solo encima de las pistas)
planta      = "planta" ["variante"] [número]
id          = "(" texto sin espacios ")"
```

- Colores: `azul menta amarillo coral lavanda` (también `blue mint yellow coral lavender`).
- Símbolos: `● ▲ ■ ◆ ✚` o `círculo triángulo cuadrado rombo cruz` (también `○ △ □ ◇`, y los ids en inglés).
- Sin mayúsculas ni tildes que importen; un símbolo puede ir pegado (`caja azul▲`).
- `caja azul` no nombra símbolo (lleva el de su color, azul ●) y **no** es lo mismo que `caja azul ●`: un nivel usa
  símbolos (como los antiguos niveles 19–24) si alguna caja o zona nombra uno.
- `tipo`: tipo de caja (`standard`, alias `estándar`); solo existe uno hoy.

| Escribes | Resultado |
|---|---|
| `a = caja coral` | una caja coral |
| `a = caja azul ▲` | caja azul con ▲ en la tapa |
| `a = pila azul,menta` | pila inicial: azul abajo, menta encima |
| `1 = zona azul` | acepta cualquier caja azul |
| `1 = zona ▲` | acepta cualquier caja con ▲ (almohadilla neutra) |
| `1 = zona azul ■` | acepta solo la caja azul ■ |
| `1 = zona pila azul,amarillo,lavanda` | zona que pide esa torre, de abajo arriba (su color es el de abajo) |
| `1 = zona azul + caja coral` | zona azul con una caja coral encima al empezar |
| `1 = zona pila coral,lavanda + pila lavanda,coral` | zona que pide coral-lavanda y empieza con la pila al revés |
| `H = estantería 3 alturas` | estantería alta (las altas, solo contra los muros del fondo) |
| `E = estantería` | otra estantería de 2 alturas: sirve para pegarla a una `#` |
| `P = planta variante 2` | planta con otra forma |
| `R = estantería frente sur: azul / ▲ + caja coral / libre` | estantería **almacenable** de 1 columna, se carga desde el sur: hueco de abajo «azul», el del medio «▲» con una caja coral dentro, arriba libre |
| `T = camión muelle oeste: coral ◆ + caja menta ▲ / ■` | **camión** aparcado fuera de una puerta del muro oeste (el carácter marca la casilla de la puerta, en la columna 0), 1 columna: abajo «coral ◆» con una menta ▲ cargada al empezar, encima «■» |
| `T = camión muelle norte: azul \| coral ◆ / libre` | camión de 2 columnas; con `limit: 2` cada columna llega sola a 2 niveles (`min(2, limit)`), así que las dos llevan un «libre» arriba, escrito o no (el formateador no escribe los «libre» de arriba sin caja) |
| `R = estantería frente oeste: azul ● / libre \| menta` | 2 columnas (el carácter en 2 casillas de una columna del mapa), separadas por `\|` |

Estanterías almacenables y camiones son dos aspectos del mismo almacenaje (docs/STORAGE.md: sus reglas comunes, entre
ellas la horquilla con F / V y los niveles «libre»). Cada zona y cada nivel con pista de una unidad es un **objetivo**:
tiene que haber una caja por objetivo y un único reparto completo (cajas idénticas no cuentan dos veces), y cada objetivo
solo se cumple con su caja destinada.

Las **estanterías almacenables** (`docs/RACKS.md`) ocupan una fila recta (frente norte o sur) o una columna recta
(frente este u oeste) de 1 casilla de fondo, con una columna de la leyenda por casilla (de oeste a este, o de norte a
sur). Se cargan solo por el frente; la pista de cada hueco se ve desde las dos caras. Las cajas de los huecos se
numeran después de las del suelo; las estanterías, `r1, r2…`.

Los **camiones** (muelles de carga: `docs/DOCKS.md`, gramática completa allí) esperan
**fuera** del almacén, con la trasera pegada a la cara de fuera del muro, en una puerta del muro norte u oeste. En el
mapa, su carácter marca las **casillas de la puerta**: una tirada recta pegada a su muro (fila 0 en el muelle norte,
columna 0 en el oeste), de 1 a 3 casillas, una columna de la leyenda por casilla (de oeste a este, o de norte a sur),
cada una de 1 o 2 niveles. Esas casillas son **suelo** (la carretilla pasa y aparca ahí) pero empiezan vacías: ni
muebles, ni zonas, ni cajas, ni la carretilla; `ventanas:` no puede pisar la puerta. La columna de la caja del camión
queda justo detrás del muro, fuera del mapa (`z = -1` / `x = -1`). Se carga desde la casilla de la puerta, mirando al
muro, como una pila del suelo, de abajo arriba, con la horquilla por teclas (F / V, como en una estantería: se deja en
el siguiente nivel libre de la columna y se coge la caja de arriba, con la horquilla a su nivel): la carga y la horquilla
cruzan la puerta, la carretilla se para en el muro. Cada nivel con pista (en un cartel sobre la puerta) es un objetivo
más del reparto único. Cada columna llega a `min(2, limit)` niveles: los de encima de sus pistas son **«libre»** (se
pueden escribir `libre` o dejar sin escribir; un «libre» nunca va debajo de un nivel con pista): valen para aparcar
cualquier caja y nunca son objetivo. Las cajas del camión se numeran después de las de las estanterías; los camiones,
`t1, t2…` (nunca el id de una estantería).

**Casillas laterales**: cada puerta lleva sola, a cada lado, una barandilla naranja baja de una casilla (no se escribe
en el mapa). La casilla de al lado de cada extremo de la tirada, a lo largo del muro (en el muelle norte, la de la
izquierda y la de la derecha en la fila 0; en el oeste, la de arriba y la de abajo en la columna 0), queda detrás de la
barandilla y tiene que ser un **obstáculo fijo**: una planta `p` (o una estantería de madera, o una estantería
almacenable que no dé a la puerta). Si la tirada llega a un rincón del almacén, ese lado no tiene casilla lateral. Dos
puertas pegadas no valen: entre ellas va al menos una casilla con un obstáculo. Así al camión solo se llega de frente,
desde la fila (o columna) de detrás de la puerta. Ejemplo: `0 .pTTp...` (la puerta en 2–3, plantas en 1 y 4).

## Reglas que conviene saber

- **Estanterías**: cada grupo conectado de un mismo carácter es una estantería y tiene que ser un rectángulo. Dos
  estanterías pegadas llevan caracteres distintos (`##EE`), si no serían una sola.
- **Ids de cajas y zonas**: si no pones `(id)`, se numeran `b1, b2…` y `z1, z2…` en el orden de la leyenda (dentro
  de una entrada, en el orden de sus caracteres; un carácter usado en varias casillas, en orden de lectura; en una
  pila, de abajo arriba). El juego no depende de esos ids; los tiempos guardados dependen del id del **nivel**.
- **Orden de lectura**: plantas y estanterías se leen fila a fila, de izquierda a derecha.
- El nivel pasa después por `validateLevel` (las reglas de siempre: colores de cajas = huecos de las zonas, un nivel
  con símbolos no apila y tiene un reparto completo, no empieza resuelto, `limit` suficiente para pilas…). Con
  almacenaje (estanterías o camiones, docs/STORAGE.md): sitio delante de cada columna, zonas de una sola caja (apilar
  en el suelo solo aparca, y entonces sí se permite con símbolos), una caja por objetivo y **un solo** reparto
  completo.

## Errores

Todos dicen archivo, línea y columna, en español, y qué hacer (aquí, errores metidos en el ejemplo de arriba):

```
src/data/levels/level-04.level:6:7: «x» no está en la leyenda: defínelo debajo del mapa, p. ej. «x = caja azul»
src/data/levels/level-04.level:12:10: palabra desconocida «azu» en una caja: …; ¿quisiste decir «azul»?
src/data/levels/level-04.level:12:1: sobran cajas menta: hay más que huecos menta en las zonas (…)
```

Salen al arrancar el juego (`npm run dev`), en `npm test` y en `npm run levels`.

## Forma canónica

`renderLevel` escribe cualquier `LevelData` en forma canónica (lo que ves en los archivos): cabecera en orden fijo
(`limit` siempre), regla y números de fila, zonas con `1 2 3 … 9 0 A B…`, cajas con `a b c…` (sin `p` ni `v`), glifos para los
símbolos, entradas iguales seguidas agrupadas (`b c = caja amarillo`) e ids solo si no son los generados.
`parseLevel(renderLevel(nivel))` devuelve exactamente el mismo nivel (test permanente para todos, también los
especiales) y volver a
escribirlo da el mismo texto. `npm run levels:fmt` reescribe los archivos así (conserva `dificultad:` y `nota:`).
Casos raros que el formato normaliza (ninguno se da en los niveles del juego): plantas y estanterías listadas fuera
del orden de lectura, cajas de una misma pila no seguidas en la lista, o una zona con una caja de más adelante en la
lista mientras otra zona anterior tiene una de antes (se conservan ids y casillas; cambia el orden de la lista).

## Métricas

Se miden en el **modelo conservador de carga** (el mismo que usan los tests de solubilidad y el piloto automático):
la carretilla va de centro en centro de casilla mirando a uno de 4 lados, la caja cargada ocupa la casilla de
delante, avanza o retrocede en línea recta (la marcha atrás de S: libre la casilla de detrás) y un giro de 90° con
carga necesita libre la casilla nueva de delante y la diagonal que barre la caja (un cuadrado 2×2 libre). Las pilas
bloquean como cajas, salvo como destino. El juego real es más permisivo (desliza, traza curvas): lo que el modelo
resuelve, un jugador lo resuelve. Con la marcha atrás en el modelo, `movimientos` y `extra` valen también para quien
usa S (un pasillo estrecho no se «salta» dando marcha atrás). `LevelGrid(level, { reverse: false })` da el modelo
antiguo, solo hacia delante, para comparar. Almacenaje (docs/STORAGE.md): cada hueco de estantería es una posición más
y cada columna de camión otra (una pila de sus niveles); se cargan con un paso adelante desde la casilla de detrás de su
frente (o de su puerta) y una caja sacada de ellas sale marcha atrás.

| Nombre (`dificultad:`) | Qué mide |
|---|---|
| `movimientos` | Mínimo de movimientos de caja (coger + dejar) para terminar. Primero se busca un plan rápido (un poco de voraz y luego búsqueda ponderada) y después A* lo demuestra mínimo, con una cota que nunca se pasa (y que un movimiento nunca baja en más de uno: tests en `metrics.test.ts`): cada caja suelta se mueve al menos una vez, dos si solo encaja en su propia pila (tiene que salir y volver); una más si ninguna caja puede colocarse ya o hay una trampa; una más por cada **corro cerrado** (cajas en zonas ajenas sin ninguna zona libre de esos colores, como dos cajas cambiadas; en símbolos, con destinos fijos, cajas cada una en el destino de otra); y las que exige el orden de un **pasillo sin salida** (lo que está más cerca de la boca tiene que salir para llenar el fondo: una caja ya colocada delante de una zona vacía del fondo sale y vuelve, +2). Con estanterías o camiones, las cotas de corros y pasillos no se usan; en su lugar, +1 por cada ciclo de cajas que descansan cada una en el destino de la siguiente (zonas y huecos; `docs/STORAGE.md`). Si agota su presupuesto (`--estados`, 150 000 por defecto) da una cota inferior demostrada «≥ n» y el mejor plan encontrado como cota superior. |
| `obligadas` | Cajas que tienen que moverse al menos una vez: las que no forman parte de la base correcta de su zona (en una pila, la parte de abajo que ya encaja cuenta como colocada). |
| `extra` | `movimientos − obligadas`: aparcar, reordenar una pila, deshacer una trampa. |
| `bloqueos` | Cajas que hay que apartar antes de poder usar otra cosa: **tapan** (están sobre una zona sin encajar en ella, o encima de una caja que tiene que moverse) o **cierran paso** (quitándolas, la carretilla vacía llega junto a una caja o una zona libre a la que antes no llegaba). |
| `estrechas` | Casillas de suelo donde no cabe un giro de 90° con carga: ningún cuadrado 2×2 libre de estanterías, plantas y paredes las contiene. |
| `libre` | % de casillas sin estantería, planta ni caja al empezar. |
| `ambiguas` | Cajas con más de un destino posible (zonas distintas, o pisos distintos de pilas; zonas idénticas cuentan una vez). |
| `trampas` | Niveles con símbolos: colocaciones aceptadas (tipo de caja → tipo de zona) que dejan a otra caja sin zona. |
| `repartos` | Niveles con símbolos: repartos completos distintos (cajas idénticas y zonas idénticas no cuentan como distintos). Con estanterías o camiones: repartos por posición (cajas idénticas no cuentan como distintas); siempre 1. En otros niveles no aplica. |
| `callejones` | Estados a los que la carretilla puede llegar desde los que ya no se puede terminar (ver abajo). Se buscan alrededor de un plan mínimo; «0 (60)» = ninguno en los 60 estados explorados; exacto solo si la búsqueda recorre todos los estados alcanzables. |
| `huecos` | Huecos de estantería almacenable (en el informe: total, con pista y libres). |
| `camion` | Niveles de camión, con pista y «libre» (alias `camiones`; en el informe: con pista y libres, columnas, camiones y cuántos empiezan cargados; `docs/DOCKS.md`). |
| `cajas`, `zonas` | Cuántas hay. |

Coste: `npm run levels` mide los 3 niveles y el Benchmark, todos exactos, en unos segundos (sobre todo la búsqueda de
callejones; el mínimo de movimientos, menos de 1 s por nivel; con los 24 niveles de antes eran ~15 s).

## Mínimos del contador de movimientos

El contador de movimientos del juego (HUD "12 · mín. 10", `README.md`) compara con la métrica `movimientos` de cada
nivel, con el mismo criterio: un movimiento = coger una caja y dejarla en otro sitio (dejarla exactamente donde estaba,
misma casilla y altura o mismo hueco, no cuenta; `GameSnapshot.moves`). El juego **nunca** ejecuta el solver: lee los
mínimos precalculados de `src/data/levelMinimums.json` con `levelMinimum(id)` (`src/data/levels/minimums.ts`). El
archivo vive en `src/data` y no junto a los niveles porque todo `*.json` de `src/data/levels` se carga como un nivel.

- **Generarlo:** `npm run levels -- --minimos` recalcula todos los niveles, los del juego y los especiales
  (`src/data/levels/minimumsBuild.ts`: `minMoves` de `solver.ts` con los controles del juego, marcha atrás incluida) y
  reescribe el archivo (una línea por nivel, en el orden de los niveles; conserva los finales de línea) con un resumen
  de lo que cambió. Un nivel que el modelo no sabe terminar no tiene entrada (y su contador no enseña mínimo).
- **Presupuesto:** `--estados N` usa más trabajo para la búsqueda exacta (150 000 por defecto, como `npm run levels`).
  El archivo guarda el presupuesto con que se calculó (`maxWork`) y las siguientes ejecuciones y el test lo reutilizan.
- **Exacto o cota:** `{ "moves": 10, "exact": true }` = nadie lo hace en menos (en el modelo conservador de arriba; el
  juego real es algo más permisivo, así que terminar en menos es posible y también cuenta como «mínimo»). Si el
  presupuesto se agota, `"exact": false` y `moves` es solo una cota inferior demostrada: el HUD y la tarjeta la
  enseñan como "mín. ≥ 10", u omiten el mínimo si `moves.showLowerBound` es `false` en `gameConfig.json`. Para
  convertirla en exacta, sube `--estados`. Hoy los 3 niveles y el Benchmark son exactos (1, 2, 3 y 14).
- **Comprobarlo:** `npm run levels -- --minimos --check` solo dice si el archivo está al día (código de salida 1 si
  no); `npm test` lo recalcula (`src/data/levels/minimums.test.ts`) y falla con «run `npm run levels -- --minimos`»
  cuando un nivel (o el solver) cambió y el archivo se quedó atrás. No se edita a mano.

## Callejones

Un **callejón** es un estado del que ya no se puede terminar: el jugador tendría que reiniciar (R). Ningún nivel puede
tener uno, y los tests lo comprueban (`levels.test.ts`, «no dead ends»).

- **Cómo se busca** (`solver.deadEnds`): se parte de los estados de un plan mínimo (así se cubre primero cualquier
  despiste en cualquier momento de una buena partida) y se exploran en anchura. De cada estado se prueban **todos** los
  movimientos posibles. Un movimiento que se puede deshacer (volver a llevar la caja a donde estaba, con la carretilla
  en la misma zona del suelo: `carryBackTo`) lleva a un estado tan bueno como el de partida; cualquier otro recibe una
  comprobación completa (voraz y luego la búsqueda exacta, con presupuesto). Resultado: callejones encontrados (demostrados:
  todo lo alcanzable desde ellos se recorrió), estados sin decidir, estados explorados y si la búsqueda llegó a todos.
- **Por qué siempre sale 0**: con la marcha atrás, **todo movimiento se puede deshacer** (se recorren las mismas
  posturas al revés: avanzar ↔ retroceder, girar ↔ girar al otro lado, con la misma diagonal libre; meter en un hueco ↔
  sacar marcha atrás), así que desde cualquier estado alcanzable se puede volver al principio y de ahí terminar. La
  búsqueda lo confirma en cada nivel y avisaría si una regla nueva (una puerta de un solo sentido, una caja que no se
  puede volver a coger) lo rompiera.
- **Sin marcha atrás sí los hay**: con `reverse: false`, el antiguo nivel 14 tiene uno (dos cajas empujadas al rincón
  entre la estantería y la planta solo salen marcha atrás; sigue como disposición en `metrics.test.ts`). No es un callejón para el jugador, que tiene S, pero explica por qué
  el modelo incluye la marcha atrás.
- Los tests exploran todos los estados de un plan mínimo de cada nivel (cada movimiento posible desde cada uno) y
  exigen 0 callejones, 0 sin decidir y que todos esos movimientos se puedan deshacer. `npm run levels` explora 60
  estados por nivel (`--callejones N` para más).

## Objetivos de dificultad

```
dificultad: extra>=2, bloqueos>=1, movimientos<=14, libre>=60
```

Métricas de la tabla, comparaciones `>= <= = > <` (también `≥ ≤`), números (decimales con punto). Los tests
(`levels.test.ts`) miden cada nivel que declara objetivos y fallan si alguno no está **demostrado**: una cota «≥ n»
demuestra `>=`/`>` pero no `<=`, `<` ni `=` (sube `--estados` o simplifica el nivel). Solo buscan movimientos si algún
objetivo habla de `movimientos` o `extra`, y paran en cuanto cada objetivo queda demostrado o descartado. Una métrica
que no aplica (`repartos` sin símbolos, estanterías ni camiones) nunca se cumple (`huecos` y `camion` valen 0 sin
estanterías o sin camiones). `callejones` también se puede pedir
(`callejones=0`), pero en un nivel grande la búsqueda no llega a todos los estados, así que solo demuestra `>=`: el
«ninguno» de todos los niveles lo garantiza el test de arriba.

## Herramientas

```bash
npm run levels                  # todos (los del juego y luego los especiales): mapa, leyenda y métricas de cada
                                #   nivel + tabla resumen, con la cabecera «Toro · 3 niveles + 1 especial»
npm run levels -- 3             # uno en detalle (por número, #posición, id o archivo): texto, métricas,
                                #   objetivos, un plan mínimo movimiento a movimiento y las casillas estrechas
npm run levels -- benchmark     # igual con un nivel especial (su id, su número 100 o su archivo)
npm run levels -- 3 --estados 1000000   # más presupuesto para la búsqueda exacta
npm run levels -- 3 --callejones 2000   # explorar más estados buscando callejones (60 por defecto)
npm run levels:fmt              # reescribe los .level (también los de especiales/) en forma canónica
npm run levels:fmt -- --check   # solo avisa (código de salida 1) de los que no lo están
npm run levels -- --minimos     # recalcula src/data/levelMinimums.json (mínimos del contador de movimientos)
npm run levels -- --minimos --estados 1000000   # igual con más presupuesto (se guarda en el archivo)
npm run levels -- --minimos --check             # solo avisa (código de salida 1) si está desfasado
```

Funcionan en Windows y no molestan al servidor de desarrollo (cargan el código con Vite sin abrir puertos). Si la
consola muestra mal los símbolos, usa Windows Terminal (UTF-8).

## Añadir o editar un nivel

1. Copia un archivo parecido (`level-03.level` → `level-04.level`); cambia número y nombre del título y pon un `id`
   nuevo (en minúsculas con guiones; no lo cambies después: guarda los tiempos).
2. Dibuja el mapa y la leyenda. Para editar un nivel existente, cambia solo el mapa y la leyenda: `id` y número se
   quedan.
3. `npm run levels -- 4`: mira las métricas y el plan; ajusta hasta que midan lo que buscas y fíjalo con
   `dificultad:`.
4. `npm test`: además de validar, comprueba las reglas de diseño (plantas y ventanas, nada escondido tras una
   estantería, solubilidad, sin callejones, el piloto automático lo juega con los controles reales a 60 y 20 fps) y
   los objetivos.
5. Añadir, quitar o reordenar niveles: actualiza la lista `SHIPPED` de `src/data/levels/levels.test.ts` (ids y
   números a propósito: de ellos dependen tiempos guardados y desbloqueos) y los tests de capítulo si cambian.
6. `npm run levels -- --minimos` para que el contador de movimientos conozca su mínimo (si no, `npm test` falla en
   `minimums.test.ts`). Un `id` nuevo necesita su entrada; un mapa cambiado, su mínimo nuevo.
7. Opcional: `npm run levels:fmt` para dejarlo en forma canónica.

Un nivel **especial** (fuera de la progresión) va en `src/data/levels/especiales/` con un id y un número que no use
ningún nivel del juego (el Benchmark usa 100). No hace falta tocar `SHIPPED`: pasa las mismas validaciones, la forma
canónica (`levels.test.ts`) y `npm run levels`; sus reglas de diseño y su piloto automático van en tests propios
(`benchmark.test.ts`, `src/integration/benchmarkPlayable.test.ts`). Para jugarlo hace falta una entrada en la UI (hoy,
el botón «Benchmark» del Modo prueba, `Game.startBenchmark`); nunca pasa por ProgressStore.
