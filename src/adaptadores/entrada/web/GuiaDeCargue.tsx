"use client";

/**
 * La guía de cargue de §5.1 — la parte que cierra el ciclo.
 *
 * «La herramienta no termina cuando entrega el archivo: termina cuando el
 * profesor logró subirlo.»
 *
 * ESTADO: los pasos son los que se pueden afirmar hoy con lo que sabemos de
 * Banner 9 Faculty Grade Entry. **Los pasos exactos y las capturas están
 * pendientes de la Fase 1**, cuando alguien con acceso de docente recorra la
 * pantalla de cargue real. Hasta entonces esto orienta, y lo dice.
 */

const ENLACE_BANNER = "https://ssbprod.utb.edu.co:8443/ssomanager/c/SSB";

export interface Props {
  readonly listo: boolean;
}

export function GuiaDeCargue({ listo }: Props) {
  return (
    <section className="tarjeta">
      <h2>Cómo subirlo a Banner</h2>

      {!listo && (
        <p className="alerta aviso">
          Todavía no hay archivo que subir: primero hay que resolver lo que
          quedó pendiente arriba.
        </p>
      )}

      <ol className="pasos">
        <li>
          Entra a{" "}
          <a href={ENLACE_BANNER} target="_blank" rel="noreferrer">
            Banner
          </a>{" "}
          con tu usuario y abre el curso en Faculty Grade Entry.
        </li>
        <li>
          Busca la opción de importar o cargar notas y selecciona el archivo que
          acabas de descargar.
        </li>
        <li>
          <strong>No lo abras en Excel antes de subirlo.</strong> Si lo abres y
          lo vuelves a guardar, Excel puede cambiar el punto decimal por una
          coma según la configuración regional, y Banner rechaza el archivo.
        </li>
        <li>Revisa la vista previa que muestra Banner y confirma el cargue.</li>
      </ol>

      <details>
        <summary>¿Y si Banner lo rechaza?</summary>
        <p style={{ fontSize: "0.92rem" }}>
          Anota el mensaje de error tal como aparece —completo, sin resumirlo— y
          hazlo llegar junto con el archivo que intentaste subir. Cada rechazo
          es información: es lo que dice qué hay que ajustar.
        </p>
        <p className="alerta info">
          <strong>Nota honesta:</strong> todavía no se ha comprobado que Banner
          acepte un archivo generado por esta herramienta. La estructura
          coincide con la plantilla oficial y el contenedor se conserva casi
          intacto, pero el cargue real está pendiente de probarse. Si eres de
          los primeros en usarla, tu resultado —salga bien o mal— es el dato que
          falta.
        </p>
      </details>
    </section>
  );
}
