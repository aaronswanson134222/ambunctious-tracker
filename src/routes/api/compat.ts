import { createFileRoute } from '@tanstack/react-router';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export const Route = createFileRoute('/api/compat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch (err) {
          return json({ error: 'Invalid JSON' }, 400);
        }

        const { action, table, payload } = body;
        if (!action || !table) return json({ error: 'Missing action or table' }, 400);

        try {
          switch (action) {
            case 'insert': {
              const res = await supabaseAdmin.from(table).insert(payload);
              return json(res);
            }
            case 'select': {
              const cols = payload?.columns || '*';
              const res = await supabaseAdmin.from(table).select(cols);
              return json(res);
            }
            case 'delete': {
              if (!payload?.col || payload.value === undefined) return json({ error: 'Invalid delete payload' }, 400);
              const res = await supabaseAdmin.from(table).delete().eq(payload.col, payload.value);
              return json(res);
            }
            case 'update': {
              if (!payload?.col || payload.value === undefined || !payload.data) return json({ error: 'Invalid update payload' }, 400);
              const res = await supabaseAdmin.from(table).update(payload.data).eq(payload.col, payload.value);
              return json(res);
            }
            case 'rpc': {
              const name = payload?.name;
              const params = payload?.params || {};
              if (!name) return json({ error: 'Missing rpc name' }, 400);
              const res = await supabaseAdmin.rpc(name, params);
              return json(res);
            }
            default:
              return json({ error: 'Unknown action' }, 400);
          }
        } catch (err) {
          return json({ error: String(err) }, 500);
        }
      },
    },
  },
});
