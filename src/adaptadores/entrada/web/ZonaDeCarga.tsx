"use client";

/**
 * Una sola zona de carga (§5.0).
 *
 * El docente suelta uno o dos archivos en el mismo sitio y la herramienta los
 * ordena. No hay un formulario que aparece después de otro, ni un "segundo
 * paso" que dé la sensación de trabajo doble: quién es la plantilla y quién el
 * archivo de notas lo decide `esPlantillaBanner`, no una pregunta.
 */

import { useCallback, useRef, useState } from "react";

import type { ArchivoEntrante } from "@aplicacion/puertos.ts";

const ENLACE_BANNER = "https://ssbprod.utb.edu.co:8443/ssomanager/c/SSB";

export interface Props {
  readonly onArchivos: (archivos: ArchivoEntrante[]) => void;
  readonly cargando: boolean;
  readonly archivos: readonly ArchivoEntrante[];
}

async function aEntrante(archivo: File): Promise<ArchivoEntrante> {
  return { nombre: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) };
}

export function ZonaDeCarga({ onArchivos, cargando, archivos }: Props) {
  const [encima, setEncima] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const recibir = useCallback(
    async (lista: FileList | null) => {
      if (!lista || lista.length === 0) return;
      onArchivos(await Promise.all(Array.from(lista, aEntrante)));
    },
    [onArchivos],
  );

  return (
    <>
      <div
        className={`zona${encima ? " encima" : ""}`}
        onClick={() => entrada.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          void recibir(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") entrada.current?.click();
        }}
      >
        <input
          ref={entrada}
          type="file"
          multiple
          accept=".xlsx,.xlsm,.csv,.txt"
          onChange={(e) => void recibir(e.target.files)}
        />
        {cargando ? (
          <strong>Procesando…</strong>
        ) : (
          <>
            <strong>Suelta aquí tus archivos, o haz clic para buscarlos</strong>
            <span>
              La plantilla que descargaste de Banner y, si las notas están en tu
              propio Excel, ese archivo también. Admite .xlsx, .xlsm, .csv y .txt
            </span>
          </>
        )}
      </div>

      {archivos.length > 0 && (
        <ul className="resumen" style={{ marginTop: "1rem" }}>
          {archivos.map((a) => (
            <li key={a.nombre}>
              <b style={{ fontSize: "0.95rem" }}>{a.nombre}</b>
              {(a.bytes.length / 1024).toFixed(0)} KB
            </li>
          ))}
        </ul>
      )}

      <details>
        <summary>¿De dónde saco la plantilla del curso?</summary>
        <ol className="pasos">
          <li>
            Entra a{" "}
            <a href={ENLACE_BANNER} target="_blank" rel="noreferrer">
              Banner
            </a>{" "}
            con tu usuario de docente.
          </li>
          <li>Abre el curso en Faculty Grade Entry.</li>
          <li>
            Usa la opción de exportar la plantilla. Descarga el archivo{" "}
            <strong>sin modificarlo</strong> y súbelo aquí.
          </li>
        </ol>
        <p className="alerta aviso">
          Si tus notas están en un Excel propio, no hace falta que las copies a
          la plantilla. Sube los dos archivos y la herramienta empareja cada nota
          con su estudiante por el documento, no por la posición en la lista.
        </p>
      </details>
    </>
  );
}
