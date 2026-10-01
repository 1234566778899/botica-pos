import { useEffect, useRef, useState } from "react";
import { Modal, Select, Spinner, TextArea, TextField, cn, useToast } from "@/components/ui";
import type { Customer, DocType } from "@/lib/types";
import { docTypeLabels, lookupDocName, useSaveCustomer, validateCustomer, type CustomerInput } from "./api";

const docTypes = (Object.keys(docTypeLabels) as DocType[]).map((v) => ({ value: v, label: docTypeLabels[v] }));

type Lookup = { doc: string; state: "loading" | "found" | "missing" | "error"; message?: string };

/**
 * Datos del cliente. Con un DNI o RUC completo busca el nombre (customer-lookup) y lo
 * escribe si el nombre está vacío o lo había puesto la búsqueda anterior.
 */
export function CustomerFields({ value, onChange, errors = {}, autoFocus }: {
  value: CustomerInput;
  onChange: (c: CustomerInput) => void;
  errors?: Partial<Record<keyof CustomerInput, string>>;
  autoFocus?: "doc_number" | "name";
}) {
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const autoName = useRef("");
  // La búsqueda termina después: usa el formulario y el onChange de ese momento.
  const latest = useRef({ value, onChange });
  useEffect(() => { latest.current = { value, onChange }; });

  const doc = value.doc_number;
  const searchable = (value.doc_type === "DNI" && /^\d{8}$/.test(doc)) || (value.doc_type === "RUC" && /^\d{11}$/.test(doc));
  useEffect(() => {
    if (!searchable) return;
    let alive = true;
    const t = setTimeout(() => {
      // Ya tiene un nombre escrito (p. ej. al abrir un cliente registrado): no hace falta buscar.
      const current = latest.current.value.name.trim();
      if (current && current !== autoName.current) return;
      setLookup({ doc, state: "loading" });
      lookupDocName(doc).then(
        (name) => {
          if (!alive) return;
          if (!name) return setLookup({ doc, state: "missing" });
          setLookup({ doc, state: "found" });
          const { value: c, onChange: update } = latest.current;
          const previous = autoName.current;
          autoName.current = name;
          if (c.doc_number === doc && (!c.name.trim() || c.name === previous)) update({ ...c, name });
        },
        (e: Error) => alive && setLookup({ doc, state: "error", message: e.message }),
      );
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [doc, searchable]);

  const set = (k: keyof CustomerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  const onDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase();
    const next = value.doc_type === "DNI" || value.doc_type === "RUC" ? raw.replace(/\D/g, "").slice(0, value.doc_type === "DNI" ? 8 : 11) : raw.replace(/[^A-Z0-9]/g, "").slice(0, 15);
    // Otro documento: el nombre que puso la búsqueda ya no corresponde (uno escrito a mano se respeta).
    onChange({ ...value, doc_number: next, name: next !== doc && value.name === autoName.current ? "" : value.name });
  };
  const onType = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const t = e.target.value as DocType;
    onChange({ ...value, doc_type: t, doc_number: t === "DNI" || t === "RUC" ? value.doc_number.replace(/\D/g, "") : value.doc_number });
  };

  const hint = lookup && lookup.doc === doc && searchable && lookup.state !== "found" ? lookup : null;
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <Select label="Documento" options={docTypes} value={value.doc_type} onChange={onType} />
      <TextField label="Número" value={doc} onChange={onDoc} error={errors.doc_number} autoFocus={autoFocus === "doc_number"}
        inputMode={value.doc_type === "DNI" || value.doc_type === "RUC" ? "numeric" : "text"} placeholder={value.doc_type === "RUC" ? "11 dígitos" : value.doc_type === "DNI" ? "8 dígitos" : ""} />
      <div className="sm:col-span-2">
        <TextField label={value.doc_type === "RUC" ? "Razón social" : "Nombre completo"} value={value.name} onChange={set("name")} error={errors.name} autoFocus={autoFocus === "name"} />
        {hint && (
          <p className={cn("mt-1 flex items-center gap-1.5 text-[12px]", hint.state === "loading" ? "text-ink-secondary" : "text-warning")}>
            {hint.state === "loading" && <><Spinner className="size-3.5" /> Buscando el nombre…</>}
            {hint.state === "missing" && `No se encontró ese ${value.doc_type}: escribe el nombre.`}
            {hint.state === "error" && `No se pudo buscar el nombre (${hint.message}). Escríbelo.`}
          </p>
        )}
      </div>
      <TextField label="Teléfono / celular" type="tel" inputMode="tel" value={value.phone} onChange={set("phone")} error={errors.phone} placeholder="Opcional" />
      <TextField label="Correo" type="email" value={value.email} onChange={set("email")} error={errors.email} placeholder="Opcional" />
      <TextField label="Dirección" className="sm:col-span-2" value={value.address} onChange={set("address")} placeholder="Opcional (para facturas con RUC)" />
      <TextArea label="Notas" className="sm:col-span-2" rows={2} value={value.note} onChange={set("note")}
        help="Por ejemplo, cómo prefiere que lo contacten. No anotes datos de salud (diagnósticos, tratamientos)." />
    </div>
  );
}

/** Registrar o editar un cliente en una ventana (desde la venta o desde la lista). */
export function CustomerModal({ initial, onClose, onSaved }: { initial: CustomerInput; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const save = useSaveCustomer();
  const toast = useToast();
  const errors = touched ? validateCustomer(value) : {};
  const submit = () => {
    setTouched(true);
    if (Object.keys(validateCustomer(value)).length) return;
    save.mutate(value, {
      onSuccess: (c) => { toast(initial.id ? "Cliente actualizado" : "Cliente registrado"); onSaved(c); },
      onError: (e) => toast(e.message, { error: true }),
    });
  };
  return (
    <Modal open onClose={onClose} title={initial.id ? "Editar cliente" : "Nuevo cliente"}
      primaryAction={{ label: initial.id ? "Guardar" : "Registrar cliente", loading: save.isPending, onClick: submit }}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <CustomerFields value={value} onChange={setValue} errors={errors} autoFocus={initial.doc_number ? "name" : "doc_number"} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
