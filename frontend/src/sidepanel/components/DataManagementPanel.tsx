import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FolderArchive,
  Loader2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type {
  AsyncStatus,
  DataOverviewSnapshot,
  ExportFormat,
  StorageUsageSnapshot,
} from "~lib/types";
import {
  clearAllData,
  clearInsightsCache,
  exportData,
  getDataOverview,
} from "~lib/services/storageService";

const FALLBACK_SOFT_LIMIT = 900 * 1024 * 1024;
const FALLBACK_HARD_LIMIT = 1024 * 1024 * 1024;

type AccordionKey = "storage" | "export" | "cleanup";

interface DataAccordionProps {
  icon: React.ReactNode;
  iconTone: "storage" | "export" | "cleanup" | "dashboard";
  label: string;
  subtitle: string;
  open?: boolean;
  disabled?: boolean;
  soonTag?: string;
  onToggle?: () => void;
  children?: React.ReactNode;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDateTime(value: number | null): string {
  if (!value || !Number.isFinite(value)) return "—";
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value}`;
}

function buildLimitLabel(limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) return "Unknown";
  return formatBytes(limit);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function DataAccordion({
  icon,
  iconTone,
  label,
  subtitle,
  open = false,
  disabled = false,
  soonTag,
  onToggle,
  children,
}: DataAccordionProps) {
  return (
    <section
      className={`data-acc-item ${open ? "is-open" : ""} ${
        disabled ? "is-disabled" : ""
      }`}
    >
      <button
        type="button"
        className="data-acc-header"
        onClick={disabled ? undefined : onToggle}
        aria-expanded={disabled ? undefined : open}
        aria-disabled={disabled || undefined}
      >
        <span className={`data-acc-icon data-acc-icon-${iconTone}`}>{icon}</span>
        <span className="data-acc-text">
          <span className="data-acc-label">{label}</span>
          <span className="data-acc-subtitle">{subtitle}</span>
        </span>
        <span className="data-acc-right">
          {soonTag ? (
            <span className="data-soon-badge">{soonTag}</span>
          ) : (
            <ChevronDown className="data-acc-chevron h-4 w-4" strokeWidth={1.8} />
          )}
        </span>
      </button>

      {!disabled ? (
        <div className={`data-acc-body ${open ? "is-open" : ""}`}>
          <div className="data-acc-inner">{children}</div>
        </div>
      ) : null}
    </section>
  );
}

export function DataManagementPanel() {
  const [overview, setOverview] = useState<DataOverviewSnapshot | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Record<AccordionKey, boolean>>({
    storage: true,
    export: false,
    cleanup: false,
  });

  const refreshOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const result = await getDataOverview();
      setOverview(result);
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const toggleAccordion = (key: AccordionKey) => {
    setOpenMap((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleExport = async (format: ExportFormat) => {
    setActionKey(`export-${format}`);
    setStatus("loading");
    setMessage(null);
    try {
      const file = await exportData(format);
      triggerDownload(file.blob, file.filename);
      setStatus("ready");
      setMessage(`Exported ${file.filename}`);
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    } finally {
      setActionKey(null);
      await refreshOverview();
    }
  };

  const handleClearInsightsCache = async () => {
    const confirmed = window.confirm(
      "Clear cached summaries and weekly reports only?\nConversations and messages will be kept."
    );
    if (!confirmed) return;

    setActionKey("clear-insights-cache");
    setStatus("loading");
    setMessage(null);
    try {
      await clearInsightsCache();
      setStatus("ready");
      setMessage("Insights cache cleared. Conversations and messages were kept.");
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    } finally {
      setActionKey(null);
      await refreshOverview();
    }
  };

  const handleClearAllData = async () => {
    const input = window.prompt(
      "This will clear all local conversations, messages, summaries, and weekly reports.\nType DELETE to continue:"
    );
    if (input !== "DELETE") {
      setStatus("idle");
      setMessage("Clear cancelled.");
      return;
    }

    setActionKey("clear-all-data");
    setStatus("loading");
    setMessage(null);
    try {
      await clearAllData();
      setStatus("ready");
      setMessage("Local data cleared. LLM configuration is kept.");
    } catch (error) {
      setStatus("error");
      setMessage(getErrorMessage(error));
    } finally {
      setActionKey(null);
      await refreshOverview();
    }
  };

  const storage: StorageUsageSnapshot | null = overview?.storage ?? null;
  const used = storage?.originUsed ?? 0;
  const hardLimit = storage?.hardLimit ?? FALLBACK_HARD_LIMIT;
  const softLimit = storage?.softLimit ?? FALLBACK_SOFT_LIMIT;
  const usagePercentRaw = hardLimit > 0 ? (used / hardLimit) * 100 : 0;
  const usagePercent = Math.min(100, Math.max(used > 0 ? 0.8 : 0, usagePercentRaw));

  const statusTone = useMemo(() => {
    if (!storage || storage.status === "ok") {
      return { label: "Healthy", cls: "is-healthy" };
    }
    if (storage.status === "warning") {
      return { label: "Soft limit warning", cls: "is-warning" };
    }
    return { label: "Write blocked", cls: "is-danger" };
  }, [storage]);

  const exportOptions: Array<{
    format: ExportFormat;
    name: string;
    description: string;
  }> = [
    {
      format: "json",
      name: "JSON",
      description: "Reversible - includes summaries and weekly caches",
    },
    {
      format: "txt",
      name: "TXT",
      description: "Human-readable plain text export",
    },
    {
      format: "md",
      name: "MD",
      description: "Markdown - compatible with Obsidian and notes tools",
    },
  ];

  return (
    <div className="data-page-stack">
      <p className="data-group-label">Overview</p>
      <DataAccordion
        icon={<Database className="h-4 w-4" strokeWidth={1.8} />}
        iconTone="storage"
        label="Storage"
        subtitle="Used space, quota, and browser details"
        open={openMap.storage}
        onToggle={() => toggleAccordion("storage")}
      >
        <div className="data-stat-row">
          <span className="data-stat-label">Used / App limit (1GB)</span>
          <span className="data-stat-value">
            {formatBytes(used)} / {buildLimitLabel(hardLimit)}
          </span>
        </div>

        <div className="data-progress-track">
          <div className="data-progress-fill" style={{ width: `${usagePercent}%` }} />
        </div>

        <div className="data-stat-row">
          <span className="data-stat-label">Browser quota</span>
          <span className="data-stat-value data-inline-status">
            {storage?.originQuota ? formatBytes(storage.originQuota) : "Unknown"}
            <span className={`data-status-pill ${statusTone.cls}`}>
              <span className="data-status-dot" />
              {statusTone.label}
            </span>
          </span>
        </div>

        {storage?.status === "warning" ? (
          <p className="data-state-note is-warning">
            Storage crossed 900MB. Export or clear old data soon.
          </p>
        ) : null}
        {storage?.status === "blocked" ? (
          <p className="data-state-note is-danger">
            Storage reached 1GB. New writes are blocked until you export or clear data.
          </p>
        ) : null}

        <div className="data-inner-divider" />

        <button
          type="button"
          className={`data-detail-toggle ${detailOpen ? "is-open" : ""}`}
          onClick={() => setDetailOpen((prev) => !prev)}
        >
          <ChevronRight className="data-detail-chevron h-3 w-3" strokeWidth={1.8} />
          <span>Advanced storage details</span>
        </button>

        <div className={`data-detail-rows ${detailOpen ? "is-open" : ""}`}>
          <div className="data-detail-item">
            <span>Threads stored</span>
            <span>{formatCount(overview?.totalConversations)}</span>
          </div>
          <div className="data-detail-item">
            <span>Compacted threads</span>
            <span>{formatCount(overview?.compactedThreads)}</span>
          </div>
          <div className="data-detail-item">
            <span>Summary records</span>
            <span>{formatCount(overview?.summaryRecordCount)}</span>
          </div>
          <div className="data-detail-item">
            <span>Weekly reports</span>
            <span>{formatCount(overview?.weeklyReportCount)}</span>
          </div>
          <div className="data-detail-item">
            <span>IndexedDB store</span>
            <span>{overview?.indexedDbName ?? "MemoryHubDB"}</span>
          </div>
          <div className="data-detail-item">
            <span>Last compaction</span>
            <span>{formatDateTime(overview?.lastCompactionAt ?? null)}</span>
          </div>
          <p className="data-detail-note">
            Compacted metrics currently use summary cache proxy and can be upgraded
            to strict Agent A compaction lineage later.
          </p>
          <div className="data-detail-item">
            <span>Soft limit</span>
            <span>{buildLimitLabel(softLimit)}</span>
          </div>
          <div className="data-detail-item">
            <span>chrome.storage.local used</span>
            <span>{formatBytes(storage?.localUsed ?? 0)}</span>
          </div>
          <div className="data-detail-item">
            <span>Estimated IndexedDB + other</span>
            <span>
              {formatBytes(
                storage ? Math.max(storage.originUsed - storage.localUsed, 0) : 0
              )}
            </span>
          </div>
        </div>
      </DataAccordion>

      <p className="data-group-label">Operations</p>
      <DataAccordion
        icon={<Download className="h-4 w-4" strokeWidth={1.8} />}
        iconTone="export"
        label="Export"
        subtitle="Download data in JSON, TXT, or MD"
        open={openMap.export}
        onToggle={() => toggleAccordion("export")}
      >
        <p className="data-subgroup-label">Export format</p>
        <div className="data-export-list">
          {exportOptions.map((item) => {
            const busy = actionKey === `export-${item.format}`;
            return (
              <div className="data-export-item" key={item.format}>
                <div className="data-export-info">
                  <p className="data-export-name">{item.name}</p>
                  <p className="data-export-desc">{item.description}</p>
                </div>
                <button
                  type="button"
                  className="data-export-btn"
                  disabled={Boolean(actionKey)}
                  onClick={() => handleExport(item.format)}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                  ) : (
                    <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                  )}
                  Export
                </button>
              </div>
            );
          })}
        </div>
      </DataAccordion>

      <DataAccordion
        icon={<FolderArchive className="h-4 w-4" strokeWidth={1.8} />}
        iconTone="cleanup"
        label="Cleanup"
        subtitle="Remove summary cache or wipe all local data"
        open={openMap.cleanup}
        onToggle={() => toggleAccordion("cleanup")}
      >
        <div className="data-clean-card">
          <div className="data-clean-card-head">
            <p className="data-clean-card-title">Insights cache</p>
            <button
              type="button"
              className="data-secondary-btn"
              disabled={Boolean(actionKey)}
              onClick={handleClearInsightsCache}
            >
              {actionKey === "clear-insights-cache" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              Clear cache
            </button>
          </div>
          <p className="data-clean-card-desc">
            Clears cached thread summaries and weekly reports while keeping
            conversations and messages.
          </p>
        </div>

        <div className="data-danger-zone">
          <div className="data-danger-head">
            <TriangleAlert className="h-4 w-4" strokeWidth={1.8} />
            <span>Danger zone</span>
          </div>
          <p className="data-danger-desc">
            Clears all conversations, messages, cached summaries, and weekly
            reports. LLM configuration remains unchanged.
          </p>
          <button
            type="button"
            className="data-danger-btn"
            disabled={Boolean(actionKey)}
            onClick={handleClearAllData}
          >
            {actionKey === "clear-all-data" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            Clear local data
          </button>
        </div>
      </DataAccordion>

      <p className="data-group-label">Roadmap</p>
      <DataAccordion
        icon={<BarChart3 className="h-4 w-4" strokeWidth={1.8} />}
        iconTone="dashboard"
        label="Dashboard"
        subtitle="Usage trends and compaction analytics"
        disabled
        soonTag="Soon"
      />

      {(overviewLoading || actionKey) && (
        <p className="data-feedback-row">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          {actionKey ? "Running data action..." : "Refreshing data overview..."}
        </p>
      )}

      {message && !overviewLoading && (
        <p className={`data-feedback-row ${status === "error" ? "is-error" : ""}`}>
          {message}
        </p>
      )}
    </div>
  );
}
