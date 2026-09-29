# Mecánica: dos criterios de clasificación (color + símbolo)

Decisiones (2026-09-29): segundo atributo = **símbolo** (los glifos que ya existen: `circle`, `triangle`, `square`,
`diamond`, `cross`) · ambigüedad permitida desde el nivel 21 · **sin** combinar con pilas en este capítulo
(niveles 19–24 con `stackLimit` 1; recetas de pila siguen siendo solo de color).

## Reglas
1. Cada caja tiene **color** y **símbolo**. En el nivel el símbolo es opcional (`caja azul` frente a `caja azul ▲`,
   docs/LEVELS.md): si falta, se deriva del color con el mapa
   canónico actual (azul ● · menta ▲ · amarillo ■ · coral ◆ · lavanda ✚), así los niveles 1–18 no cambian.
2. Cada zona **acepta** según los criterios que declara (al menos uno):
   - solo `color` → «cualquier caja de ese color» (lo de siempre);
   - solo `symbol` → «cualquier caja con ese símbolo», del color que sea;
   - `color` + `symbol` → «esa caja exacta».
3. Zona satisfecha = tiene una caja que cumple **todos** sus criterios. Victoria = todas las zonas satisfechas.
4. Una caja puede encajar en varias zonas (ambigüedad). Colocarla en cualquiera que la acepte cuenta. Si luego otra
   caja se queda sin hueco, basta con moverla: nunca hay error ni mensaje negativo.
5. Todo nivel tiene al menos un reparto completo caja → zona (emparejamiento perfecto), comprobado al validar.

## Lectura visual (sin texto)
- **Fondo de la zona** = criterio de color: con color → almohadilla de ese color; sin color → almohadilla neutra
  (crema claro con cinta gris cálido, `theme.neutralZone`).
- **Símbolo grabado grande** en el centro = criterio de símbolo (0,6 de lado frente a 0,38 del glifo clásico): un
  hueco real en la almohadilla, paredes en el tono del borde y fondo en `engrave` (tono más hondo del mismo color, o
  topo en la neutra). Sin criterio de símbolo → sin grabado (ni siquiera el glifo de color).
- En los niveles clásicos (ningún símbolo explícito), las zonas siguen mostrando el glifo tono sobre tono de siempre
  (equivale a su color, ayuda para daltónicos). Geometría idéntica a la de antes (test).
- Las cajas muestran su símbolo (`BoxState.symbol`, nunca derivado del color en el render) más grande (0,6 de la
  tapa frente a 0,4) y en tinta más honda del color (`BoxPalette.ink`) cuando el nivel usa símbolos. Sobre una zona
  que la acepta, la caja gira hasta alinear su símbolo, como antes.
- Mientras llevas una caja, **respiran** las zonas libres que la aceptan (y el contorno de suelta toma el tono de
  la caja cuando caería en una de ellas); si no queda ninguna libre, respiran muy suave (≈ ⅓) las ocupadas que la
  aceptarían (pista de «intercambia»), nunca en rojo. La pista solo existe en niveles con símbolos: los clásicos se
  ven exactamente como antes.
- Una caja apoyada sobre una zona tapa su grabado (el fondo de color sigue asomando alrededor): por eso ningún nivel
  empieza con una caja sobre una zona de símbolo que no la acepte.

## Imán y feedback
- Imán al soltar: entre las zonas cercanas que la tomarían ahora (`takesNext`: vacía y la acepta, o pila cuya receta
  pide su color), gana la **más específica** (color + símbolo > un criterio), luego la más cercana. La exacta nunca
  estorba: solo acepta esa clase de caja, así que siempre queda un reparto completo.
- Sonido: encajar por color = campana de siempre; por símbolo = marimba de madera suave (fundamental + parcial
  afinado a dos octavas, un poco bajo; golpe de mazo de fieltro filtrado; paso bajo 2,6 kHz); exacto = ambos
  superpuestos, más suaves. Equilibrado offline: los tres picos quedan a ±0,2 dB de la campana clásica. La
  campanita de progreso sigue subiendo con cada zona cumplida (misma nota, `chimeNote`). La audio no lee el nivel:
  Game le pasa el tipo de encaje de la zona junto al evento (`handleEvent(event, match)`).

## Niveles 19–24
| Nivel | Nombre | Enseña |
|---|---|---|
| 19 | Lo que dice la tapa | Solo zonas por símbolo (neutras ● ▲ ■); dos cajas azules van a sitios distintos: el color ya no manda |
| 20 | Color o forma | Zonas por color (menta, amarillo) y por símbolo (●, ◆); cada caja encaja en una sola |
| 21 | Dos sitios posibles | Coral ■ encaja en «cualquier coral» y en «cualquier ■»; si toma el ■, el amarillo ■ se queda sin hueco |
| 22 | Justo esa | Cuatro zonas exactas (azul ●, menta ▲, azul ▲, menta ●): cada caja comparte color con una y símbolo con otra |
| 23 | La muestra | **Nivel de muestra**: los tres tipos a la vez con la trampa clásica (ver abajo) |
| 24 | El gran reparto | Final: ocho cajas, los tres tipos, tres cajas ambiguas (azul ▲, amarillo ◆, lavanda ▲) y un único reparto completo |

Todos: `stackLimit` 1, arranque mirando la primera caja (a ≤ 4 casillas), recorrido hacia el fondo (lejos de la
cámara, que está hacia +x,+z: A/D no se invierten en pantalla) con todas las zonas más al fondo que la salida, pasillos
de ≥ 2 casillas donde se gira con carga, nada tapado por estanterías.

### Nivel 23 (muestra de la lógica)
- Zonas (fila del fondo, z = 1): «cualquier ▲» (1,1) y (3,1) neutras, «azul ■ exacto» (5,1), «cualquier azul» (7,1).
- Cajas: azul ▲ (7,4), azul ■ (4,4), menta ▲ (2,5), azul ● (5,6). La carretilla sale en (7,6) mirando al fondo.
- Único reparto completo: azul ■ → exacta · azul ● → «cualquier azul» · azul ▲ y menta ▲ → las dos «▲».
- Trampa amable, a la vista: la carretilla empieza frente al azul ▲ y «cualquier azul» está recto detrás de él (basta
  con mantener W). Si lo dejas ahí, suena y brilla como cualquier acierto; al llevar el azul ● no respira ninguna zona
  libre y solo «cualquier azul» respira muy suave → lo mueves al ▲ libre y listo. (Dejar el azul ■ en «cualquier azul»
  es la misma trampa, con la misma salida.)

## Técnica
- `core/types`: `SYMBOL_IDS` / `SymbolId` (= los glifos) + `DEFAULT_SYMBOL` (color → símbolo); `LevelBox.symbol?`;
  `LevelZone.color?` y `LevelZone.symbol?` (al menos uno); `ZoneCriteria { color?, symbol? }`; `BoxState.symbol`;
  `ZoneState.accepts`. `ZoneState.color` pasa a `ColorId | null` (color de la almohadilla = criterio de color, null =
  neutra; solo para pintar). `ZoneState.recipe` pasa a `(ColorId | null)[]`: la caja de abajo responde a `accepts`
  (su entrada es solo el criterio de color, null si no pide color), las de encima a la receta de color. `next` sigue
  siendo el color que la pila pide (null en una zona vacía sin color): para preguntar «¿tomaría esta caja?» está
  `takesNext`. `Theme`: `neutralZone`, `ZonePalette.engrave`, `BoxPalette.ink`; `theme.glyphs` queda como el mapa
  canónico (`DEFAULT_SYMBOL`, comprobado en test).
- `core/sorting.ts`: `accepts(zone, box)` único punto de verdad (logic, render, dev preview y solvers), más `meets`,
  `fitsLevel`, `takesNext`, `specificity`, `matchKind`, `usesSymbols` (un nivel usa símbolos si alguna caja o zona
  nombra uno) y `assignBoxes` (emparejamiento por caminos aumentantes).
- `validateLevel`: criterios válidos (símbolo desconocido, zona sin criterio → error), `symbol` + `recipe` de más de
  1 → error; en niveles con símbolos: sin pilas (`stackLimit` 1, sin recetas ni pilas iniciales), nº cajas = nº zonas,
  existe un reparto completo (si no, nombra la caja que se queda sin zona); los niveles sin símbolos mantienen la regla
  del multiconjunto de colores; ninguno empieza resuelto (con la aceptación general).
- Lógica: `refreshZone` usa `fitsLevel` (abajo `accepts`, encima receta); imán por especificidad; eventos con la misma
  forma que antes (`boxDropped.correct` = la zona aceptó la caja).
- Tests: `core/sorting` y validador (matriz de aceptación, caminos aumentantes, errores), lógica (satisfacción, imán
  por especificidad, ambigüedad, la trampa del 23 de principio a fin), render (almohadillas, grabado, tapas, respiración,
  pista de intercambio, contorno), audio (timbres), Game (tipo de encaje), solver de rejilla y autopiloto con cajas
  color × símbolo, aceptación por criterios y un paso más de coste cuando el resto ya no tiene reparto completo (así
  evitan trampas sin prohibirlas); el autopiloto también cae a propósito en la trampa del 23 y sale de ella a 60 y 20 fps.
