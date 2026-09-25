import { Clock } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Spinner, TextField } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { supabase, translateError } from "@/lib/supabase";
import { AuthScreen } from "./AuthScreen";
import { useAuth } from "./AuthProvider";
import { LoginPage } from "./LoginPage";

function SetupScreen() {
  return (
    <AuthScreen>
      <h1 className="text-[20px] font-[650]">Conecta tu proyecto de Supabase</h1>
      <p className="mt-2 text-ink-secondary">La app necesita las credenciales del proyecto para funcionar.</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-ink">
        <li>Aplica las migraciones y el seed de <code className="rounded bg-surface-muted px-1">supabase/</code>.</li>
        <li>Copia la <strong>URL</strong> y la <strong>publishable key</strong> en <code className="rounded bg-surface-muted px-1">.env.local</code>.</li>
        <li>Reinicia <code className="rounded bg-surface-muted px-1">npm run dev</code>.</li>
      </ol>
    </AuthScreen>
  );
}

/** Nombre y apellido: se usa para configurar la botica o para pedir acceso. */
function NameForm({ title, description, submitLabel, withBusiness, rpc }: {
  title: string; description: string; submitLabel: string; withBusiness?: boolean; rpc: "bootstrap_owner" | "request_access";
}) {
  const { refresh, signOut } = useAuth();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [business, setBusiness] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthScreen>
      <h1 className="text-[20px] font-[650]">{title}</h1>
      <p className="mt-1 text-ink-secondary">{description}</p>
      <form
        className="mt-5 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          const args = withBusiness ? { p_first_name: first, p_last_name: last, p_business_name: business } : { p_first_name: first, p_last_name: last };
          const { error } = await supabase.rpc(rpc, args);
          setLoading(false);
          if (error) setError(translateError(error.message));
          else await refresh();
        }}
      >
        {withBusiness && <TextField label="Nombre de la botica" placeholder="Botica Vida Sana" value={business} onChange={(e) => setBusiness(e.target.value)} help="Aparece en los tickets. Puedes cambiarlo después." />}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Tu nombre" required value={first} onChange={(e) => setFirst(e.target.value)} />
          <TextField label="Apellido" value={last} onChange={(e) => setLast(e.target.value)} />
        </div>
        {error && <Banner tone="critical">{error}</Banner>}
        <Button type="submit" variant="primary" size="md" loading={loading} className="w-full justify-center">{submitLabel}</Button>
      </form>
      <button type="button" onClick={signOut} className="mt-4 text-[12px] text-brand hover:underline">Usar otra cuenta</button>
    </AuthScreen>
  );
}

function Pending({ email }: { email?: string }) {
  const { refresh, signOut } = useAuth();
  return (
    <AuthScreen>
      <Clock className="size-8 text-warning" strokeWidth={1.6} />
      <h1 className="mt-3 text-[20px] font-[650]">Esperando aprobación</h1>
      <p className="mt-1 text-ink-secondary">
        Tu cuenta {email} ya pidió acceso. Un administrador debe activarla en <strong>Configuración → Usuarios</strong>.
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" size="md" onClick={refresh} className="flex-1 justify-center">Ya me aprobaron</Button>
        <Button size="md" onClick={signOut}>Cerrar sesión</Button>
      </div>
    </AuthScreen>
  );
}

function ConnectionError({ message }: { message: string }) {
  const { refresh, signOut } = useAuth();
  return (
    <AuthScreen>
      <h1 className="text-[20px] font-[650]">No se pudo conectar</h1>
      <p className="mt-1 mb-3 text-ink-secondary">No pudimos comunicarnos con el servidor.</p>
      <Banner tone="critical">{translateError(message)}</Banner>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" size="md" onClick={refresh} className="flex-1 justify-center">Reintentar</Button>
        <Button size="md" onClick={signOut}>Cerrar sesión</Button>
      </div>
    </AuthScreen>
  );
}

/** Decide qué mostrar según la sesión antes de entrar a la app. */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (!isSupabaseConfigured) return <SetupScreen />;
  if (state.status === "loading") return <div className="grid h-full place-items-center bg-surface-muted"><Spinner /></div>;
  if (state.status === "signed-out") return <LoginPage />;
  if (state.status === "error") return <ConnectionError message={state.message} />;
  if (state.status === "no-access") {
    const email = state.session.user.email;
    if (!state.hasOwner)
      return <NameForm rpc="bootstrap_owner" withBusiness title="Configura tu botica" submitLabel="Empezar"
        description={`Aún no hay administradores. Quedarás como administrador con la cuenta ${email}.`} />;
    if (!state.staff)
      return <NameForm rpc="request_access" title="Pide acceso" submitLabel="Solicitar acceso"
        description="Tu cuenta aún no tiene acceso a la botica. Envía tu nombre y un administrador te aprobará." />;
    return <Pending email={email} />;
  }
  return <>{children}</>;
}
