import { createClient } from 'npm:@supabase/supabase-js@2.49.8';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const allowedMimes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const allowedDocumentTypes = new Set([
  'STUDENT_ID',
  'IDENTITY_DOCUMENT',
  'ADMISSION_LETTER',
  'SPONSORSHIP_LETTER',
  'SEMESTER_TIMETABLE',
]);
const documentTypeAliases = new Map([
  ['NATIONAL_ID_OR_PASSPORT', 'IDENTITY_DOCUMENT'],
]);
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function validDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  const apikey = req.headers.get('apikey');
  if (!authorization || !apikey) return json({ error: 'Authenticated PJVault admin request required' }, 401);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 64_000) return json({ error: 'Request body too large' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid JSON object' }, 400);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  async function rpc(name: string, args: Record<string, unknown>, schema = 'pjvault') {
    const headers: Record<string, string> = {
      Authorization: authorization,
      apikey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (schema) {
      headers['Content-Profile'] = schema;
      headers['Accept-Profile'] = schema;
    }
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(args),
    });
    const text = await response.text();
    let result: unknown = null;
    try { result = text ? JSON.parse(text) : null; } catch { result = { error: 'Invalid database response' }; }
    return { ok: response.ok, status: response.status, body: result };
  }
  function failed(result: { status: number; body: unknown }) {
    const status = result.status >= 400 && result.status < 600 ? result.status : 500;
    return json({ error: 'PJVault operation failed', details: result.body }, status);
  }
  function firstRow(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
  }
  function optionalText(value: unknown, maxLength: number, field: string): string | null | Response {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.length > maxLength) return json({ error: `Invalid ${field}` }, 400);
    return value;
  }
  function pagination() {
    const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit as number, 1), 100) : 50;
    const offset = Number.isInteger(body.offset) ? Math.max(body.offset as number, 0) : 0;
    return { limit, offset };
  }

  try {
    switch (body.action) {
      case 'create_request': {
        const requirements = body.requirements;
        if (!Array.isArray(requirements) || requirements.length < 1 || requirements.length > 5) {
          return json({ error: 'Provide between 1 and 5 requirements' }, 400);
        }
        const normalizedRequirements: Record<string, unknown>[] = [];
        for (const item of requirements) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return json({ error: 'Invalid requirement' }, 400);
          const r = item as Record<string, unknown>;
          const rawType = typeof r.document_type === 'string' ? r.document_type : '';
          const requestedType = rawType.trim().toUpperCase();
          const documentType = documentTypeAliases.get(requestedType) ?? requestedType;
          if (!allowedDocumentTypes.has(documentType)) {
            console.warn('Unsupported PJVault document type', { document_type: rawType.slice(0, 64) || null });
            return json({
              error: 'Unsupported document type',
              details: {
                document_type: rawType.slice(0, 64) || null,
                allowed_document_types: [...allowedDocumentTypes],
              },
            }, 400);
          }
          if (!Array.isArray(r.allowed_mime_types) || r.allowed_mime_types.length < 1 || r.allowed_mime_types.some((m) => typeof m !== 'string' || !allowedMimes.has(m))) {
            return json({ error: 'Unsupported MIME type' }, 400);
          }
          if (r.required !== undefined && typeof r.required !== 'boolean') return json({ error: 'Invalid required flag' }, 400);
          if (r.max_file_size_bytes !== undefined && (!Number.isInteger(r.max_file_size_bytes) || (r.max_file_size_bytes as number) < 1 || (r.max_file_size_bytes as number) > 20 * 1024 * 1024)) {
            return json({ error: 'Invalid maximum file size' }, 400);
          }
          normalizedRequirements.push({ ...r, document_type: documentType });
        }
        const token = randomToken();
        const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : new Date(Date.now() + 7 * 86400_000).toISOString();
        const result = await rpc('admin_create_upload_request', {
          p_token_hash: await sha256Hex(token),
          p_expires_at: expiresAt,
          p_recipient_label: typeof body.recipient_label === 'string' ? body.recipient_label : null,
          p_external_reference: typeof body.external_reference === 'string' ? body.external_reference : null,
          p_requirements: normalizedRequirements,
        });
        if (!result.ok) return failed(result);
        const row = firstRow(result.body);
        return json({ ...((row && typeof row === 'object') ? row : {}), upload_token: token });
      }
      case 'reissue_token': {
        if (!validUuid(body.request_id)) return json({ error: 'Valid request_id is required' }, 400);
        const token = randomToken();
        const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : new Date(Date.now() + 7 * 86400_000).toISOString();
        const result = await rpc('admin_reissue_upload_token', {
          p_request_id: body.request_id,
          p_token_hash: await sha256Hex(token),
          p_expires_at: expiresAt,
        });
        if (!result.ok) return failed(result);
        const row = firstRow(result.body);
        return json({ ...((row && typeof row === 'object') ? row : {}), upload_token: token });
      }
      case 'close_request':
      case 'revoke_request': {
        if (!validUuid(body.request_id)) return json({ error: 'Valid request_id is required' }, 400);
        const result = await rpc(body.action === 'close_request' ? 'admin_close_upload_request' : 'admin_revoke_upload_request', { p_request_id: body.request_id });
        if (!result.ok) return failed(result);
        return json({ ok: true, request_id: body.request_id });
      }
      case 'review_document': {
        if (!validUuid(body.document_id) || !['ACCEPTED', 'REJECTED'].includes(String(body.decision))) return json({ error: 'Valid document_id and decision are required' }, 400);
        const result = await rpc('admin_review_document', {
          p_document_id: body.document_id,
          p_decision: body.decision,
          p_note: typeof body.note === 'string' ? body.note : null,
        });
        if (!result.ok) return failed(result);
        return json(firstRow(result.body));
      }
      case 'list_requests':
      case 'list_review_queue': {
        const { limit, offset } = pagination();
        const status = typeof body.status === 'string' ? body.status : null;
        const result = await rpc('pjvault_admin_list_review_queue', { p_status: status, p_limit: limit, p_offset: offset }, 'public');
        if (!result.ok) return failed(result);
        return json(result.body);
      }
      case 'get_request':
      case 'get_request_details':
      case 'get_application': {
        if (!validUuid(body.request_id)) return json({ error: 'Valid request_id is required' }, 400);
        const result = await rpc('pjvault_admin_get_application', { p_request_id: body.request_id }, 'public');
        if (!result.ok) return failed(result);
        return json(result.body);
      }
      case 'accept_application':
      case 'approve_application': {
        if (!validUuid(body.request_id)) return json({ error: 'Valid request_id is required' }, 400);
        if (typeof body.loan_amount !== 'number' || !Number.isFinite(body.loan_amount) || body.loan_amount <= 0) {
          return json({ error: 'A positive numeric loan_amount is required' }, 400);
        }
        if (!validDateOnly(body.due_date)) return json({ error: 'due_date must be a valid YYYY-MM-DD date' }, 400);
        const note = optionalText(body.decision_note ?? body.note, 2000, 'decision_note');
        if (note instanceof Response) return note;
        const result = await rpc('pjvault_admin_decide_application', {
          p_request_id: body.request_id,
          p_decision: 'APPROVED',
          p_loan_amount: body.loan_amount,
          p_due_date: body.due_date,
          p_decision_note: note,
        }, 'public');
        if (!result.ok) return failed(result);
        return json(result.body);
      }
      case 'reject_application': {
        if (!validUuid(body.request_id)) return json({ error: 'Valid request_id is required' }, 400);
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!reason || reason.length > 2000) return json({ error: 'A rejection reason of 1–2000 characters is required' }, 400);
        const result = await rpc('pjvault_admin_decide_application', {
          p_request_id: body.request_id,
          p_decision: 'REJECTED',
          p_loan_amount: null,
          p_due_date: null,
          p_decision_note: reason,
        }, 'public');
        if (!result.ok) return failed(result);
        return json(result.body);
      }
      case 'list_loans': {
        const { limit, offset } = pagination();
        const status = typeof body.status === 'string' ? body.status : null;
        const result = await rpc('pjvault_admin_list_loans', { p_status: status, p_limit: limit, p_offset: offset }, 'public');
        if (!result.ok) return failed(result);
        return json(result.body);
      }
      case 'get_loan':
      case 'get_loan_details': {
        if (!validUuid(body.loan_id)) return json({ error: 'Valid loan_id is required' }, 400);
        const result = await rpc('pjvault_admin_get_loan', { p_loan_id: body.loan_id }, 'public');
        if (!result.ok) return failed(result);
        return json(result.body);
      }
      case 'record_disbursement': {
        if (!validUuid(body.loan_id)) return json({ error: 'Valid loan_id is required' }, 400);
        if (typeof body.disbursed_amount !== 'number' || !Number.isFinite(body.disbursed_amount) || body.disbursed_amount <= 0) {
          return json({ error: 'A positive numeric disbursed_amount is required' }, 400);
        }
        if (!validTimestamp(body.disbursed_at)) return json({ error: 'disbursed_at must be an ISO 8601 timestamp with timezone' }, 400);
        if (typeof body.payment_method !== 'string' || !body.payment_method.trim() || body.payment_method.trim().length > 80) {
          return json({ error: 'payment_method is required and must be at most 80 characters' }, 400);
        }
        const reference = optionalText(body.transaction_reference, 160, 'transaction_reference');
        if (reference instanceof Response) return reference;
        const notes = optionalText(body.admin_notes, 2000, 'admin_notes');
        if (notes instanceof Response) return notes;
        const result = await rpc('pjvault_admin_record_disbursement', {
          p_loan_id: body.loan_id,
          p_disbursed_amount: body.disbursed_amount,
          p_disbursed_at: body.disbursed_at,
          p_payment_method: body.payment_method,
          p_transaction_reference: reference,
          p_admin_notes: notes,
        }, 'public');
        if (!result.ok) return failed(result);
        return json(firstRow(result.body));
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch {
    return json({ error: 'Unexpected PJVault admin API error' }, 500);
  }
});