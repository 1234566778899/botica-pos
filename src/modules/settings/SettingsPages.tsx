import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Store, Tags, Trash2, Truck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useBusiness } from "@/components/layout/AppFrame";
import { Badge, Banner, Button, Card, CardHeader, Modal, Page, Select, TextArea, TextField, useToast } from "@/components/ui";
import { formatDate, fullName } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";
import type { Business, Category, Staff, Supplier } from "@/lib/types";
import { useStaff } from "@/modules/auth/AuthProvider";
import { useCategories } from "@/modules/pos/api";
import { useSuppliers } from "@/modules/inventory/api";

export function BusinessSettingsPage() {
  const { data } = useBusiness();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Business | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  const save = useMutation({
    mutationFn: async (b: Business) => unwrap(await supabase.from("business").update({
      name: b.name, ruc: b.ruc || null, address: b.address || null, phone: b.phone || null, ticket_footer: b.ticket_footer || null,
      igv_rate: Number(b.igv_rate), expiry_warning_days: Number(b.expiry_warning_days),
    }).eq("id", true).select().single()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["business"] }); toast("Datos guardados"); },
    onError: (e) => toast(e.message, { error: true }),
  });
  if (!f) return <Page icon={Store} title="Botica"><div /></Page>;
  const field = (k: keyof Business) => ({ value: (f[k] as string | number | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Page icon={Store} title="Botica" width="narrow" actions={<Button variant="primary" loading={save.isPending} onClick={() => save.mutate(f)}>Guardar</Button>}>
      <Card>
        <CardHeader title="Datos del negocio" description="Aparecen en el ticket de venta." />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nombre" className="sm:col-span-2" {...field("name")} />
          <TextField label="RUC" {...field("ruc")} />
          <TextField label="Teléfono" {...field("phone")} />
          <TextField label="Dirección" className="sm:col-span-2" {...field("address")} />
          <TextArea label="Mensaje al pie del ticket" className="sm:col-span-2" rows={2} {...field("ticket_footer")} />
        </div>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Parámetros" />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="IGV (%)" type="number" min="0" step="0.01" {...field("igv_rate")} help="Los precios incluyen IGV." />
          <TextField label="Aviso de vencimiento (días)" type="number" min="7" {...field("expiry_warning_days")} help="Un lote se marca “por vencer” con esta anticipación." />
        </div>
      </Card>
    </Page>
  );
}

export function UsersSettingsPage() {
  const me = useStaff();
  const qc = useQueryClient();
  const toast = useToast();
  const { data = [], isLoading } = useQuery({ queryKey: ["staff"], queryFn: async () => unwrap(await supabase.from("staff").select("*").order("created_at")) as Staff[] });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Staff> }) => unwrap(await supabase.from("staff").update(patch).eq("user_id", id).select().single()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff"] }); toast("Usuario actualizado"); },
    onError: (e) => toast(e.message, { error: true }),
  });
  const pending = data.filter((s) => !s.is_active);
  return (
    <Page icon={Users} title="Usuarios" width="narrow">
      <Banner tone="info">Para agregar a alguien: que cree su cuenta en la pantalla de inicio de sesión (“Crear cuenta”) y pida acceso. Luego apruébala aquí.</Banner>
      {pending.length > 0 && <p className="mt-4 mb-2 px-1 text-[14px] font-[650]">Pendientes de aprobación ({pending.length})</p>}
      <Card padded={false} className="mt-4">
        {isLoading ? <p className="p-4 text-ink-secondary">Cargando…</p> : (
          <ul className="divide-y divide-border">
            {data.map((s) => {
              const self = s.user_id === me.user_id;
              return (
                <li key={s.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid size-9 place-items-center rounded-[10px] bg-surface-pressed text-[12px] font-[650]">{(fullName(s.first_name, s.last_name) || s.email).slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-[550]">{fullName(s.first_name, s.last_name) || "Sin nombre"} {self && <span className="text-ink-tertiary">(tú)</span>}</p>
                    <p className="text-[12px] text-ink-secondary">{s.email} · desde {formatDate(s.created_at)}</p>
                  </div>
                  {s.is_active ? <Badge tone="success">Activo</Badge> : <Badge tone="warning">Pendiente</Badge>}
                  <Select hideLabel label="Rol" value={s.role} disabled={self} className="w-36"
                    onChange={(e) => update.mutate({ id: s.user_id, patch: { role: e.target.value as Staff["role"] } })}
                    options={[{ value: "cajero", label: "Cajero" }, { value: "admin", label: "Administrador" }]} />
                  {!self && (s.is_active
                    ? <Button onClick={() => update.mutate({ id: s.user_id, patch: { is_active: false } })}>Desactivar</Button>
                    : <Button variant="primary" onClick={() => update.mutate({ id: s.user_id, patch: { is_active: true } })}>Aprobar</Button>)}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="mt-3 px-1 text-[12px] text-ink-secondary">El cajero vende, ve el historial de ventas, maneja su caja y registra ingresos. El administrador además ve el panel y la utilidad, edita productos, anula ventas y ajusta el stock.</p>
    </Page>
  );
}

export function CategoriesSettingsPage() {
  const { data = [] } = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const save = useMutation({
    mutationFn: async (c: Partial<Category>) => {
      const row = { name: c.name?.trim(), color: c.color ?? "#5c6ac4", rank: c.rank ?? data.length + 1 };
      return unwrap(c.id ? await supabase.from("category").update(row).eq("id", c.id).select().single() : await supabase.from("category").insert(row).select().single());
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); qc.invalidateQueries({ queryKey: ["products"] }); setEditing(null); toast("Categoría guardada"); },
    onError: (e) => toast(e.message, { error: true }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from("category").delete().eq("id", id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast("Categoría eliminada"); },
    onError: (e) => toast(e.message, { error: true }),
  });
  return (
    <Page icon={Tags} title="Categorías" width="narrow" actions={<Button variant="primary" icon={Plus} onClick={() => setEditing({ color: "#5c6ac4" })}>Nueva categoría</Button>}>
      <Card padded={false}>
        <ul className="divide-y divide-border">
          {data.map((c) => (
            <li key={c.id} className="group flex items-center gap-3 px-4 py-2.5">
              <span className="size-3 rounded-full" style={{ background: c.color }} />
              <button type="button" onClick={() => setEditing(c)} className="flex-1 text-left font-[550] hover:underline">{c.name}</button>
              <Button variant="plain" size="icon" icon={Trash2} onClick={() => remove.mutate(c.id)}>Eliminar</Button>
            </li>
          ))}
        </ul>
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? "Editar categoría" : "Nueva categoría"} size="sm"
        primaryAction={{ label: "Guardar", loading: save.isPending, disabled: !editing?.name?.trim(), onClick: () => editing && save.mutate(editing) }}>
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <TextField label="Nombre" value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <label className="text-[13px] font-medium">Color<input type="color" value={editing?.color ?? "#5c6ac4"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="mt-1 block h-[30px] w-full rounded-[10px]" /></label>
        </div>
      </Modal>
    </Page>
  );
}

export function SuppliersSettingsPage() {
  const { data = [] } = useSuppliers();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const save = useMutation({
    mutationFn: async (s: Partial<Supplier>) => {
      const row = { name: s.name?.trim(), ruc: s.ruc || null, phone: s.phone || null, contact: s.contact || null };
      return unwrap(s.id ? await supabase.from("supplier").update(row).eq("id", s.id).select().single() : await supabase.from("supplier").insert(row).select().single());
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); setEditing(null); toast("Proveedor guardado"); },
    onError: (e) => toast(e.message, { error: true }),
  });
  const f = (k: keyof Supplier) => ({ value: (editing?.[k] as string | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, [k]: e.target.value }) });
  return (
    <Page icon={Truck} title="Proveedores" width="narrow" actions={<Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Nuevo proveedor</Button>}>
      <Card padded={false}>
        {data.length === 0 ? <p className="p-4 text-ink-secondary">Aún no hay proveedores.</p> : (
          <ul className="divide-y divide-border">
            {data.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setEditing(s)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-muted">
                  <span className="flex-1"><span className="block font-[550]">{s.name}</span><span className="text-[12px] text-ink-secondary">{[s.ruc && `RUC ${s.ruc}`, s.contact, s.phone].filter(Boolean).join(" · ")}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? "Editar proveedor" : "Nuevo proveedor"}
        primaryAction={{ label: "Guardar", loading: save.isPending, disabled: !editing?.name?.trim(), onClick: () => editing && save.mutate(editing) }}>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Razón social" className="col-span-2" {...f("name")} />
          <TextField label="RUC" {...f("ruc")} />
          <TextField label="Teléfono" {...f("phone")} />
          <TextField label="Contacto" className="col-span-2" {...f("contact")} />
        </div>
      </Modal>
    </Page>
  );
}
