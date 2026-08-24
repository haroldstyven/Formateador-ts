/**
 * Adaptador de la plantilla oficial de Banner: leerla y rellenar `Final Grade`.
 *
 * Implementa la mitad de I/O de `formateador/plantilla.py`. La otra mitad —el
 * cruce— es lógica de dominio y vive en `src/dominio/plantilla.ts`.
 *
 * ESTA ES LA DESVIACIÓN MÁS GRANDE DEL PORT, y es deliberada.
 *
 * La referencia abre el libro con `openpyxl` y lo guarda. Eso no reproduce el
 * archivo byte a byte: la cadena vacía explícita de `Hours Attended` se pierde
 * y la tabla de cadenas compartidas se reescribe en línea. Ningún dato cambia,
 * pero el contenedor sí, y `plan.md` §2.2 lo dejó anotado como el caso
 * `BL-07b`, con la solución ya escrita: «parchear el XML dentro del zip en
 * lugar de reabrir el libro — más fiel y más complejo. No se implementa antes
 * de saber si hace falta.»
 *
 * En TypeScript esa solución sale más barata que evitarla, así que se
 * implementa: `ooxml.ts` descomprime, empalma el texto de una sola celda y
 * vuelve a empaquetar. **Todas las demás partes del zip salen idénticas a como
 * entraron**, y hay un test que lo comprueba parte por parte.
 *
 * Lo que eso cambia: `BL-07b` deja de ser un caso pendiente. Lo que NO cambia:
 * `BL-05` y `BL-07` siguen abiertos, porque nadie ha comprobado todavía que
 * Banner acepte un archivo generado por la herramienta. Ser más fiel que la
 * referencia no es lo mismo que estar verificado.
 */

import type { ArchivoEntrante, RepositorioDePlantilla } from "@aplicacion/puertos.ts";
import {
  ESQUEMA_POR_DEFECTO,
  type Cruce,
  type EsquemaBanner,
  type FilaPlantilla,
  type Plantilla,
  NoSePuedeGenerar,
  PlantillaInvalida,
  crn,
  motivosDeBloqueo,
  notaTexto,
  puedeGenerarCruce,
} from "@dominio/plantilla.ts";
import {
  type Hoja,
  type Libro,
  OoxmlInvalido,
  abrir,
  columnaDeIndice,
  empaquetar,
  escribirTextoEnCeldas,
  indiceDeColumna,
  leerHoja,
  valor,
} from "./ooxml.ts";

export interface OpcionesPlantilla {
  readonly esquema?: EsquemaBanner;
}

/**
 * Lee la plantilla exportada por Banner y valida que tenga su forma.
 *
 * Nota sobre la hoja: la referencia la busca por nombre (`Grades`). Aquí se lee
 * `sheet1.xml` y se comprueba que el libro **declare** ese nombre, porque
 * resolver nombre → parte exigiría seguir las relaciones del paquete. En la
 * plantilla oficial hay una sola hoja, así que las dos rutas coinciden; si
 * dejaran de coincidir, la comprobación del nombre lo detecta.
 */
export function leerPlantilla(
  archivo: ArchivoEntrante,
  opciones: OpcionesPlantilla = {},
): Plantilla {
  const esquema = opciones.esquema ?? ESQUEMA_POR_DEFECTO;

  let libro: Libro;
  try {
    libro = abrir(archivo.bytes);
  } catch (e) {
    throw new PlantillaInvalida(
      e instanceof OoxmlInvalido
        ? `${e.message} Vuelve a exportarla desde Banner sin modificarla.`
        : String(e),
    );
  }

  const hojas = hojasDeclaradas(libro);
  if (!hojas.includes(esquema.hoja)) {
    throw new PlantillaInvalida(
      `El archivo no tiene la hoja '${esquema.hoja}'. ¿Es la plantilla que ` +
        `exporta Banner? Hojas encontradas: ${JSON.stringify(hojas)}.`,
    );
  }

  let hoja: Hoja;
  try {
    hoja = leerHoja(libro);
  } catch (e) {
    throw new PlantillaInvalida(String(e instanceof Error ? e.message : e));
  }

  const columnas = leerEncabezados(hoja, esquema);

  const faltantes = [esquema.columnaClave, esquema.columnaNota].filter(
    (h) => !columnas.has(h),
  );
  if (faltantes.length) {
    throw new PlantillaInvalida(
      `A la plantilla le faltan columnas obligatorias: ${JSON.stringify(faltantes)}. ` +
        "Vuelve a exportarla desde Banner sin modificarla.",
    );
  }

  const celda = (fila: number, encabezado: string): string => {
    const indice = columnas.get(encabezado);
    if (indice === undefined) return "";
    return valor(hoja, fila, columnaDeIndice(indice)).trim();
  };

  const filas: FilaPlantilla[] = [];
  for (let numero = esquema.filaEncabezado + 1; numero <= hoja.ultimaFila; numero++) {
    const identificador = celda(numero, esquema.columnaClave);
    if (!identificador) continue;
    filas.push({
      fila: numero,
      identificador,
      nombre: celda(numero, esquema.columnaNombre),
      rolled:
        celda(numero, esquema.columnaRolled).toLowerCase() ===
        esquema.valorRolledBloquea.toLowerCase(),
      confidencial: celda(numero, esquema.columnaConfidencial).toLowerCase() === "yes",
      notaExistente: celda(numero, esquema.columnaNota),
    });
  }

  if (filas.length === 0) {
    throw new PlantillaInvalida(
      "La plantilla no tiene ningún estudiante. Verifica que exportaste el curso correcto.",
    );
  }

  const primera = esquema.filaEncabezado + 1;
  const control = new Map<string, string>(
    (["Course", "Term Code", "CRN"] as const).map((n) => [n, celda(primera, n)]),
  );

  return { origen: archivo.nombre, esquema, columnas, filas, control };
}

/** Los encabezados de la fila 1, en orden, mapeados a su índice de columna. */
function leerEncabezados(hoja: Hoja, esquema: EsquemaBanner): Map<string, number> {
  const columnas = new Map<string, number>();
  const fila = hoja.celdas.get(esquema.filaEncabezado);
  if (!fila) return columnas;
  for (const columna of hoja.columnas) {
    const encabezado = (fila.get(columna) ?? "").trim();
    // El primero gana: si Banner repitiera un encabezado, quedarse con el
    // primero es lo mismo que hace la referencia al construir el diccionario.
    if (encabezado && !columnas.has(encabezado)) {
      columnas.set(encabezado, indiceDeColumna(columna));
    }
  }
  return columnas;
}

function hojasDeclaradas(libro: Libro): string[] {
  const parte = libro.partes.get("xl/workbook.xml");
  if (!parte) return [];
  const xml = new TextDecoder().decode(parte);
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]!);
}

export interface OpcionesEscritura {
  /**
   * Permite generar un archivo parcial. Existe **solo** para las pruebas del
   * entorno de test, donde hace falta producir cargues deliberadamente
   * incompletos: nunca debe exponerse en la interfaz del docente.
   */
  readonly forzar?: boolean;
}

/**
 * Rellena `Final Grade` sobre la plantilla y devuelve el archivo resultante.
 *
 * Modifica **una sola columna**. Todo lo demás —estilos, formatos de fecha,
 * anchos, columnas de control, y las partes del paquete que nadie mira— se
 * conserva sin tocar, porque Banner espera de vuelta lo que él mismo entregó.
 */
export function escribirEnPlantilla(
  original: ArchivoEntrante,
  cruce: Cruce,
  opciones: OpcionesEscritura = {},
): Uint8Array {
  if (!puedeGenerarCruce(cruce) && !opciones.forzar) {
    throw new NoSePuedeGenerar(motivosDeBloqueo(cruce).join(" "));
  }

  const esquema = cruce.plantilla.esquema;
  const indice = cruce.plantilla.columnas.get(esquema.columnaNota);
  if (indice === undefined) {
    throw new PlantillaInvalida(
      `La plantilla no tiene la columna '${esquema.columnaNota}'.`,
    );
  }
  const columna = columnaDeIndice(indice);

  const valores = new Map<string, string>();
  for (const emparejamiento of cruce.emparejados) {
    valores.set(`${columna}${emparejamiento.plantilla.fila}`, notaTexto(emparejamiento));
  }

  const libro = abrir(original.bytes);
  escribirTextoEnCeldas(libro, valores);
  return empaquetar(libro);
}

/** El archivo en memoria y un nombre sugerido, para descargarlo. */
export function archivoDeSalida(
  original: ArchivoEntrante,
  cruce: Cruce,
  opciones: OpcionesEscritura = {},
): ArchivoEntrante {
  return {
    nombre: `notas_banner_${crn(cruce.plantilla) || "curso"}.xlsx`,
    bytes: escribirEnPlantilla(original, cruce, opciones),
  };
}

/**
 * ¿Este archivo es la plantilla que exporta Banner?
 *
 * Permite que el docente suba **un solo archivo**: si ya llenó las notas sobre
 * la plantilla, no hace falta pedírsela aparte — el cruce se vuelve trivial
 * porque cada estudiante casa consigo mismo.
 */
export function esPlantillaBanner(
  archivo: ArchivoEntrante,
  opciones: OpcionesPlantilla = {},
): boolean {
  const esquema = opciones.esquema ?? ESQUEMA_POR_DEFECTO;
  try {
    const libro = abrir(archivo.bytes);
    if (!hojasDeclaradas(libro).includes(esquema.hoja)) return false;
    const hoja = leerHoja(libro);
    const encabezados = new Set(
      [...(hoja.celdas.get(esquema.filaEncabezado)?.values() ?? [])].map((v) => v.trim()),
    );
    return encabezados.has(esquema.columnaClave) && encabezados.has(esquema.columnaNota);
  } catch {
    return false;
  }
}

/** Implementación del puerto, para inyectarla en el caso de uso. */
export class PlantillaZip implements RepositorioDePlantilla {
  constructor(private readonly opciones: OpcionesPlantilla = {}) {}

  async leer(archivo: ArchivoEntrante): Promise<readonly FilaPlantilla[]> {
    return leerPlantilla(archivo, this.opciones).filas;
  }

  async escribirFinalGrade(
    original: ArchivoEntrante,
    notasPorStudentId: ReadonlyMap<string, string>,
  ): Promise<Uint8Array> {
    const plantilla = leerPlantilla(original, this.opciones);
    const indice = plantilla.columnas.get(plantilla.esquema.columnaNota);
    if (indice === undefined) {
      throw new PlantillaInvalida(
        `La plantilla no tiene la columna '${plantilla.esquema.columnaNota}'.`,
      );
    }
    const columna = columnaDeIndice(indice);

    const valores = new Map<string, string>();
    for (const fila of plantilla.filas) {
      const nota = notasPorStudentId.get(fila.identificador);
      if (nota !== undefined) valores.set(`${columna}${fila.fila}`, nota);
    }

    const libro = abrir(original.bytes);
    escribirTextoEnCeldas(libro, valores);
    return empaquetar(libro);
  }
}
