/**
 * Suite del caso de uso: el hexágono completo, de bytes a bytes.
 *
 * Es el único test que recorre todo el camino con los adaptadores reales —
 * lector, plantilla y configuración— y por tanto el que comprueba que las
 * piezas encajan y no solo que cada una funciona por separado.
 *
 * Lo que más importa aquí no es que genere el archivo, sino **cuándo se niega
 * a generarlo**. Un cargue incompleto parece correcto.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ArchivoEntrante } from "@aplicacion/puertos.ts";
import {
  type Dependencias,
  EntradaIncompleta,
  clasificar,
  formatearNotas,
} from "@aplicacion/formatear-notas.ts";
import { ConfigValores } from "@dominio/valores.ts";
import { LectorXlsx } from "@adaptadores/salida/lectura-xlsx.ts";
import { PlantillaZip } from "@adaptadores/salida/plantilla-zip.ts";
import { ConfiguracionJson } from "@adaptadores/salida/configuracion-json.ts";
import { abrir, leerHoja, valor } from "@adaptadores/salida/ooxml.ts";
import { CatalogoAlias } from "@dominio/mapeo.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

function json(ruta: string): unknown {
  return JSON.parse(readFileSync(`${RAIZ}${ruta}`, "utf-8"));
}

const config = new ConfiguracionJson({
  alias: json("config/alias_columnas.json"),
  valores: json("config/valores_no_numericos.json"),
  esquema: json("config/schema_banner.json"),
});

const catalogo = CatalogoAlias.desdeObjeto(json("config/alias_columnas.json"));

const deps: Dependencias = {
  lector: new LectorXlsx(catalogo),
  plantillas: new PlantillaZip(),
  config,
};

function archivo(ruta: string, nombre: string): ArchivoEntrante {
  return { nombre, bytes: new Uint8Array(readFileSync(`${RAIZ}${ruta}`)) };
}

const PLANTILLA = archivo(
  "tests/fixtures/Template_Anonimo.xlsx",
  "Template_Anonimo.xlsx",
);

/**
 * El archivo del docente con los 12 identificadores del ejemplar anónimo.
 *
 * La fixture la genera el oráculo leyendo la plantilla real: inventar los
 * identificadores aquí probaría el cruce contra datos que casan por
 * construcción, que es no probarlo.
 */
function notasDelDocente(): ArchivoEntrante {
  return archivo("tests/fixtures/flujo/curso-completo.xlsx", "notas.xlsx");
}

describe("clasificación de los archivos subidos (§5.0)", () => {
  it("un solo archivo, y es la plantilla: camino A", async () => {
    const c = await clasificar(deps, [PLANTILLA]);
    expect(c.mismoArchivo).toBe(true);
    expect(c.notas).toBe(c.plantilla);
  });

  it("dos archivos: reconoce cuál es cuál sin preguntar", async () => {
    const c = await clasificar(deps, [notasDelDocente(), PLANTILLA]);
    expect(c.mismoArchivo).toBe(false);
    expect(c.plantilla.nombre).toBe("Template_Anonimo.xlsx");
    expect(c.notas.nombre).toBe("notas.xlsx");
  });

  it("el orden en que se suben da igual", async () => {
    const c = await clasificar(deps, [PLANTILLA, notasDelDocente()]);
    expect(c.plantilla.nombre).toBe("Template_Anonimo.xlsx");
    expect(c.notas.nombre).toBe("notas.xlsx");
  });

  it("sin plantilla, dice qué falta y dónde conseguirlo", async () => {
    await expect(clasificar(deps, [notasDelDocente()])).rejects.toThrow(
      /plantilla que exporta Banner/,
    );
  });

  it("sin archivos, o con demasiados", async () => {
    await expect(clasificar(deps, [])).rejects.toThrow(EntradaIncompleta);
    await expect(
      clasificar(deps, [PLANTILLA, PLANTILLA, PLANTILLA]),
    ).rejects.toThrow(/Necesito uno o dos/);
  });
});

describe("el camino completo", () => {
  const peticionBase = { generado: "2026-08-25T00:00:00+00:00" };

  it("sin confirmar la columna no se genera archivo, aunque todo esté bien", async () => {
    // §4.0: es el único punto del flujo donde preguntar es preferible a
    // acertar. Cinco segundos contra un curso calificado con las notas del
    // parcial.
    const r = await formatearNotas(deps, {
      ...peticionBase,
      archivos: [notasDelDocente(), PLANTILLA],
    });
    expect(r.confirmacionPendiente).toContain("nota definitiva");
    expect(r.confirmacionPendiente).toContain("¿Es correcto?");
    expect(r.archivo).toBeNull();
  });

  it("con la columna confirmada genera el archivo de cargue", async () => {
    const r = await formatearNotas(deps, {
      ...peticionBase,
      archivos: [notasDelDocente(), PLANTILLA],
      columnaNotaConfirmada: 5,
    });
    expect(r.confirmacionPendiente).toBeNull();
    expect(r.bloqueos).toEqual([]);
    expect(r.archivo).not.toBeNull();

    const hoja = leerHoja(abrir(r.archivo!.bytes));
    expect(valor(hoja, 2, "H")).toBe("4.3"); // 4.25 con ROUND_HALF_UP
    expect(valor(hoja, 13, "H")).toBe("4.3");
    expect(r.archivo!.nombre).toMatch(/^notas_banner_.+\.xlsx$/);
  });

  it("el reporte acompaña siempre al archivo", async () => {
    const r = await formatearNotas(deps, {
      ...peticionBase,
      archivos: [notasDelDocente(), PLANTILLA],
      columnaNotaConfirmada: 5,
    });
    expect(r.reporte.generado).toBe("2026-08-25T00:00:00+00:00");
    expect(Object.values(r.reporte.reglas_de_oro).every(Boolean)).toBe(true);
    expect(r.reporte.resumen.filas_leidas).toBe(12);
    expect(r.cambios).toHaveLength(12); // 4.25 -> 4.3 en las doce
  });

  it("camino A: la plantilla diligenciada se cruza consigo misma", async () => {
    const r = await formatearNotas(deps, {
      ...peticionBase,
      archivos: [PLANTILLA],
      columnaNotaConfirmada: 7,
    });
    expect(r.clasificacion.mismoArchivo).toBe(true);
    expect(r.cruce.mismoArchivo).toBe(true);
    // El ejemplar viene sin notas, así que no se puede generar: todas vacías.
    expect(r.archivo).toBeNull();
    expect(r.bloqueos.length).toBeGreaterThan(0);
  });

  it("un estudiante del curso sin nota bloquea todo el cargue", async () => {
    const r = await formatearNotas(deps, {
      ...peticionBase,
      archivos: [
        archivo("tests/fixtures/flujo/curso-incompleto.xlsx", "notas.xlsx"),
        PLANTILLA,
      ],
      columnaNotaConfirmada: 5,
    });
    expect(r.archivo).toBeNull();
    expect(r.bloqueos.map((b) => b.motivo).join(" ")).toContain("no tienen nota");
  });

  it("un NP sin decisión bloquea; con la decisión registrada, se desbloquea", async () => {
    const archivos = [
      archivo("tests/fixtures/flujo/curso-con-np.xlsx", "notas.xlsx"),
      PLANTILLA,
    ];

    const sinDecision = await formatearNotas(deps, {
      ...peticionBase,
      archivos,
      columnaNotaConfirmada: 5,
    });
    expect(sinDecision.archivo).toBeNull();

    const conDecision = await formatearNotas(deps, {
      ...peticionBase,
      archivos,
      columnaNotaConfirmada: 5,
      config: ConfigValores.desdeObjeto({
        tokens: { np: { accion: "reemplazar", valor: "0.0" } },
      }),
    });
    expect(conDecision.archivo).not.toBeNull();
    const hoja = leerHoja(abrir(conDecision.archivo!.bytes));
    expect(valor(hoja, 3, "H")).toBe("0.0");
  });
});
