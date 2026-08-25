"use client";

/**
 * El adaptador de entrada web. Todo el procesamiento ocurre **aquí, en el
 * navegador del docente**.
 *
 * Eso no es un detalle de implementación: es lo que hace que la promesa de la
 * pantalla —"ningún dato sale de tu computador"— sea literal y no una
 * intención. El archivo con los nombres, los documentos y las notas de sus
 * estudiantes nunca viaja a ningún servidor, porque no hay servidor. La
 * aplicación se exporta estática (`next.config.ts`).
 *
 * El componente no decide nada sobre las notas: llama al caso de uso y muestra
 * lo que devuelve. Toda la política vive en `src/dominio`.
 *
 * Criterio de redacción (§5.0): los docentes se pierden con exceso de texto.
 * Cada estado muestra una o dos frases; el diff completo, los sobrantes y el
 * reporte viven en secciones plegadas que nadie tiene que abrir para terminar
 * su trabajo.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import alias from "@/config/alias_columnas.json";
import esquema from "@/config/schema_banner.json";
import valoresNoNumericos from "@/config/valores_no_numericos.json";

import {
  type Dependencias,
  type ResultadoCompleto,
  formatearNotas,
} from "@aplicacion/formatear-notas.ts";
import type { ArchivoEntrante } from "@aplicacion/puertos.ts";
import { CatalogoAlias } from "@dominio/mapeo.ts";
import { ConfigValores } from "@dominio/valores.ts";
import { LectorXlsx } from "@adaptadores/salida/lectura-xlsx.ts";
import { PlantillaZip } from "@adaptadores/salida/plantilla-zip.ts";
import { ConfiguracionJson } from "@adaptadores/salida/configuracion-json.ts";

import { ZonaDeCarga } from "./ZonaDeCarga.tsx";
import { ConfirmarColumna } from "./ConfirmarColumna.tsx";
import { Diff } from "./Diff.tsx";
import { GuiaDeCargue } from "./GuiaDeCargue.tsx";
import { Pendientes } from "./Pendientes.tsx";

function construirDependencias(): Dependencias {
  const catalogo = CatalogoAlias.desdeObjeto(alias);
  return {
    lector: new LectorXlsx(catalogo),
    plantillas: new PlantillaZip(),
    config: new ConfiguracionJson({ alias, valores: valoresNoNumericos, esquema }),
  };
}

export function Formateador() {
  const deps = useMemo(construirDependencias, []);

  const [archivos, setArchivos] = useState<ArchivoEntrante[]>([]);
  const [resultado, setResultado] = useState<ResultadoCompleto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  /** Lo que el docente ya confirmó. Sin esto no se genera nada (§4.0). */
  const [columnaConfirmada, setColumnaConfirmada] = useState<number | null>(null);
  const [decisiones, setDecisiones] = useState<ConfigValores | undefined>();

  const ultimaPeticion = useRef(0);

  const procesar = useCallback(
    async (
      entrantes: readonly ArchivoEntrante[],
      columna: number | null,
      config: ConfigValores | undefined,
    ) => {
      const marca = ++ultimaPeticion.current;
      setTrabajando(true);
      setError(null);
      try {
        const r = await formatearNotas(deps, {
          archivos: entrantes,
          ...(columna !== null ? { columnaNotaConfirmada: columna } : {}),
          ...(config ? { config } : {}),
        });
        // Si el docente subió otro archivo mientras este se procesaba, el
        // resultado viejo no debe pisar al nuevo.
        if (marca === ultimaPeticion.current) setResultado(r);
      } catch (e) {
        if (marca === ultimaPeticion.current) {
          setResultado(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (marca === ultimaPeticion.current) setTrabajando(false);
      }
    },
    [deps],
  );

  const recibir = useCallback(
    (nuevos: ArchivoEntrante[]) => {
      // Cada archivo nuevo reinicia las confirmaciones: la columna que el
      // docente aprobó era la de otro archivo.
      setArchivos(nuevos);
      setColumnaConfirmada(null);
      setDecisiones(undefined);
      void procesar(nuevos, null, undefined);
    },
    [procesar],
  );

  const confirmarColumna = useCallback(
    (indice: number) => {
      setColumnaConfirmada(indice);
      void procesar(archivos, indice, decisiones);
    },
    [archivos, decisiones, procesar],
  );

  const decidir = useCallback(
    (config: ConfigValores) => {
      setDecisiones(config);
      void procesar(archivos, columnaConfirmada, config);
    },
    [archivos, columnaConfirmada, procesar],
  );

  const empezarDeCero = useCallback(() => {
    ultimaPeticion.current++;
    setArchivos([]);
    setResultado(null);
    setError(null);
    setColumnaConfirmada(null);
    setDecisiones(undefined);
  }, []);

  const descargar = useCallback(() => {
    if (!resultado?.archivo) return;
    // El archivo se arma en memoria y se entrega desde el propio navegador.
    const blob = new Blob([resultado.archivo.bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = resultado.archivo.nombre;
    enlace.click();
    URL.revokeObjectURL(url);
  }, [resultado]);

  return (
    <>
      <section className="tarjeta">
        <ZonaDeCarga onArchivos={recibir} cargando={trabajando} archivos={archivos} />

        <p className="alerta info">
          El procesamiento ocurre <strong>en tu navegador</strong>. Tu archivo de
          notas no se envía a ningún servidor.
        </p>

        {error !== null && (
          <div className="alerta error">
            <strong>No pude continuar.</strong> {error}
          </div>
        )}
      </section>

      {resultado !== null && (
        <>
          {resultado.confirmacionPendiente !== null ? (
            <ConfirmarColumna
              texto={resultado.confirmacionPendiente}
              encabezados={resultado.analisis.tabla.encabezados}
              tabla={resultado.analisis.tabla}
              sugerida={resultado.analisis.indiceNota}
              onConfirmar={confirmarColumna}
            />
          ) : (
            <>
              <Pendientes resultado={resultado} onDecidir={decidir} />
              <Diff resultado={resultado} />

              {resultado.archivo !== null && (
                <section className="tarjeta">
                  <h2>Tu archivo está listo</h2>
                  <p className="alerta exito">
                    Las {resultado.reporte.resumen.listas_para_cargar} notas del
                    curso quedaron en el archivo que Banner espera.
                  </p>
                  <div className="acciones">
                    <button type="button" className="boton" onClick={descargar}>
                      Descargar {resultado.archivo.nombre}
                    </button>
                    <button
                      type="button"
                      className="boton secundario"
                      onClick={empezarDeCero}
                    >
                      Empezar de nuevo
                    </button>
                  </div>
                </section>
              )}

              <GuiaDeCargue listo={resultado.archivo !== null} />
            </>
          )}
        </>
      )}
    </>
  );
}
