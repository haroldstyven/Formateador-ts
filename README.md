# Formateador de notas para Banner — port a TypeScript

Migración del núcleo determinista a Next.js + TypeScript sobre arquitectura
hexagonal, que es el stack de la organización.

**Estado:** esqueleto. El motor de redondeo está portado y en verde; el resto
son puertos definidos y stubs con el orden de trabajo.

```bash
npm install
npm test          # suite TypeScript + prueba diferencial contra Python
npm run typecheck
```

---

## Esta es la implementación definitiva

La PoC en Python vive en el repositorio **`Formateador-Banner`** y va a
desaparecer. Decidido el 24 de agosto de 2026: el destino del proyecto es este
repositorio.

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
herramientas/corpus.json         193 casos de entrada
herramientas/salida-python.json  lo que Python devuelve para cada uno — el dorado
tests/oraculo.test.ts            evalúa el corpus con src/dominio y compara
```

Si divergen en un solo valor, el build cae (`.github/workflows/ci.yml`). Es la
red de seguridad de toda la migración: migrar lógica que califica estudiantes
sin ella es volver a apostar desde cero.

**Al ampliar el corpus** —cada módulo portado añade sus casos— se regenera el
dorado desde el repo de la PoC y se copian los dos archivos:

```bash
# en Formateador-Banner
python herramientas/oraculo.py --generar-corpus
python herramientas/oraculo.py > herramientas/salida-python.json
cp herramientas/{corpus,salida-python}.json ../Formateador-ts/herramientas/
```

Siempre en un commit aparte, para que el diff del dorado se pueda revisar. Si
una línea cambia sin que nadie haya ampliado el corpus, algo se rompió: **no se
actualiza el dorado para que pase el test.**

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
    mapeo.ts        ⬜ port de mapeo.py — qué columna es cuál

  aplicacion/       Casos de uso y puertos. Depende del dominio, nada más.
    puertos.ts      ✅ Las interfaces del hexágono
    formatear-notas.ts  ⬜ port de flujo.py + reporte.py

  adaptadores/
    salida/
      lectura-exceljs.ts  ⬜ port de lectura.py
      plantilla-zip.ts    ⬜ port de plantilla.py
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
| 3 | `mapeo.ts` | `mapeo.py` | `test_mapeo.py` |
| 4 | `plantilla-zip.ts` | `plantilla.py` | `test_plantilla.py` |
| 5 | `lectura-exceljs.ts` | `lectura.py` | `test_lectura.py` |
| 6 | `formatear-notas.ts` | `flujo.py` + `reporte.py` | `test_flujo.py` |
| 7 | Adaptador web | `app.py` | — |

Después de cada paso, el corpus se amplía con los casos de ese módulo y la
prueba diferencial los cubre también. Hoy son **534 casos** en dos pares de
archivos: 199 de redondeo y 335 de interpretación de celdas.

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
| `openpyxl` (escribir) | `fflate` + parche XML | Más fiel que reabrir y guardar. Cierra `BL-07b` (ver `plantilla-zip.ts`) |
| `rapidfuzz` | `fastest-levenshtein` | **No da el mismo puntaje.** Hay que recalibrar los umbrales de `mapeo.ts` |
| `csv` + `latin-1` | `TextDecoder` | Probar la misma cascada: utf-8-sig, utf-8, cp1252, latin-1 |
| `unittest` | `vitest` | — |

## Lo que no cambia con el port

`plan.md` sigue siendo el documento de referencia, y `casos_prueba_banner.md`
sigue siendo la matriz que decide si esto sirve. **La Fase 1 sigue siendo el
único bloqueo real:** que Banner acepte un archivo generado por la herramienta
es independiente del lenguaje, y si lo rechaza, lo rechaza igual en TypeScript.
