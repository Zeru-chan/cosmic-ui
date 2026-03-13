import type { PaneTabKind } from "../stores/splitStore";

const CODE_EXTENSIONS = new Set(["lua", "luau"]);
const JSON_EXTENSIONS = new Set(["json", "jsonc"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "csv",
  "html",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "sh",
  "bat",
  "ps1",
]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "ico",
  "avif",
]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "mov",
  "avi",
  "mkv",
  "wmv",
  "m4v",
]);

export function getFileExtension(nameOrPath: string | null | undefined): string | null {
  if (!nameOrPath) {
    return null;
  }

  const fileName = nameOrPath.split(/[/\\]/).pop() || "";
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return null;
  }

  return fileName.slice(lastDot + 1).toLowerCase();
}

export function isCodeFile(extension: string | null): boolean {
  return Boolean(extension && CODE_EXTENSIONS.has(extension.toLowerCase()));
}

export function isJsonFile(extension: string | null): boolean {
  return Boolean(extension && JSON_EXTENSIONS.has(extension.toLowerCase()));
}

export function isTextFileExtension(extension: string | null): boolean {
  if (!extension) {
    return false;
  }

  const normalized = extension.toLowerCase();
  return (
    CODE_EXTENSIONS.has(normalized) ||
    JSON_EXTENSIONS.has(normalized) ||
    TEXT_EXTENSIONS.has(normalized)
  );
}

export function isImageFile(extension: string | null): boolean {
  return Boolean(extension && IMAGE_EXTENSIONS.has(extension.toLowerCase()));
}

export function isAudioFile(extension: string | null): boolean {
  return Boolean(extension && AUDIO_EXTENSIONS.has(extension.toLowerCase()));
}

export function isVideoFile(extension: string | null): boolean {
  return Boolean(extension && VIDEO_EXTENSIONS.has(extension.toLowerCase()));
}

export function getPaneTabKind(extension: string | null): PaneTabKind {
  if (isCodeFile(extension)) {
    return "code";
  }

  if (isJsonFile(extension)) {
    return "json";
  }

  if (isTextFileExtension(extension)) {
    return "text";
  }

  if (isImageFile(extension)) {
    return "image";
  }

  if (isAudioFile(extension)) {
    return "audio";
  }

  if (isVideoFile(extension)) {
    return "video";
  }

  return "binary";
}

export function getMonacoLanguage(extension: string | null): string {
  if (!extension) {
    return "plaintext";
  }

  const normalized = extension.toLowerCase();

  if (CODE_EXTENSIONS.has(normalized)) return "luau";
  if (JSON_EXTENSIONS.has(normalized)) return "json";
  if (normalized === "md") return "markdown";
  if (normalized === "xml") return "xml";
  if (normalized === "html") return "html";
  if (normalized === "css") return "css";
  if (normalized === "js") return "javascript";
  if (normalized === "jsx") return "javascript";
  if (normalized === "ts") return "typescript";
  if (normalized === "tsx") return "typescript";
  if (normalized === "py") return "python";
  if (normalized === "ps1") return "powershell";
  if (normalized === "sh" || normalized === "bat") return "shell";

  return "plaintext";
}
