import { loadPersistedJson, savePersistedJson } from './persistedJson';

export interface QolTransformation {
  id: string;
  pattern: string;
  replacement: string;
  isDefault: boolean;
}

export interface QolSettings {
  enabled: boolean;
  userTransformations: QolTransformation[];
}

const DEFAULT_TRANSFORMATIONS: QolTransformation[] = [
];

const QOL_FILE = 'qol-settings.json';

let settings: QolSettings = {
  enabled: true,
  userTransformations: [],
};

let listeners: Set<() => void> = new Set();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export async function loadQolSettings(): Promise<QolSettings> {
  try {
    const loaded = await loadPersistedJson<Partial<QolSettings> | null>(QOL_FILE, null);
    if (loaded) {
      settings = {
        enabled: loaded.enabled ?? true,
        userTransformations: Array.isArray(loaded.userTransformations) ? loaded.userTransformations : [],
      };
    }
  } catch {
    settings = { enabled: true, userTransformations: [] };
  }
  notifyListeners();
  return settings;
}

export async function saveQolSettings(newSettings: Partial<QolSettings>): Promise<void> {
  settings = { ...settings, ...newSettings };
  notifyListeners();
  try {
    await savePersistedJson(QOL_FILE, settings);
  } catch {}
}

export function getQolSettings(): QolSettings {
  return { ...settings, userTransformations: [...settings.userTransformations] };
}

export function getDefaultTransformations(): QolTransformation[] {
  return [...DEFAULT_TRANSFORMATIONS];
}

export function getAllTransformations(): QolTransformation[] {
  return [...DEFAULT_TRANSFORMATIONS, ...settings.userTransformations];
}

export async function addUserTransformation(pattern: string, replacement: string): Promise<void> {
  const newTransformation: QolTransformation = {
    id: `user_${Date.now()}`,
    pattern,
    replacement,
    isDefault: false,
  };
  await saveQolSettings({
    userTransformations: [...settings.userTransformations, newTransformation],
  });
}

export async function updateUserTransformation(id: string, pattern: string, replacement: string): Promise<void> {
  const updated = settings.userTransformations.map((t) =>
    t.id === id ? { ...t, pattern, replacement } : t
  );
  await saveQolSettings({ userTransformations: updated });
}

export async function removeUserTransformation(id: string): Promise<void> {
  const filtered = settings.userTransformations.filter((t) => t.id !== id);
  await saveQolSettings({ userTransformations: filtered });
}

export async function setQolEnabled(enabled: boolean): Promise<void> {
  await saveQolSettings({ enabled });
}

export function subscribeToQol(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function transformScript(script: string): string {
  if (!settings.enabled) return script;

  let result = script;
  const allTransformations = getAllTransformations();

  for (const t of allTransformations) {
    if (t.pattern && t.replacement) {
      const regex = new RegExp(escapeRegex(t.pattern), 'g');
      result = result.replace(regex, t.replacement);
    }
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
