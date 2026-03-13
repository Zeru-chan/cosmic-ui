import { useState, useEffect, useCallback, useRef } from "react";
import { colors } from "../../config/theme";
import { useAccentColor } from "../../hooks/useAccentColor";
import { DragGhost } from "./DragGhost";
import {
  fileStore,
  initializeFileStore,
  ScriptTreeNode,
  subscribeToFileStore,
  VirtualFile,
} from "../../stores/fileStore";
import {
  WorkspaceNode,
  deleteWorkspacePath,
  getChildren,
  getRootEntries,
  isExpanded,
  isWorkspaceInitialized,
  loadWorkspaceRoot,
  refreshWorkspace,
  renameWorkspacePath,
  subscribeWorkspace,
  toggleExpand,
} from "../../stores/workspaceStore";
import type { PaneTabSource } from "../../stores/splitStore";
import { isAudioFile, isImageFile, isVideoFile } from "../../utils/fileTypes";
import { getParentPath, joinPath, pathStartsWith } from "../../utils/filePaths";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Code,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image,
  Music,
  Plus,
  RefreshCw,
  Search,
  Settings,
  User,
  Users,
  Video,
  Zap,
} from "lucide-react";

export type SidebarMutation =
  | { type: "script-file-renamed"; file: VirtualFile; oldPath: string }
  | { type: "script-path-removed"; path: string; isDir: boolean }
  | { type: "script-directory-renamed"; oldPath: string; newPath: string }
  | { type: "workspace-file-renamed"; oldPath: string; newPath: string }
  | { type: "workspace-path-removed"; path: string; isDir: boolean }
  | { type: "workspace-directory-renamed"; oldPath: string; newPath: string };

interface SidebarProps {
  activeTabPath?: string;
  activeTabSource?: PaneTabSource;
  onFileOpen: (fileId: string, fileName: string) => void;
  onSettingsClick?: () => void;
  onScriptHubClick?: () => void;
  onAccountClick?: () => void;
  onClientManagerClick?: () => void;
  onRevealInExplorer?: (fileId: string) => void;
  onWorkspaceFileOpen?: (
    path: string,
    name: string,
    extension: string | null,
  ) => void;
  onSidebarMutation?: (mutation: SidebarMutation) => void;
  showWorkspace?: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  position: "left" | "right";
  order?: number;
}

interface SidebarItemRef {
  source: "scripts" | "workspace";
  path: string;
  name: string;
  isDir: boolean;
  extension: string | null;
  fileId?: string;
  isAutoexec?: boolean;
}

const SIDEBAR_DROP_PATH_ATTR = "data-sidebar-script-drop-path";
const SIDEBAR_ROOT_DROP_ATTR = "data-sidebar-script-root-drop";

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  item: SidebarItemRef | null;
}

interface ScriptTreeItemProps {
  node: ScriptTreeNode;
  level: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  activePath?: string;
  activeSource?: PaneTabSource;
  editingPath: string | null;
  renameValue: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onOpen: (node: ScriptTreeNode) => void;
  onContextMenu: (e: React.MouseEvent, item: SidebarItemRef) => void;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: (item: SidebarItemRef) => void;
  onRenameCancel: () => void;
  consumeInteractionSuppression: () => boolean;
  onPointerDragStartNode: (
    item: SidebarItemRef,
    e: React.MouseEvent<HTMLDivElement>,
  ) => void;
  draggedPath: string | null;
  dropTargetPath: string | null;
  accentColor: string;
  forceExpanded?: boolean;
}

function getDropPathFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const dropElement = target.closest<HTMLElement>(`[${SIDEBAR_DROP_PATH_ATTR}]`);
  return dropElement?.getAttribute(SIDEBAR_DROP_PATH_ATTR) || null;
}

function isRootDropTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest(`[${SIDEBAR_ROOT_DROP_ATTR}="true"]`));
}

function findScriptNodeByPath(
  nodes: ScriptTreeNode[],
  path: string,
): ScriptTreeNode | null {
  for (const node of nodes) {
    if (node.relativePath === path) {
      return node;
    }

    if (node.isDir && node.children) {
      const childMatch = findScriptNodeByPath(node.children, path);
      if (childMatch) {
        return childMatch;
      }
    }
  }

  return null;
}

function getFileIcon(extension: string | null, isDir: boolean) {
  if (isDir) {
    return <Folder size={14} color="#FBBF24" />;
  }

  if (!extension) {
    return <File size={14} color={colors.textMuted} />;
  }

  if (extension === "lua" || extension === "luau") {
    return <Code size={14} color="#4ADE80" />;
  }

  if (extension === "json" || extension === "yaml" || extension === "yml" || extension === "toml") {
    return <FileText size={14} color="#60A5FA" />;
  }

  if (isImageFile(extension)) {
    return <Image size={14} color="#F472B6" />;
  }

  if (isAudioFile(extension)) {
    return <Music size={14} color="#A78BFA" />;
  }

  if (isVideoFile(extension)) {
    return <Video size={14} color="#FB923C" />;
  }

  return <File size={14} color={colors.textMuted} />;
}

function filterScriptTree(
  nodes: ScriptTreeNode[],
  query: string,
): ScriptTreeNode[] {
  if (!query.trim()) {
    return nodes;
  }

  const normalizedQuery = query.trim().toLowerCase();

  return nodes
    .map((node) => {
      if (node.isDir) {
        const filteredChildren = filterScriptTree(node.children || [], query);
        if (
          node.name.toLowerCase().includes(normalizedQuery) ||
          filteredChildren.length > 0
        ) {
          return {
            ...node,
            children: filteredChildren,
          };
        }

        return null;
      }

      return node.name.toLowerCase().includes(normalizedQuery) ? node : null;
    })
    .filter((node): node is ScriptTreeNode => Boolean(node));
}

function remapExpandedScriptPaths(
  expandedPaths: Set<string>,
  oldPath: string,
  newPath: string,
): Set<string> {
  const nextExpandedPaths = new Set<string>();

  for (const path of expandedPaths) {
    if (pathStartsWith(path, oldPath)) {
      nextExpandedPaths.add(path.replace(oldPath, newPath));
    } else {
      nextExpandedPaths.add(path);
    }
  }

  return nextExpandedPaths;
}

function removeExpandedScriptPath(
  expandedPaths: Set<string>,
  removedPath: string,
): Set<string> {
  const nextExpandedPaths = new Set<string>();

  for (const path of expandedPaths) {
    if (!pathStartsWith(path, removedPath)) {
      nextExpandedPaths.add(path);
    }
  }

  return nextExpandedPaths;
}

function ScriptTreeItem({
  node,
  level,
  expandedPaths,
  selectedPath,
  activePath,
  activeSource,
  editingPath,
  renameValue,
  onToggle,
  onSelect,
  onOpen,
  onContextMenu,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  consumeInteractionSuppression,
  onPointerDragStartNode,
  draggedPath,
  dropTargetPath,
  accentColor,
  forceExpanded = false,
}: ScriptTreeItemProps) {
  const [hovered, setHovered] = useState(false);
  const isEditing = editingPath === node.relativePath;
  const isExpanded = forceExpanded || expandedPaths.has(node.relativePath);
  const isActive =
    activeSource === "scripts" && activePath === node.relativePath;
  const isSelected = selectedPath === node.relativePath;
  const isDragged = draggedPath === node.relativePath;
  const isDropTarget = dropTargetPath === node.relativePath;

  const itemRef: SidebarItemRef = {
    source: "scripts",
    path: node.relativePath,
    name: node.name,
    isDir: node.isDir,
    extension: node.extension,
    fileId: node.fileId,
    isAutoexec: node.isAutoexec,
  };

  return (
    <>
      <div
        data-sidebar-script-drop-path={node.isDir ? node.relativePath : undefined}
        onClick={() => {
          if (consumeInteractionSuppression()) {
            return;
          }

          onSelect(node.relativePath);
          if (node.isDir) {
            onToggle(node.relativePath);
          }
        }}
        onDoubleClick={() => {
          if (consumeInteractionSuppression()) {
            return;
          }

          if (!node.isDir) {
            onOpen(node);
          }
        }}
        onContextMenu={(e) => {
          onSelect(node.relativePath);
          onContextMenu(e, itemRef);
        }}
        onMouseDown={(e) => {
          if (isEditing) {
            return;
          }

          onPointerDragStartNode(itemRef, e);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          paddingLeft: 10 + level * 12,
          cursor: "pointer",
          borderRadius: 6,
          margin: "0 6px",
          background: isActive
            ? `linear-gradient(135deg, ${accentColor}15 0%, ${accentColor}08 100%)`
            : isSelected
            ? "rgba(255,255,255,0.05)"
            : isDropTarget
            ? `${accentColor}26`
            : hovered
            ? "rgba(255,255,255,0.03)"
            : "transparent",
          border: isActive
            ? `1px solid ${accentColor}25`
            : isDropTarget
            ? `1px dashed ${accentColor}70`
            : "1px solid transparent",
          boxShadow: isDropTarget ? `inset 0 0 0 1px ${accentColor}20` : "none",
          transition: "all 0.15s ease",
          opacity: isDragged ? 0.45 : 1,
        }}
      >
        <div
          style={{
            width: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            opacity: node.isDir ? 1 : 0.4,
          }}
        >
          {node.isDir ? (
            isExpanded ? (
              <ChevronDown size={10} color={colors.textMuted} />
            ) : (
              <ChevronRight size={10} color={colors.textMuted} />
            )
          ) : null}
        </div>
        {getFileIcon(node.extension, node.isDir)}
        {isEditing ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRenameSubmit(itemRef);
              } else if (e.key === "Escape") {
                onRenameCancel();
              }
            }}
            onBlur={onRenameCancel}
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              padding: "6px 8px",
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${accentColor}40`,
              borderRadius: 6,
              outline: "none",
              fontSize: 11,
              color: colors.textWhite,
            }}
          />
        ) : (
          <>
            <span
              style={{
                fontSize: 11,
                color: isActive ? colors.textWhite : colors.textMuted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {node.name}
            </span>
            {isDropTarget && node.isDir && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: accentColor,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                Drop
              </span>
            )}
            {node.isAutoexec && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "2px 5px",
                  borderRadius: 4,
                  background: "#FBBF2420",
                }}
                title="Auto-execute enabled"
              >
                <Zap size={10} color="#FBBF24" />
              </div>
            )}
          </>
        )}
      </div>
      {node.isDir &&
        isExpanded &&
        (node.children || []).map((child) => (
          <ScriptTreeItem
            key={child.relativePath}
            node={child}
            level={level + 1}
            expandedPaths={expandedPaths}
            selectedPath={selectedPath}
            activePath={activePath}
            activeSource={activeSource}
            editingPath={editingPath}
            renameValue={renameValue}
            onToggle={onToggle}
            onSelect={onSelect}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            onRenameValueChange={onRenameValueChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            consumeInteractionSuppression={consumeInteractionSuppression}
            onPointerDragStartNode={onPointerDragStartNode}
            draggedPath={draggedPath}
            dropTargetPath={dropTargetPath}
            accentColor={accentColor}
            forceExpanded={forceExpanded}
          />
        ))}
    </>
  );
}

interface WorkspaceTreeItemProps {
  node: WorkspaceNode;
  level: number;
  selectedPath: string | null;
  activePath?: string;
  activeSource?: PaneTabSource;
  editingPath: string | null;
  renameValue: string;
  onSelect: (path: string) => void;
  onOpen: (node: WorkspaceNode) => void;
  onContextMenu: (e: React.MouseEvent, item: SidebarItemRef) => void;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: (item: SidebarItemRef) => void;
  onRenameCancel: () => void;
  accentColor: string;
}

function WorkspaceTreeItem({
  node,
  level,
  selectedPath,
  activePath,
  activeSource,
  editingPath,
  renameValue,
  onSelect,
  onOpen,
  onContextMenu,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  accentColor,
}: WorkspaceTreeItemProps) {
  const [hovered, setHovered] = useState(false);
  const [loading, setLoading] = useState(false);
  const expanded = isExpanded(node.path);
  const children = getChildren(node.path);
  const isEditing = editingPath === node.path;
  const isActive =
    activeSource === "workspace" && activePath === node.path;
  const isSelected = selectedPath === node.path;

  const itemRef: SidebarItemRef = {
    source: "workspace",
    path: node.path,
    name: node.name,
    isDir: node.is_dir,
    extension: node.extension,
  };

  const handleToggle = async () => {
    if (!node.is_dir) {
      return;
    }

    setLoading(true);
    await toggleExpand(node.path);
    setLoading(false);
  };

  return (
    <>
      <div
        onClick={async () => {
          onSelect(node.path);
          if (node.is_dir) {
            await handleToggle();
          }
        }}
        onDoubleClick={() => {
          if (!node.is_dir) {
            onOpen(node);
          }
        }}
        onContextMenu={(e) => {
          onSelect(node.path);
          onContextMenu(e, itemRef);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          paddingLeft: 10 + level * 12,
          cursor: "pointer",
          borderRadius: 6,
          margin: "0 6px",
          background: isActive
            ? `linear-gradient(135deg, ${accentColor}15 0%, ${accentColor}08 100%)`
            : isSelected
            ? "rgba(255,255,255,0.05)"
            : hovered
            ? "rgba(255,255,255,0.03)"
            : "transparent",
          border: isActive
            ? `1px solid ${accentColor}25`
            : "1px solid transparent",
          transition: "all 0.15s ease",
        }}
      >
        <div
          style={{
            width: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            opacity: node.is_dir ? 1 : 0.4,
          }}
        >
          {node.is_dir ? (
            loading ? (
              <RefreshCw
                size={10}
                color={colors.textMuted}
                style={{ animation: "spin 1s linear infinite" }}
              />
            ) : expanded ? (
              <ChevronDown size={10} color={colors.textMuted} />
            ) : (
              <ChevronRight size={10} color={colors.textMuted} />
            )
          ) : null}
        </div>
        {getFileIcon(node.extension, node.is_dir)}
        {isEditing ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRenameSubmit(itemRef);
              } else if (e.key === "Escape") {
                onRenameCancel();
              }
            }}
            onBlur={onRenameCancel}
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              padding: "6px 8px",
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${accentColor}40`,
              borderRadius: 6,
              outline: "none",
              fontSize: 11,
              color: colors.textWhite,
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 11,
              color: isActive ? colors.textWhite : colors.textMuted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {node.name}
          </span>
        )}
      </div>
      {node.is_dir &&
        expanded &&
        (children || []).map((child) => (
          <WorkspaceTreeItem
            key={child.path}
            node={child}
            level={level + 1}
            selectedPath={selectedPath}
            activePath={activePath}
            activeSource={activeSource}
            editingPath={editingPath}
            renameValue={renameValue}
            onSelect={onSelect}
            onOpen={onOpen}
            onContextMenu={onContextMenu}
            onRenameValueChange={onRenameValueChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            accentColor={accentColor}
          />
        ))}
    </>
  );
}

export function Sidebar({
  activeTabPath,
  activeTabSource,
  onFileOpen,
  onSettingsClick,
  onScriptHubClick,
  onAccountClick,
  onClientManagerClick,
  onRevealInExplorer,
  onWorkspaceFileOpen,
  onSidebarMutation,
  showWorkspace = true,
  width,
  onWidthChange,
  position,
  order,
}: SidebarProps) {
  const accent = useAccentColor();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [scriptTree, setScriptTree] = useState<ScriptTreeNode[]>([]);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceNode[]>([]);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [expandedScriptPaths, setExpandedScriptPaths] = useState<Set<string>>(
    new Set(),
  );
  const [selectedScriptPath, setSelectedScriptPath] = useState<string | null>(
    null,
  );
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<
    string | null
  >(null);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [creationParentPath, setCreationParentPath] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    item: null,
  });
  const [isResizing, setIsResizing] = useState(false);
  const [draggedItem, setDraggedItem] = useState<SidebarItemRef | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const draggedItemRef = useRef<SidebarItemRef | null>(null);
  const pointerDragSessionRef = useRef<{
    item: SidebarItemRef;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressInteractionRef = useRef(false);
  const resolveDraggedScriptItem = useCallback(
    (dragPayload?: SidebarItemRef | null): SidebarItemRef | null => {
      const candidate = dragPayload ?? draggedItemRef.current;
      return candidate?.source === "scripts" ? candidate : null;
    },
    [],
  );

  const loadScripts = useCallback(() => {
    setScriptTree(fileStore.getScriptTree());
  }, []);

  useEffect(() => {
    const init = async () => {
      await initializeFileStore();
      loadScripts();
    };

    init();
    return subscribeToFileStore(loadScripts);
  }, [loadScripts]);

  useEffect(() => {
    return subscribeWorkspace(() => {
      setWorkspaceEntries(getRootEntries());
    });
  }, []);

  const handleResizeMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      e.preventDefault();

      const delta =
        position === "left"
          ? e.clientX - startX.current
          : startX.current - e.clientX;
      const nextWidth = Math.max(200, Math.min(380, startWidth.current + delta));
      onWidthChange(nextWidth);
    },
    [isResizing, onWidthChange, position],
  );

  const handleResizeMouseUp = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    document.addEventListener("mousemove", handleResizeMouseMove);
    document.addEventListener("mouseup", handleResizeMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
    };
  }, [handleResizeMouseMove, handleResizeMouseUp, isResizing]);

  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    const handleCloseAll = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener("click", handleClickOutside);
    window.addEventListener("close-all-context-menus", handleCloseAll);

    return () => {
      document.removeEventListener("click", handleClickOutside);
      window.removeEventListener("close-all-context-menus", handleCloseAll);
    };
  }, [contextMenu.visible]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = width;
    setIsResizing(true);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const handleWorkspaceToggle = useCallback(async () => {
    const nextExpanded = !workspaceExpanded;
    setWorkspaceExpanded(nextExpanded);

    if (nextExpanded && !isWorkspaceInitialized()) {
      setWorkspaceLoading(true);
      await loadWorkspaceRoot();
      setWorkspaceEntries(getRootEntries());
      setWorkspaceLoading(false);
    }
  }, [workspaceExpanded]);

  const handleWorkspaceRefresh = useCallback(async () => {
    setWorkspaceLoading(true);
    await refreshWorkspace();
    setWorkspaceEntries(getRootEntries());
    setWorkspaceLoading(false);
  }, []);

  const handleCreateFile = () => {
    setIsCreatingFile(true);
    setIsCreatingFolder(false);
    setNewFileName("");
  };

  const getSelectedScriptDirectory = useCallback(() => {
    if (!selectedScriptPath) {
      return "";
    }

    const selectedNode = findScriptNodeByPath(scriptTree, selectedScriptPath);
    if (!selectedNode) {
      return "";
    }

    return selectedNode.isDir
      ? selectedNode.relativePath
      : getParentPath(selectedNode.relativePath);
  }, [scriptTree, selectedScriptPath]);

  const handleCreateFolder = useCallback(() => {
    setIsCreatingFolder(true);
    setIsCreatingFile(false);
    setCreationParentPath(getSelectedScriptDirectory());
    setNewFolderName("");
  }, [getSelectedScriptDirectory]);

  const handleCreateFileSubmit = async (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Enter") {
      const trimmedName = newFileName.trim();
      if (trimmedName) {
        const finalName =
          trimmedName.endsWith(".lua") || trimmedName.endsWith(".luau")
            ? trimmedName
            : `${trimmedName}.lua`;

        if (!fileStore.getFileByRelativePath(finalName)) {
          const newFile = await fileStore.createFile(
            finalName,
            `-- ${finalName}\n\n`,
          );
          onFileOpen(newFile.id, newFile.name);
        }
      }

      setIsCreatingFile(false);
      setNewFileName("");
    } else if (e.key === "Escape") {
      setIsCreatingFile(false);
      setNewFileName("");
    }
  };

  const handleCreateFolderSubmit = async (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Enter") {
      const trimmedName = newFolderName.trim();
      if (trimmedName) {
        const folderPath = joinPath(creationParentPath, trimmedName);
        await fileStore.createDirectory(trimmedName, creationParentPath);
        setExpandedScriptPaths((prev) => {
          const next = new Set(prev);
          if (creationParentPath) {
            next.add(creationParentPath);
          }
          next.add(folderPath);
          return next;
        });
        setSelectedScriptPath(folderPath);
      }

      setIsCreatingFolder(false);
      setCreationParentPath("");
      setNewFolderName("");
    } else if (e.key === "Escape") {
      setIsCreatingFolder(false);
      setCreationParentPath("");
      setNewFolderName("");
    }
  };

  const handleRefreshScripts = async () => {
    await fileStore.loadFilesFromDisk();
    loadScripts();
  };

  const canDropInDirectory = useCallback((
    targetPath: string,
    dragPayload?: SidebarItemRef | null,
  ) => {
    const currentDraggedItem = resolveDraggedScriptItem(dragPayload);

    if (!currentDraggedItem) {
      return false;
    }

    if (!targetPath || !currentDraggedItem.path) {
      return false;
    }

    if (currentDraggedItem.path === targetPath) {
      return false;
    }

    if (getParentPath(currentDraggedItem.path) === targetPath) {
      return false;
    }

    if (currentDraggedItem.isDir && pathStartsWith(targetPath, currentDraggedItem.path)) {
      return false;
    }

    return true;
  }, [resolveDraggedScriptItem]);

  const consumeInteractionSuppression = useCallback(() => {
    if (!suppressInteractionRef.current) {
      return false;
    }

    suppressInteractionRef.current = false;
    return true;
  }, []);

  const handlePointerDragStartNode = useCallback(
    (item: SidebarItemRef, e: React.MouseEvent<HTMLDivElement>) => {
      if (item.source !== "scripts" || e.button !== 0) {
        return;
      }

      pointerDragSessionRef.current = {
        item,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
    },
    [],
  );

  const handleDragEndNode = useCallback(() => {
    pointerDragSessionRef.current = null;
    suppressInteractionRef.current = false;
    draggedItemRef.current = null;
    setDraggedItem(null);
    setDragPointer(null);
    setDropTargetPath(null);
    setRootDropActive(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const clearDropIndicators = useCallback(() => {
    setDropTargetPath(null);
    setRootDropActive(false);
  }, []);

  const resolveDropDestination = useCallback(
    (target: EventTarget | null, dragPayload?: SidebarItemRef | null) => {
      const currentDraggedItem = resolveDraggedScriptItem(dragPayload);
      if (!currentDraggedItem) {
        return null;
      }

      const dropPath = getDropPathFromTarget(target);
      if (dropPath && canDropInDirectory(dropPath, currentDraggedItem)) {
        return { type: "directory" as const, path: dropPath, item: currentDraggedItem };
      }

      if (
        isRootDropTarget(target) &&
        getParentPath(currentDraggedItem.path) !== ""
      ) {
        return { type: "root" as const, path: "", item: currentDraggedItem };
      }

      return null;
    },
    [canDropInDirectory, resolveDraggedScriptItem],
  );

  const handleDropMove = useCallback(async (
    targetDirectoryPath = "",
    dragPayload?: SidebarItemRef | null,
  ) => {
    const currentDraggedItem = resolveDraggedScriptItem(dragPayload);

    if (!currentDraggedItem) {
      return;
    }

    const targetDirectory = targetDirectoryPath;
    const currentParent = getParentPath(currentDraggedItem.path);
    if (currentParent === targetDirectory) {
      handleDragEndNode();
      return;
    }

    try {
      const result = await fileStore.movePath(currentDraggedItem.path, targetDirectory);

      setExpandedScriptPaths((prev) => {
        let next = new Set(prev);
        if (result.isDir) {
          next = remapExpandedScriptPaths(next, result.oldPath, result.newPath);
        }
        if (targetDirectory) {
          next.add(targetDirectory);
        }
        return next;
      });
      setSelectedScriptPath(result.newPath);

      onSidebarMutation?.(
        result.isDir
          ? {
              type: "script-directory-renamed",
              oldPath: result.oldPath,
              newPath: result.newPath,
            }
          : {
              type: "script-file-renamed",
              file: result.file,
              oldPath: result.oldPath,
            },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to move script entry";
      alert(message);
    } finally {
      handleDragEndNode();
    }
  }, [handleDragEndNode, onSidebarMutation, resolveDraggedScriptItem]);

  const handlePointerDragMove = useCallback(
    (e: MouseEvent) => {
      const session = pointerDragSessionRef.current;
      if (!session) {
        return;
      }

      const distance = Math.hypot(
        e.clientX - session.startX,
        e.clientY - session.startY,
      );

      if (!session.active) {
        if (distance < 6) {
          return;
        }

        session.active = true;
        suppressInteractionRef.current = true;
        draggedItemRef.current = session.item;
        setDraggedItem(session.item);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }

      setDragPointer({ x: e.clientX, y: e.clientY });

      const destination = resolveDropDestination(
        document.elementFromPoint(e.clientX, e.clientY),
        session.item,
      );

      if (!destination) {
        clearDropIndicators();
        return;
      }

      if (destination.type === "directory") {
        setRootDropActive(false);
        setDropTargetPath((prev) =>
          prev === destination.path ? prev : destination.path,
        );
        return;
      }

      setDropTargetPath(null);
      setRootDropActive(true);
    },
    [clearDropIndicators, resolveDropDestination],
  );

  const handlePointerDragEnd = useCallback(
    (event?: MouseEvent) => {
      const session = pointerDragSessionRef.current;
      if (!session) {
        return;
      }

      pointerDragSessionRef.current = null;

      const activeSession = session.active;
      const draggedScript = session.item;
      let destination:
        | { type: "directory" | "root"; path: string; item: SidebarItemRef }
        | null = null;

      if (activeSession && event) {
        destination = resolveDropDestination(
          document.elementFromPoint(event.clientX, event.clientY),
          draggedScript,
        );
        window.setTimeout(() => {
          suppressInteractionRef.current = false;
        }, 0);
      }

      clearDropIndicators();

      if (activeSession && destination) {
        void handleDropMove(destination.path, draggedScript);
        return;
      }

      handleDragEndNode();
    },
    [clearDropIndicators, handleDragEndNode, handleDropMove, resolveDropDestination],
  );

  useEffect(() => {
    const handleWindowBlur = () => {
      handleDragEndNode();
    };

    document.addEventListener("mousemove", handlePointerDragMove);
    document.addEventListener("mouseup", handlePointerDragEnd);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("mousemove", handlePointerDragMove);
      document.removeEventListener("mouseup", handlePointerDragEnd);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [handleDragEndNode, handlePointerDragEnd, handlePointerDragMove]);

  const openScriptNode = useCallback(
    (node: ScriptTreeNode) => {
      if (!node.fileId) {
        return;
      }

      onFileOpen(node.fileId, node.name);
    },
    [onFileOpen],
  );

  const openWorkspaceNode = useCallback(
    (node: WorkspaceNode) => {
      if (node.is_dir) {
        return;
      }

      onWorkspaceFileOpen?.(node.path, node.name, node.extension);
    },
    [onWorkspaceFileOpen],
  );

  const handleContextMenu = (
    e: React.MouseEvent,
    item: SidebarItemRef,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    window.dispatchEvent(new Event("close-all-context-menus"));

    const menuWidth = 170;
    const menuHeight = item.source === "scripts" && !item.isDir ? 160 : 96;
    const padding = 8;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth + padding > window.innerWidth) {
      x = e.clientX - menuWidth;
    }

    if (y + menuHeight + padding > window.innerHeight) {
      y = e.clientY - menuHeight;
    }

    setContextMenu({
      visible: true,
      x,
      y,
      item,
    });
  };

  const handleRenameStart = () => {
    if (!contextMenu.item) {
      return;
    }

    setEditingPath(contextMenu.item.path);
    setRenameValue(contextMenu.item.name);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const handleDelete = async () => {
    const item = contextMenu.item;
    if (!item) {
      return;
    }

    if (item.source === "scripts") {
      if (item.isDir) {
        await fileStore.deletePath(item.path, true);
        setExpandedScriptPaths((prev) => removeExpandedScriptPath(prev, item.path));
      } else if (item.fileId) {
        await fileStore.deleteFile(item.fileId);
      }

      onSidebarMutation?.({
        type: "script-path-removed",
        path: item.path,
        isDir: item.isDir,
      });
    } else {
      await deleteWorkspacePath(item.path, item.isDir);
      onSidebarMutation?.({
        type: "workspace-path-removed",
        path: item.path,
        isDir: item.isDir,
      });
    }

    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const handleToggleAutoexec = async () => {
    const item = contextMenu.item;
    if (!item?.fileId || item.source !== "scripts" || item.isDir) {
      return;
    }

    if (item.isAutoexec) {
      await fileStore.removeFromAutoexec(item.fileId);
    } else {
      await fileStore.addToAutoexec(item.fileId);
    }

    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const handleRevealInExplorer = () => {
    const item = contextMenu.item;
    if (item?.source === "scripts" && item.fileId) {
      onRevealInExplorer?.(item.fileId);
    }
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const handleRenameSubmit = async (item: SidebarItemRef) => {
    const nextName = renameValue.trim();
    if (!nextName) {
      setEditingPath(null);
      setRenameValue("");
      return;
    }

    if (item.source === "scripts") {
      if (item.isDir) {
        const { oldPath, newPath } = await fileStore.renameDirectory(
          item.path,
          nextName,
        );
        setExpandedScriptPaths((prev) =>
          remapExpandedScriptPaths(prev, oldPath, newPath),
        );
        setSelectedScriptPath((prev) =>
          prev === oldPath ? newPath : prev,
        );
        onSidebarMutation?.({
          type: "script-directory-renamed",
          oldPath,
          newPath,
        });
      } else if (item.fileId) {
        const finalName =
          nextName.endsWith(".lua") || nextName.endsWith(".luau")
            ? nextName
            : `${nextName}.lua`;
        const targetPath = joinPath(getParentPath(item.path), finalName);
        const existing = fileStore.getFileByRelativePath(targetPath);
        if (!existing || existing.id === item.fileId) {
          const renamedFile = await fileStore.renameFile(item.fileId, finalName);
          setSelectedScriptPath(renamedFile.relativePath);
          onSidebarMutation?.({
            type: "script-file-renamed",
            file: renamedFile,
            oldPath: item.path,
          });
        }
      }
    } else {
      const finalName = item.extension
        ? nextName.toLowerCase().endsWith(`.${item.extension}`)
          ? nextName
          : `${nextName}.${item.extension}`
        : nextName;
      const { oldPath, newPath } = await renameWorkspacePath(
        item.path,
        finalName,
      );
      setSelectedWorkspacePath(newPath);
      onSidebarMutation?.(
        item.isDir
          ? {
              type: "workspace-directory-renamed",
              oldPath,
              newPath,
            }
          : {
              type: "workspace-file-renamed",
              oldPath,
              newPath,
            },
      );
    }

    setEditingPath(null);
    setRenameValue("");
  };

  const visibleScriptTree = filterScriptTree(scriptTree, searchQuery);

  return (
    <div
      style={{
        width,
        minWidth: 200,
        maxWidth: 380,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #0e0e13 0%, #0a0a0e 100%)",
        borderLeft:
          position === "right" ? "1px solid rgba(255,255,255,0.04)" : "none",
        borderRight:
          position === "left" ? "1px solid rgba(255,255,255,0.04)" : "none",
        position: "relative",
        order,
      }}
    >
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: "absolute",
          top: 0,
          [position === "left" ? "right" : "left"]: 0,
          width: 4,
          height: "100%",
          cursor: "ew-resize",
          zIndex: 10,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            [position === "left" ? "right" : "left"]: 0,
            width: 1,
            height: "100%",
            background: isResizing ? accent.primary : "transparent",
            transition: isResizing ? "none" : "all 0.15s ease",
          }}
        />
      </div>

      <div style={{ padding: "12px 12px 8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: searchFocused
              ? "rgba(255,255,255,0.04)"
              : "rgba(255,255,255,0.02)",
            border: `1px solid ${searchFocused ? `${accent.primary}40` : "rgba(255,255,255,0.04)"}`,
            borderRadius: 10,
            transition: "all 0.2s ease",
          }}
        >
          <Search
            size={14}
            color={searchFocused ? accent.primary : colors.textMuted}
          />
          <input
            type="text"
            placeholder="Search scripts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 12,
              color: colors.textWhite,
            }}
          />
        </div>
      </div>

      {showWorkspace && (
        <>
          <div
            onClick={handleWorkspaceToggle}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              cursor: "pointer",
              background: workspaceExpanded
                ? "rgba(255,255,255,0.02)"
                : "transparent",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              transition: "background 0.15s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {workspaceExpanded ? (
                <ChevronDown size={12} color={colors.textMuted} />
              ) : (
                <ChevronRight size={12} color={colors.textMuted} />
              )}
              <Folder size={12} color="#FBBF24" />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: colors.textMuted,
                  letterSpacing: "0.03em",
                }}
              >
                Workspace
              </span>
            </div>
            {workspaceExpanded && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleWorkspaceRefresh();
                }}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <RefreshCw
                  size={10}
                  color={colors.textMuted}
                  style={
                    workspaceLoading
                      ? { animation: "spin 1s linear infinite" }
                      : undefined
                  }
                />
              </div>
            )}
          </div>

          {workspaceExpanded && (
            <div
              style={{
                maxHeight: 210,
                overflowY: "auto",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                padding: "4px 0",
              }}
            >
              {workspaceLoading && workspaceEntries.length === 0 ? (
                <div style={{ padding: "12px", textAlign: "center" }}>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>
                    Loading...
                  </span>
                </div>
              ) : workspaceEntries.length === 0 ? (
                <div style={{ padding: "12px", textAlign: "center" }}>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>
                    Workspace is empty
                  </span>
                </div>
              ) : (
                workspaceEntries.map((entry) => (
                  <WorkspaceTreeItem
                    key={entry.path}
                    node={entry}
                    level={0}
                    selectedPath={selectedWorkspacePath}
                    activePath={activeTabPath}
                    activeSource={activeTabSource}
                    editingPath={editingPath}
                    renameValue={renameValue}
                    onSelect={setSelectedWorkspacePath}
                    onOpen={openWorkspaceNode}
                    onContextMenu={handleContextMenu}
                    onRenameValueChange={setRenameValue}
                    onRenameSubmit={handleRenameSubmit}
                    onRenameCancel={() => {
                      setEditingPath(null);
                      setRenameValue("");
                    }}
                    accentColor={accent.primary}
                  />
                ))
              )}
            </div>
          )}
        </>
      )}

      <div
        {...{ [SIDEBAR_ROOT_DROP_ATTR]: "true" }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px 8px",
          background: rootDropActive ? `${accent.primary}12` : "transparent",
          borderTop: rootDropActive ? `1px dashed ${accent.primary}60` : "1px solid transparent",
          borderBottom: rootDropActive ? `1px dashed ${accent.primary}60` : "1px solid transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FolderOpen size={12} color={accent.primary} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: colors.textMuted,
              letterSpacing: "0.03em",
            }}
          >
            Scripts
          </span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          <div
            onClick={handleCreateFolder}
            title="New Folder"
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <FolderPlus size={12} color={colors.textMuted} />
          </div>
          <div
            onClick={handleCreateFile}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Plus size={12} color={colors.textMuted} />
          </div>
          <div
            onClick={handleRefreshScripts}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={12} color={colors.textMuted} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {isCreatingFolder && (
          <div style={{ padding: "4px 12px" }}>
            <input
              type="text"
              placeholder="folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={handleCreateFolderSubmit}
              onBlur={() => {
                setIsCreatingFolder(false);
                setCreationParentPath("");
                setNewFolderName("");
              }}
              autoFocus
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${accent.primary}40`,
                borderRadius: 8,
                outline: "none",
                fontSize: 12,
                color: colors.textWhite,
              }}
            />
          </div>
        )}
        {isCreatingFile && (
          <div style={{ padding: "4px 12px" }}>
            <input
              type="text"
              placeholder="filename.lua"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={handleCreateFileSubmit}
              onBlur={() => {
                setIsCreatingFile(false);
                setNewFileName("");
              }}
              autoFocus
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${accent.primary}40`,
                borderRadius: 8,
                outline: "none",
                fontSize: 12,
                color: colors.textWhite,
              }}
            />
          </div>
        )}

        {visibleScriptTree.length === 0 && searchQuery ? (
          <div style={{ padding: "16px 12px", textAlign: "center" }}>
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              No matching scripts found
            </span>
          </div>
        ) : scriptTree.length === 0 ? (
          <div style={{ padding: "16px 12px", textAlign: "center" }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <FileText size={18} color={colors.textMuted} />
            </div>
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              No scripts yet
            </span>
          </div>
        ) : (
          visibleScriptTree.map((node) => (
            <ScriptTreeItem
              key={node.relativePath}
              node={node}
              level={0}
              expandedPaths={expandedScriptPaths}
              selectedPath={selectedScriptPath}
              activePath={activeTabPath}
              activeSource={activeTabSource}
              editingPath={editingPath}
              renameValue={renameValue}
              onToggle={(path) =>
                setExpandedScriptPaths((prev) => {
                  const next = new Set(prev);
                  if (next.has(path)) {
                    next.delete(path);
                  } else {
                    next.add(path);
                  }
                  return next;
                })
              }
              onSelect={setSelectedScriptPath}
              onOpen={openScriptNode}
              onContextMenu={handleContextMenu}
              onRenameValueChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={() => {
                setEditingPath(null);
                setRenameValue("");
              }}
              consumeInteractionSuppression={consumeInteractionSuppression}
              onPointerDragStartNode={handlePointerDragStartNode}
              draggedPath={draggedItem?.path || null}
              dropTargetPath={dropTargetPath}
              accentColor={accent.primary}
              forceExpanded={searchQuery.trim().length > 0}
            />
          ))
        )}
      </div>

      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          gap: 6,
        }}
      >
        <div
          onClick={onScriptHubClick}
          title="Script Hub"
          style={footerButtonStyle}
        >
          <Cloud size={14} color={colors.textMuted} />
        </div>
        <div
          onClick={onClientManagerClick}
          title="Client Manager"
          style={footerButtonStyle}
        >
          <Users size={14} color={colors.textMuted} />
        </div>
        <div
          onClick={onAccountClick}
          title="Account"
          style={footerButtonStyle}
        >
          <User size={14} color={colors.textMuted} />
        </div>
        <div
          onClick={onSettingsClick}
          title="Settings"
          style={footerButtonStyle}
        >
          <Settings size={14} color={colors.textMuted} />
        </div>
      </div>

      {draggedItem && dragPointer && (
        <DragGhost
          title={draggedItem.name}
          x={dragPointer.x}
          y={dragPointer.y}
        />
      )}

      {contextMenu.visible && contextMenu.item && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "#141418",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "6px",
            zIndex: 10000,
            minWidth: 160,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuAction label="Rename" onClick={handleRenameStart} />
          {contextMenu.item.source === "scripts" &&
            !contextMenu.item.isDir && (
              <ContextMenuAction
                label="Auto-execute"
                onClick={handleToggleAutoexec}
                color={contextMenu.item.isAutoexec ? "#4ADE80" : colors.textWhite}
                icon={
                  contextMenu.item.isAutoexec ? (
                    <Check size={14} />
                  ) : (
                    <Plus size={14} />
                  )
                }
              />
            )}
          {contextMenu.item.source === "scripts" &&
            !contextMenu.item.isDir &&
            onRevealInExplorer && (
              <ContextMenuAction
                label="Reveal in Explorer"
                onClick={handleRevealInExplorer}
              />
            )}
          <ContextMenuAction
            label="Delete"
            onClick={handleDelete}
            color={colors.error}
            danger
          />
        </div>
      )}
    </div>
  );
}

const footerButtonStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 12px",
  background: "rgba(255,255,255,0.02)",
  borderRadius: 8,
  cursor: "pointer",
};

interface ContextMenuActionProps {
  label: string;
  onClick: () => void;
  color?: string;
  icon?: React.ReactNode;
  danger?: boolean;
}

function ContextMenuAction({
  label,
  onClick,
  color,
  icon,
  danger = false,
}: ContextMenuActionProps) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 14px",
        fontSize: 13,
        color: color || colors.textWhite,
        cursor: "pointer",
        borderRadius: 8,
        transition: "background 0.15s ease",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger
          ? "rgba(255,77,106,0.1)"
          : "rgba(255,255,255,0.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      {label}
    </div>
  );
}
