import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const projectRoot = process.cwd();
const envPath = resolve(projectRoot, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
if (
  !publishableKey ||
  publishableKey === process.env.SUPABASE_SECRET_KEY ||
  publishableKey === process.env.SUPABASE_SERVICE_ROLE_KEY ||
  publishableKey.startsWith('sb_secret_')
) {
  throw new Error('A Supabase publishable key is required; secret/service-role keys cannot be exposed to the browser.');
}

const runtimeConfig = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabasePublishableKey: publishableKey,
};
if (!runtimeConfig.supabaseUrl) throw new Error('SUPABASE_URL is required for the PJVault app.');

mkdirSync(resolve(projectRoot, 'public'), { recursive: true });
writeFileSync(resolve(projectRoot, 'public/runtime-config.json'), `${JSON.stringify(runtimeConfig, null, 2)}\n`);
