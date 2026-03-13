import { PaneTab } from './splitStore';
import { loadPersistedJson, savePersistedJson } from './persistedJson';

export interface SessionState {
  tabs: PaneTab[];
  activeTabId: string;
}

const SESSION_FILE = 'session.json';

export async function saveSession(tabs: PaneTab[], activeTabId: string): Promise<void> {
  try {
    const session: SessionState = { tabs, activeTabId };
    await savePersistedJson(SESSION_FILE, session);
  } catch {}
}

export async function loadSession(): Promise<SessionState | null> {
  try {
    const session = await loadPersistedJson<SessionState | null>(SESSION_FILE, null);
    if (!session) return null;

    if (!session.tabs || !Array.isArray(session.tabs)) return null;

    return session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await savePersistedJson(SESSION_FILE, {});
  } catch {
  }
}
