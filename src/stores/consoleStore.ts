import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type ConsoleLogLevel = 'info' | 'warning' | 'error' | 'success' | 'status';

export interface ConsoleLogEntry {
  id: string;
  level: ConsoleLogLevel;
  message: string;
  timestamp: Date;
}

interface ConsoleLogPayload {
  level?: string;
  message?: string;
}

let logs: ConsoleLogEntry[] = [];
const listeners = new Set<() => void>();
let unlistenPromise: Promise<UnlistenFn> | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function normalizeLevel(level?: string): ConsoleLogLevel {
  if (level === 'warning' || level === 'error' || level === 'success' || level === 'status') {
    return level;
  }
  return 'info';
}

function nextId(): string {
  return `console_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function initializeConsoleListener(): Promise<void> {
  if (unlistenPromise) {
    await unlistenPromise;
    return;
  }

  unlistenPromise = listen<ConsoleLogPayload>('console-log', (event) => {
    appendConsoleLog({
      level: normalizeLevel(event.payload?.level),
      message: event.payload?.message ?? '',
    });
  });

  await unlistenPromise;
}

export function appendConsoleLog(entry: Omit<ConsoleLogEntry, 'id' | 'timestamp'>): void {
  logs = [
    ...logs,
    {
      id: nextId(),
      timestamp: new Date(),
      ...entry,
    },
  ].slice(-500);

  notify();
}

export function clearConsoleLogs(): void {
  if (logs.length === 0) return;
  logs = [];
  notify();
}

export function getConsoleLogs(): ConsoleLogEntry[] {
  return [...logs];
}

export function subscribeToConsoleLogs(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
