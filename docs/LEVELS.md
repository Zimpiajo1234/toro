# Niveles: formato `.level`, métricas y herramientas

Cada nivel es un archivo de texto `src/data/levels/*.level`: un mapa ASCII que se ve como el almacén, más una
leyenda. El registro (`src/data/levels/index.ts`) carga todos los `*.level` (y, por compatibilidad, los `*.json`
antiguos), los valida al importar y los ordena por su número. Los ids y los números no se pueden repetir.

- Parser y renderer: `src/data/asciiLevel.ts` (texto → `validateLevel` → `LevelData`, y `LevelData` → texto canónico).
- Modelo de rejilla y búsquedas: `src/data/levels/solver.ts` (el mismo para tests, piloto automático y métricas).
- Métricas: `src/data/levels/metrics.ts` · Informe: `src/data/levels/report.ts` · Objetivos: `src/data/difficulty.ts`.

## Un ejemplo: el nivel 23

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
elemento    = caja | pila | zona | estantería | planta
caja        = "caja" color [símbolo] ["tipo" tipo] [id]
pila        = "pila" color [símbolo] [id] { "," color [símbolo] [id] }      (de abajo arriba)
zona        = "zona" [color] [símbolo] ["pila" color { "," color }] [id]   (al menos color o símbolo)
            | "zona" color "," color { "," color } [id]                   (atajo de «zona pila …»)
estantería  = "estantería" ["de"] [alturas ["alturas"]]                   (sin número: 2)
planta      = "planta" ["variante"] [número]
id          = "(" texto sin espacios ")"
```

- Colores: `azul menta amarillo coral lavanda` (también `blue mint yellow coral lavender`).
- Símbolos: `● ▲ ■ ◆ ✚` o `círculo triángulo cuadrado rombo cruz` (también `○ △ □ ◇`, y los ids en inglés).
- Sin mayúsculas ni tildes que importen; un símbolo puede ir pegado (`caja azul▲`).
- `caja azul` no nombra símbolo (lleva el de su color, azul ●) y **no** es lo mismo que `caja azul ●`: un nivel usa
  símbolos (capítulo 19–24) si alguna caja o zona nombra uno.
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

## Reglas que conviene saber

- **Estanterías**: cada grupo conectado de un mismo carácter es una estantería y tiene que ser un rectángulo. Dos
  estanterías pegadas llevan caracteres distintos (`##EE`), si no serían una sola.
- **Ids de cajas y zonas**: si no pones `(id)`, se numeran `b1, b2…` y `z1, z2…` en el orden de la leyenda (dentro
  de una entrada, en el orden de sus caracteres; un carácter usado en varias casillas, en orden de lectura; en una
  pila, de abajo arriba). El juego no depende de esos ids; los tiempos guardados dependen del id del **nivel**.
- **Orden de lectura**: plantas y estanterías se leen fila a fila, de izquierda a derecha.
- El nivel pasa después por `validateLevel` (las reglas de siempre: colores de cajas = huecos de las zonas, un nivel
  con símbolos no apila y tiene un reparto completo, no empieza resuelto, `limit` suficiente para pilas…).

## Errores

Todos dicen archivo, línea y columna, en español, y qué hacer:

```
src/data/levels/level-23.level:6:7: «x» no está en la leyenda: defínelo debajo del mapa, p. ej. «x = caja azul»
src/data/levels/level-23.level:12:10: palabra desconocida «azu» en una caja: …; ¿quisiste decir «azul»?
src/data/levels/level-23.level:12:1: sobran cajas menta: hay más que huecos menta en las zonas (…)
```

Salen al arrancar el juego (`npm run dev`), en `npm test` y en `npm run levels`.

## Forma canónica

`renderLevel` escribe cualquier `LevelData` en forma canónica (lo que ves en los archivos): cabecera en orden fijo
(`limit` siempre), regla y números de fila, zonas con `1 2 3 … 9 0 A B…`, cajas con `a b c…` (sin `p` ni `v`), glifos para los
símbolos, entradas iguales seguidas agrupadas (`b c = caja amarillo`) e ids solo si no son los generados.
`parseLevel(renderLevel(nivel))` devuelve exactamente el mismo nivel (test permanente para los 24) y volver a
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
antiguo, solo hacia delante, para comparar.

| Nombre (`dificultad:`) | Qué mide |
|---|---|
| `movimientos` | Mínimo de movimientos de caja (coger + dejar) para terminar. Primero se busca un plan rápido (un poco de voraz y luego búsqueda ponderada) y después A* lo demuestra mínimo, con una cota que nunca se pasa (y que un movimiento nunca baja en más de uno: tests en `metrics.test.ts`): cada caja suelta se mueve al menos una vez, dos si solo encaja en su propia pila (tiene que salir y volver); una más si ninguna caja puede colocarse ya o hay una trampa; una más por cada **corro cerrado** (cajas en zonas ajenas sin ninguna zona libre de esos colores, como dos cajas cambiadas; en símbolos, con destinos fijos, cajas cada una en el destino de otra); y las que exige el orden de un **pasillo sin salida** (lo que está más cerca de la boca tiene que salir para llenar el fondo: una caja ya colocada delante de una zona vacía del fondo sale y vuelve, +2). Si agota su presupuesto (`--estados`, 150 000 por defecto) da una cota inferior demostrada «≥ n» y el mejor plan encontrado como cota superior. |
| `obligadas` | Cajas que tienen que moverse al menos una vez: las que no forman parte de la base correcta de su zona (en una pila, la parte de abajo que ya encaja cuenta como colocada). |
| `extra` | `movimientos − obligadas`: aparcar, reordenar una pila, deshacer una trampa. |
| `bloqueos` | Cajas que hay que apartar antes de poder usar otra cosa: **tapan** (están sobre una zona sin encajar en ella, o encima de una caja que tiene que moverse) o **cierran paso** (quitándolas, la carretilla vacía llega junto a una caja o una zona libre a la que antes no llegaba). |
| `estrechas` | Casillas de suelo donde no cabe un giro de 90° con carga: ningún cuadrado 2×2 libre de estanterías, plantas y paredes las contiene. |
| `libre` | % de casillas sin estantería, planta ni caja al empezar. |
| `ambiguas` | Cajas con más de un destino posible (zonas distintas, o pisos distintos de pilas; zonas idénticas cuentan una vez). |
| `trampas` | Niveles con símbolos: colocaciones aceptadas (tipo de caja → tipo de zona) que dejan a otra caja sin zona. |
| `repartos` | Niveles con símbolos: repartos completos distintos (cajas idénticas y zonas idénticas no cuentan como distintos). En otros niveles no aplica. |
| `callejones` | Estados a los que la carretilla puede llegar desde los que ya no se puede terminar (ver abajo). Se buscan alrededor de un plan mínimo; «0 (60)» = ninguno en los 60 estados explorados; exacto solo si la búsqueda recorre todos los estados alcanzables. |
| `cajas`, `zonas` | Cuántas hay. |

Coste: `npm run levels` mide los 24 niveles, todos exactos, en ~15 s (sobre todo la búsqueda de callejones; el
mínimo de movimientos, menos de 1 s por nivel).

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
  posturas al revés: avanzar ↔ retroceder, girar ↔ girar al otro lado, con la misma diagonal libre), así que desde
  cualquier estado alcanzable se puede volver al principio y de ahí terminar. La búsqueda lo confirma en cada nivel y
  avisaría si una regla nueva (una puerta de un solo sentido, una caja que no se puede volver a coger) lo rompiera.
- **Sin marcha atrás sí los hay**: con `reverse: false`, el nivel 14 tiene uno (dos cajas empujadas al rincón entre la
  estantería y la planta solo salen marcha atrás). No es un callejón para el jugador, que tiene S, pero explica por qué
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
que no aplica (`repartos` sin símbolos) nunca se cumple. `callejones` también se puede pedir (`callejones=0`), pero
en un nivel grande la búsqueda no llega a todos los estados, así que solo demuestra `>=`: el «ninguno» de todos los
niveles lo garantiza el test de arriba.

## Curva de dificultad

Objetivos que cada nivel declara (`dificultad:`) y lo que mide hoy (`npm run levels`). Los niveles 1, 2, 3, 13, 14, 16,
19, 20 y 23 no cambian; los demás se rediseñaron (2026-09-29) para que pidan pensar: ninguno pide conducir con
precisión ni hacer viajes largos (cada uno lleva además un tope de `movimientos`, ~2× las obligadas, ~3× en los
finales), y todos tienen id nuevo `…-v2` para que los tiempos de la versión fácil no cuenten.

| Nivel | Objetivos | Medido (mov. · extra · bloq. · estr. · libre) | La idea |
|---|---|---|---|
| 1 Primer encargo | — | 1 · 0 · 0 · 0 · 91 % | Una caja recta delante. |
| 2 Dos colores | — | 2 · 0 · 0 · 0 · 92 % | Dos colores. |
| 3 Rincón tranquilo | — | 3 · 0 · 0 · 0 · 87 % | Tres cajas y la primera estantería. |
| 4 Pequeño desorden | extra≥1, bloqueos≥1, mov.≤6 | 4 · 1 · 3 · 0 · 86 % | Corro de tres: ninguna caja en su zona y ninguna zona libre; se aparca una. |
| 5 Cruce de pasillos | extra≥1, bloqueos≥1, mov.≤8 | 5 · 1 · 4 · 4 · 83 % | Dos cambios que comparten las zonas amarillas: aparcando una sola caja, las cuatro encajan en cadena. |
| 6 Un toque de coral | extra≥2, bloqueos≥2, libre≤80, mov.≤10 | 6 · 2 · 3 · 7 · 80 % | Primer pasillo sin salida: la coral del fondo está detrás de la amarilla ya colocada, que sale y vuelve. |
| 7 Estanterías en fila | extra≥2, bloqueos≥2, libre≤80, mov.≤12 | 8 · 2 · 4 · 2 · 78 % | Dos cajas cambiadas dentro de un pasillo sin salida: salen las dos y entran en orden, primero la del fondo. |
| 8 Una cosa lleva a otra | extra≥2, bloqueos≥2, libre≤80, mov.≤12 | 8 · 2 · 6 · 10 · 78 % | Cadena de seis cajas cuya única zona libre está al fondo de un pasillo, tras la amarilla; la coral suelta es una tentación que cierra el corro. |
| 9 Tarde de lavanda | extra≥3, estrechas≥3, libre≤75, mov.≤16 | 11 · 3 · 8 · 6 · 74 % | Llega la lavanda: cambiada con la azul en un pasillo de tres (salen las dos) y un corro de seis sin hueco. |
| 10 Mudanza a medias | extra≥3, estrechas≥3, libre≤75, mov.≤10 | 7 · 3 · 5 · 9 · 75 % | Media mudanza hecha; el corro de cuatro se cierra con la caja del fondo de un pasillo, tras la lavanda colocada. |
| 11 Pasillos de luz | extra≥4, bloqueos≥3, libre≤70, mov.≤16 | 12 · 4 · 8 · 14 · 70 % | Dos pasillos sin salida: una pareja cambiada y una coral colocada que tapa la zona que abre la cadena de lavandas y amarillas. |
| 12 El gran almacén | extra≥4, bloqueos≥3, libre≤70, mov.≤24 | 13 · 5 · 9 · 13 · 70 % | Pasillo de tres al revés (se vacía entero) y un corro de siete sin hueco. |
| 13 Una encima de otra | — | 1 · 0 · 0 · 0 · 90 % | La primera pila. |
| 14 Primero la base | — | 2 · 0 · 0 · 0 · 88 % | El orden de la pila. |
| 15 Dos pilas | extra≥1, mov.≤8 | 5 · 1 · 2 · 1 · 87 % | Cada zona tiene encima la base de la otra: se aparca una base. |
| 16 Al revés | — | 5 · 2 · 2 · 0 · 87 % | Desmontar una pila hecha al revés. |
| 17 Torre de tres | extra≥3, mov.≤8 | 7 · 3 · 4 · 0 · 92 % | La lavanda ocupa la base de la torre y la azul está debajo de todo en la zona menta: aparcar en el orden en que volverán. |
| 18 El gran apilado | extra≥4, bloqueos≥2, mov.≤21 | 12 · 5 · 6 · 0 · 91 % | Dos torres empezadas mal: una se desmonta entera y otra desde la mitad. |
| 19 Lo que dice la tapa | — | 3 · 0 · 0 · 0 · 90 % | Zonas por símbolo. |
| 20 Color o forma | — | 4 · 0 · 0 · 0 · 89 % | Zonas por color y por símbolo. |
| 21 Dos sitios posibles | trampas≥1, extra≥1, mov.≤8 | 5 · 1 · 2 · 0 · 87 % | Coral ■ y azul ● cambiadas: la zona ■ parece el hueco para la coral, pero es el único sitio del amarillo ■. |
| 22 Justo esa | bloqueos≥1, mov.≤6 | 4 · 0 · 1 · 2 · 86 % | Solo zonas exactas, y la azul ▲ cierra el rincón de la menta ●. |
| 23 La muestra | — | 4 · 0 · 0 · 0 · 91 % | Muestra de la lógica: los tres tipos de zona y la trampa clásica. |
| 24 El gran reparto | extra≥3, trampas≥3, mov.≤21 | 10 · 3 · 3 · 3 · 86 % | Tres cajas con dos sitios y un solo reparto, un cambio en las zonas de color y la cruz al fondo de un pasillo tras la coral ■. |

Cada capítulo sube sin saltos (movimientos extra): clásico, del 3 al 12, 0 → 1 → 1 → 2 → 2 → 2 → 3 → 3 → 4 → 5;
apilar 0 → 0 → 1 → 2 → 3 → 5; símbolos 0 → 0 → 1 → 0 → 0 → 3 (el 22 enseña zonas exactas con un bloqueo y el 23 es la
muestra, sin cambios). Cómo se consigue sin tedio: bloqueos
«sokoban» (una caja tapa una zona o cierra un pasillo, el orden importa), pasillos de una casilla donde no se gira con
carga (la entrada decide cómo sale la caja; la marcha atrás vale y el modelo la tiene en cuenta), corros cerrados que
obligan a aparcar, pilas que hay que desmontar y más ambigüedad de símbolos. Las cajas y zonas iniciales están siempre
a la vista de la cámara (los pasillos sin salida van contra los bordes este o sur) y, en los niveles rediseñados, la
carretilla sale mirando la primera tarea, conduciendo hacia el fondo.

## Herramientas

```bash
npm run levels                  # todos: mapa, leyenda y métricas de cada nivel + tabla resumen
npm run levels -- 23            # uno en detalle (por número, #posición, id o archivo): texto, métricas,
                                #   objetivos, un plan mínimo movimiento a movimiento y las casillas estrechas
npm run levels -- 23 --estados 1000000  # más presupuesto para la búsqueda exacta
npm run levels -- 23 --callejones 2000  # explorar más estados buscando callejones (60 por defecto)
npm run levels:fmt              # reescribe los .level en forma canónica
npm run levels:fmt -- --check   # solo avisa (código de salida 1) de los que no lo están
```

Funcionan en Windows y no molestan al servidor de desarrollo (cargan el código con Vite sin abrir puertos). Si la
consola muestra mal los símbolos, usa Windows Terminal (UTF-8).

## Añadir o editar un nivel

1. Copia un archivo parecido (`level-23.level` → `level-25.level`); cambia número y nombre del título y pon un `id`
   nuevo (en minúsculas con guiones; no lo cambies después: guarda los tiempos).
2. Dibuja el mapa y la leyenda. Para retocar un nivel existente, cambia solo el mapa y la leyenda: `id` y número se
   quedan. Si el puzle cambia de verdad (otro nivel, no un retoque), dale un id nuevo (`…-v2`): los tiempos del
   anterior no valen para el nuevo, y el desbloqueo, que va por posición, se conserva.
3. `npm run levels -- 25`: mira las métricas y el plan; ajusta hasta que midan lo que buscas y fíjalo con
   `dificultad:`.
4. `npm test`: además de validar, comprueba las reglas de diseño (plantas y ventanas, nada escondido tras una
   estantería, solubilidad, sin callejones, el piloto automático lo juega con los controles reales a 60 y 20 fps) y
   los objetivos. Una caja puede cerrar el paso a propósito: lo que queda detrás basta con que se alcance al apartar
   las cajas a las que ya se llega.
5. Añadir, quitar o reordenar niveles: actualiza la lista `SHIPPED` de `src/data/levels/levels.test.ts` (ids y
   números a propósito: de ellos dependen tiempos guardados y desbloqueos) y los tests de capítulo si cambian.
6. Opcional: `npm run levels:fmt` para dejarlo en forma canónica.
