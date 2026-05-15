import type { StoredOutputVersion } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

type VersionHistoryProps = {
  activeVersionId?: string;
  versions: StoredOutputVersion[];
  onRestore: (version: StoredOutputVersion) => void;
};

export function VersionHistory({ activeVersionId, versions, onRestore }: VersionHistoryProps) {
  const { locale } = useI18n();

  return (
    <aside className="version-history" aria-label="Output version history">
      <div className="version-history-header">
        <p className="eyebrow">{locale === "zh" ? "版本历史" : "Version History"}</p>
        <h3>{locale === "zh" ? "输出版本" : "Output versions"}</h3>
      </div>
      <div className="version-list">
        {versions.length === 0 ? (
          <p className="version-empty">{locale === "zh" ? "生成后会保存版本。" : "Versions are saved after generation."}</p>
        ) : null}
        {versions.slice(0, 6).map((version, index) => (
          <button
            className={`version-item ${activeVersionId === version.id ? "is-active" : ""}`}
            key={version.id}
            type="button"
            onClick={() => onRestore(version)}
          >
            <span>{locale === "zh" ? `版本 ${versions.length - index}` : `Version ${versions.length - index}`}</span>
            <small>{version.mode} · {new Date(version.createdAt).toLocaleString()}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}
