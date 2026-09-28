# Brief original (cliente)

Videojuego web cozy: el jugador controla una pequeña carretilla elevadora (toro) en almacenes pequeños y ordenados. Mueve cajas de colores a sus zonas de entrega. Sin derrota, sin fracaso, sin presión. Único elemento competitivo: cronómetro opcional (tiempo empleado + mejor tiempo personal).

Sensación: relajante, reconfortante, satisfactoria, ordenada, minimalista, zen.
Inspiraciones: Unpacking, Mini Metro (claridad visual), Dorfromantik, A Little To The Left, Cozy Grove, Tiny Glade.

## Plataforma
Web desktop. Three.js + React + TypeScript + Vite. Sin dependencias pesadas. Carga rápida. >60 FPS.

## Dirección artística
Ultra low poly. Elementos simples, volúmenes limpios, pocas texturas, pastel suave. Nada de ruido visual, carteles, textos dentro del mundo, partículas excesivas ni efectos exagerados.
- Base neutra: beige, crema, gris claro, madera clara.
- Funcionales: azul suave, verde menta, amarillo cálido, coral suave.
- Evitar: rojos intensos, negros profundos, neón, contrastes agresivos.

## Cámara
Isométrica fija, inclinación 35°–45°, rotación suave opcional. Visión clara del almacén siempre. Sin movimientos bruscos ni zoom agresivo.

## Escenario
Extremadamente limpio: suelo de almacén, estanterías simples, zonas de entrega marcadas, algunas plantas, ventanas con luz suave. El jugador identifica al instante: caja, destino, carretilla.

## Personaje
Carretilla low poly simpática. Animaciones suaves, ruedas girando, horquillas elevables. Controles WASD / flechas. Acción: recoger / depositar caja. Opcional: elevar horquilla visualmente.

## Mecánica
Buscar caja → recogerla → transportarla → depositarla en su zona. Extremadamente intuitivo. Sin tutoriales largos. Aprendizaje mediante diseño.

## Niveles
1. Una caja, un destino, distancia corta (~30 s).
2. Dos cajas, dos zonas, colores distintos.
3. Tres cajas, posiciones separadas.
4. Algunas cajas colocadas incorrectamente: reorganizar.
5. Cruce de recorridos, planificación ligera.
6+. Gradualmente: más cajas, más colores, más rutas, más espacio.
Nunca: enemigos, castigos, pérdidas, presión.

## Cronómetro
Visible, minimalista, discreto en una esquina. Al terminar: tiempo empleado + mejor tiempo personal. Nunca fallos, penalizaciones ni mensajes negativos. Lenguaje positivo: "Buen trabajo", "Almacén organizado", "Perfectamente colocado".

## Sonido (muy importante)
Música lo-fi suave: piano relajante, guitarra ambiental, pads cálidos, volumen bajo, loop imperceptible.
SFX: recoger = madera ligera; depositar = suave satisfactorio; movimiento = motor eléctrico muy tenue. Nada estridente ni repetitivo.

## Feedback visual
Suave. Al colocar: pequeño brillo, escala ligera, animación agradable. Caja correcta: resplandor tenue, confirmación elegante. Nunca explosiones, flashazos, pantallazos ni efectos arcade.

## UX
Como ordenar una habitación. "Solo quiero ordenar una caja más." Sin ansiedad, urgencia ni sobrecarga cognitiva.

## Interfaz
Minimalista. Solo: tiempo, nivel actual, botón reiniciar. Sin minimapa, HUD complejo, inventarios, árboles de habilidades ni economía.

## Arquitectura
Código limpio, componentes desacoplados, niveles ampliables, configuración JSON. Separar render, lógica, audio, UI y datos de niveles. Preparado para: más almacenes, más tipos de cajas, nuevos temas visuales, ranking local de tiempos.

## Prioridades
1. Claridad visual. 2. Sensación relajante. 3. Satisfacción al ordenar. 4. Ausencia total de estrés. 5. Diseño limpio y elegante.
Resultado: debe parecer un indie premium vendible en Steam.
