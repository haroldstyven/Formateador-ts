/**
 * Lo mínimo de OOXML para leer una hoja y cambiar una celda **sin tocar el
 * resto del archivo**.
 *
 * Por qué no se usa una librería de Excel para esto: `plan.md` §2.2 exige que
 * el archivo de salida se produzca a partir del que Banner entregó, conservando
 * incluso las partes cuyo propósito no entendemos. Cualquier librería que abra
 * el libro y lo vuelva a serializar reescribe todo el contenedor — es
 * exactamente la divergencia que la referencia dejó anotada como `BL-07b`.
 *
 * Aquí el `.xlsx` se trata como lo que es: un zip con XML dentro. Se
 * descomprime, se empalma el texto de **una** celda en `sheet1.xml`, se
 * añade la cadena a `sharedStrings.xml`, y todo lo demás —estilos, tema,
 * relaciones, propiedades— se vuelve a empaquetar byte a byte como estaba.
 *
 * Sobre el parseo con expresiones regulares. Es deliberado, no pereza: un
 * parser de XML de verdad obligaría a reserializar, que es justo lo que se
 * quiere evitar. El XML de una hoja de cálculo lo genera una máquina y es
 * regular; aun así, `leerHoja` valida lo que asume y falla en voz alta si el
 * archivo no tiene la forma esperada, en vez de devolver celdas silenciosamente
 * vacías.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

export const RUTA_HOJA_1 = "xl/worksheets/sheet1.xml";
export const RUTA_CADENAS = "xl/sharedStrings.xml";
export const RUTA_LIBRO = "xl/workbook.xml";

/** El archivo no tiene la forma de un `.xlsx` que podamos manipular. */
export class OoxmlInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "OoxmlInvalido";
  }
}

/** Un `.xlsx` abierto: sus partes tal cual venían. */
export interface Libro {
  readonly partes: Map<string, Uint8Array>;
}

export function abrir(bytes: Uint8Array): Libro {
  let crudo: Record<string, Uint8Array>;
  try {
    crudo = unzipSync(bytes);
  } catch (e) {
    throw new OoxmlInvalido(`el archivo no es un zip válido: ${String(e)}`);
  }
  const partes = new Map(Object.entries(crudo));
  if (!partes.has(RUTA_HOJA_1)) {
    throw new OoxmlInvalido(
      `el archivo no tiene ${RUTA_HOJA_1}. ¿Es un .xlsx exportado por Banner?`,
    );
  }
  return { partes };
}

export function empaquetar(libro: Libro): Uint8Array {
  return zipSync(Object.fromEntries(libro.partes), { level: 6 });
}

export function texto(libro: Libro, ruta: string): string {
  const parte = libro.partes.get(ruta);
  if (!parte) throw new OoxmlInvalido(`falta la parte ${ruta}`);
  return strFromU8(parte);
}

function reemplazarParte(libro: Libro, ruta: string, contenido: string): void {
  libro.partes.set(ruta, strToU8(contenido));
}

// ---------------------------------------------------------------------------
// Entidades XML
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

export function desescapar(xml: string): string {
  return xml.replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9A-Fa-f]+);/g, (e) => {
    const conocida = ENTIDADES[e];
    if (conocida !== undefined) return conocida;
    const hex = e.startsWith("&#x") || e.startsWith("&#X");
    const codigo = Number.parseInt(e.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : e;
  });
}

export function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Texto de un `<si>` o `<is>`: la concatenación de sus `<t>`, con o sin runs. */
function textoDeNodo(xml: string): string {
  let salida = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    salida += m[1] === undefined ? "" : desescapar(m[1]);
  }
  return salida;
}

export function leerCadenasCompartidas(libro: Libro): string[] {
  if (!libro.partes.has(RUTA_CADENAS)) return [];
  const xml = texto(libro, RUTA_CADENAS);
  const cadenas: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    cadenas.push(m[1] === undefined ? "" : textoDeNodo(m[1]));
  }
  return cadenas;
}

/** Separa "H12" en su columna ("H") y su fila (12). */
export function partirReferencia(ref: string): { columna: string; fila: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new OoxmlInvalido(`referencia de celda inesperada: ${ref}`);
  return { columna: m[1]!, fila: Number.parseInt(m[2]!, 10) };
}

/** "A" -> 1, "H" -> 8, "AA" -> 27. */
export function indiceDeColumna(columna: string): number {
  let n = 0;
  for (const c of columna) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

/** 1 -> "A", 8 -> "H", 27 -> "AA". */
export function columnaDeIndice(indice: number): string {
  let n = indice;
  let salida = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    salida = String.fromCharCode(65 + resto) + salida;
    n = Math.floor((n - 1) / 26);
  }
  return salida;
}

/**
 * La hoja leída como texto: `celdas[fila][columna] = valor`.
 *
 * Todos los valores salen como cadena, incluidos los numéricos (§3.4). Una
 * celda ausente o vacía no aparece en el mapa.
 */
export interface Hoja {
  readonly celdas: ReadonlyMap<number, ReadonlyMap<string, string>>;
  readonly ultimaFila: number;
  readonly columnas: readonly string[];
}

export function leerHoja(libro: Libro, ruta = RUTA_HOJA_1): Hoja {
  const xml = texto(libro, ruta);
  const cadenas = leerCadenasCompartidas(libro);

  if (!/<sheetData\s*\/?>|<sheetData[\s>]/.test(xml)) {
    throw new OoxmlInvalido(`${ruta} no tiene <sheetData>: no parece una hoja`);
  }

  const celdas = new Map<number, Map<string, string>>();
  const columnas = new Set<string>();
  let ultimaFila = 0;

  const celda = /<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  for (const m of xml.matchAll(celda)) {
    const atributos = m[1]!;
    const cuerpo = m[3] ?? "";

    const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
    if (!ref) continue;
    const { columna, fila } = partirReferencia(ref);

    ultimaFila = Math.max(ultimaFila, fila);
    columnas.add(columna);

    const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1] ?? "n";
    let valor = "";

    if (tipo === "s") {
      const indice = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      if (indice !== undefined) {
        const i = Number.parseInt(indice, 10);
        valor = cadenas[i] ?? "";
      }
    } else if (tipo === "inlineStr") {
      valor = textoDeNodo(cuerpo);
    } else {
      // "n", "str" (resultado de fórmula) y "b": el valor crudo, sin convertir.
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      valor = v === undefined ? "" : desescapar(v);
    }

    if (valor === "") continue;
    let filaMapa = celdas.get(fila);
    if (!filaMapa) {
      filaMapa = new Map();
      celdas.set(fila, filaMapa);
    }
    filaMapa.set(columna, valor);
  }

  const ordenadas = [...columnas].sort(
    (a, b) => indiceDeColumna(a) - indiceDeColumna(b),
  );
  return { celdas, ultimaFila, columnas: ordenadas };
}

export function valor(hoja: Hoja, fila: number, columna: string): string {
  return hoja.celdas.get(fila)?.get(columna) ?? "";
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Escribe texto en las celdas indicadas, **sin tocar nada más**.
 *
 * Las cadenas se añaden a `sharedStrings.xml` y la celda queda como `t="s"`,
 * que es lo que hace Excel al escribir en una casilla. Se eligió eso en vez de
 * `inlineStr` porque en la plantilla original **todas** las celdas de datos son
 * cadenas compartidas, y porque §5.0.2 da la única evidencia disponible sobre
 * qué acepta Banner: un archivo que pasó por Excel.
 *
 * El atributo `s` de la celda se conserva. En la plantilla oficial la columna
 * `Final Grade` ya viene con el estilo de texto (`numFmtId="49"`, o sea `@`),
 * así que respetarlo evita tener que tocar `styles.xml`.
 */
export function escribirTextoEnCeldas(
  libro: Libro,
  valores: ReadonlyMap<string, string>,
  ruta = RUTA_HOJA_1,
): void {
  if (valores.size === 0) return;

  let xml = texto(libro, ruta);
  const cadenas = leerCadenasCompartidas(libro);
  const indicePorCadena = new Map<string, number>();
  cadenas.forEach((c, i) => {
    if (!indicePorCadena.has(c)) indicePorCadena.set(c, i);
  });
  const nuevas: string[] = [];

  const indiceDe = (texto: string): number => {
    const existente = indicePorCadena.get(texto);
    if (existente !== undefined) return existente;
    const indice = cadenas.length + nuevas.length;
    indicePorCadena.set(texto, indice);
    nuevas.push(texto);
    return indice;
  };

  for (const [ref, contenido] of valores) {
    const indice = indiceDe(contenido);
    xml = empalmarCelda(xml, ref, indice);
  }

  reemplazarParte(libro, ruta, xml);
  if (nuevas.length) agregarCadenas(libro, cadenas.length, nuevas, xml);
}

/** Sustituye (o inserta) una celda con una referencia a cadena compartida. */
function empalmarCelda(xml: string, ref: string, indiceCadena: number): string {
  const existente = new RegExp(
    `<c\\s([^>]*?\\br="${ref}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`,
  ).exec(xml);

  if (existente) {
    const atributos = existente[1]!
      .replace(/\s*\bt="[^"]*"/g, "")
      .trimEnd();
    const nueva = `<c ${atributos} t="s"><v>${indiceCadena}</v></c>`;
    return xml.slice(0, existente.index) + nueva + xml.slice(existente.index + existente[0].length);
  }

  return insertarCeldaEnFila(xml, ref, indiceCadena);
}

/**
 * Inserta una celda que no existía, en su posición por columna dentro de la
 * fila. La plantilla oficial trae todas las celdas, pero un archivo que pasó
 * por otra herramienta puede haber omitido las vacías.
 */
function insertarCeldaEnFila(xml: string, ref: string, indiceCadena: number): string {
  const { columna, fila } = partirReferencia(ref);
  const nueva = `<c r="${ref}" t="s"><v>${indiceCadena}</v></c>`;

  const filaRe = new RegExp(`<row\\s([^>]*?\\br="${fila}"[^>]*?)(?:/>|>([\\s\\S]*?)</row>)`);
  const m = filaRe.exec(xml);
  if (!m) {
    throw new OoxmlInvalido(
      `la hoja no tiene la fila ${fila}, y crear filas nuevas no está soportado: ` +
        "el listado lo pone Banner, la herramienta solo rellena una columna.",
    );
  }

  const cuerpo = m[2] ?? "";
  const objetivo = indiceDeColumna(columna);
  let posicion = cuerpo.length;

  for (const c of cuerpo.matchAll(/<c\s([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const refActual = /\br="([A-Z]+\d+)"/.exec(c[1]!)?.[1];
    if (!refActual) continue;
    if (indiceDeColumna(partirReferencia(refActual).columna) > objetivo) {
      posicion = c.index;
      break;
    }
  }

  const cuerpoNuevo = cuerpo.slice(0, posicion) + nueva + cuerpo.slice(posicion);
  const filaNueva = `<row ${m[1]!.trimEnd()}>${cuerpoNuevo}</row>`;
  return xml.slice(0, m.index) + filaNueva + xml.slice(m.index + m[0].length);
}

/**
 * Añade cadenas nuevas al final de `sharedStrings.xml` y recalcula sus dos
 * contadores. `uniqueCount` es cuántos `<si>` hay; `count`, cuántas celdas
 * apuntan a uno — y ese se recuenta sobre la hoja ya parcheada, no se estima.
 */
function agregarCadenas(
  libro: Libro,
  cuantasHabia: number,
  nuevas: readonly string[],
  hojaXml: string,
): void {
  const anteriores = libro.partes.has(RUTA_CADENAS) ? texto(libro, RUTA_CADENAS) : "";

  const cierre = anteriores.lastIndexOf("</sst>");
  if (cierre === -1) {
    throw new OoxmlInvalido(
      "el archivo no tiene una tabla de cadenas compartidas utilizable",
    );
  }

  const items = nuevas
    .map((c) => `<si><t${/^\s|\s$/.test(c) ? ' xml:space="preserve"' : ""}>${escapar(c)}</t></si>`)
    .join("");

  const total = [...hojaXml.matchAll(/<c\s[^>]*\bt="s"/g)].length;
  const unicas = cuantasHabia + nuevas.length;

  let xml = anteriores.slice(0, cierre) + items + "</sst>";
  xml = xml.replace(/(<sst\b[^>]*?)\scount="\d+"/, "$1").replace(
    /(<sst\b[^>]*?)\suniqueCount="\d+"/,
    "$1",
  );
  xml = xml.replace(/<sst\b([^>]*?)>/, `<sst$1 count="${total}" uniqueCount="${unicas}">`);

  reemplazarParte(libro, RUTA_CADENAS, xml);
}

// ---------------------------------------------------------------------------
// Lectura detallada — lo que hace falta para el archivo del docente
//
// Para la plantilla de Banner basta el texto de cada celda. Para el archivo del
// docente no: hay que distinguir una fórmula sin calcular de una celda vacía
// (§3.1) y saber cuántos decimales muestra el formato (§3.2). Eso obliga a
// mirar tres cosas que `leerHoja` no necesitaba: el `<f>` de la celda, su
// índice de estilo y la tabla de formatos de `styles.xml`.
// ---------------------------------------------------------------------------

/** Formatos numéricos incorporados de OOXML, por su id. */
const FORMATOS_INCORPORADOS: Readonly<Record<number, string>> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm-dd-yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

/**
 * El formato de cada índice de `cellXfs`, que es lo que la celda referencia con
 * su atributo `s`. Una celda sin `s` usa el índice 0, que por defecto es
 * "General".
 */
export function formatosDeCelda(libro: Libro): string[] {
  if (!libro.partes.has("xl/styles.xml")) return ["General"];
  const xml = texto(libro, "xl/styles.xml");

  const personalizados = new Map<number, string>();
  for (const m of xml.matchAll(
    /<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g,
  )) {
    personalizados.set(Number.parseInt(m[1]!, 10), desescapar(m[2]!));
  }

  const bloque = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  const formatos: string[] = [];
  for (const xf of bloque.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number.parseInt(/\bnumFmtId="(\d+)"/.exec(xf[1]!)?.[1] ?? "0", 10);
    formatos.push(personalizados.get(id) ?? FORMATOS_INCORPORADOS[id] ?? "General");
  }
  return formatos.length ? formatos : ["General"];
}

/** Las hojas del libro, en su orden, con la parte del zip que las contiene. */
export function hojas(libro: Libro): { nombre: string; ruta: string }[] {
  const workbook = libro.partes.has(RUTA_LIBRO) ? texto(libro, RUTA_LIBRO) : "";
  const rels = libro.partes.has("xl/_rels/workbook.xml.rels")
    ? texto(libro, "xl/_rels/workbook.xml.rels")
    : "";

  const destinoPorId = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const destino = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    if (id && destino) {
      destinoPorId.set(id, destino.startsWith("/") ? destino.slice(1) : "xl/" + destino);
    }
  }

  const salida: { nombre: string; ruta: string }[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const id = /\br:id="([^"]*)"/.exec(m[0])?.[1];
    if (!nombre) continue;
    const ruta = normalizarRuta((id && destinoPorId.get(id)) || "");
    if (ruta && libro.partes.has(ruta)) salida.push({ nombre, ruta });
  }

  // Sin relaciones utilizables, se cae a la convención habitual.
  if (salida.length === 0 && libro.partes.has(RUTA_HOJA_1)) {
    const nombre = /<sheet\b[^>]*\bname="([^"]*)"/.exec(workbook)?.[1] ?? "Hoja1";
    salida.push({ nombre, ruta: RUTA_HOJA_1 });
  }
  return salida;
}

function normalizarRuta(ruta: string): string {
  const partes: string[] = [];
  for (const parte of ruta.split("/")) {
    if (parte === "." || parte === "") continue;
    if (parte === "..") partes.pop();
    else partes.push(parte);
  }
  return partes.join("/");
}

/** Una celda con todo lo que hace falta para no equivocarse al interpretarla. */
export interface CeldaCruda {
  readonly fila: number;
  readonly columna: number;
  /** El texto crudo del `<v>`, o de los `<t>` si es cadena. `null` si no hay. */
  readonly valor: string | null;
  /** El tipo declarado: "s", "inlineStr", "str", "b", "e" o "n". */
  readonly tipo: string;
  /** La fórmula con su signo igual delante, o `null`. */
  readonly formula: string | null;
  readonly formato: string;
}

/** Rangos combinados de la hoja, como `[filaMin, colMin, filaMax, colMax]`. */
function rangosCombinados(xml: string): [number, number, number, number][] {
  const salida: [number, number, number, number][] = [];
  for (const m of xml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const a = partirReferencia(m[1]!);
    const b = partirReferencia(m[2]!);
    salida.push([
      Math.min(a.fila, b.fila),
      Math.min(indiceDeColumna(a.columna), indiceDeColumna(b.columna)),
      Math.max(a.fila, b.fila),
      Math.max(indiceDeColumna(a.columna), indiceDeColumna(b.columna)),
    ]);
  }
  return salida;
}

const CELDA_VACIA = {
  valor: null,
  tipo: "n",
  formula: null,
  formato: "General",
} as const;

/**
 * La hoja como matriz densa de celdas, del tamaño que ocupe.
 *
 * Densa a propósito: la referencia usa `iter_rows()` de openpyxl, que rellena
 * los huecos. Si aquí se devolvieran solo las celdas presentes, las columnas se
 * correrían y el archivo saldría con las notas de otro estudiante.
 */
export function leerMatriz(libro: Libro, ruta = RUTA_HOJA_1): CeldaCruda[][] {
  const xml = texto(libro, ruta);
  const cadenas = leerCadenasCompartidas(libro);
  const formatos = formatosDeCelda(libro);

  const porFila = new Map<number, Map<number, CeldaCruda>>();
  let maxFila = 0;
  let maxColumna = 0;

  const poner = (celda: CeldaCruda): void => {
    let filaMapa = porFila.get(celda.fila);
    if (!filaMapa) {
      filaMapa = new Map();
      porFila.set(celda.fila, filaMapa);
    }
    filaMapa.set(celda.columna, celda);
    maxFila = Math.max(maxFila, celda.fila);
    maxColumna = Math.max(maxColumna, celda.columna);
  };

  for (const m of xml.matchAll(/<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
    const atributos = m[1]!;
    const cuerpo = m[3] ?? "";
    const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
    if (!ref) continue;

    const { columna, fila } = partirReferencia(ref);
    const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1] ?? "n";
    const estilo = Number.parseInt(/\bs="(\d+)"/.exec(atributos)?.[1] ?? "0", 10);

    const formulaCruda = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(cuerpo)?.[1];
    const formula = formulaCruda === undefined ? null : "=" + desescapar(formulaCruda);

    let valor: string | null = null;
    if (tipo === "s") {
      const indice = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      if (indice !== undefined) valor = cadenas[Number.parseInt(indice, 10)] ?? "";
    } else if (tipo === "inlineStr") {
      valor = textoDeNodo(cuerpo);
    } else if (tipo === "b") {
      // Un booleano se guarda como <v>1</v> o <v>0</v>. Devolver ese crudo
      // sería catastrófico: un TRUE en la columna de nota se convertiría en un
      // 1.0 perfectamente válido, en silencio. Tiene que llegar como texto no
      // numérico para que el dominio lo bloquee y pregunte.
      // Lo encontró la prueba diferencial; ver `herramientas/desviaciones.json`.
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      valor = v === undefined ? null : v.trim() === "0" ? "FALSE" : "TRUE";
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      valor = v === undefined ? null : desescapar(v);
    }

    poner({
      fila,
      columna: indiceDeColumna(columna),
      valor,
      tipo,
      formula,
      formato: formatos[estilo] ?? "General",
    });
  }

  // Excel guarda el valor de un rango combinado solo en su esquina superior
  // izquierda; el resto llega vacío. En un encabezado combinado eso borra el
  // nombre de la columna, así que se propaga.
  for (const [filaMin, colMin, filaMax, colMax] of rangosCombinados(xml)) {
    const origen = porFila.get(filaMin)?.get(colMin);
    if (!origen || origen.valor === null) continue;
    for (let f = filaMin; f <= filaMax; f++) {
      for (let c = colMin; c <= colMax; c++) {
        if (f === filaMin && c === colMin) continue;
        const destino = porFila.get(f)?.get(c);
        if (destino && (destino.valor !== null || destino.formula !== null)) continue;
        poner({ ...origen, fila: f, columna: c });
      }
    }
  }

  const matriz: CeldaCruda[][] = [];
  for (let f = 1; f <= maxFila; f++) {
    const filaMapa = porFila.get(f);
    const fila: CeldaCruda[] = [];
    for (let c = 1; c <= maxColumna; c++) {
      fila.push(filaMapa?.get(c) ?? { ...CELDA_VACIA, fila: f, columna: c });
    }
    matriz.push(fila);
  }
  return matriz;
}
