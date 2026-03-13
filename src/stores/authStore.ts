import { invoke } from '@tauri-apps/api/core';
import { loadPersistedJson, savePersistedJson } from './persistedJson';

interface AuthState {
  isRemembered: boolean;
  licenseKey?: string;
  sessionToken?: string;
  displayName?: string;
  expiresAt?: string;
}

export interface AuthSessionData {
  token: string;
  licenseKey: string;
  displayName: string;
  expiresAt?: string;
}

const AUTH_FILE = 'auth.json';

let cachedSession: AuthState | null = null;

export async function saveAuthState(
  isRemembered: boolean,
  licenseKey?: string,
  sessionData?: AuthSessionData
): Promise<void> {
  const state: AuthState = {
    isRemembered,
    licenseKey: isRemembered ? licenseKey : undefined,
    sessionToken: sessionData?.token,
    displayName: sessionData?.displayName,
    expiresAt: sessionData?.expiresAt,
  };

  cachedSession = state;

  try {
    await savePersistedJson(AUTH_FILE, state);
  } catch {}
}

export async function loadAuthState(): Promise<AuthState | null> {
  try {
    const parsed = await loadPersistedJson<(AuthState & { email?: string }) | null>(AUTH_FILE, null);
    if (!parsed) return null;

    const state: AuthState = {
      isRemembered: parsed.isRemembered,
      licenseKey: parsed.licenseKey ?? parsed.email,
      sessionToken: parsed.sessionToken,
      displayName: parsed.displayName,
      expiresAt: parsed.expiresAt,
    };

    cachedSession = state;
    return state;
  } catch {
    return null;
  }
}

export async function loginWithLicense(licenseKey: string): Promise<AuthSessionData | null> {
  const trimmedLicense = licenseKey.trim();
  if (!trimmedLicense) {
    return null;
  }

  try {
    const session = await invoke<Omit<AuthSessionData, 'licenseKey'>>('redeem_license', {
      license: trimmedLicense,
    });

    return {
      ...session,
      licenseKey: trimmedLicense,
    };
  } catch {
    return null;
  }
}

export async function validateSession(): Promise<boolean> {
  const state = await loadAuthState();
  if (!state?.isRemembered || !state.sessionToken || !state.licenseKey) {
    return false;
  }

  try {
    return await invoke<boolean>('validate_license_session', {
      license: state.licenseKey,
    });
  } catch {
    return state.isRemembered && !!state.sessionToken && !!state.licenseKey;
  }
}

export function getSession(): AuthState | null {
  return cachedSession;
}

export async function clearAuthState(): Promise<void> {
  cachedSession = null;
  try {
    await savePersistedJson(AUTH_FILE, { isRemembered: false });
  } catch {}
}
