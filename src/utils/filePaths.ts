export function normalizePath(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+/g, "\\").replace(/^\\+|\\+$/g, "");
}

export function normalizeAbsolutePath(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+/g, "\\");
}

export function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("\\");
  return parts[parts.length - 1] || "";
}

export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("\\");
  parts.pop();
  return parts.join("\\");
}

export function joinPath(...parts: Array<string | null | undefined>): string {
  return normalizePath(
    parts
      .filter((part): part is string => Boolean(part))
      .join("\\"),
  );
}

export function replaceBaseName(path: string, newName: string): string {
  const parent = getParentPath(path);
  return joinPath(parent, newName);
}

export function pathStartsWith(path: string, prefix: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase();
  const normalizedPrefix = normalizePath(prefix).toLowerCase();

  if (!normalizedPrefix) {
    return true;
  }

  return (
    normalizedPath === normalizedPrefix ||
    normalizedPath.startsWith(`${normalizedPrefix}\\`)
  );
}
