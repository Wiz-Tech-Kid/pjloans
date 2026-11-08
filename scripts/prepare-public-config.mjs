import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const projectRoot = process.cwd();
const envPath = resolve(projectRoot, '.env');
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const authMode = process.env.PJLOANS_AUTH_MODE ?? 'supabase';
if (authMode !== 'supabase' && authMode !== 'mock') {
  throw new Error('PJLOANS_AUTH_MODE must be either "supabase" or "mock".');
}
const dataMode = process.env.PJLOANS_MODE ?? 'demo';
if (dataMode !== 'demo' && dataMode !== 'api') {
  throw new Error('PJLOANS_MODE must be either "demo" or "api".');
}
const borrowerDataMode = process.env.PJLOANS_BORROWER_MODE ?? dataMode;
if (!['demo', 'api'].includes(borrowerDataMode)) {
  throw new Error('PJLOANS_BORROWER_MODE must be "demo" or "api"; borrower lending data must not be stored in Supabase.');
}

const runtimeConfig = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  authMode,
  dataMode,
  borrowerDataMode,
};

const privilegedKeys = [
  process.env.SUPABASE_SECRET_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
].filter(Boolean);
if (privilegedKeys.includes(runtimeConfig.supabaseAnonKey)) {
  throw new Error('The browser key must not contain a Supabase secret or service-role key.');
}
if (
  runtimeConfig.supabaseAnonKey.startsWith('sb_secret_')
  || isServiceRoleJwt(runtimeConfig.supabaseAnonKey)
) {
  throw new Error('A Supabase secret or service-role key cannot be exposed to the browser. Use the publishable key.');
}

const outputPath = resolve(projectRoot, 'public/runtime-config.json');
mkdirSync(resolve(projectRoot, 'public'), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`);

function isServiceRoleJwt(key) {
  const [, payload] = key.split('.');
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}
