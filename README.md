# Toro

*Un pequeño almacén, a tu ritmo.*

Juego web cozy: una carretilla elevadora low poly ordena cajas pastel en sus zonas de entrega.
Sin derrota, sin presión. Solo un cronómetro y un contador de movimientos, los dos opcionales, y tus mejores marcas.

**Niveles:** hoy el juego trae los niveles 1–3. Los niveles 4–24 se retiraron (2026-09-30) para rehacerlos; los
sistemas que usaban (apilar con recetas, símbolos, estanterías almacenables) siguen en el juego y en sus tests. Un
progreso guardado con los 24 niveles carga sin problema: lo desbloqueado y "Continuar" se quedan dentro de los niveles
que hay y los tiempos de los niveles retirados se ignoran (siguen guardados).

## Arrancar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests de lógica, niveles, storage, helpers
npm run build      # typecheck + build de producción en dist/
npm run levels     # mapas y métricas de dificultad de todos los niveles y del Benchmark (npm run levels -- 3: uno en detalle)
npm run levels -- --minimos   # recalcula los mínimos de movimientos del contador (src/data/levelMinimums.json)
```

`dist/` usa rutas relativas (`base: './'`): funciona servido desde cualquier subruta (itch.io, GitHub Pages).
Para un envoltorio de escritorio, servir `dist/` por http o protocolo propio, no por `file://`.

## Controles

| Tecla | Acción |
|---|---|
| W / ↑ | Avanzar (hacia donde mira la carretilla) |
| S / ↓ | Marcha atrás |
| A / ← · D / → | Girar a la izquierda · a la derecha (también parado; W + A avanza girando) |
| Espacio | Recoger / dejar caja |
| F / V · rueda del ratón | Delante de una estantería almacenable o de un camión: subir / bajar la horquilla un hueco o un nivel (un paso de rueda = uno; fuera de ellos la horquilla es automática) |
| Q / E | Girar cámara (la conducción W/S/A/D no cambia) |
| + / − (teclado principal o numérico) · pellizcar | Acercar / alejar la cámara (mantener = zoom continuo, un toque = un paso pequeño; ver **Zoom** abajo) |
| R | Reiniciar nivel (mantener ~0,5 s si ya moviste una caja) |
| M | Silencio |
| B | Pitido de marcha atrás: sí / no (se guarda) |
| P | Pistas: sí / no (se guarda; apagadas por defecto): mientras llevas una caja se iluminan los destinos que la aceptarían (ver **Pistas** abajo) |
| T | Mostrar / ocultar tiempo |
| N | Mostrar / ocultar movimientos |
| Esc | Volver al inicio ("Continuar" retoma el nivel) |
| Enter | Continuar |
| U (inicio) | Activar / desactivar el **Modo prueba**: todos los niveles abiertos (también el interruptor del pie de la pantalla de inicio) |
| RePág / AvPág · las dos teclas a la derecha de la P ([ / ] en teclado inglés; también con AltGr) | Solo en Modo prueba: nivel anterior / siguiente (al instante; si ya has movido una caja, mantén pulsada la tecla un momento, como R). En teclado español la segunda es la tecla +, que hace zoom: ahí el nivel siguiente es AltGr + esa tecla o AvPág |

**Zoom** (mientras juegas): **+** acerca y **−** aleja la cámara (las teclas que escriben + y − en cualquier
distribución, y las del teclado numérico), igual que pellizcar en el trackpad o en la pantalla táctil. Sube y baja con
suavidad, sin tirones ni rebote. Con
el zoom a 1 se ve el almacén entero, como siempre (nunca se aleja más); acercada (hasta unas 2,5×) la cámara sigue a
la carretilla sin salirse del almacén, y al alejarla del todo vuelve al plano completo. Q / E y el fundido de lo que
tapa la carretilla siguen igual. **La cámara nunca se reencuadra sola**: solo se mueve cuando giras (Q / E), haces
zoom o cambias el tamaño de la ventana (y, acercada, para seguir a la carretilla); ni las paredes que se hunden, ni el
camión, ni la horquilla, ni la pista de controles la mueven. El almacén queda libre del HUD y de la pista tal como
están al empezar el nivel, y al salir del título la cámara se asienta en su sitio con un único giro suave. El zoom se
mantiene al reiniciar el nivel y vuelve a 1 al cambiar
de nivel y en el título (su órbita lenta nunca se acerca). La **rueda del ratón sola no hace zoom**: sigue siendo de
la horquilla (Ctrl + rueda, lo que manda un pellizco en el trackpad, sí acerca y aleja). La pista de controles lo
recuerda con "+ − zoom" al final de su primera fila. Al soltar la tecla (o los dedos) la cámara se para
enseguida, y un toque en sentido contrario parte de lo que se ve. Si la página se quedó ampliada por un pellizco en el
título, el primer pellizco en la partida la devuelve a su tamaño; después ya mueve la cámara. Se ajusta en
`gameConfig.json` → `camera` (`zoomMax`, `zoomEaseSec`, `zoomTrackSec`, `zoomResetSec`, `zoomFollowSec`, `zoomRate`,
`zoomStep`).

**Modo prueba** (ajuste guardado, apagado por defecto): abre todos los niveles desde el título sin tocar el progreso
real; al apagarlo vuelven los candados de siempre. Los tiempos se guardan con normalidad en los niveles ya
desbloqueados; un nivel abierto solo por el Modo prueba no guarda tiempo (guardarlo desbloquearía el siguiente) y
la tarjeta final lo dice: solo "Tiempo" y "Modo prueba · este tiempo no se guarda".

Con el Modo prueba encendido aparece junto al interruptor el botón **Benchmark**: un almacén de prueba fuera de la
progresión que reúne todo el juego de estanterías almacenables y del muelle de carga (ver abajo). El cronómetro corre, pero no guarda nada:
ni récord, ni desbloqueos, ni "Continuar" (el HUD dice "Benchmark", con un discreto "sin récord"). R lo reinicia,
RePág / AvPág no hacen nada en él y al terminarlo la tarjeta vuelve al inicio. Esc lo deja en pausa detrás del título
("Continuar" o el mismo botón lo retoman); apagar el Modo prueba lo descarta.

**Contador de movimientos** (ajuste guardado, visible por defecto; N o un clic en su píldora lo ocultan, como T el
tiempo): arriba a la derecha, junto al tiempo, "12 · mín. 10" = movimientos de caja de este intento · el mínimo del
nivel. Un movimiento es coger una caja y dejarla en otro sitio, el mismo criterio que la métrica `movimientos` del
solver (`docs/LEVELS.md`); cogerla y dejarla exactamente donde estaba (misma casilla y altura, mismo hueco) no cuenta.
Cada movimiento nuevo entra con un pequeño «tic»; al terminar en el mínimo (o menos) la píldora toma un tono suave del
acento con un destello, nunca rojo: más movimientos son solo más movimientos. Reiniciar lo pone a 0; "Continuar" tras
Esc lo conserva. El mínimo viene precalculado (`src/data/levelMinimums.json`, nunca se resuelve nada durante el juego);
si la búsqueda exacta no terminó y solo hay una cota inferior se muestra "mín. ≥ N" (con `moves.showLowerBound: false`
en `gameConfig.json` se oculta). La tarjeta final añade un recuadro "Movimientos" junto al de "Tiempo" (con su
mínimo, o "✦ mínimo" en un tono suave si lo alcanzaste) y debajo, en pequeño, el récord del nivel ("récord 11", como
"mejor 0:38.9" bajo el tiempo), que se guarda como los mejores tiempos (solo baja con estrictamente menos
movimientos). Un récord nuevo se lee "✦ nuevo récord" en su propio recuadro, iluminado: siempre una sola fila, para
que la tarjeta no tape el almacén. El Benchmark y los niveles abiertos solo por el Modo prueba enseñan sus movimientos
pero no guardan récord. Un progreso guardado antes del contador carga igual (sin récords de movimientos todavía).

**Pistas** (ajuste guardado, **apagadas por defecto**; **P** las enciende y las apaga, en el título y en la partida):
una ayuda para quien la quiera. Encendidas, mientras llevas una caja se iluminan los destinos que la aceptarían: las
zonas que la toman, el escalón de la receta que llenaría, los huecos y niveles del camión cuya pista encaja y, si
ninguno libre la toma, muy suave los ocupados que la aceptarían (en cada apartado de abajo). Apagadas, al coger una caja
no se ilumina nada: se deduce. Si las cambias con una caja en la horquilla, la luz entra o se va con suavidad. Lo demás
no cambia: el destello y el brillo suave al dejar una caja en su sitio, el tono más hondo de una caja fija, el zumbido
de una caja equivocada, el tono de la vista previa y el marco del hueco elegido. El pie del título dice "P activar
pistas" (con una bombilla tachada) o "P pistas"; en la partida lo confirma un aviso breve ("Pistas: sí / no"). Un
progreso guardado antes de este ajuste carga con las pistas apagadas.

También se puede jugar con mando, aunque la pantalla solo indica teclado y ratón.

El mapeo de movimiento se ajusta en `gameConfig.json` → `controls`: `keyboardMapping` (teclado y cruceta) `"vehicle"` (por defecto:
W/S avanzar/atrás y A/D girar, relativo a la carretilla e independiente de la cámara), `"grid"` (cada tecla recorre un
eje del suelo) o `"screen"` (dirección de pantalla); `stickMapping` acepta lo mismo (por defecto `"screen"`).
Ajustes del modo vehículo en `forklift`: `reverseSpeed`, `driveTurnRate`, `headingAssistDeg` (0 = sin ayuda de alineación).

## Arquitectura

```
src/
  core/        contratos compartidos (tipos, math, store)
  config/      gameConfig.json — todos los parámetros ajustables
  themes/      paletas (Theme). Nuevo tema = nuevo archivo + entrada en THEMES (themes/index.ts)
  data/        niveles: levels/*.level (texto; levels/especiales/: el Benchmark), asciiLevel.ts (parser), validateLevel.ts,
               solver y métricas
  logic/       simulación pura (sin three / DOM / audio) + tests
  render/      escena three.js, cámara, mallas, feedback
  audio/       música generativa + SFX procedurales (Web Audio, sin assets)
  ui/          overlay React (HUD, título, tarjeta de fin)
  storage/     progreso, mejores tiempos, ranking local, récord de movimientos
  game/        bucle, input, orquestación
```

Detalle de contratos y dirección creativa: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Brief: [docs/BRIEF.md](docs/BRIEF.md). Almacenaje común de estanterías y camiones (en curso): [docs/STORAGE.md](docs/STORAGE.md).

## Apilar

Hoy ningún nivel apila (los niveles 13–18 que lo hacían se retiraron para rehacerlos); el sistema sigue ahí.
Cualquier caja apoyada admite otra encima, hasta `stackLimit` por nivel (máx. `stack.maxHeight` = 3 en
`gameConfig.json`; con `limit: 1`, lo normal, no se apila). Sin teclas nuevas: Espacio coge la caja de arriba de la pila de enfrente y deja encima de la
pila de destino si cabe. Una zona con `recipe` (colores de abajo arriba) se cumple cuando su pila coincide
exactamente; la receta se dibuja en la zona como una mini pila de escalones de color. Reglas completas: [docs/STACKING.md](docs/STACKING.md).

## Clasificar por color y símbolo

Hoy solo el Benchmark lo usa (los niveles 19–24 se retiraron para rehacerlos); el sistema sigue ahí.

Cada caja lleva un color y un símbolo (● ▲ ■ ◆ ✚) en la tapa. Cada zona pide un color (almohadilla de ese color),
un símbolo (grabado grande sobre una almohadilla neutra) o los dos (esa caja exacta). Cuenta cualquier zona que
acepte la caja; si otra se queda sin sitio, mueve la primera. Con las **pistas** encendidas (P; apagadas por defecto),
mientras llevas una caja respiran las zonas libres que la aceptan y, si no queda ninguna, respiran muy suave las
ocupadas que la aceptarían. Sin teclas nuevas. Encajar por color suena a campana, por símbolo a madera y la exacta a
las dos. Reglas completas: [docs/SORTING.md](docs/SORTING.md).

## Estanterías almacenables (Benchmark, Modo prueba)

El nuevo sistema de apilado, de momento solo en el nivel **Benchmark** (los niveles 1–3 no lo usan). Una estantería
almacenable es un mueble de metal pizarra con vigas crema (las de madera con cajas kraft siguen siendo solo obstáculos):
columnas de 1 a 3 **huecos** de alto que se cargan y descargan **solo por el frente**, donde hay una línea pintada en el
suelo. El panel del fondo de cada hueco muestra su **pista**, visible desde las dos caras (y, en las columnas de los
extremos, en la placa casi transparente de cada lado, que deja ver las cajas; así se lee desde cualquier ángulo): una pegatina del color exacto de la caja, un
símbolo en negrita sobre una pegatina neutra, los dos (esa caja exacta) o nada («libre»: guarda cualquier caja y nunca
cuenta). Las pistas nunca se atenúan: ni sombras ni el fundido de la estantería cuando tapa la carretilla. Las pistas se combinan para que haya **un
solo** reparto posible, así que se resuelve deduciendo; un hueco (o una zona) solo brilla con **su** caja: al dejarla,
el brillo destella, se asienta suave y la caja toma un tono más hondo de su color y queda **fija** (ya no se coge ni
admite nada encima). Otra caja, aunque encaje en la pista, suena con un zumbido suave y se puede volver a coger; nunca
hay rojo (los huecos «libres» y el suelo no dicen nada). Con las **pistas** encendidas (P; apagadas por defecto),
mientras llevas una caja brillan con claridad los huecos y zonas cuya pista encaja; apagadas, solo te guían las pistas
de los huecos. Todo esto, solo en los niveles con estanterías; los demás funcionan como siempre.

Delante de una columna, **F / V** (o la rueda) suben y bajan la horquilla un hueco, con un clic
suave; un marco tenue señala el hueco elegido y la vista previa se pone del tono de la caja si su pista encaja. Con la
horquilla a su altura, Espacio mete la caja (entra recta; se sale marcha atrás) o saca la del hueco. Los huecos se
llenan en cualquier orden. Si una estantería te da la espalda, rodéala para cargarla (Q / E ayudan a leerla). La pista
de controles de abajo está siempre a la vista mientras juegas, en todos los niveles; en los niveles con estanterías o
camiones añade la fila "F V subir / bajar horquilla · rueda". Reglas y contratos: [docs/RACKS.md](docs/RACKS.md).

## Muelles de carga (Benchmark, Modo prueba)

Un **muelle** es una puerta en el muro norte u oeste con un pequeño camión aparcado **fuera**, marcha atrás, con la
trasera pegada al muro: nada del camión entra en el almacén. Delante de la puerta quedan sus **casillas de puerta** (de
1 a 3, una por columna del camión), suelo normal. Para cargar una columna, ponte en su casilla de puerta mirando al
muro: la carretilla se para en el muro y la horquilla y la caja cruzan la puerta hasta la plataforma (entra recta; se
sale marcha atrás). Se carga **como una pila del suelo**: las cajas van de abajo arriba, hasta 2 de alto, sin techo ni
barras sobre la plataforma. La horquilla, en cambio, va **por teclas**, como en una estantería: **F / V** (o la rueda)
eligen el nivel, con el mismo clic suave y un marco tenue en su casilla del cartel. Se deja solo en el siguiente nivel
libre de la columna y se saca solo la caja de arriba, con la horquilla a su altura; si va baja, la caja choca con la de
la plataforma (F la sube por encima). Los niveles de abajo llevan su pista (color, símbolo o las dos) en el **cartel
enmarcado sobre la puerta**: una casilla por columna (justo encima de su casilla de puerta) y por nivel (abajo, el de
la plataforma), con la pegatina de las estanterías por las dos caras, que nunca se atenúa ni sale en espejo. Encima de
las pistas, hasta 2 de alto (según el límite del nivel), los niveles son **libres** (casilla lisa en el cartel): sirven
para aparcar cualquier caja, también encima de una fija, y no cuentan en el reparto. Los niveles con pista cuentan en
el reparto único, igual que zonas y huecos: un nivel brilla y su caja queda fija solo con **su** caja y con todo lo de
debajo bien; aun así se puede cargar el siguiente nivel encima. Cualquier otra caja (también una que encaje en la
pista) suena con el zumbido suave y se puede volver a sacar marcha atrás. Con las **pistas** encendidas (P; apagadas
por defecto), mientras llevas una caja late el siguiente nivel de cada columna cuya pista encaja. Sin teclas nuevas.
A cada lado de la puerta, una **barandilla naranja** baja, de una casilla, con una planta detrás: al camión se llega de
frente, desde la fila de detrás de la puerta, y hay que entrar bastante recto (muy torcida, la caja puede quedarse
atascada en la puerta: marcha atrás y otra vez, alineada).
Hoy solo el Benchmark lleva un camión (los niveles 1–3 no cambian). Reglas y contratos: [docs/DOCKS.md](docs/DOCKS.md).

## Sonidos de la carretilla

Todo procedural (Web Audio, sin archivos) y bajo la música (el pitido de marcha atrás, a su altura); M lo silencia todo:

- **Motor eléctrico**: un zumbido suave que sube de tono con la velocidad y un rodar de ruedas sobre las baldosas;
  parada, en silencio.
- **Horquilla**: al subir, la bomba hidráulica (algo más aguda por nivel); al bajar, un tono más grave y un soplo leve;
  al llegar, un «clonc» pequeño (nunca encima de coger o dejar una caja). Delante de una estantería o de un camión, cada
  paso de F / V lleva además su clic.
- **Marcha atrás**: un «tin… tin… tin» dulce y breve, como una campanita (un tono puro con un leve brillo de octava
  que se apaga solo en unos 0,3 s), uno por pulso y en la tonalidad de la música (620–880 Hz), mientras la carretilla
  retrocede de verdad. Suena a la altura de la música y se distingue por su timbre, nunca más fuerte que coger o dejar
  una caja. **B** lo quita o lo vuelve a poner (se guarda; en la partida lo confirma un aviso breve). Con él se enciende
  en el techo una lucecita ámbar que gira al compás, con un brillo cálido en el suelo detrás, y se apaga suave al
  parar; se ve también con el pitido quitado o el sonido en silencio.
- **Camión**: dejar una caja en la plataforma suena a madera hueca, distinto del «toc» metálico de las estanterías.

Todos los valores están en tablas con nombre al principio de `src/audio/motor.ts`, `src/audio/beeper.ts` y
`src/audio/sfx.ts`, listos para ajustar a oído.

## Ampliar

- **Nuevo nivel:** añadir `src/data/levels/level-XX.level`, un archivo de texto con el mapa dibujado y una leyenda
  (formato completo, métricas y pasos en [docs/LEVELS.md](docs/LEVELS.md)):

  ```
  # 25 · Mi nivel
  id: mi-nivel
  limit: 1
  ventanas: norte 2-4

    0123456
  0 p......
  1 .1..2..
  2 .......
  3 .a..b..
  4 ...^..p

  1 = zona azul      2 = zona menta ▲
  a = caja azul      b = caja menta ▲
  ```

  `.` suelo, `#` estantería, `p` planta, `^ > v <` carretilla; el resto se explica en la leyenda: `caja`, `pila azul,menta`
  (de abajo arriba), `zona azul` / `zona ▲` / `zona azul ■` / `zona pila azul,menta`, combinaciones como
  `zona azul + caja coral`, `estantería 3 alturas`, las estanterías almacenables (`estantería frente sur: …`,
  [docs/RACKS.md](docs/RACKS.md)) y los camiones (`camión muelle norte: …`, [docs/DOCKS.md](docs/DOCKS.md)). El `id`
  guarda los mejores tiempos: no lo cambies. Se valida al
  cargar y en `npm test`; `npm run levels -- 25` enseña sus métricas (movimientos mínimos, extra, bloqueos…) y un plan,
  y `dificultad: extra>=2` fija objetivos que los tests comprueban. Añadir o quitar niveles: actualiza la lista
  `SHIPPED` de `src/data/levels/levels.test.ts`. Después de añadir o cambiar un nivel, `npm run levels -- --minimos`
  recalcula el mínimo que enseña el contador de movimientos (`npm test` avisa si se te olvida). Los `.json` antiguos (esquema `LevelData`) siguen cargando.
  Los niveles especiales (fuera de la progresión, como el Benchmark) viven en `src/data/levels/especiales/`
  (`SPECIAL_LEVELS`, [docs/LEVELS.md](docs/LEVELS.md)).
- **Nuevo tema visual:** crear `src/themes/<id>.ts` que exporte un `Theme`, añadirlo al mapa `THEMES` de `themes/index.ts` y poner `"theme": "<id>"` en el nivel. El tema cubre la escena 3D, el fondo y los tokens de la UI; un id sin registrar hace fallar `src/integration/themes.test.ts`.
- **Nuevo tipo de caja:** añadir el id a `BOX_KINDS` (`core/types.ts`) y su constructor de malla en el registro de cajas de `render/`.
- **Ranking local:** `ProgressStore.getRanking(levelId)` ya guarda el top‑5 por nivel.
