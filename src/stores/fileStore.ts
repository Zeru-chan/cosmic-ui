import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import {
  getParentPath,
  joinPath,
  normalizeAbsolutePath,
  normalizePath,
  pathStartsWith,
} from "../utils/filePaths";
import { getFileExtension } from "../utils/fileTypes";

export interface VirtualFile {
  id: string;
  name: string;
  relativePath: string;
  content: string;
  createdAt: number;
  modifiedAt: number;
  filePath: string;
  extension: string | null;
  isAutoexec?: boolean;
}

export interface ScriptTreeNode {
  id: string;
  name: string;
  relativePath: string;
  filePath: string;
  isDir: boolean;
  extension: string | null;
  fileId?: string;
  isAutoexec?: boolean;
  children?: ScriptTreeNode[];
}

export interface FileStore {
  readonly files: Map<string, VirtualFile>;
  getFile: (id: string) => VirtualFile | undefined;
  getFileByName: (name: string) => VirtualFile | undefined;
  getFileByRelativePath: (relativePath: string) => VirtualFile | undefined;
  getAllFiles: () => VirtualFile[];
  getScriptTree: () => ScriptTreeNode[];
  createDirectory: (
    name: string,
    parentRelativePath?: string,
  ) => Promise<{ path: string }>;
  createFile: (
    name: string,
    content?: string,
    directoryRelativePath?: string,
  ) => Promise<VirtualFile>;
  updateFile: (id: string, content: string) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  deletePath: (relativePath: string, isDir: boolean) => Promise<void>;
  renameFile: (id: string, newName: string) => Promise<VirtualFile>;
  renameDirectory: (
    relativePath: string,
    newName: string,
  ) => Promise<{ oldPath: string; newPath: string }>;
  movePath: (
    relativePath: string,
    targetDirectoryRelativePath?: string,
  ) => Promise<
    | { isDir: false; oldPath: string; newPath: string; file: VirtualFile }
    | { isDir: true; oldPath: string; newPath: string }
  >;
  loadFilesFromDisk: () => Promise<void>;
  getFilePath: (id: string) => string | undefined;
  revealInExplorer: (id: string) => Promise<void>;
  addToAutoexec: (id: string) => Promise<void>;
  removeFromAutoexec: (id: string) => Promise<void>;
  isInAutoexec: (id: string) => boolean;
}

let scriptsDir: string | null = null;
let files: Map<string, VirtualFile> = new Map();
let scriptTree: ScriptTreeNode[] = [];
let listeners: Set<() => void> = new Set();
let initialized = false;

const DEFAULT_FILE_STATE_STORAGE_KEY = "synz:default-file-state";
const DEFAULT_FILE_TEMPLATES: Record<string, string> = {
  "example.lua": `-- Example Luau Script
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local function onPlayerAdded(player: Player)
    print("Welcome, " .. player.Name .. "!")

    player.CharacterAdded:Connect(function(character)
        local humanoid = character:WaitForChild("Humanoid")
        humanoid.WalkSpeed = 16
        humanoid.JumpPower = 50
    end)
end

Players.PlayerAdded:Connect(onPlayerAdded)

for _, player in Players:GetPlayers() do
    task.spawn(onPlayerAdded, player)
end

print("Example script loaded!")
`,
  "test.lua": `-- Test Script
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local config = {
    enabled = true,
    interval = 1,
    maxRetries = 3,
}

local function makeRequest(url: string, data: any): boolean
    local success, result = pcall(function()
        return HttpService:JSONEncode(data)
    end)

    if success then
        print("Request data:", result)
        return true
    else
        warn("Failed to encode:", result)
        return false
    end
end

local connection = RunService.Heartbeat:Connect(function(deltaTime)
    if config.enabled then
    end
end)

print("Test script initialized!")
`,
};

interface DefaultFileState {
  seeded: boolean;
  deleted: string[];
}

function isScriptFileName(name: string): boolean {
  return name.endsWith(".lua") || name.endsWith(".luau");
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

function generateId(seed: string): string {
  return `file_${seed.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
}

function getDefaultFileState(): DefaultFileState {
  try {
    const raw = localStorage.getItem(DEFAULT_FILE_STATE_STORAGE_KEY);
    if (!raw) {
      return { seeded: false, deleted: [] };
    }

    const parsed = JSON.parse(raw) as Partial<DefaultFileState>;
    return {
      seeded: parsed.seeded === true,
      deleted: Array.isArray(parsed.deleted)
        ? parsed.deleted.filter(
            (name): name is string => typeof name === "string",
          )
        : [],
    };
  } catch {
    return { seeded: false, deleted: [] };
  }
}

function saveDefaultFileState(state: DefaultFileState): void {
  try {
    localStorage.setItem(DEFAULT_FILE_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
  }
}

function isManagedDefaultFile(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULT_FILE_TEMPLATES, name);
}

function markDefaultFileDeleted(name: string): void {
  if (!isManagedDefaultFile(name)) {
    return;
  }

  const state = getDefaultFileState();
  if (state.deleted.includes(name)) {
    return;
  }

  saveDefaultFileState({
    ...state,
    deleted: [...state.deleted, name],
  });
}

function isRootRelativePath(relativePath: string): boolean {
  return getParentPath(relativePath) === "";
}

function toAutoexecScriptName(relativePath: string): string {
  return normalizePath(relativePath).replace(/\\/g, "__");
}

async function getScriptsDir(): Promise<string> {
  if (!scriptsDir) {
    scriptsDir = normalizeAbsolutePath(await invoke<string>("get_scripts_path"));
  }

  return scriptsDir;
}

async function ensureScriptsDir(): Promise<string> {
  return getScriptsDir();
}

async function createDefaultFiles(): Promise<void> {
  const defaultFileState = getDefaultFileState();
  if (defaultFileState.seeded) {
    return;
  }

  const dir = await getScriptsDir();
  for (const [fileName, content] of Object.entries(DEFAULT_FILE_TEMPLATES)) {
    if (defaultFileState.deleted.includes(fileName)) {
      continue;
    }

    const filePath = normalizeAbsolutePath(`${dir}\\${fileName}`);
    if (!(await exists(filePath))) {
      await writeTextFile(filePath, content);
    }
  }

  saveDefaultFileState({
    ...defaultFileState,
    seeded: true,
  });
}

async function getAutoexecScripts(): Promise<Set<string>> {
  try {
    const autoexecScripts = await invoke<string[]>("get_autoexec_scripts");
    return new Set(autoexecScripts);
  } catch {
    return new Set<string>();
  }
}

async function syncAutoexecRenames(
  renames: Array<{ oldName: string; newName: string; content: string }>,
): Promise<void> {
  for (const renameEntry of renames) {
    if (renameEntry.oldName === renameEntry.newName) {
      continue;
    }

    try {
      await invoke("remove_from_autoexec", {
        scriptName: renameEntry.oldName,
      });
    } catch {
    }

    try {
      await invoke("add_to_autoexec", {
        scriptName: renameEntry.newName,
        content: renameEntry.content,
      });
    } catch {
    }
  }
}

async function removeAutoexecEntries(scriptNames: string[]): Promise<void> {
  for (const scriptName of scriptNames) {
    try {
      await invoke("remove_from_autoexec", { scriptName });
    } catch {
    }
  }
}

async function buildScriptTree(
  absoluteDirPath: string,
  relativeDirPath: string,
  newFiles: Map<string, VirtualFile>,
  existingByPath: Map<string, VirtualFile>,
  autoexecScripts: Set<string>,
): Promise<ScriptTreeNode[]> {
  const entries = await readDir(absoluteDirPath);
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.isDirectory === b.isDirectory) {
      return a.name.localeCompare(b.name);
    }

    return a.isDirectory ? -1 : 1;
  });

  const nodes: ScriptTreeNode[] = [];

  for (const entry of sortedEntries) {
    const absolutePath = normalizeAbsolutePath(
      `${absoluteDirPath}\\${entry.name}`,
    );
    const relativePath = joinPath(relativeDirPath, entry.name);

    if (entry.isDirectory) {
      const children = await buildScriptTree(
        absolutePath,
        relativePath,
        newFiles,
        existingByPath,
        autoexecScripts,
      );

      nodes.push({
        id: `dir_${relativePath}`,
        name: entry.name,
        relativePath,
        filePath: absolutePath,
        isDir: true,
        extension: null,
        children,
      });
      continue;
    }

    if (!entry.isFile || !isScriptFileName(entry.name)) {
      continue;
    }

    const content = await readTextFile(absolutePath);
    const existingFile =
      existingByPath.get(absolutePath) ??
      Array.from(files.values()).find(
        (file) => normalizePath(file.relativePath) === relativePath,
      );
    const id = existingFile?.id || generateId(relativePath);
    const now = Date.now();
    const autoexecKey = toAutoexecScriptName(relativePath);

    const virtualFile: VirtualFile = {
      id,
      name: entry.name,
      relativePath,
      content,
      createdAt: existingFile?.createdAt || now,
      modifiedAt: now,
      filePath: absolutePath,
      extension: getFileExtension(entry.name),
      isAutoexec: autoexecScripts.has(autoexecKey),
    };

    newFiles.set(id, virtualFile);
    nodes.push({
      id: `file_${id}`,
      fileId: id,
      name: entry.name,
      relativePath,
      filePath: absolutePath,
      isDir: false,
      extension: virtualFile.extension,
      isAutoexec: virtualFile.isAutoexec,
    });
  }

  return nodes;
}

async function reloadFilesFromDisk(): Promise<void> {
  const dir = await ensureScriptsDir();
  await createDefaultFiles();

  const existingByPath = new Map(
    Array.from(files.values()).map((file) => [file.filePath, file]),
  );
  const newFiles = new Map<string, VirtualFile>();
  const autoexecScripts = await getAutoexecScripts();

  scriptTree = await buildScriptTree(
    dir,
    "",
    newFiles,
    existingByPath,
    autoexecScripts,
  );
  files = newFiles;
  initialized = true;
  notifyListeners();
}

export const fileStore: FileStore = {
  get files() {
    return files;
  },

  getFile(id: string): VirtualFile | undefined {
    return files.get(id);
  },

  getFileByName(name: string): VirtualFile | undefined {
    const normalizedInput = normalizePath(name);
    const matchByRelativePath = normalizedInput.includes("\\");

    for (const file of files.values()) {
      if (
        matchByRelativePath
          ? normalizePath(file.relativePath) === normalizedInput
          : file.name === name
      ) {
        return file;
      }
    }

    return undefined;
  },

  getFileByRelativePath(relativePath: string): VirtualFile | undefined {
    const normalizedRelativePath = normalizePath(relativePath);
    for (const file of files.values()) {
      if (normalizePath(file.relativePath) === normalizedRelativePath) {
        return file;
      }
    }
    return undefined;
  },

  getAllFiles(): VirtualFile[] {
    return Array.from(files.values()).sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    );
  },

  getScriptTree(): ScriptTreeNode[] {
    return scriptTree;
  },

  getFilePath(id: string): string | undefined {
    return files.get(id)?.filePath;
  },

  async revealInExplorer(id: string): Promise<void> {
    const file = files.get(id);
    if (file?.filePath) {
      await invoke("reveal_in_explorer", { path: file.filePath });
    }
  },

  async createFile(
    name: string,
    content = "",
    directoryRelativePath = "",
  ): Promise<VirtualFile> {
    const dir = await ensureScriptsDir();
    const relativePath = joinPath(directoryRelativePath, name);
    const filePath = normalizeAbsolutePath(`${dir}\\${relativePath}`);
    const parentDirectory = getParentPath(filePath);

    if (parentDirectory) {
      await mkdir(parentDirectory, { recursive: true });
    }

    const id = generateId(relativePath);
    const now = Date.now();
    const file: VirtualFile = {
      id,
      name,
      relativePath,
      content,
      createdAt: now,
      modifiedAt: now,
      filePath,
      extension: getFileExtension(name),
    };

    await writeTextFile(filePath, content);
    files.set(id, file);
    await reloadFilesFromDisk();

    return files.get(id) || file;
  },

  async createDirectory(
    name: string,
    parentRelativePath = "",
  ): Promise<{ path: string }> {
    const relativePath = joinPath(parentRelativePath, name);
    await invoke("create_scripts_folder", {
      relativePath,
    });
    await reloadFilesFromDisk();

    return { path: relativePath };
  },

  async updateFile(id: string, content: string): Promise<void> {
    const file = files.get(id);
    if (!file?.filePath) {
      return;
    }

    await writeTextFile(file.filePath, content);

    const updatedFile: VirtualFile = {
      ...file,
      content,
      modifiedAt: Date.now(),
    };

    files.set(id, updatedFile);
    notifyListeners();
  },

  async deleteFile(id: string): Promise<void> {
    const file = files.get(id);
    if (!file?.filePath) {
      return;
    }

    await remove(file.filePath);

    if (file.isAutoexec) {
      await removeAutoexecEntries([toAutoexecScriptName(file.relativePath)]);
    }

    if (isRootRelativePath(file.relativePath)) {
      markDefaultFileDeleted(file.name);
    }

    files.delete(id);
    await reloadFilesFromDisk();
  },

  async deletePath(relativePath: string, isDir: boolean): Promise<void> {
    const dir = await ensureScriptsDir();
    const normalizedRelativePath = normalizePath(relativePath);
    const absolutePath = normalizeAbsolutePath(`${dir}\\${normalizedRelativePath}`);
    const affectedFiles = Array.from(files.values()).filter((file) =>
      pathStartsWith(file.relativePath, normalizedRelativePath),
    );

    await remove(absolutePath, { recursive: isDir });

    if (affectedFiles.length > 0) {
      await removeAutoexecEntries(
        affectedFiles
          .filter((file) => file.isAutoexec)
          .map((file) => toAutoexecScriptName(file.relativePath)),
      );
    }

    if (!isDir) {
      const deletedFile = affectedFiles[0];
      if (deletedFile && isRootRelativePath(deletedFile.relativePath)) {
        markDefaultFileDeleted(deletedFile.name);
      }
    }

    await reloadFilesFromDisk();
  },

  async renameFile(id: string, newName: string): Promise<VirtualFile> {
    const file = files.get(id);
    if (!file?.filePath) {
      throw new Error("File not found");
    }

    const dir = await ensureScriptsDir();
    const currentDirectory = getParentPath(file.relativePath);
    const newRelativePath = joinPath(currentDirectory, newName);
    const newPath = normalizeAbsolutePath(`${dir}\\${newRelativePath}`);
    const oldAutoexecName = toAutoexecScriptName(file.relativePath);
    const newAutoexecName = toAutoexecScriptName(newRelativePath);

    await rename(file.filePath, newPath);

    const updatedFile: VirtualFile = {
      ...file,
      name: newName,
      relativePath: newRelativePath,
      filePath: newPath,
      extension: getFileExtension(newName),
      modifiedAt: Date.now(),
    };

    files.set(id, updatedFile);

    if (file.isAutoexec) {
      await syncAutoexecRenames([
        {
          oldName: oldAutoexecName,
          newName: newAutoexecName,
          content: file.content,
        },
      ]);
    }

    if (isRootRelativePath(file.relativePath) && file.name !== newName) {
      markDefaultFileDeleted(file.name);
    }

    await reloadFilesFromDisk();
    return files.get(id) || updatedFile;
  },

  async renameDirectory(
    relativePath: string,
    newName: string,
  ): Promise<{ oldPath: string; newPath: string }> {
    const dir = await ensureScriptsDir();
    const normalizedRelativePath = normalizePath(relativePath);
    const parentRelativePath = getParentPath(normalizedRelativePath);
    const newRelativePath = joinPath(parentRelativePath, newName);
    const oldAbsolutePath = normalizeAbsolutePath(
      `${dir}\\${normalizedRelativePath}`,
    );
    const newAbsolutePath = normalizeAbsolutePath(`${dir}\\${newRelativePath}`);
    const affectedFiles = Array.from(files.values()).filter((file) =>
      pathStartsWith(file.relativePath, normalizedRelativePath),
    );

    await rename(oldAbsolutePath, newAbsolutePath);

    if (affectedFiles.length > 0) {
      await syncAutoexecRenames(
        affectedFiles
          .filter((file) => file.isAutoexec)
          .map((file) => ({
            oldName: toAutoexecScriptName(file.relativePath),
            newName: toAutoexecScriptName(
              file.relativePath.replace(normalizedRelativePath, newRelativePath),
            ),
            content: file.content,
          })),
      );
    }

    await reloadFilesFromDisk();
    return { oldPath: normalizedRelativePath, newPath: newRelativePath };
  },

  async movePath(
    relativePath: string,
    targetDirectoryRelativePath = "",
  ): Promise<
    | { isDir: false; oldPath: string; newPath: string; file: VirtualFile }
    | { isDir: true; oldPath: string; newPath: string }
  > {
    const dir = await ensureScriptsDir();
    const normalizedRelativePath = normalizePath(relativePath);
    const normalizedTargetDirectory = normalizePath(targetDirectoryRelativePath);
    const name = normalizedRelativePath.split("\\").pop() || normalizedRelativePath;
    const newRelativePath = joinPath(normalizedTargetDirectory, name);
    const getFileByRelativePath = (lookupPath: string): VirtualFile | undefined => {
      const normalizedLookupPath = normalizePath(lookupPath);
      for (const file of files.values()) {
        if (normalizePath(file.relativePath) === normalizedLookupPath) {
          return file;
        }
      }
      return undefined;
    };

    if (!normalizedRelativePath || normalizedRelativePath === newRelativePath) {
      throw new Error("Path is already in that location");
    }

    if (pathStartsWith(normalizedTargetDirectory, normalizedRelativePath)) {
      throw new Error("Cannot move a folder into itself");
    }

    const targetAbsolutePath = normalizeAbsolutePath(`${dir}\\${newRelativePath}`);

    if (await exists(targetAbsolutePath)) {
      throw new Error("A file or folder with that name already exists");
    }

    const file = getFileByRelativePath(normalizedRelativePath);
    const affectedFiles = file
      ? [file]
      : Array.from(files.values()).filter((candidate) =>
          pathStartsWith(candidate.relativePath, normalizedRelativePath),
        );
    const isDir = !file;

    await invoke("move_scripts_entry", {
      fromRelativePath: normalizedRelativePath,
      toRelativePath: newRelativePath,
    });

    if (affectedFiles.length > 0) {
      await syncAutoexecRenames(
        affectedFiles
          .filter((candidate) => candidate.isAutoexec)
          .map((candidate) => ({
            oldName: toAutoexecScriptName(candidate.relativePath),
            newName: toAutoexecScriptName(
              candidate.relativePath.replace(
                normalizedRelativePath,
                newRelativePath,
              ),
            ),
            content: candidate.content,
          })),
      );
    }

    await reloadFilesFromDisk();

    if (!isDir) {
      const movedFile = getFileByRelativePath(newRelativePath);
      if (!movedFile) {
        throw new Error("Moved file not found");
      }

      return {
        isDir: false,
        oldPath: normalizedRelativePath,
        newPath: newRelativePath,
        file: movedFile,
      };
    }

    return {
      isDir: true,
      oldPath: normalizedRelativePath,
      newPath: newRelativePath,
    };
  },

  async loadFilesFromDisk(): Promise<void> {
    await reloadFilesFromDisk();
  },

  async addToAutoexec(id: string): Promise<void> {
    const file = files.get(id);
    if (!file) {
      return;
    }

    await invoke("add_to_autoexec", {
      scriptName: toAutoexecScriptName(file.relativePath),
      content: file.content,
    });

    files.set(id, { ...file, isAutoexec: true });
    await reloadFilesFromDisk();
  },

  async removeFromAutoexec(id: string): Promise<void> {
    const file = files.get(id);
    if (!file) {
      return;
    }

    await invoke("remove_from_autoexec", {
      scriptName: toAutoexecScriptName(file.relativePath),
    });

    files.set(id, { ...file, isAutoexec: false });
    await reloadFilesFromDisk();
  },

  isInAutoexec(id: string): boolean {
    return files.get(id)?.isAutoexec ?? false;
  },
};

export function subscribeToFileStore(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function initializeFileStore(): Promise<void> {
  if (!initialized) {
    await reloadFilesFromDisk();
  }
}
