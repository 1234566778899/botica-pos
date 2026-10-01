import { SearchX } from "lucide-react";
import { Button } from "./Button";
import { EmptyState } from "./Feedback";
import { Page } from "./Page";

/**
 * "No encontrado" con un botón para volver. Sin `back` es la página 404 general (ruta desconocida);
 * con `back` es el detalle de algo que no existe o se eliminó (venta, producto, cliente).
 */
export function NotFound({ title = "Página no encontrada", description, back }: {
  title?: string;
  description?: string;
  back?: { label: string; to: string };
}) {
  const action = <Button variant="primary" to={back?.to ?? "/"}>{back ? `Volver a ${back.label}` : "Ir al inicio"}</Button>;
  const empty = (
    <EmptyState icon={SearchX} title={title} action={action}
      description={description ?? (back ? "Puede que se haya eliminado o que el enlace esté incompleto." : "Revisa la dirección o vuelve al inicio.")} />
  );
  return back ? <Page title={title} breadcrumbs={[back]}>{empty}</Page> : empty;
}
