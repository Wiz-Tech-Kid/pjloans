import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3@3.750.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.750.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: corsHeaders });
}
function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}
function r2Client(): { client: S3Client; bucket: string } {
  const endpoint = requiredEnv("R2_ENDPOINT");
  const bucket = requiredEnv("R2_BUCKET_NAME");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  return { client: new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } }), bucket };
}
async function userRpc(req: Request, name: string, payload: Record<string, unknown>): Promise<unknown> {
  const authorization = req.headers.get("authorization");
  const apikey = req.headers.get("apikey");
  if (!authorization?.startsWith("Bearer ") || !apikey) throw new HttpError(401, "Authentication required");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { authorization, apikey, "content-type": "application/json", "content-profile": "loanops", "accept-profile": "loanops" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? response.status : 400;
    throw new HttpError(status, status === 400 ? "Upload request was rejected" : "Not authorized");
  }
  return text ? JSON.parse(text) : null;
}
function firstRow(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") throw new HttpError(502, "Upload intent could not be created");
  return row as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST required" });
  try {
    const body = await req.json();
    const applicationId = Number(body?.application_id);
    const documentType = body?.document_type;
    const filename = body?.original_filename;
    const mimeType = typeof body?.mime_type === "string" ? body.mime_type.toLowerCase().trim() : "";
    const size = Number(body?.expected_size);
    if (!Number.isSafeInteger(applicationId) || applicationId < 1 || typeof documentType !== "string" || typeof filename !== "string" || !Number.isSafeInteger(size)) throw new HttpError(400, "Invalid upload metadata");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(mimeType) || size < 1 || size > 20 * 1024 * 1024) throw new HttpError(400, "Unsupported file type or size (maximum 20 MiB)");

    const intent = firstRow(await userRpc(req, "create_document_upload_intent", {
      p_application_id: applicationId,
      p_document_type: documentType,
      p_original_filename: filename,
      p_mime_type: mimeType,
      p_expected_size: size,
    }));
    const { client, bucket } = r2Client();
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
      Bucket: bucket,
      Key: String(intent.storage_key),
      ContentType: String(intent.mime_type),
      ContentLength: Number(intent.expected_size),
    }), { expiresIn: 300 });
    return json(200, {
      intent_id: intent.intent_id,
      expires_at: intent.expires_at,
      upload_url: uploadUrl,
      upload_method: "PUT",
      required_headers: { "Content-Type": intent.mime_type },
      url_expires_in_seconds: 300,
    });
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error("create-document-upload failed", error instanceof Error ? error.message : "unknown error");
    return json(500, { error: "Could not create upload URL; verify server configuration" });
  }
});