/**
 * Suite del lector tolerante — `plan.md` §3, §3.1 y §3.2.
 *
 * Port de `tests/test_lectura.py`. Allá cada test fabrica su `.xlsx` con
 * openpyxl; aquí se leen las fixtures versionadas en `tests/fixtures/lectura/`,
 * generadas por el oráculo con esa misma openpyxl. La diferencia importa: la
 * mitad de lo que se prueba —formatos, fórmulas sin calcular, celdas
 * combinadas— depende de cómo quedó escrito el archivo, no de lo que el test
 * creyó escribir.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ArchivoEntrante } from "@aplicacion/puertos.ts";
import { CatalogoAlias, CAMPO_NOTA, mapear } from "@dominio/mapeo.ts";
import { formulaSinCalcular, ocultaPrecision, texto, vacia } from "@dominio/celda.ts";
import { SinEncabezado, muestra } from "@dominio/tabla.ts";
import { interpretar } from "@dominio/valores.ts";
import {
  ArchivoNoSoportado,
  LectorXlsx,
  decodificar,
  detectarDelimitador,
  leer,
  partirCsv,
} from "@adaptadores/salida/lectura-xlsx.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const catalogo = CatalogoAlias.desdeObjeto(
  JSON.parse(readFileSync(`${RAIZ}config/alias_columnas.json`, "utf-8")),
);

function fixture(nombre: string): ArchivoEntrante {
  return {
    nombre,
    bytes: new Uint8Array(readFileSync(`${RAIZ}tests/fixtures/lectura/${nombre}`)),
  };
}

function leerFixture(nombre: string) {
  return leer(fixture(nombre), catalogo);
}

const ENCABEZADOS = [
  "nombre",
  "codigo de estudiante",
  "trabajos",
  "quizes",
  "examen",
  "nota definitiva",
];

describe("lectura básica", () => {
  it("lee encabezados y filas", () => {
    const tabla = leerFixture("basico.xlsx");
    expect(tabla.encabezados).toEqual(ENCABEZADOS);
    expect(tabla.filas).toHaveLength(2);
    expect(tabla.hoja).toBe("Notas");
  });

  it("encuentra el encabezado aunque no esté en la fila 1", () => {
    const tabla = leerFixture("encabezado-fila-4.xlsx");
    expect(tabla.filaEncabezado).toBe(4);
    expect(tabla.filas).toHaveLength(2);
    expect(tabla.incidencias.some((i) => i.includes("primera fila"))).toBe(true);
  });

  it("salta las filas vacías intercaladas", () => {
    expect(leerFixture("huecos.xlsx").filas).toHaveLength(2);
  });

  it("avisa cuando hay varias hojas", () => {
    const tabla = leerFixture("tres-hojas.xlsx");
    expect(tabla.incidencias.some((i) => i.includes("hojas"))).toBe(true);
  });

  it("conserva el cero a la izquierda del código", () => {
    // Principio §3.4: el código se lee como texto, o el cero ya se perdió.
    expect(texto(leerFixture("basico.xlsx").filas[0]![1]!)).toBe("0012345");
  });

  it("recorta las columnas fantasma de la derecha", () => {
    const tabla = leerFixture("columnas-fantasma.xlsx");
    expect(tabla.encabezados).toEqual(ENCABEZADOS);
    expect(tabla.filas[0]).toHaveLength(ENCABEZADOS.length);
  });

  it("da la muestra de una columna para el paso de confirmación", () => {
    const tabla = leerFixture("basico.xlsx");
    const indice = mapear(tabla.encabezados, catalogo).get(CAMPO_NOTA)!.indice!;
    expect(muestra(tabla, indice)).toEqual(["4.25", "2.95"]);
  });
});

describe("fórmulas sin calcular", () => {
  // §3.1: la trampa que convierte todas las notas en nada.

  it("detecta la fórmula sin valor cacheado", () => {
    const celda = leerFixture("formulas.xlsx").filas[0]![5]!;
    expect(formulaSinCalcular(celda)).toBe(true);
    expect(celda.formula).toBe("=AVERAGE(C2:E2)");
  });

  it("no confunde una fórmula sin calcular con una celda vacía", () => {
    // En openpyxl ambas llegan como None y hacen falta dos lecturas. En el XML
    // están en la misma celda, así que una pasada basta — pero el resultado
    // tiene que ser el mismo: son situaciones opuestas.
    const tabla = leerFixture("formulas.xlsx");
    const conFormula = tabla.filas[0]![5]!;
    const vaciaDeVerdad = tabla.filas[1]![5]!;
    expect(formulaSinCalcular(conFormula)).toBe(true);
    expect(formulaSinCalcular(vaciaDeVerdad)).toBe(false);
    expect(vacia(vaciaDeVerdad)).toBe(true);
  });

  it("el aviso dice qué hacer", () => {
    const aviso = leerFixture("formulas.xlsx").incidencias.join(" ");
    expect(aviso).toContain("fórmulas sin calcular");
    expect(aviso).toContain("Ctrl+S");
  });

  it("ninguna nota se interpreta como cero", () => {
    // El extremo del riesgo: una fórmula sin caché nunca es 0.0.
    const tabla = leerFixture("formulas.xlsx");
    for (const celda of [tabla.filas[0]![5]!, tabla.filas[1]![5]!]) {
      const nota = interpretar(celda.valor, undefined, {
        formulaSinCalcular: formulaSinCalcular(celda),
      });
      expect(nota.valor).toBeNull();
    }
  });

  it("una fórmula ya calculada se lee normal", () => {
    const celda = leerFixture("basico.xlsx").filas[0]![5]!;
    expect(formulaSinCalcular(celda)).toBe(false);
    expect(interpretar(celda.valor).valor?.toFixed(1)).toBe("4.3");
  });
});

describe("precisión oculta", () => {
  // §3.2: Excel muestra 4.3 donde el archivo guarda 4.25.

  it("detecta que el formato oculta decimales", () => {
    const tabla = leerFixture("formato-un-decimal.xlsx");
    expect(ocultaPrecision(tabla.filas[0]![5]!)).toBe(true);
    expect(tabla.incidencias.some((i) => i.includes("menos decimales"))).toBe(true);
  });

  it("no alarma cuando el formato muestra todo", () => {
    expect(ocultaPrecision(leerFixture("formato-dos-decimales.xlsx").filas[0]![5]!))
      .toBe(false);
  });

  it("General no oculta nada", () => {
    expect(ocultaPrecision(leerFixture("formato-general.xlsx").filas[0]![5]!))
      .toBe(false);
  });

  it("el formato de texto tampoco", () => {
    expect(ocultaPrecision(leerFixture("formato-texto.xlsx").filas[0]![5]!))
      .toBe(false);
  });
});

describe("celdas combinadas", () => {
  it("propaga el valor de un encabezado combinado", () => {
    const tabla = leerFixture("combinadas.xlsx");
    expect(tabla.encabezados[0]).toBe("codigo de estudiante");
    expect(tabla.filas).toHaveLength(1);
  });
});

describe("filas de resumen", () => {
  it("avisa de una fila de promedio al final", () => {
    const tabla = leerFixture("resumen.xlsx");
    expect(tabla.incidencias.some((i) => i.includes("total o promedio"))).toBe(true);
  });
});

describe("valores que no son notas", () => {
  it("un TRUE en la columna de nota bloquea, no vale 1.0", () => {
    // La prueba diferencial encontró que el lector devolvía el `<v>1</v>` crudo
    // de un booleano y el 1.0 pasaba como nota válida. Este es el test que
    // impide que vuelva.
    const celda = leerFixture("valores-raros.xlsx").filas[5]![5]!;
    expect(texto(celda)).toBe("TRUE");
    const nota = interpretar(celda.valor);
    expect(nota.estado).toBe("no_numerica");
    expect(nota.valor).toBeNull();
  });

  it("cada valor raro queda en el estado que le corresponde", () => {
    const filas = leerFixture("valores-raros.xlsx").filas;
    const notas = filas.map((f) => interpretar(f[5]!.valor));
    expect(notas.map((n) => n.estado)).toEqual([
      "no_numerica", //   NP
      "vacia", //         celda sin nada
      "ok", //            "4,5": la coma se corrige, pero el valor no cambia
      "fuera_de_rango", // 85 en escala de 5
      "ok", //            0
      "no_numerica", //   TRUE
    ]);
  });

  it("la coma corregida entra al diff aunque el estado sea ok", () => {
    // Regla de oro 4: se muestra todo lo que la herramienta tocó, no solo lo
    // que alteró numéricamente. Por eso "4,5" no es `redondeada` pero sí es
    // una modificación visible.
    const nota = interpretar(leerFixture("valores-raros.xlsx").filas[2]![5]!.valor);
    expect(nota.estado).toBe("ok");
    expect(nota.formatoCorregido).toBe(true);
    expect(nota.valor?.toFixed(1)).toBe("4.5");
  });
});

describe("archivos de texto", () => {
  it("csv con punto y coma, que es lo que exporta Excel aquí", () => {
    const tabla = leerFixture("punto-y-coma.csv");
    expect(tabla.encabezados).toEqual(["codigo de estudiante", "nota definitiva"]);
    expect(texto(tabla.filas[0]![1]!)).toBe("4,25");
  });

  it("la coma decimal del csv se corrige al interpretar, y se reporta", () => {
    const tabla = leerFixture("punto-y-coma.csv");
    const nota = interpretar(tabla.filas[0]![1]!.valor);
    expect(nota.valor?.toFixed(1)).toBe("4.3");
    expect(nota.formatoCorregido).toBe(true);
  });

  it("csv con coma como delimitador", () => {
    expect(leerFixture("coma.csv").encabezados).toHaveLength(2);
  });

  it("latin-1 con eñes y tildes", () => {
    expect(texto(leerFixture("latin1.csv").filas[0]![0]!)).toContain("Muñoz");
  });

  it("el BOM de utf-8 no contamina el primer encabezado", () => {
    // Si el BOM se cuela, el mapeo deja de reconocer la columna del código.
    const tabla = leerFixture("utf8-bom.csv");
    expect(tabla.encabezados[0]).toBe("codigo de estudiante");
  });

  it("respeta las comillas y el delimitador dentro de ellas", () => {
    const tabla = leerFixture("comillas.csv");
    expect(texto(tabla.filas[0]![1]!)).toBe("Munoz; Ana");
  });

  it("txt con tabulador", () => {
    expect(leerFixture("tabulador.txt").encabezados).toHaveLength(2);
  });

  it("informa con qué delimitador leyó", () => {
    expect(leerFixture("coma.csv").incidencias.some((i) => i.includes("delimitador")))
      .toBe(true);
  });
});

describe("piezas del lector de texto", () => {
  it("detectarDelimitador se queda con el más frecuente", () => {
    expect(detectarDelimitador("a;b;c\n1;2;3")).toBe(";");
    expect(detectarDelimitador("a,b,c\n1,2,3")).toBe(",");
    expect(detectarDelimitador("a\tb\n1\t2")).toBe("\t");
  });

  it("partirCsv respeta comillas, comillas dobles y saltos de línea", () => {
    expect(partirCsv('a;"b;c";d', ";")).toEqual([["a", "b;c", "d"]]);
    expect(partirCsv('a;"di ""hola"""', ";")).toEqual([["a", 'di "hola"']]);
    expect(partirCsv("a;b\r\nc;d\r\n", ";")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("decodificar prueba la cascada y falla con un mensaje accionable", () => {
    expect(decodificar(new TextEncoder().encode("hola"))).toBe("hola");
    // 0xF1 no es UTF-8 válido, pero sí es la eñe en latin-1.
    expect(decodificar(new Uint8Array([0x41, 0xf1, 0x6f]))).toBe("Año");
  });
});

describe("errores accionables", () => {
  it("el .xls antiguo explica cómo resolverlo", () => {
    expect(() => leer({ nombre: "viejo.xls", bytes: new Uint8Array() }, catalogo))
      .toThrow(/guárdalo como \.xlsx/);
  });

  it("una extensión desconocida se rechaza", () => {
    expect(() => leer({ nombre: "notas.pdf", bytes: new Uint8Array() }, catalogo))
      .toThrow(ArchivoNoSoportado);
  });

  it("un archivo sin encabezado reconocible se declara, no se adivina", () => {
    expect(() => leerFixture("sin-encabezado.xlsx")).toThrow(SinEncabezado);
  });
});

describe("flujo completo", () => {
  it("de archivo desordenado a notas listas", () => {
    const tabla = leerFixture("encabezado-fila-4.xlsx");
    const indice = mapear(tabla.encabezados, catalogo).get(CAMPO_NOTA)!.indice!;
    const notas = tabla.filas.map((f) => interpretar(f[indice]!.valor));

    expect(notas.map((n) => n.valor?.toFixed(1))).toEqual(["4.3", "3.0"]);
    expect(notas.every((n) => n.estado === "redondeada")).toBe(true);
    // 2.95 -> 3.0: la nota que decide si el estudiante aprueba.
    expect(notas[1]!.valorPrevio?.toString()).toBe("2.95");
  });
});

describe("el puerto LectorDeArchivos", () => {
  const lector = new LectorXlsx(catalogo);

  it("leer devuelve la tabla", async () => {
    expect((await lector.leer(fixture("basico.xlsx"))).filas).toHaveLength(2);
  });

  it("reconoce la plantilla de Banner y no confunde el archivo del docente", async () => {
    const plantilla: ArchivoEntrante = {
      nombre: "Template_Anonimo.xlsx",
      bytes: new Uint8Array(readFileSync(`${RAIZ}tests/fixtures/Template_Anonimo.xlsx`)),
    };
    expect(await lector.esPlantillaBanner(plantilla)).toBe(true);
    expect(await lector.esPlantillaBanner(fixture("basico.xlsx"))).toBe(false);
  });
});
