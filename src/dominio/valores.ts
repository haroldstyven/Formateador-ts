/**
 * Interpretación de una celda de nota: qué es, qué le falta, quién lo decide.
 *
 * Traduce el contenido crudo de una celda al modelo canónico (`Nota`), sin
 * tomar nunca una decisión académica por su cuenta. Las tres invariantes que
 * gobiernan este módulo (`plan.md` §0.3, §0.3.1 y regla de oro 3):
 *
 *   1. Una celda vacía nunca se convierte en 0.0. Se reporta.
 *   2. Un valor no numérico nunca tiene reemplazo por defecto. Se pregunta.
 *   3. Toda sustitución queda registrada con su valor original y su token.
 *
 * La configuración de valores no numéricos es editable (`config/`), para que
 * la institución pueda fijar una política sin tocar el código. Lo que la
 * configuración *no* puede hacer es inventar un valor por defecto: eso está
 * bloqueado al cargar, no por convención.
 *
 * Port de `formateador/valores.py`.
 *
 * Una diferencia deliberada con el original: aquí no hay `desdeJson`. Leer un
 * archivo es I/O, y esto es el interior del hexágono. La configuración entra
 * ya parseada por `desdeObjeto`, y de traerla se encarga el puerto
 * `Configuracion`. Lo que sí se conserva íntegro es la validación al cargar:
 * eso es política, no plomería.
 */

import { Decimal } from "decimal.js";

import type { Accion, Estado, Nota } from "./modelo.ts";
import { ValorNoDecimal, aDecimal, enRango, redondear } from "./redondeo.ts";

const ESPACIOS = /\s+/g;

/** Estados en los que el archivo no puede generarse sin intervención humana. */
const ESTADOS_BLOQUEANTES: ReadonlySet<Estado> = new Set<Estado>([
  "vacia",
  "no_numerica",
  "fuera_de_rango",
  "formula_sin_calcular",
]);

/** Qué hacer con un token, según la configuración vigente. */
export interface Decision {
  readonly accion: Accion;
  readonly valor: Decimal | null;
  readonly etiqueta: string;
}

/** La configuración de valores no numéricos no es segura de aplicar. */
export class ConfigInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ConfigInvalida";
  }
}

/** Si es `true`, el archivo no puede generarse sin intervención humana. */
export function requiereDecision(nota: Nota): boolean {
  return ESTADOS_BLOQUEANTES.has(nota.estado);
}

/**
 * Si es `true`, la nota debe aparecer en el diff que ve el docente (regla 4).
 *
 * Incluye las correcciones de formato que no cambian el valor —una coma por un
 * punto— porque la regla exige mostrar todo lo que la herramienta tocó, no
 * solo lo que alteró numéricamente.
 */
export function fueModificada(nota: Nota): boolean {
  return (
    nota.estado === "redondeada" ||
    nota.estado === "sustituida" ||
    nota.formatoCorregido
  );
}

/**
 * Reduce un valor no numérico a una clave estable.
 *
 * "NP", "np", "N.P." y " Np " son el mismo caso y deben preguntarse una vez,
 * no cuatro.
 */
export function normalizarToken(texto: string): string {
  const sinTildes = texto.normalize("NFKD").replace(/\p{M}/gu, "");
  return sinTildes.toLowerCase().replaceAll(".", "").trim().replace(ESPACIOS, " ");
}

const ACCIONES: readonly Accion[] = [
  "preguntar",
  "reemplazar",
  "dejar_vacio",
  "descartar_fila",
];

function comoAccion(bruto: unknown, contexto: string): Accion {
  if (typeof bruto === "string" && (ACCIONES as readonly string[]).includes(bruto)) {
    return bruto as Accion;
  }
  throw new ConfigInvalida(
    `acción desconocida para '${contexto}': ${JSON.stringify(bruto)}`,
  );
}

/**
 * Decisiones sobre tokens no numéricos, con las salvaguardas incorporadas.
 *
 * La acción por defecto es siempre `preguntar`, y `reemplazar` como política
 * global está prohibida: un valor por defecto aplicado a tokens desconocidos
 * es exactamente el mecanismo que reprueba estudiantes en silencio.
 */
export class ConfigValores {
  readonly politicaPorDefecto: Accion;
  readonly decisiones: ReadonlyMap<string, Decision>;

  constructor(
    decisiones: ReadonlyMap<string, Decision> = new Map(),
    politicaPorDefecto: Accion = "preguntar",
  ) {
    if (politicaPorDefecto === "reemplazar") {
      throw new ConfigInvalida(
        "'reemplazar' no puede ser la política por defecto: obligaría a " +
          "inventar un valor para tokens que nadie ha revisado.",
      );
    }
    this.politicaPorDefecto = politicaPorDefecto;
    this.decisiones = decisiones;
  }

  static desdeObjeto(datos: unknown): ConfigValores {
    if (datos === null || typeof datos !== "object") {
      throw new ConfigInvalida("la configuración no es un objeto");
    }
    const raiz = datos as Record<string, unknown>;

    const porDefecto = comoAccion(
      raiz["politica_por_defecto"] ?? "preguntar",
      "politica_por_defecto",
    );

    const tokens = (raiz["tokens"] ?? {}) as Record<string, unknown>;
    if (typeof tokens !== "object" || tokens === null) {
      throw new ConfigInvalida("'tokens' debe ser un objeto");
    }

    const decisiones = new Map<string, Decision>();

    for (const [tokenBruto, crudo] of Object.entries(tokens)) {
      if (crudo === null || typeof crudo !== "object") {
        throw new ConfigInvalida(`la entrada de '${tokenBruto}' no es un objeto`);
      }
      const cfg = crudo as Record<string, unknown>;
      const token = normalizarToken(tokenBruto);
      const accion = comoAccion(cfg["accion"] ?? "preguntar", tokenBruto);

      let valor: Decimal | null = null;
      if (accion === "reemplazar") {
        if (cfg["valor"] === undefined || cfg["valor"] === null) {
          throw new ConfigInvalida(
            `'${tokenBruto}' declara 'reemplazar' sin indicar el valor. ` +
              "No existe un valor por defecto: debe escribirlo una persona.",
          );
        }
        try {
          valor = redondear(String(cfg["valor"]));
        } catch (e) {
          if (e instanceof ValorNoDecimal) {
            throw new ConfigInvalida(
              `'${tokenBruto}' declara un reemplazo no numérico: ` +
                JSON.stringify(cfg["valor"]),
            );
          }
          throw e;
        }
        if (!enRango(valor)) {
          throw new ConfigInvalida(
            `'${tokenBruto}' declara un reemplazo fuera de la escala 0.0 a 5.0: ` +
              JSON.stringify(cfg["valor"]),
          );
        }
      }

      decisiones.set(token, {
        accion,
        valor,
        etiqueta: typeof cfg["etiqueta"] === "string" ? cfg["etiqueta"] : "",
      });
    }

    return new ConfigValores(decisiones, porDefecto);
  }

  decisionPara(token: string): Decision {
    return (
      this.decisiones.get(token) ?? {
        accion: this.politicaPorDefecto,
        valor: null,
        etiqueta: "",
      }
    );
  }
}

export interface OpcionesInterpretar {
  /**
   * Lo aporta el lector cuando la celda contiene una fórmula cuyo valor
   * cacheado está vacío. Sin ese dato, "fórmula sin calcular" y "celda vacía"
   * son indistinguibles —ambas llegan vacías— y merecen mensajes opuestos.
   * Ver `plan.md` §3.1.
   */
  readonly formulaSinCalcular?: boolean;
}

/** Convierte el contenido crudo de una celda en una `Nota`. */
export function interpretar(
  bruto: unknown,
  config: ConfigValores = new ConfigValores(),
  opciones: OpcionesInterpretar = {},
): Nota {
  const esNulo = bruto === null || bruto === undefined;
  const original = esNulo ? "" : String(bruto);

  if (opciones.formulaSinCalcular) {
    return nota({
      original,
      estado: "formula_sin_calcular",
      detalle:
        "La celda tiene una fórmula sin calcular. Abre el archivo en Excel, " +
        "guárdalo con Ctrl+S y vuelve a subirlo.",
    });
  }

  if (esNulo || (typeof bruto === "string" && bruto.trim() === "")) {
    return nota({
      original,
      estado: "vacia",
      detalle: "Sin calificar. No se rellena con ningún valor: decide el docente.",
    });
  }

  let texto = original.trim();
  let detallePrevio = "";
  let formatoCorregido = false;

  // Coma decimal: se corrige, pero nunca en silencio -- va al diff.
  if (typeof bruto === "string" && texto.includes(",")) {
    if (contar(texto, ",") === 1 && !texto.includes(".")) {
      texto = texto.replace(",", ".");
      detallePrevio = "Estaba escrita con coma; Banner necesita punto. ";
      formatoCorregido = true;
    } else {
      return tokenNoNumerico(original, config, "separadores ambiguos");
    }
  }

  let valor: Decimal;
  try {
    valor = aDecimal(typeof bruto === "string" ? texto : bruto);
  } catch (e) {
    if (e instanceof ValorNoDecimal) return tokenNoNumerico(original, config);
    throw e;
  }

  if (!enRango(valor)) {
    return nota({
      original,
      estado: "fuera_de_rango",
      detalle: `${valor.toString()} está fuera de la escala 0.0 a 5.0.`,
    });
  }

  const redondeada = redondear(valor);
  if (redondeada.equals(valor)) {
    return nota({
      original,
      valor: redondeada,
      estado: "ok",
      detalle: detallePrevio.trim(),
      formatoCorregido,
    });
  }

  return nota({
    original,
    valor: redondeada,
    estado: "redondeada",
    valorPrevio: valor,
    detalle:
      `${detallePrevio}Se redondeó ${valor.toString()} a ${redondeada.toString()}.`.trim(),
    formatoCorregido,
  });
}

function tokenNoNumerico(
  original: string,
  config: ConfigValores,
  motivo = "",
): Nota {
  const token = normalizarToken(original);
  const decision = config.decisionPara(token);
  const sufijo = motivo ? ` (${motivo})` : "";

  if (decision.accion === "reemplazar") {
    // El valor ya fue validado al cargar la configuración: existe, es numérico
    // y está en escala. Aquí solo se aplica y se deja registrado.
    return nota({
      original,
      valor: decision.valor,
      estado: "sustituida",
      token,
      detalle:
        `'${original}' se reemplazó por ${decision.valor?.toString()} ` +
        "por decisión registrada.",
    });
  }

  if (decision.accion === "dejar_vacio") {
    return nota({
      original,
      estado: "vacia",
      token,
      detalle: `'${original}' se deja sin nota por decisión registrada.`,
    });
  }

  if (decision.accion === "descartar_fila") {
    return nota({
      original,
      estado: "descartada",
      token,
      detalle: `'${original}': la fila se excluye por decisión registrada.`,
    });
  }

  return nota({
    original,
    estado: "no_numerica",
    token,
    detalle:
      `'${original}' no es un número${sufijo}. Banner solo acepta valores ` +
      "entre 0.0 y 5.0. Indica qué debe ir en su lugar.",
  });
}

/**
 * Agrupa por token las notas que esperan una decisión.
 *
 * Permite preguntar una sola vez por token en vez de una vez por fila: "hay 4
 * estudiantes con NP", no cuatro preguntas idénticas.
 */
export function agruparPendientes(notas: readonly Nota[]): Map<string, Nota[]> {
  const grupos = new Map<string, Nota[]>();
  for (const n of notas) {
    if (n.estado === "no_numerica" && n.token) {
      const grupo = grupos.get(n.token);
      if (grupo) grupo.push(n);
      else grupos.set(n.token, [n]);
    }
  }
  return grupos;
}

/** Constructor con los mismos valores por defecto que el dataclass original. */
function nota(campos: {
  original: string;
  estado: Estado;
  detalle: string;
  valor?: Decimal | null;
  token?: string | null;
  valorPrevio?: Decimal | null;
  formatoCorregido?: boolean;
}): Nota {
  return {
    original: campos.original,
    valor: campos.valor ?? null,
    estado: campos.estado,
    detalle: campos.detalle,
    token: campos.token ?? null,
    valorPrevio: campos.valorPrevio ?? null,
    formatoCorregido: campos.formatoCorregido ?? false,
  };
}

function contar(texto: string, caracter: string): number {
  let n = 0;
  for (const c of texto) if (c === caracter) n++;
  return n;
}
