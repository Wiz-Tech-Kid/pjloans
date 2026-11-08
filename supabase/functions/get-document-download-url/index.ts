import { S3Client, HeadObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.750.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.750.0";
import { FetchHttpHandler } from "npm:@smithy/fetch-http-handler@5.0.1";

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
  return {
    client: new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: new FetchHttpHandler(),
    }),
    bucket,
  };
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
    const status = response.status === 401 || response.status === 403 ? response.status : 404;
    throw new HttpError(status, status === 404 ? "Document not found" : "Not authorized");
  }
  return text ? JSON.parse(text) : null;
}
function firstRow(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") throw new HttpError(404, "Document not found");
  return row as Record<string, unknown>;
}
function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey";
}
function safeDisposition(filename: unknown): string {
  const raw = typeof filename === "string" ? filename : "document";
  const fallback = raw.replace(/[\r\n"\\]/g, "_").slice(0, 120) || "document";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(raw.slice(0, 180))}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST required" });
  try {
    const body = await req.json();
    const documentId = Number(body?.document_id);
    if (!Number.isSafeInteger(documentId) || documentId < 1) throw new HttpError(400, "A valid document_id is required");
    const metadata = firstRow(await userRpc(req, "get_document_download_metadata", { p_document_id: documentId }));
    if (metadata.storage_provider !== "CLOUDFLARE_R2" || typeof metadata.storage_key !== "string" || !metadata.storage_key) throw new HttpError(404, "Document is not available");
    const { client, bucket } = r2Client();
    try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: metadata.storage_key })); }
    catch (error) { if (isNotFound(error)) throw new HttpError(404, "Private document object does not exist"); throw error; }
    const downloadUrl = await getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket,
      Key: metadata.storage_key,
      ResponseContentDisposition: safeDisposition(metadata.original_filename),
      ResponseContentType: String(metadata.mime_type || "application/octet-stream"),
    }), { expiresIn: 120 });
    return json(200, { document_id: documentId, download_url: downloadUrl, expires_in_seconds: 120 });
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error("get-document-download-url failed", error instanceof Error ? error.message : "unknown error");
    return json(500, { error: "Download URL could not be created; verify R2 configuration" });
  }
});