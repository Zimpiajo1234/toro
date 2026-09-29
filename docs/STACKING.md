# Mecánica: apilar cajas

Decisiones (2026-09-28): altura máx. 3 (`stackLimit` por nivel, niveles 13–14 = 2) · apilar en cualquier celda · recetas mixtas.

## Reglas
1. Cualquier caja apoyada es apilable hasta `stackLimit` (por defecto `stack.maxHeight` = 3 si el nivel apila —receta > 1 o pila inicial—, si no 1: los niveles clásicos no apilan). Sin teclas nuevas: Espacio.
2. Recoger: coge siempre la caja superior de la pila frente a la horquilla.
3. Dejar: si la celda destino tiene pila con hueco → encima; si no → suelo. Imán de zona sigue; preferir zona cuya receta acepta la caja en su siguiente posición.
4. Zona con `recipe: ColorId[]` (abajo→arriba; `color` = `recipe[0]`). Satisfecha si la pila coincide exactamente. Sin receta = `[color]` (comportamiento actual).
5. Pila incorrecta: zona neutra, sin mensaje negativo.
6. Victoria: todas las zonas satisfechas.
7. Las pilas nunca caen (sin física de caída).

## Feedback
- Receta dibujada en la zona: mini pila de escalones de color con separadores crema sobre un zócalo crema, en dos esquinas opuestas de la zona (abajo→arriba). El escalón que llenaría la caja cargada respira con la zona. Nunca texto.
- Preview de drop muestra altura (contorno sobre la pila). La horquilla sube antes de llegar a una pila (predicción por movimiento, giro y acelerador) y nunca baja mientras la carga está encima.
- Subida algo más lenta con la altura (nivel 1 en 0,39 s, nivel 2 en 0,94 s); servo un 12 % más agudo por nivel. Toc de madera más agudo al posar sobre caja; toda la pila se hunde un poco a la vez (sin separarse).
- Pila completa: brillo abajo→arriba + arpegio de N notas (sin notas que choquen con el acorde); el arpegio de nivel completado espera a que termine.
- Posar encima de una zona cumplida: la zona se libera (brillo y tic) cuando la caja aterriza. Quitar la caja errónea de encima y dejar la zona cumplida otra vez: su campanita (`zoneRestored`), sin fanfarria.
- Oclusión: una caja apilada (nivel > 0) se vuelve fantasma (0,55) si tapa la cabina, la tapa de otra caja o una zona; las bases nunca; todo vuelve a sólido al completar el nivel.

## Niveles 13–18
13 pila de 2, base ya cerca · 14 pila de 2 con la de arriba más cerca (orden) · 15 dos pilas de 2 con las bases cambiadas (aparcar una base) · 16 desmontar pila mal hecha · 17 torre de 3 con la lavanda en su base y la azul enterrada bajo amarilla y menta en la zona menta (aparcar en el orden en que volverán) · 18 final: dos torres de 3 empezadas mal (una se desmonta entera, otra desde la mitad) y dos zonas sueltas. Movimientos extra: 0, 0, 1, 2, 3, 5 (docs/LEVELS.md, «Curva de dificultad»). Todos empiezan conduciendo en sentido contrario a la cámara.

## Técnica
- `LevelData.stackLimit?`, `LevelZone.recipe?`; `validateLevel`: recetas válidas, longitud ≤ límite, colores de cajas = suma de recetas, cajas iniciales pueden apilarse (mismas `x, z`, de abajo arriba en orden de lista; sin campo de altura).
- Logic: celda → pila (array); `BoxState.level` 0‥2; pick/drop sobre la cima; eventos con `level`; `zoneRestored` tras `boxPicked`. Colisión: pila = 1 celda (solo la base); el cuerpo siempre choca; una pila llena bloquea la carga. Una pila con hueco deja pasar la carga cuando `forkHeight ≥ altura − 0,25` y sigue pasable mientras la carga esté encima (nunca se vuelve sólida debajo); antes la bloquea como una caja.
- Horquilla: objetivo = máx(`dropLevel`, altura de paso) al cargar; ritmo `forkRiseRate` = `forkRiseSpeed / (1 + 0,25·nivel)` (`logic/forkRise.ts`, `forkRiseSpeed` 3,2). Todo condicionado a `stackLimit > 1`.
- Render: y = level·size; alturas de horquilla discretas; receta en zona; preview con altura; fantasmas por oclusión.
- Audio: variantes de drop por altura; arpegio al completar pila; `setMotor(…, forkHeight)`.
- Tests: solver de levels.test y autopiloto de integración con estado de pila por celda.
