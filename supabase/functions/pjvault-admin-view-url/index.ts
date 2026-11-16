import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { S3Client, GetObjectCommand } from 'npm:@aws-sdk/client-s3@3.750.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.750.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');
const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT');
if (!R2_ENDPOINT) throw new Error('R2_ENDPOINT is required');
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID');
if (!R2_ACCESS_KEY_ID) throw new Error('R2_ACCESS_KEY_ID is required');
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY');
if (!R2_SECRET_ACCESS_KEY) throw new Error('R2_SECRET_ACCESS_KEY is required');
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME_2');
if (!R2_BUCKET_NAME) throw new Error('R2_BUCKET_NAME_2 is required');

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT.replace(/\/$/, ''),
  forcePathStyle: true,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  const apikey = req.headers.get('apikey');
  if (!authorization || !apikey) return json({ error: 'Authenticated PJVault admin required' }, 401);

  let body: { document_id?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 8_000) return json({ error: 'Request body too large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body.document_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.document_id)) {
    return json({ error: 'Valid document_id is required' }, 400);
  }

  try {
    const client = createClient(SUPABASE_URL, apikey, {
      db: { schema: 'pjvault' },
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc('admin_get_document_storage_metadata', { p_document_id: body.document_id });
    if (error) return json({ error: 'Document lookup failed' }, error.code === 'P0002' ? 404 : 403);
    const metadata = Array.isArray(data) ? data[0] : data;
    if (!metadata || typeof metadata.storage_key !== 'string') return json({ error: 'Document not found' }, 404);

    const safeName = String(metadata.original_filename ?? 'document').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160) || 'document';
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: metadata.storage_key,
      ResponseContentType: metadata.mime_type,
      ResponseContentDisposition: `inline; filename=\"${safeName}\"`,
    }), { expiresIn: 60 });

    const { error: auditError } = await client.rpc('admin_record_document_view', { p_document_id: body.document_id });
    if (auditError) return json({ error: 'Could not record document access' }, 500);
    return json({ url: signedUrl, expires_in_seconds: 60, review_status: metadata.review_status });
  } catch {
    return json({ error: 'Could not create document view URL' }, 500);
  }
});