import { Formateador } from "@adaptadores/entrada/web/Formateador.tsx";

/**
 * La única página. Todo el trabajo ocurre en el componente cliente: es lo que
 * hace que el archivo de notas nunca viaje a ningún servidor.
 */
export default function Pagina() {
  return (
    <main className="pagina">
      <header className="cabecera">
        <h1>Formateador de notas para Banner</h1>
        <p>Universidad Tecnológica de Bolívar</p>
      </header>
      <Formateador />
    </main>
  );
}
