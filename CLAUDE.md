# Contexto para trabajar en este repositorio

Formateador de notas para Banner. Toma el archivo de notas del docente, en el
formato que tenga, y produce el archivo que Banner acepta. Si algo falta o no se
puede decidir sin una persona, se detiene y lo dice.

Este repositorio es la **implementación definitiva**. La PoC en Python vive en
`github.com/haroldstyven/Formateador` y está **congelada**: se consulta, no
recibe commits ni despliegues.

## Stack

Next.js, TypeScript, arquitectura hexagonal, GitHub. Es el stack corporativo de
la organización y no está en discusión. Copilot Studio y Power Platform quedaron
descartados como plataforma de la lógica; ver `copilot_studio.md` en el repo de
referencia.

## Las cinco reglas que no se negocian

Vienen de `plan.md` (en el repo de referencia), que sigue siendo el documento de
diseño de los dos repositorios.

1. **El redondeo solo ocurre en `src/dominio/redondeo.ts`.** Nada más en el
   proyecto puede llamar a `toFixed()`, `Math.round()` ni operar notas con
   `number`. La política es un decimal, `ROUND_HALF_UP`, escala 0.0–5.0,
   aprobación en 3.0. `Number(v).toFixed(1)` falla en 20 de 50 casos de
   frontera; acierta `2.95` por casualidad, así que probar a mano el ejemplo del
   plan no detecta el fallo.
2. **Una celda vacía nunca vale 0.0.** Ni una fórmula sin calcular, ni un `NP`,
   ni un valor fuera de rango. Todos bloquean la generación hasta que el docente
   decida. Un formateador que rellena con cero no produce un bug: reprueba a un
   estudiante.
3. **La definitiva se lee, jamás se calcula.** Aunque estén las columnas
   componentes. No conocemos las ponderaciones.
4. **La columna de nota siempre la confirma una persona**, aunque el mapeo esté
   seguro. Hay cuatro columnas numéricas en escala 0.0–5.0 y elegir mal no
   produce ningún síntoma.
5. **Todo cambio es visible.** Cada nota redondeada, sustituida o corregida de
   formato aparece en el diff que ve el docente — incluida una coma cambiada por
   punto, que no altera el valor.

## La regla de dependencia del hexágono

Las flechas apuntan hacia adentro. `src/dominio` no importa nada de
`src/aplicacion` ni de `src/adaptadores`; `src/aplicacion` solo importa sus
propias interfaces (`puertos.ts`), nunca un adaptador concreto.

El dominio no hace I/O. Por eso las clases de configuración tienen
`desdeObjeto` y no `desdeJson`: leer un archivo es trabajo del adaptador.

Esto se cobra de inmediato: el mismo caso de uso corre en el navegador, en un
route handler y en una CLI. Correrlo en el navegador conserva la promesa de que
los datos del docente no salen de su computador.

## La prueba diferencial

`herramientas/oraculo.py` genera los archivos dorados ejecutando la
implementación de referencia desde un clon local; `tests/oraculo.test.ts` los
compara. La suite **no** necesita Python: los JSON están versionados.

Al ampliar el corpus, siempre en un commit aparte. Y ante una divergencia:

> **La pregunta es cuál de las dos tiene razón, no cuál es el oráculo.** Si la
> tiene el port, se regenera el dorado y el commit explica por qué el valor
> nuevo es correcto. Un dorado que cambia sin esa explicación es un test
> desactivado en silencio.

Ya encontró un defecto real de la PoC: `formatear("-0.0")` devolvía `"-0.0"`,
que podía llegar hasta la columna `Final Grade`.

## Convenciones

- **Todo en español**: nombres de módulos, funciones, tipos, tests y comentarios.
- Los commits van a nombre de Harold, **sin trailers de co-autoría**.
- Todo cambio de lógica va con sus tests, de lógica y de casos de uso.
- `npm test` y `npm run typecheck` en verde antes de commitear.

## Lo que sigue

El orden del port y su estado están en `README.md`. **La Fase 1 del plan sigue
siendo el único bloqueo real**: nadie ha comprobado que Banner acepte un archivo
generado por la herramienta, y eso es independiente del lenguaje.
