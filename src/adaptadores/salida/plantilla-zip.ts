/**
 * Adaptador de escritura sobre la plantilla oficial de Banner.
 *
 * PENDIENTE — port de `formateador/plantilla.py`.
 *
 * DECISIÓN DE DISEÑO, y la razón por la que este adaptador está separado del
 * lector: aquí se puede hacer algo que la versión Python dejó como plan B.
 *
 * `plan.md` §2.2 advierte que reabrir y guardar con openpyxl no es idéntico
 * byte a byte (caso `BL-07b`), y que la solución fiel sería parchear el XML
 * dentro del zip en vez de reabrir el libro. En TypeScript eso sale más barato
 * de hacer que de evitar: se abre el .xlsx con `fflate`, se toca
 * `xl/worksheets/sheet1.xml` para escribir las celdas de `Final Grade` como
 * texto inline, y todo lo demás del contenedor —estilos, sharedStrings,
 * metadatos, las otras doce columnas— se reempaqueta sin haberlo tocado.
 *
 * Si se implementa así, `BL-07b` deja de ser un caso pendiente.
 * Si se implementa con exceljs (reabrir y guardar), `BL-07b` sigue abierto y
 * hay que probarlo contra Banner igual que en la versión Python.
 *
 * En ambos casos se conserva la regla de §2.2: de las 13 columnas se escribe
 * exactamente una, y el archivo de salida se produce a partir del que Banner
 * entregó, nunca construyendo un libro nuevo.
 */

import type {
  ArchivoEntrante,
  FilaPlantilla,
  RepositorioDePlantilla,
} from "@aplicacion/puertos.ts";

export class PlantillaZip implements RepositorioDePlantilla {
  async leer(_archivo: ArchivoEntrante): Promise<readonly FilaPlantilla[]> {
    throw new Error("PENDIENTE: portar formateador/plantilla.py");
  }

  async escribirFinalGrade(
    _original: ArchivoEntrante,
    _notasPorStudentId: ReadonlyMap<string, string>,
  ): Promise<Uint8Array> {
    throw new Error("PENDIENTE: portar formateador/plantilla.py");
  }
}
