const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const authorization = req.headers.get('Authorization');
  const apikey = req.headers.get('apikey');
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization) || !apikey) {
    return json({ error: 'Authenticated request required' }, 401);
  }

  try {
    // Resolve the caller from the signed-in user's JWT; never trust a client-supplied user ID.
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        apikey,
        Accept: 'application/json',
      },
    });

    const userBody = parseJson(await userResponse.text());
    if (
      !userResponse.ok ||
      !userBody ||
      typeof userBody !== 'object' ||
      typeof (userBody as Record<string, unknown>)['id'] !== 'string'
    ) {
      return json({ error: 'Authenticated request required' }, 401);
    }

    const userId = (userBody as Record<string, unknown>)['id'] as string;

    // This public, authenticated-only wrapper delegates to the private PJVault helper.
    // Do not set Content-Profile/Accept-Profile to `private`: PostgREST must call the
    // exposed public wrapper, while the helper and role tables remain private.
    const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pjvault_is_active_admin`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
    });

    const responseBody = parseJson(await rpcResponse.text());
    if (!rpcResponse.ok || typeof responseBody !== 'boolean') {
      console.error('PJVault admin RPC failed', { status: rpcResponse.status });
      return json({ error: 'PJVault administrator authorization could not be verified.' }, 502);
    }

    return json(responseBody
      ? [{ user_id: userId, app_role: 'ADMIN', account_status: 'ACTIVE' }]
      : []);
  } catch (error) {
    console.error('PJVault admin session request failed', error);
    return json({ error: 'PJVault administrator authorization could not be verified.' }, 502);
  }
});