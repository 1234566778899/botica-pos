import { useState } from "react";
import { Banner, Button, TextField } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { AuthScreen } from "./AuthScreen";

type Mode = "sign-in" | "sign-up" | "reset";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const res =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : mode === "sign-up"
          ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
          : await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setLoading(false);
    if (res.error) {
      setError(/Invalid login/i.test(res.error.message) ? "Correo o contraseña incorrectos." : /confirm/i.test(res.error.message) ? "Confirma tu correo antes de ingresar (revisa tu bandeja)." : res.error.message);
      return;
    }
    if (mode === "sign-up" && !(res.data as { session?: unknown } | null)?.session) setNotice("Te enviamos un correo para confirmar tu cuenta. Después inicia sesión.");
    if (mode === "reset") setNotice("Si el correo existe, recibirás un enlace para cambiar tu contraseña.");
  };

  return (
    <AuthScreen>
      <h1 className="text-[20px] font-[650]">{mode === "sign-in" ? "Iniciar sesión" : mode === "sign-up" ? "Crear cuenta" : "Recuperar contraseña"}</h1>
      <p className="mt-1 text-ink-secondary">
        {mode === "sign-up" ? "Después de crearla, el administrador debe aprobar tu acceso." : "Ingresa con tu cuenta del personal de la botica."}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <TextField label="Correo electrónico" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== "reset" && (
          <TextField
            label="Contraseña"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            minLength={mode === "sign-up" ? 8 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {error && <Banner tone="critical">{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}
        <Button type="submit" variant="primary" size="md" loading={loading} className="w-full justify-center">
          {mode === "sign-in" ? "Iniciar sesión" : mode === "sign-up" ? "Crear cuenta" : "Enviar enlace"}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-[12px]">
        {mode === "sign-in" ? (
          <>
            <button type="button" className="text-brand hover:underline" onClick={() => setMode("reset")}>¿Olvidaste tu contraseña?</button>
            <button type="button" className="text-brand hover:underline" onClick={() => setMode("sign-up")}>Crear cuenta</button>
          </>
        ) : (
          <button type="button" className="text-brand hover:underline" onClick={() => setMode("sign-in")}>Volver a iniciar sesión</button>
        )}
      </div>
    </AuthScreen>
  );
}
