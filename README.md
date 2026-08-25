# Formateador de notas para Banner — port a TypeScript

Migración del núcleo determinista a Next.js + TypeScript sobre arquitectura
hexagonal, que es el stack de la organización.

**Estado:** el port está completo, interfaz incluida. Del archivo del docente al
`.xlsx` de cargue, con su reporte y su guía, **procesándolo todo en el navegador**.

```bash
npm install
npm run dev       # la aplicación en http://localhost:3000
npm test          # suite TypeScript + prueba diferencial contra Python
npm run typecheck
npm run build     # exportación estática a out/
```

> **Lo único que queda abierto es la Fase 1 del plan**, y no es código: nadie ha
> comprobado todavía que Banner acepte un archivo generado por la herramienta.
> Harold lo probará cuando tenga acceso de docente.

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
    celda.ts        ✅ PORTADO — qué se puede decir de una celda (§3.1, §3.2)
    tabla.ts        ✅ PORTADO — de matriz de celdas a tabla con encabezados
    flujo.ts        ✅ PORTADO — análisis fila por fila; código ausente y duplicado
    reporte.ts      ✅ PORTADO — el diff y las reglas de oro sobre datos reales

  aplicacion/       Casos de uso y puertos. Depende del dominio, nada más.
    puertos.ts      ✅ Las interfaces del hexágono
    formatear-notas.ts  ✅ El caso de uso: de bytes a bytes

  adaptadores/
    salida/
      ooxml.ts            ✅ zip + XML: leer una hoja y cambiar una celda
      plantilla-zip.ts    ✅ PORTADO — la plantilla de Banner, sin reabrir el libro
      lectura-xlsx.ts     ✅ PORTADO — lector tolerante de .xlsx y .csv
      configuracion-json.ts ✅ De dónde salen config/*.json
    entrada/
      web/          ✅ Next.js, y TODO el procesamiento ocurre aquí
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

**Y así se construyó.** El adaptador web es un componente cliente y la
aplicación se exporta estática: no hay servidor que reciba notas, así que no hay
sitio donde puedan quedarse. La promesa que la pantalla le hace al docente —
*"ningún dato sale de tu computador"*— es literal, no una intención.

`tests/arquitectura.test.ts` la sostiene: falla si algo en la cadena que llega
al componente cliente importa una API de Node, si el dominio importa un
adaptador, o si la aplicación deja de exportarse estática. Son cosas revisables
a ojo, y por eso mismo se escapan en una revisión apurada.

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
| 5 | ✅ `lectura-xlsx.ts` + `celda.ts` + `tabla.ts` | `lectura.py` | `test_lectura.py` — **hecho** |
| 6 | ✅ `flujo.ts` + `reporte.ts` + el caso de uso | `flujo.py` + `reporte.py` | `test_flujo.py` — **hecho** |
| 7 | ✅ Adaptador web | `app.py` | `tests/arquitectura.test.ts` — **hecho** |

Después de cada paso, el corpus se amplía con los casos de ese módulo y la
prueba diferencial los cubre también. Hoy son **687 casos** en siete pares de
archivos: 199 de redondeo, 335 de interpretación de celdas, 52 de mapeo, 21 del
cruce por identificador, 9 de escritura del `.xlsx`, 20 del lector tolerante y
51 del análisis completo con su reporte.

El de `flujo` compara **el reporte entero, incluida su prosa**. Ahí sí se puede:
sus mensajes no interpolan decimales con el formato del lenguaje —lo que el
docente lee sale de `formatear`, que es el mismo texto que va a quedar en
Banner— así que la igualdad literal es alcanzable y vale la pena tenerla.

### Cuando la divergencia es del lenguaje, no de la decisión

`herramientas/desviaciones.json` lleva la lista de divergencias **aceptadas**,
una por una y con su razón. Existe porque la referencia está congelada: cuando
el port tiene razón no siempre se puede regenerar el dorado, porque a veces lo
que diverge es un artefacto del lenguaje —el `repr` de un booleano en Python— y
no una decisión.

Cualquier divergencia que **no** esté en esa lista rompe el build. Y una
entrada que deje de ocurrir también, para que la lista no se llene de fantasmas.

Hoy tiene **una sola** entrada, y conviene saber de dónde salió.

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
| `openpyxl` (leer) | `ooxml.ts` | ✅ Hecho, sin `exceljs`. En el XML la fórmula y su valor cacheado están en la misma celda, así que la doble lectura de §3.1 sale de una sola pasada |
| `openpyxl` (escribir) | `fflate` + parche XML | ✅ Hecho. Más fiel que reabrir y guardar: cierra `BL-07b` |
| `difflib.SequenceMatcher` | `src/dominio/similitud.ts` | Reimplementado, no sustituido. Ver abajo |
| `csv` + `latin-1` | `TextDecoder` | ✅ Hecho, con `fatal: true` para que el intento falle en vez de rellenar con basura |
| `unittest` | `vitest` | — |

## Lo que no cambia con el port

`plan.md` sigue siendo el documento de referencia, y `casos_prueba_banner.md`
sigue siendo la matriz que decide si esto sirve. **La Fase 1 sigue siendo el
único bloqueo real:** que Banner acepte un archivo generado por la herramienta
es independiente del lenguaje, y si lo rechaza, lo rechaza igual en TypeScript.

---

## Lo que la prueba diferencial ha encontrado

No es un adorno del proceso. Hasta ahora ha cazado dos defectos reales, uno en
cada dirección, y ninguno de los dos se habría visto revisando el código.

**En la referencia — el cero negativo.** `formatear("-0.0")` devolvía `"-0.0"`.
`Decimal` conserva el signo al cuantizar y `en_rango` acepta el valor porque
`-0.0 == 0.0`; Excel produce ceros negativos por su cuenta. Ese `"-0.0"` podía
llegar hasta la columna `Final Grade`. Corregido en las dos implementaciones.

**En el port — el booleano que valía 1.0.** Un `TRUE` en la columna de nota se
guarda en el XML como `<v>1</v>`. El lector devolvía ese crudo, y **el 1.0
pasaba como una nota perfectamente válida, en silencio**. La referencia lo
bloqueaba porque openpyxl lo convierte al bool de Python y `a_decimal` rechaza
los booleanos. Es exactamente la clase de fallo que el proyecto existe para
evitar: el archivo sale impecable y el estudiante queda con un 1.0.
