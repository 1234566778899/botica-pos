import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Staff } from "@/lib/types";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  /** Sesión iniciada pero sin acceso activo: aún no hay dueño, pidió acceso o espera aprobación. */
  | { status: "no-access"; session: Session; hasOwner: boolean; staff: Staff | null }
  | { status: "active"; session: Session; staff: Staff };

type AuthContextValue = {
  state: AuthState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function resolveAccess(session: Session): Promise<AuthState> {
  const current = await supabase.rpc("current_staff");
  if (current.error) return { status: "error", message: current.error.message };
  const staff = (current.data as Staff | null)?.user_id ? (current.data as Staff) : null;
  if (staff?.is_active) return { status: "active", session, staff };
  const owner = await supabase.rpc("has_owner");
  if (owner.error) return { status: "error", message: owner.error.message };
  return { status: "no-access", session, hasOwner: Boolean(owner.data), staff };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const load = useCallback(async (session: Session | null) => {
    setState(session ? await resolveAccess(session) : { status: "signed-out" });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase recomienda no llamar a la API dentro de este callback (bloquea el lock de auth).
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") setTimeout(() => void load(session), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value: AuthContextValue = {
    state,
    refresh: async () => load((await supabase.auth.getSession()).data.session),
    signOut: async () => {
      await supabase.auth.signOut();
      setState({ status: "signed-out" });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}

/** Usuario activo (solo dentro de la app, ya validada por AccessGate). */
export function useStaff() {
  const { state } = useAuth();
  if (state.status !== "active") throw new Error("Se requiere una sesión activa");
  return state.staff;
}

export const useIsAdmin = () => useStaff().role === "admin";
