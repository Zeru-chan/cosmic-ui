import { loadPersistedJson, savePersistedJson } from './persistedJson';

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  minimap: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  fontLigatures: boolean;
}

export interface AutoAttachSettings {
  enabled: boolean;
  delay: number;
}

export interface AppearanceSettings {
  accentColor: string;
  backgroundOpacity: number;
}

export interface WorkbenchSettings {
  startupAction: 'welcome' | 'none' | 'new';
  restoreTabs: boolean;
  floatingExecuteButton: boolean;
  sidebarPosition: 'left' | 'right';
  terminalPosition: 'bottom' | 'top';
  sidebarWidth: number;
  alwaysOnTop: boolean;
}

export interface ClientSettings {
  redirectOutputs: boolean;
  disableInternalUI: boolean;
  enableBitLibrary: boolean;
  securityPurchasePrompt: boolean;
  hookIn: boolean;
  enableMultiInstance: boolean;
}

export interface AppSettings {
  editor: EditorSettings;
  autoAttach: AutoAttachSettings;
  appearance: AppearanceSettings;
  workbench: WorkbenchSettings;
  client: ClientSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  editor: {
    fontSize: 13,
    tabSize: 4,
    minimap: true,
    wordWrap: false,
    lineNumbers: true,
    fontLigatures: true,
  },
  autoAttach: {
    enabled: false,
    delay: 1000,
  },
  appearance: {
    accentColor: '#FFFFFF',
    backgroundOpacity: 0.95,
  },
  workbench: {
    startupAction: 'welcome',
    restoreTabs: false,
    floatingExecuteButton: false,
    sidebarPosition: 'left',
    terminalPosition: 'bottom',
    sidebarWidth: 220,
    alwaysOnTop: false,
  },
  client: {
    redirectOutputs: false,
    disableInternalUI: false,
    enableBitLibrary: false,
    securityPurchasePrompt: true,
    hookIn: false,
    enableMultiInstance: false,
  },
};

const SETTINGS_FILE = 'settings.json';

function cloneDefaultSettings(): AppSettings {
  return {
    editor: { ...DEFAULT_SETTINGS.editor },
    autoAttach: { ...DEFAULT_SETTINGS.autoAttach },
    appearance: { ...DEFAULT_SETTINGS.appearance },
    workbench: { ...DEFAULT_SETTINGS.workbench },
    client: { ...DEFAULT_SETTINGS.client },
  };
}

let settings: AppSettings = cloneDefaultSettings();
let listeners: Set<() => void> = new Set();
let initialized = false;

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export async function loadSettings(): Promise<AppSettings> {
  if (initialized) {
    return settings;
  }

  try {
    const loaded = await loadPersistedJson<Partial<AppSettings> | null>(SETTINGS_FILE, null);
    if (loaded) {
      settings = {
        editor: { ...DEFAULT_SETTINGS.editor, ...loaded.editor },
        autoAttach: { ...DEFAULT_SETTINGS.autoAttach, ...loaded.autoAttach },
        appearance: { ...DEFAULT_SETTINGS.appearance, ...loaded.appearance },
        workbench: { ...DEFAULT_SETTINGS.workbench, ...loaded.workbench },
        client: { ...DEFAULT_SETTINGS.client, ...loaded.client },
      };
    } else {
      settings = cloneDefaultSettings();
      await savePersistedJson(SETTINGS_FILE, settings);
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
    settings = cloneDefaultSettings();
  }

  initialized = true;
  notifyListeners();
  return settings;
}

export async function saveSettings(newSettings: Partial<AppSettings>): Promise<void> {
  if (!initialized) {
    await loadSettings();
  }

  settings = {
    editor: { ...settings.editor, ...newSettings.editor },
    autoAttach: { ...settings.autoAttach, ...newSettings.autoAttach },
    appearance: { ...settings.appearance, ...newSettings.appearance },
    workbench: { ...settings.workbench, ...newSettings.workbench },
    client: { ...settings.client, ...newSettings.client },
  };

  notifyListeners();

  try {
    await savePersistedJson(SETTINGS_FILE, settings);
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function getSettings(): AppSettings {
  return {
    editor: { ...settings.editor },
    autoAttach: { ...settings.autoAttach },
    appearance: { ...settings.appearance },
    workbench: { ...settings.workbench },
    client: { ...settings.client },
  };
}

export function subscribeToSettings(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function isSettingsInitialized(): boolean {
  return initialized;
}

export async function updateEditorSetting<K extends keyof EditorSettings>(
  key: K,
  value: EditorSettings[K]
): Promise<void> {
  await saveSettings({
    editor: { ...settings.editor, [key]: value },
  });
}

export async function updateAutoAttachSetting<K extends keyof AutoAttachSettings>(
  key: K,
  value: AutoAttachSettings[K]
): Promise<void> {
  await saveSettings({
    autoAttach: { ...settings.autoAttach, [key]: value },
  });
}

export async function updateAppearanceSetting<K extends keyof AppearanceSettings>(
  key: K,
  value: AppearanceSettings[K]
): Promise<void> {
  await saveSettings({
    appearance: { ...settings.appearance, [key]: value },
  });
}

export async function updateWorkbenchSetting<K extends keyof WorkbenchSettings>(
  key: K,
  value: WorkbenchSettings[K]
): Promise<void> {
  await saveSettings({
    workbench: { ...settings.workbench, [key]: value },
  });
}

export async function updateClientSetting<K extends keyof ClientSettings>(
  key: K,
  value: ClientSettings[K]
): Promise<void> {
  await saveSettings({
    client: { ...settings.client, [key]: value },
  });
}
