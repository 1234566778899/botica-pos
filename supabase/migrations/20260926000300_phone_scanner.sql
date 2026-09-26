-- =============================================================================
-- El celular como escáner inalámbrico de la web (Supabase Realtime)
--
-- La app Android y la web abren el mismo canal privado "scanner:<user_id>" (misma
-- cuenta en los dos). El celular transmite cada código escaneado (evento "scan"),
-- la web lo agrega a la venta y responde (evento "ack"). Presence dice a cada lado
-- si el otro está conectado.
--
-- Canales privados: Realtime revisa estas políticas sobre realtime.messages. Cada
-- usuario del personal solo puede escuchar y escribir en SU canal, así nadie puede
-- mandar códigos a la venta de otro.
-- =============================================================================
create policy scanner_channel_read on realtime.messages for select to authenticated
  using (realtime.topic() = 'scanner:' || auth.uid()::text and internal.is_staff());

create policy scanner_channel_write on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'scanner:' || auth.uid()::text and internal.is_staff());
