# Formateador de notas para Banner — port a TypeScript

Migración del núcleo determinista a Next.js + TypeScript sobre arquitectura
hexagonal, que es el stack de la organización.

**Estado:** todo el dominio puro está portado y en verde — redondeo, valores,
mapeo y el cruce contra la plantilla. Lo que falta son los adaptadores: leer el
Excel del docente, escribir el `.xlsx` de cargue y la interfaz.

```bash
npm install
npm test          # suite TypeScript + prueba diferencial contra Python
npm run typecheck
```

---

## Esta es la implementación definitiva

La PoC en Python vive en **https://github.com/haroldstyven/Formateador** y está
**congelada**: se consulta como referencia, no recibe más commits ni despliegues.
Decidido el 24 de agosto de 2026 — el destino del proyecto es este repositorio.

Ahí siguen, mientras dure el port, los documentos que no se duplican aquí:

| Archivo | Qué es |
|---|---|
| `plan.md` | El plan completo: alcance, principios, fases y riesgos. **Sigue siendo la referencia** |
| `casos_prueba_banner.md` | La matriz de casos del entorno de test de Banner |
| `branding.md` | El design system institucional |
| `copilot_studio.md` | Qué parte cabe en un agente y qué parte no |
| `formateador/` | La implementación Python — el oráculo |
| `Templates_oficiales/` | Plantillas exportadas de Banner |
| `config/*.json` | Alias de columnas, valores no numéricos, esquema de Banner |

### El oráculo, sin depender del otro repo

El port no se considera correcto porque pase sus propios tests, sino porque
produce **exactamente lo mismo** que la implementación Python, valor por valor.
Pero este repositorio **no necesita Python para verificarlo**: lo que se
versiona aquí son dos archivos JSON.

```
herramientas/corpus-<modulo>.json         las entradas
herramientas/salida-python-<modulo>.json  lo que Python devuelve — el dorado
tests/oraculo.test.ts                     evalúa el corpus con src/dominio y compara
```

Un par por módulo portado: `redondeo` (sin sufijo, por ser el primero),
`valores`, `mapeo` y `plantilla`.

Si divergen en un solo valor, el build cae (`.github/workflows/ci.yml`). Es la
red de seguridad de toda la migración: migrar lógica que califica estudiantes
sin ella es volver a apostar desde cero.

**Al ampliar el corpus** —cada módulo portado añade sus casos— se regenera el
dorado desde aquí. `herramientas/oraculo.py` es una herramienta de desarrollo
de este repositorio: importa la implementación de referencia desde un clon
local y escribe los JSON en su sitio.

```bash
git clone https://github.com/haroldstyven/Formateador ../Formateador-Banner
python herramientas/oraculo.py --modulo valores --generar-corpus
python herramientas/oraculo.py --modulo valores > herramientas/salida-python-valores.json
```

Otra ruta al clon, con `FORMATEADOR_REFERENCIA`. Nada de esto corre en CI ni en
la suite: los JSON ya están versionados.

Siempre en un commit aparte, para que el diff del dorado se pueda revisar.

### Cuando las dos implementaciones difieran

La referencia está **congelada**: se consulta, no se modifica. Así que ya no se
le puede aplicar una corrección, y la regla es:

1. **Decidir cuál tiene razón.** El oráculo es la referencia, no la autoridad.
2. Si tiene razón el port, se regenera el dorado y **el commit explica por qué
   el valor nuevo es el correcto**. Un dorado que cambia sin esa explicación es
   un test desactivado en silencio.
3. Si tiene razón la referencia, se corrige el port.

Lo que no se hace nunca es actualizar el dorado para que el test pase.

### Cuándo desaparece el Python

Cuando se cumplan las dos condiciones, en un solo commit del otro repo:

1. Los siete pasos del orden del port están en verde, con sus tests portados.
2. El piloto (§6 del plan) generó un archivo con esta implementación y **Banner
   lo aceptó**.

Mantener dos implementaciones vivas más allá de eso es un costo permanente. Y
borrarlo antes no gana nada: git conserva el historial igual, y el oráculo es
gratis mientras esté ahí.

---

## El hexágono

```
src/
  dominio/          Interior. Cero I/O, cero dependencias de framework.
    redondeo.ts     ✅ PORTADO — motor de redondeo, único sitio que redondea
    modelo.ts       ✅ Tipos del dominio
    valores.ts      ✅ PORTADO — interpretar una celda; regla de oro 3
    mapeo.ts        ✅ PORTADO — qué columna es cuál; restricción §4.0
    similitud.ts    ✅ PORTADO — difflib.SequenceMatcher, exacto
    plantilla.ts    ✅ PORTADO — esquema de Banner y el cruce por Student ID
    analisis.ts     ✅ PORTADO — predicados derivados sobre el análisis

  aplicacion/       Casos de uso y puertos. Depende del dominio, nada más.
    puertos.ts      ✅ Las interfaces del hexágono
    formatear-notas.ts  ⬜ port de flujo.py + reporte.py

  adaptadores/
    salida/
      ooxml.ts            ✅ zip + XML: leer una hoja y cambiar una celda
      plantilla-zip.ts    ✅ PORTADO — la plantilla de Banner, sin reabrir el libro
      lectura-exceljs.ts  ⬜ port de lectura.py
    entrada/
      (web)         ⬜ Next.js App Router
      (cli)         ⬜ port de formatear.py
```

La regla de dependencia: **las flechas apuntan hacia adentro.** `dominio` no
importa nada de `aplicacion` ni de `adaptadores`; `aplicacion` no importa
adaptadores concretos, solo sus propias interfaces. El typecheck lo verifica de
hecho, porque los stubs no compilan si se rompe.

### Lo que esto compra, y no es teórico

El mismo caso de uso corre en tres sitios sin cambiar una línea del dominio:

| Adaptador de entrada | Dónde corre | Consecuencia |
|---|---|---|
| Componente cliente | Navegador del docente | **Ningún dato sale del computador** — la promesa de la versión Streamlit sobrevive |
| Route handler | Servidor Next.js | Si algún día hace falta procesar del lado servidor |
| CLI | Terminal | Reproduce `formatear.py` para depurar un archivo rechazado |

`exceljs` y `decimal.js` funcionan en el navegador. Empezar por el adaptador
cliente conserva la respuesta a la pregunta abierta #2 del plan.

---

## Orden del port

Por dependencia y riesgo, igual que las fases del plan.

| # | Qué | De dónde | Tests a portar |
|---|---|---|---|
| 1 | ✅ `redondeo.ts` | `redondeo.py` | `test_redondeo.py` — **hecho** |
| 2 | ✅ `valores.ts` | `valores.py` | `test_valores.py` — **hecho** |
| 3 | ✅ `mapeo.ts` + `similitud.ts` | `mapeo.py` | `test_mapeo.py` — **hecho** |
| 4a | ✅ `plantilla.ts` + `analisis.ts` | `plantilla.py` (parte pura) | `test_plantilla.py` — cruce **hecho** |
| 4b | ✅ `plantilla-zip.ts` + `ooxml.ts` | `plantilla.py` (I/O) | `test_plantilla.py` — I/O **hecho** |
| 5 | `lectura-exceljs.ts` | `lectura.py` | `test_lectura.py` |
| 6 | `formatear-notas.ts` | `flujo.py` + `reporte.py` | `test_flujo.py` |
| 7 | Adaptador web | `app.py` | — |

Después de cada paso, el corpus se amplía con los casos de ese módulo y la
prueba diferencial los cubre también. Hoy son **616 casos** en cinco pares de
archivos: 199 de redondeo, 335 de interpretación de celdas, 52 de mapeo, 21 del
cruce por identificador y 9 de lectura y escritura del `.xlsx`.

> **`BL-07b` deja de estar pendiente.** `plan.md` §2.2 anotó que guardar con
> `openpyxl` no reproduce el archivo byte a byte —se pierde la cadena vacía de
> `Hours Attended`, las cadenas compartidas se reescriben en línea— y dejó la
> solución escrita sin implementarla: parchear el XML dentro del zip. En
> TypeScript sale más barata que evitarla, así que `ooxml.ts` la implementa. De
> las once partes del paquete **solo cambian dos**, la hoja y la tabla de
> cadenas, y hay un test que lo comprueba parte por parte.
>
> Por eso el diferencial de `plantilla-io` **no compara bytes**: el objetivo
> declarado es producir bytes distintos de los de `openpyxl`. Compara el
> contenido —la plantilla leída y las celdas del archivo generado—, y de que la
> diferencia sea una mejora se encarga la suite del adaptador.
>
> Lo que esto **no** resuelve: `BL-05` y `BL-07` siguen abiertos. Ser más fiel
> que la referencia no es lo mismo que estar verificado contra Banner.

> **La coincidencia difusa se reimplementó, no se sustituyó.** `plan.md` §4.2
> menciona `rapidfuzz`, pero la implementación de referencia nunca lo usó: usa
> `difflib.SequenceMatcher`. Es una suerte, porque `difflib` es un algoritmo
> fijo —Ratcliff-Obershelp— y no una heurística con parámetros, así que
> `similitud.ts` lo reproduce exactamente y **los umbrales 0.90 / 0.78 / 0.08
> siguen significando lo mismo**. No hubo recalibración. El diferencial de
> mapeo compara los puntajes como doubles con igualdad exacta, sin tolerancia:
> un algoritmo "casi igual" solo se notaría justo en la frontera, que es donde
> se decide si una columna se elige sola o se pregunta.

> **La prueba diferencial ya se ganó su costo.** Al portar `valores.ts`
> encontró que `formatear("-0.0")` devolvía `"-0.0"` en Python y `"0.0"` en
> TypeScript. El defecto era de la PoC: `Decimal` conserva el signo al
> cuantizar, `enRango` acepta el valor porque `-0.0 == 0.0`, y Excel produce
> ceros negativos por su cuenta — así que un `"-0.0"` podía llegar hasta la
> columna `Final Grade`. Corregido en las dos implementaciones, con test.
>
> Es el caso que justifica la regla: **cuando las dos difieren, la pregunta es
> cuál tiene razón, no cuál es el oráculo.**

## Equivalencias de dependencias

| Python | TypeScript | Cuidado |
|---|---|---|
| `decimal.Decimal` | `decimal.js` | `Number.toFixed()` falla en 20 de 50 casos de frontera. Prohibido |
| `openpyxl` (leer) | `exceljs` | Fórmulas llegan como `{ formula, result }` — la doble lectura de §3.1 se conserva |
| `openpyxl` (escribir) | `fflate` + parche XML | ✅ Hecho. Más fiel que reabrir y guardar: cierra `BL-07b` |
| `difflib.SequenceMatcher` | `src/dominio/similitud.ts` | Reimplementado, no sustituido. Ver abajo |
| `csv` + `latin-1` | `TextDecoder` | Probar la misma cascada: utf-8-sig, utf-8, cp1252, latin-1 |
| `unittest` | `vitest` | — |

## Lo que no cambia con el port

`plan.md` sigue siendo el documento de referencia, y `casos_prueba_banner.md`
sigue siendo la matriz que decide si esto sirve. **La Fase 1 sigue siendo el
único bloqueo real:** que Banner acepte un archivo generado por la herramienta
es independiente del lenguaje, y si lo rechaza, lo rechaza igual en TypeScript.
