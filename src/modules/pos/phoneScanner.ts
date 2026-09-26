import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type PhoneScanResult = { ok: boolean; text: string };

/**
 * El celular como escáner inalámbrico: la app Android (con la misma cuenta) transmite cada
 * código por el canal privado "scanner:<user_id>" y aquí se agrega a la venta. La respuesta
 * (ack) le dice al celular si se agregó. Ver supabase/migrations/20260926000300_phone_scanner.sql.
 *
 * Devuelve si hay un celular conectado en modo escáner.
 */
export function usePhoneScanner(userId: string | undefined, onScan: (code: string) => PhoneScanResult) {
  const [phoneConnected, setPhoneConnected] = useState(false);
  const handler = useRef(onScan);
  useEffect(() => { handler.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!userId) return;
    let channel: RealtimeChannel | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = async (attempt = 0) => {
      await supabase.realtime.setAuth(); // canal privado: Realtime valida el token contra las políticas
      if (closed) return;
      channel = supabase.channel(`scanner:${userId}`, { config: { private: true, presence: { key: `web-${crypto.randomUUID()}` } } });
      channel
        .on("broadcast", { event: "scan" }, ({ payload }) => {
          const { id, code } = payload as { id: string; code: string };
          const result = handler.current(String(code ?? "").trim());
          channel?.send({ type: "broadcast", event: "ack", payload: { id, ...result } });
        })
        .on("presence", { event: "sync" }, () => {
          setPhoneConnected(Object.keys(channel?.presenceState() ?? {}).some((k) => k.startsWith("android")));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") channel?.track({ device: "web", at: Date.now() });
          // El primer uso del día puede fallar mientras Realtime prepara su tabla: reintenta.
          if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !closed) {
            setPhoneConnected(false);
            const old = channel;
            channel = null;
            if (old) supabase.removeChannel(old);
            retry = setTimeout(() => connect(attempt + 1), Math.min(30_000, 1_000 * 2 ** attempt));
          }
        });
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      setPhoneConnected(false);
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  return phoneConnected;
}
