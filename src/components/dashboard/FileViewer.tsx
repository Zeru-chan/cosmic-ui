import { convertFileSrc } from "@tauri-apps/api/core";
import { FileAudio, FileImage, FileText, FileVideo } from "lucide-react";
import { CodeEditor } from "../../editor";
import { colors } from "../../config/theme";
import type { PaneTab } from "../../stores/splitStore";
import { getMonacoLanguage } from "../../utils/fileTypes";

interface FileViewerProps {
  tab: PaneTab;
  onChange: (content: string) => void;
  onExecute?: () => void;
  onSave?: () => void;
}

export function FileViewer({
  tab,
  onChange,
  onExecute,
  onSave,
}: FileViewerProps) {
  const assetUrl = tab.path ? convertFileSrc(tab.path) : null;

  if (tab.kind === "code" || tab.kind === "text" || tab.kind === "json") {
    return (
      <CodeEditor
        value={tab.content || ""}
        onChange={onChange}
        onExecute={tab.kind === "code" && !tab.readOnly ? onExecute : undefined}
        onSave={!tab.readOnly ? onSave : undefined}
        readOnly={tab.readOnly}
        fileId={tab.fileId || tab.id}
        fileName={tab.title}
        language={getMonacoLanguage(tab.extension || null)}
      />
    );
  }

  if (tab.kind === "image" && assetUrl) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          overflow: "auto",
          background: "#09090d",
        }}
      >
        <img
          src={assetUrl}
          alt={tab.title}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 12,
            boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
          }}
        />
      </div>
    );
  }

  if (tab.kind === "audio" && assetUrl) {
    return (
      <MediaShell
        icon={<FileAudio size={22} color={colors.textMuted} />}
        title={tab.title}
      >
        <audio controls src={assetUrl} style={{ width: "100%" }} />
      </MediaShell>
    );
  }

  if (tab.kind === "video" && assetUrl) {
    return (
      <MediaShell
        icon={<FileVideo size={22} color={colors.textMuted} />}
        title={tab.title}
      >
        <video
          controls
          src={assetUrl}
          style={{
            width: "100%",
            maxHeight: "70vh",
            borderRadius: 12,
            background: "#000",
          }}
        />
      </MediaShell>
    );
  }

  return (
    <MediaShell
      icon={
        tab.kind === "image" ? (
          <FileImage size={22} color={colors.textMuted} />
        ) : (
          <FileText size={22} color={colors.textMuted} />
        )
      }
      title={tab.title}
    >
      <div
        style={{
          padding: "16px 18px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "#111116",
          color: colors.textMuted,
          fontSize: 13,
        }}
      >
        Preview is not available for this file type.
      </div>
    </MediaShell>
  );
}

interface MediaShellProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function MediaShell({ icon, title, children }: MediaShellProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(180deg, #0a0a0e 0%, #08080b 100%)",
        padding: 28,
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          padding: 24,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "#0f0f14",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {icon}
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: colors.textWhite,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
