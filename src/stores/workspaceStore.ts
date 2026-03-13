import { invoke } from "@tauri-apps/api/core";
import { remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTextFileExtension } from "../utils/fileTypes";
import {
  getBaseName,
  getParentPath,
  joinPath,
  normalizeAbsolutePath,
  pathStartsWith,
} from "../utils/filePaths";

export interface WorkspaceEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
}

export interface WorkspaceNode extends WorkspaceEntry {
  children?: WorkspaceNode[];
  isLoading?: boolean;
  isExpanded?: boolean;
}

let workspacePath: string | null = null;
let rootEntries: WorkspaceNode[] = [];
let expandedPaths: Set<string> = new Set();
let childrenCache: Map<string, WorkspaceNode[]> = new Map();
let listeners: Set<() => void> = new Set();
let initialized = false;

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

function normalizeWorkspacePath(path: string): string {
  return normalizeAbsolutePath(path);
}

function remapExpandedPaths(oldPath: string, newPath: string): void {
  const nextExpandedPaths = new Set<string>();

  for (const path of expandedPaths) {
    if (pathStartsWith(path, oldPath)) {
      nextExpandedPaths.add(path.replace(oldPath, newPath));
    } else {
      nextExpandedPaths.add(path);
    }
  }

  expandedPaths = nextExpandedPaths;
}

function removeExpandedPath(pathToRemove: string): void {
  const nextExpandedPaths = new Set<string>();

  for (const path of expandedPaths) {
    if (!pathStartsWith(path, pathToRemove)) {
      nextExpandedPaths.add(path);
    }
  }

  expandedPaths = nextExpandedPaths;
}

export async function getWorkspacePath(): Promise<string> {
  if (!workspacePath) {
    workspacePath = normalizeWorkspacePath(
      await invoke<string>("get_workspace_path"),
    );
  }
  return workspacePath;
}

export async function loadWorkspaceRoot(): Promise<void> {
  const path = await getWorkspacePath();
  const entries = await invoke<WorkspaceEntry[]>("read_workspace_dir", {
    dirPath: path,
  });
  rootEntries = entries.map((entry) => ({
    ...entry,
    path: normalizeWorkspacePath(entry.path),
    isExpanded: expandedPaths.has(normalizeWorkspacePath(entry.path)),
  }));
  initialized = true;
  notifyListeners();
}

export async function loadChildren(dirPath: string): Promise<WorkspaceNode[]> {
  const normalizedPath = normalizeWorkspacePath(dirPath);

  if (childrenCache.has(normalizedPath)) {
    return childrenCache.get(normalizedPath)!;
  }

  const entries = await invoke<WorkspaceEntry[]>("read_workspace_dir", {
    dirPath: normalizedPath,
  });
  const nodes: WorkspaceNode[] = entries.map((entry) => ({
    ...entry,
    path: normalizeWorkspacePath(entry.path),
    isExpanded: expandedPaths.has(normalizeWorkspacePath(entry.path)),
  }));

  childrenCache.set(normalizedPath, nodes);
  return nodes;
}

export async function toggleExpand(path: string): Promise<void> {
  const normalizedPath = normalizeWorkspacePath(path);

  if (expandedPaths.has(normalizedPath)) {
    expandedPaths.delete(normalizedPath);
  } else {
    expandedPaths.add(normalizedPath);
    if (!childrenCache.has(normalizedPath)) {
      await loadChildren(normalizedPath);
    }
  }

  notifyListeners();
}

export function isExpanded(path: string): boolean {
  return expandedPaths.has(normalizeWorkspacePath(path));
}

export function getChildren(path: string): WorkspaceNode[] | undefined {
  return childrenCache.get(normalizeWorkspacePath(path));
}

export async function readWorkspaceFile(filePath: string): Promise<string> {
  return invoke<string>("read_workspace_file", {
    filePath: normalizeWorkspacePath(filePath),
  });
}

export async function writeWorkspaceFile(
  filePath: string,
  content: string,
): Promise<void> {
  await writeTextFile(normalizeWorkspacePath(filePath), content);
}

export async function renameWorkspacePath(
  path: string,
  newName: string,
): Promise<{ oldPath: string; newPath: string }> {
  const normalizedPath = normalizeWorkspacePath(path);
  const parentPath = getParentPath(normalizedPath);
  const newPath = normalizeWorkspacePath(joinPath(parentPath, newName));

  await rename(normalizedPath, newPath);
  remapExpandedPaths(normalizedPath, newPath);
  await refreshWorkspace();

  return { oldPath: normalizedPath, newPath };
}

export async function deleteWorkspacePath(
  path: string,
  isDir: boolean,
): Promise<void> {
  const normalizedPath = normalizeWorkspacePath(path);
  await remove(normalizedPath, { recursive: isDir });
  removeExpandedPath(normalizedPath);
  await refreshWorkspace();
}

export function isTextFile(extension: string | null): boolean {
  return isTextFileExtension(extension);
}

export function getWorkspaceItemName(path: string): string {
  return getBaseName(path);
}

export function getRootEntries(): WorkspaceNode[] {
  return rootEntries;
}

export function isWorkspaceInitialized(): boolean {
  return initialized;
}

export function subscribeWorkspace(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function refreshWorkspace(): Promise<void> {
  childrenCache.clear();
  await loadWorkspaceRoot();

  for (const path of Array.from(expandedPaths)) {
    try {
      await loadChildren(path);
    } catch {
      expandedPaths.delete(path);
    }
  }

  notifyListeners();
}

export function clearWorkspaceCache(): void {
  childrenCache.clear();
  notifyListeners();
}
