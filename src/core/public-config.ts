import { InjectionToken } from '@angular/core';

export interface PublicRuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  authMode: 'supabase' | 'mock';
  dataMode: 'demo' | 'api';
  borrowerDataMode: 'demo' | 'api';
  loadError: string | null;
}

const defaultConfig: PublicRuntimeConfig = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  authMode: 'supabase',
  dataMode: 'demo',
  borrowerDataMode: 'demo',
  loadError: 'Application configuration is unavailable.',
};

export const PUBLIC_RUNTIME_CONFIG = new InjectionToken<PublicRuntimeConfig>(
  'PUBLIC_RUNTIME_CONFIG',
  {
    providedIn: 'root',
    factory: () => defaultConfig,
  },
);

export async function loadPublicRuntimeConfig(): Promise<PublicRuntimeConfig> {
  try {
    const response = await fetch('/runtime-config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Configuration request failed with status ${response.status}.`);
    }
    const config: unknown = await response.json();
    if (
      typeof config !== 'object'
      || config === null
      || !('supabaseUrl' in config)
      || !('supabaseAnonKey' in config)
      || !('authMode' in config)
      || !('dataMode' in config)
      || !('borrowerDataMode' in config)
      || typeof config.supabaseUrl !== 'string'
      || typeof config.supabaseAnonKey !== 'string'
      || (config.authMode !== 'supabase' && config.authMode !== 'mock')
      || (config.dataMode !== 'demo' && config.dataMode !== 'api')
      || (config.borrowerDataMode !== 'demo' && config.borrowerDataMode !== 'api')
    ) {
      throw new Error('The application configuration has an invalid format.');
    }
    return {
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      authMode: config.authMode,
      dataMode: config.dataMode,
      borrowerDataMode: config.borrowerDataMode,
      loadError: null,
    };
  } catch (error) {
    console.error('Could not load public application configuration.', error);
    return defaultConfig;
  }
}
