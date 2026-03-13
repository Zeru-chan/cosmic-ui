import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

let appStorageDirPromise: Promise<string> | null = null;

function joinWindowsPath(dir: string, fileName: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${fileName}`;
}

async function getAppStorageDir(): Promise<string> {
  if (!appStorageDirPromise) {
    appStorageDirPromise = invoke<string>('get_app_storage_path');
  }

  try {
    return await appStorageDirPromise;
  } catch (error) {
    appStorageDirPromise = null;
    throw error;
  }
}

async function readAbsoluteJson<T>(path: string): Promise<T | null> {
  try {
    if (!(await exists(path))) {
      return null;
    }

    const content = await readTextFile(path);
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeAbsoluteJson<T>(path: string, value: T): Promise<void> {
  await writeTextFile(path, JSON.stringify(value, null, 2));
}

async function readLegacyJson<T>(fileName: string): Promise<T | null> {
  try {
    if (!(await exists(fileName, { baseDir: BaseDirectory.AppData }))) {
      return null;
    }

    const content = await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeLegacyJson<T>(fileName: string, value: T): Promise<void> {
  await writeTextFile(fileName, JSON.stringify(value, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

async function getStoragePath(fileName: string): Promise<string | null> {
  try {
    const storageDir = await getAppStorageDir();
    return joinWindowsPath(storageDir, fileName);
  } catch {
    return null;
  }
}

export async function loadPersistedJson<T>(fileName: string, fallback: T): Promise<T> {
  const storagePath = await getStoragePath(fileName);
  if (storagePath) {
    const currentValue = await readAbsoluteJson<T>(storagePath);
    if (currentValue !== null) {
      return currentValue;
    }
  }

  const legacyValue = await readLegacyJson<T>(fileName);
  if (legacyValue !== null) {
    if (storagePath) {
      try {
        await writeAbsoluteJson(storagePath, legacyValue);
      } catch {
      }
    }

    return legacyValue;
  }

  return fallback;
}

export async function savePersistedJson<T>(fileName: string, value: T): Promise<void> {
  const storagePath = await getStoragePath(fileName);

  if (storagePath) {
    try {
      await writeAbsoluteJson(storagePath, value);
      return;
    } catch {
    }
  }

  await writeLegacyJson(fileName, value);
}
