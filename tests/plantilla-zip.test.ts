/**
 * Suite del adaptador de la plantilla oficial de Banner.
 *
 * Port de la parte de I/O de `tests/test_plantilla.py`. Usa **exclusivamente**
 * `tests/fixtures/Template_Anonimo.xlsx`, nunca el ejemplar con datos reales:
 * durante la construcción se trabaja solo con datos anonimizados
 * (`plan.md` §0.6). El ejemplar real se quedó en el repositorio de referencia.
 *
 * El test que más importa de todos es «no toca ninguna otra parte del
 * paquete»: es el que sostiene la afirmación de que este adaptador cierra el
 * caso `BL-07b` en vez de heredarlo.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

import type { ArchivoEntrante } from "@aplicacion/puertos.ts";
import type { Analisis, FilaAnalizada } from "@dominio/modelo.ts";
import { interpretar } from "@dominio/valores.ts";
import {
  NoSePuedeGenerar,
  PlantillaInvalida,
  type Plantilla,
  cruzar,
  crn,
  descripcion,
  periodo,
  tieneNota,
} from "@dominio/plantilla.ts";
import {
  PlantillaZip,
  archivoDeSalida,
  escribirEnPlantilla,
  esPlantillaBanner,
  leerPlantilla,
} from "@adaptadores/salida/plantilla-zip.ts";
import { abrir, leerHoja, valor } from "@adaptadores/salida/ooxml.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

function fixture(): ArchivoEntrante {
  return {
    nombre: "Template_Anonimo.xlsx",
    bytes: new Uint8Array(readFileSync(`${RAIZ}tests/fixtures/Template_Anonimo.xlsx`)),
  };
}

const ORIGINAL = fixture();

/** Los 13 encabezados de la plantilla oficial, en su orden (`plan.md` §2.2). */
const TRECE_COLUMNAS = [
  "Term Code",
  "CRN",
  "Full Name",
  "Student ID",
  "Rolled",
  "Confidential",
  "Course",
  "Final Grade",
  "Last Attended Date",
  "Hours Attended",
  "Incomplete Final Grade",
  "Extension Date",
  "Extension Date Constraints",
];

function analisisPara(plantilla: Plantilla, nota: unknown = "4.25"): Analisis {
  const filas: FilaAnalizada[] = plantilla.filas.map((f, i) => ({
    numero: i + 1,
    codigo: f.identificador,
    nombre: f.nombre,
    nota: interpretar(nota),
    problemas: [],
    avisos: [],
  }));
  return {
    tabla: {
      encabezados: [],
      filas: [],
      hoja: "",
      filaEncabezado: 0,
      incidencias: [],
      origen: "notas.xlsx",
    },
    mapa: new Map(),
    indiceNota: 0,
    filas,
  };
}

function generar(nota: unknown = "4.25"): Uint8Array {
  const plantilla = leerPlantilla(ORIGINAL);
  return escribirEnPlantilla(ORIGINAL, cruzar(analisisPara(plantilla, nota), plantilla));
}

describe("lectura de la plantilla", () => {
  const plantilla = leerPlantilla(ORIGINAL);

  it("reconoce la estructura oficial", () => {
    expect(plantilla.filas).toHaveLength(12);
    expect(plantilla.esquema.hoja).toBe("Grades");
    expect(plantilla.columnas.has("Final Grade")).toBe(true);
    expect(plantilla.columnas.has("Student ID")).toBe(true);
  });

  it("las trece columnas de Banner, en su orden", () => {
    expect([...plantilla.columnas.keys()]).toEqual(TRECE_COLUMNAS);
  });

  it("la plantilla trae el listado pero no las notas", () => {
    // BL-03 y BL-04: los estudiantes vienen precargados, la nota vacía.
    expect(plantilla.filas.every((f) => f.identificador)).toBe(true);
    expect(plantilla.filas.some(tieneNota)).toBe(false);
  });

  it("un solo curso por archivo", () => {
    expect(crn(plantilla)).toBeTruthy();
    expect(periodo(plantilla)).toBeTruthy();
    expect(descripcion(plantilla)).toContain(crn(plantilla));
  });

  it("ninguna fila viene marcada como consolidada en el ejemplar", () => {
    // El comportamiento real ante `Rolled = Yes` se verifica en el entorno de
    // test; aquí solo se deja constancia de lo que trae el ejemplar.
    expect(plantilla.filas.some((f) => f.rolled)).toBe(false);
  });

  it("rechaza un archivo que no es plantilla", () => {
    expect(() => leerPlantilla({ nombre: "x.xlsx", bytes: new Uint8Array([1, 2, 3]) }))
      .toThrow(PlantillaInvalida);
  });

  it("rechaza un zip que no tiene la hoja Grades", () => {
    // Se construye un .xlsx mínimo cambiándole el nombre de la hoja.
    const libro = abrir(ORIGINAL.bytes);
    const xml = new TextDecoder().decode(libro.partes.get("xl/workbook.xml")!);
    libro.partes.set(
      "xl/workbook.xml",
      new TextEncoder().encode(xml.replace('name="Grades"', 'name="Otra"')),
    );
    const bytes = zipSync(Object.fromEntries(libro.partes));
    expect(() => leerPlantilla({ nombre: "x.xlsx", bytes })).toThrow(PlantillaInvalida);
  });
});

describe("detección de la plantilla", () => {
  it("reconoce el ejemplar oficial", () => {
    expect(esPlantillaBanner(ORIGINAL)).toBe(true);
  });

  it("no confunde cualquier archivo con la plantilla", () => {
    expect(esPlantillaBanner({ nombre: "x.xlsx", bytes: new Uint8Array([80, 75, 3, 4]) }))
      .toBe(false);
  });

  it("el archivo generado sigue siendo reconocible como plantilla", () => {
    expect(esPlantillaBanner({ nombre: "salida.xlsx", bytes: generar() })).toBe(true);
  });
});

describe("escritura sobre la plantilla", () => {
  it("escribe la nota redondeada como texto", () => {
    const hoja = leerHoja(abrir(generar("4.25")));
    // 4.25 -> 4.3 con ROUND_HALF_UP.
    expect(valor(hoja, 2, "H")).toBe("4.3");
    expect(valor(hoja, 13, "H")).toBe("4.3");
  });

  it("la frontera de aprobación llega correcta", () => {
    const hoja = leerHoja(abrir(generar("2.95")));
    expect(valor(hoja, 2, "H")).toBe("3.0");
  });

  it("escribe siempre con un decimal y con punto", () => {
    const hoja = leerHoja(abrir(generar("3")));
    expect(valor(hoja, 2, "H")).toBe("3.0");
  });

  it("conserva el estilo de texto de la celda", () => {
    // La columna viene con numFmtId 49 (`@`). Conservar `s` evita tocar
    // styles.xml, y es lo que garantiza que el punto decimal sobreviva.
    const xml = new TextDecoder().decode(
      abrir(generar()).partes.get("xl/worksheets/sheet1.xml")!,
    );
    const celda = /<c r="H2"[^>]*>/.exec(xml)?.[0] ?? "";
    expect(celda).toContain('s="2"');
    expect(celda).toContain('t="s"');
  });

  it("no toca ninguna otra columna", () => {
    const antes = leerHoja(abrir(ORIGINAL.bytes));
    const despues = leerHoja(abrir(generar()));

    for (let fila = 1; fila <= antes.ultimaFila; fila++) {
      for (const columna of antes.columnas) {
        if (columna === "H" && fila > 1) continue; // la única que cambia
        expect(valor(despues, fila, columna), `${columna}${fila}`).toBe(
          valor(antes, fila, columna),
        );
      }
    }
  });

  it("conserva las trece columnas y el número de filas", () => {
    const plantilla = leerPlantilla({ nombre: "salida.xlsx", bytes: generar() });
    expect([...plantilla.columnas.keys()]).toEqual(TRECE_COLUMNAS);
    expect(plantilla.filas).toHaveLength(12);
  });

  it("el resultado se puede releer como plantilla, ya con sus notas", () => {
    const plantilla = leerPlantilla({ nombre: "salida.xlsx", bytes: generar("4.25") });
    expect(plantilla.filas.every(tieneNota)).toBe(true);
    expect(plantilla.filas.every((f) => f.notaExistente === "4.3")).toBe(true);
  });

  it("se niega a generar un cargue incompleto", () => {
    const plantilla = leerPlantilla(ORIGINAL);
    const analisis = analisisPara(plantilla);
    const parcial: Analisis = { ...analisis, filas: analisis.filas.slice(0, 5) };
    expect(() => escribirEnPlantilla(ORIGINAL, cruzar(parcial, plantilla)))
      .toThrow(NoSePuedeGenerar);
  });

  it("forzar existe solo para las pruebas del entorno de test", () => {
    const plantilla = leerPlantilla(ORIGINAL);
    const analisis = analisisPara(plantilla);
    const parcial: Analisis = { ...analisis, filas: analisis.filas.slice(0, 5) };
    const bytes = escribirEnPlantilla(ORIGINAL, cruzar(parcial, plantilla), {
      forzar: true,
    });
    const hoja = leerHoja(abrir(bytes));
    expect(valor(hoja, 2, "H")).toBe("4.3");
    // Las filas no emparejadas quedan vacías: un cargue deliberadamente parcial.
    expect(valor(hoja, 13, "H")).toBe("");
  });

  it("el nombre sugerido lleva el CRN del curso", () => {
    const plantilla = leerPlantilla(ORIGINAL);
    const salida = archivoDeSalida(ORIGINAL, cruzar(analisisPara(plantilla), plantilla));
    expect(salida.nombre).toBe(`notas_banner_${crn(plantilla)}.xlsx`);
  });
});

describe("fidelidad del contenedor · caso BL-07b", () => {
  // Este bloque es la razón por la que el adaptador parchea el XML dentro del
  // zip en vez de reabrir el libro. `plan.md` §2.2 dejó anotado que openpyxl
  // pierde la cadena vacía de `Hours Attended` y reescribe las cadenas
  // compartidas en línea. Aquí no pasa ninguna de las dos cosas.

  const antes = unzipSync(ORIGINAL.bytes);
  const despues = unzipSync(generar());

  it("el paquete conserva exactamente las mismas partes", () => {
    expect(Object.keys(despues).sort()).toEqual(Object.keys(antes).sort());
  });

  it("solo cambian la hoja y la tabla de cadenas", () => {
    const cambiadas = Object.keys(antes).filter(
      (nombre) =>
        Buffer.compare(Buffer.from(antes[nombre]!), Buffer.from(despues[nombre]!)) !== 0,
    );
    expect(cambiadas.sort()).toEqual([
      "xl/sharedStrings.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("estilos, tema y propiedades salen byte a byte idénticos", () => {
    for (const parte of [
      "xl/styles.xml",
      "xl/theme/theme1.xml",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "_rels/.rels",
      "[Content_Types].xml",
      "docProps/core.xml",
      "docProps/app.xml",
      "xl/persons/person.xml",
    ]) {
      expect(Buffer.from(despues[parte]!).equals(Buffer.from(antes[parte]!)), parte).toBe(
        true,
      );
    }
  });

  it("la cadena vacía de Hours Attended sobrevive", () => {
    // Es la divergencia concreta que openpyxl introducía. La celda J2 apunta a
    // una cadena compartida vacía, y tiene que seguir apuntando a una.
    const hojaAntes = new TextDecoder().decode(antes["xl/worksheets/sheet1.xml"]!);
    const hojaDespues = new TextDecoder().decode(despues["xl/worksheets/sheet1.xml"]!);
    const celda = (xml: string) => /<c r="J2"[^>]*(?:\/>|>.*?<\/c>)/.exec(xml)?.[0];
    expect(celda(hojaDespues)).toBe(celda(hojaAntes));
    expect(celda(hojaDespues)).toContain('t="s"');
  });

  it("las cadenas compartidas se conservan y solo se añaden al final", () => {
    const texto = (b: Uint8Array) => new TextDecoder().decode(b);
    const original = texto(antes["xl/sharedStrings.xml"]!);
    const nuevo = texto(despues["xl/sharedStrings.xml"]!);

    // Todo lo que había sigue estando, en el mismo orden: los índices que ya
    // referenciaban las demás celdas no se movieron.
    const cuerpo = (xml: string) =>
      xml.slice(xml.indexOf("<si>"), xml.lastIndexOf("</sst>"));
    expect(cuerpo(nuevo).startsWith(cuerpo(original))).toBe(true);

    // Y el contador refleja la realidad, no una estimación.
    const unicas = [...nuevo.matchAll(/<si[\s>]/g)].length;
    expect(nuevo).toContain(`uniqueCount="${unicas}"`);
    const refs = [
      ...texto(despues["xl/worksheets/sheet1.xml"]!).matchAll(/<c\s[^>]*\bt="s"/g),
    ].length;
    expect(nuevo).toContain(`count="${refs}"`);
  });

  it("escribir dos veces da el mismo archivo", () => {
    // Idempotencia del contenedor: no se acumulan cadenas repetidas.
    expect(Buffer.from(generar()).equals(Buffer.from(generar()))).toBe(true);
  });

  it("una nota repetida no duplica la cadena compartida", () => {
    // Los 12 estudiantes tienen la misma nota: debe añadirse UNA entrada.
    const original = new TextDecoder().decode(antes["xl/sharedStrings.xml"]!);
    const nuevo = new TextDecoder().decode(despues["xl/sharedStrings.xml"]!);
    const cuantas = (xml: string) => [...xml.matchAll(/<si[\s>]/g)].length;
    expect(cuantas(nuevo)).toBe(cuantas(original) + 1);
  });
});

describe("el puerto RepositorioDePlantilla", () => {
  const repositorio = new PlantillaZip();

  it("leer devuelve la plantilla entera, no solo sus filas", async () => {
    // El cruce necesita además el esquema, el mapa de columnas y los datos de
    // control del curso; devolver solo las filas era una interfaz insuficiente.
    const plantilla = await repositorio.leer(ORIGINAL);
    expect(plantilla.filas).toHaveLength(12);
    expect(plantilla.filas[0]!.identificador).toBeTruthy();
    expect(plantilla.esquema.hoja).toBe("Grades");
    expect(plantilla.columnas.has("Final Grade")).toBe(true);
    expect(crn(plantilla)).toBeTruthy();
  });

  it("escribirFinalGrade escribe solo los identificadores que recibe", async () => {
    const { filas } = await repositorio.leer(ORIGINAL);
    const notas = new Map([[filas[0]!.identificador, "3.7"]]);
    const bytes = await repositorio.escribirFinalGrade(ORIGINAL, notas);
    const hoja = leerHoja(abrir(bytes));
    expect(valor(hoja, filas[0]!.fila, "H")).toBe("3.7");
    expect(valor(hoja, filas[1]!.fila, "H")).toBe("");
  });

  it("un identificador que no está en la plantilla se ignora sin romper", async () => {
    const bytes = await repositorio.escribirFinalGrade(
      ORIGINAL,
      new Map([["NO-EXISTE", "5.0"]]),
    );
    const hoja = leerHoja(abrir(bytes));
    expect(valor(hoja, 2, "H")).toBe("");
  });
});
