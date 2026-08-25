/**
 * Adaptador de configuración: de dónde salen `config/*.json`.
 *
 * Existe para que el dominio no lea archivos. Por eso las clases de
 * configuración tienen `desdeObjeto` y no `desdeJson`: parsear es trabajo de
 * aquí, y validar que la política sea segura es trabajo del dominio —
 * `ConfigValores` rechaza al construirse una configuración que obligaría a
 * inventar notas (§0.3.1).
 *
 * Toma los JSON ya parseados en el constructor y no sabe si vinieron del disco,
 * de un `fetch` o de un bundle. Eso es lo que permite que el mismo caso de uso
 * corra en el navegador y en la CLI.
 */

import type { Configuracion } from "@aplicacion/puertos.ts";
import { CatalogoAlias } from "@dominio/mapeo.ts";
import { ConfigValores } from "@dominio/valores.ts";
import { type EsquemaBanner, esquemaDesdeObjeto } from "@dominio/plantilla.ts";

export interface Fuentes {
  readonly alias: unknown;
  readonly valores: unknown;
  readonly esquema: unknown;
}

export class ConfiguracionJson implements Configuracion {
  private readonly catalogo: CatalogoAlias;
  private readonly valores: ConfigValores;
  private readonly esquema: EsquemaBanner;

  constructor(fuentes: Fuentes) {
    // Se construye todo aquí, no en cada llamada: si la configuración es
    // inválida conviene saberlo al arrancar y no a mitad de un cargue.
    this.catalogo = CatalogoAlias.desdeObjeto(fuentes.alias);
    this.valores = ConfigValores.desdeObjeto(fuentes.valores);
    this.esquema = esquemaDesdeObjeto(fuentes.esquema);
  }

  async catalogoDeAlias(): Promise<CatalogoAlias> {
    return this.catalogo;
  }

  async valoresNoNumericos(): Promise<ConfigValores> {
    return this.valores;
  }

  async esquemaBanner(): Promise<EsquemaBanner> {
    return this.esquema;
  }
}
