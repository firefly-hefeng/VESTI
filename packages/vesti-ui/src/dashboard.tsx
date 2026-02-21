"use client";

import { useState, useEffect } from "react";
import { Search, Settings } from "lucide-react";
import { LibraryTab } from "./tabs/library-tab";
import { ExploreTab } from "./tabs/explore-tab";
import { NetworkTab } from "./tabs/network-tab";
import { LibraryDataProvider } from "./contexts/library-data";
import type { StorageApi } from "./types";

type Tab = "library" | "explore" | "network";

type DashboardProps = {
  storage: StorageApi;
  logoSrc: string;
  logoAlt?: string;
  rootClassName?: string;
};

export function VestiDashboard({
  storage,
  logoSrc,
  logoAlt = "Vesti",
  rootClassName,
}: DashboardProps) {
  const SETTINGS_KEY = "vesti_llm_settings";
  const [activeTab, setActiveTab] = useState<Tab>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelscopeKey, setModelscopeKey] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<"idle" | "saved" | "error">(
    "idle"
  );
  const [settingsAvailable, setSettingsAvailable] = useState(true);

  useEffect(() => {
    if (!settingsOpen) {
      setSettingsStatus("idle");
      return;
    }
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setSettingsAvailable(false);
      return;
    }
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      setSettingsAvailable(true);
      const settings = result?.[SETTINGS_KEY] as { apiKey?: string } | undefined;
      setModelscopeKey(settings?.apiKey ?? "");
    });
  }, [settingsOpen]);

  const handleSaveModelscopeKey = () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setSettingsAvailable(false);
      setSettingsStatus("error");
      return;
    }
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        setSettingsStatus("error");
        return;
      }
      const existing = (result?.[SETTINGS_KEY] as Record<string, unknown>) ?? {};
      const next = {
        ...existing,
        apiKey: modelscopeKey.trim(),
      };
      chrome.storage.local.set({ [SETTINGS_KEY]: next }, () => {
        const saveErr = chrome.runtime?.lastError;
        if (saveErr) {
          setSettingsStatus("error");
          return;
        }
        setSettingsStatus("saved");
        setTimeout(() => setSettingsStatus("idle"), 1500);
      });
    });
  };

  return (
    <LibraryDataProvider storage={storage}>
      <div className={`${rootClassName ?? ""} h-screen flex flex-col`}>
        {/* Global Nav (56px) */}
        <header className="h-14 bg-bg-tertiary border-b border-border-subtle px-6 flex items-center justify-between">
          {/* Left - Logo */}
          <div className="flex items-center gap-2">
            <img src={logoSrc} alt={logoAlt} className="w-7 h-7" />
            <h1 className="text-base font-[family-name:var(--font-lora)] font-semibold text-text-primary">
              Vesti
            </h1>
          </div>

          {/* Center - Search */}
          <div className="flex-1 max-w-[480px] mx-auto">
            <div className="relative">
              <Search
                strokeWidth={1.5}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary"
              />
              <input
                type="text"
                placeholder="Search..."
                className="w-full pl-10 pr-4 py-2 bg-bg-primary border border-border-default rounded-md text-sm font-sans text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary transition-all"
              />
            </div>
          </div>

          {/* Right - Actions */}
          <div className="flex items-center gap-1 relative">
            <button
              onClick={() => setSettingsOpen((open) => !open)}
              className="p-2 rounded-md hover:bg-accent-primary-light transition-colors group"
            >
              <Settings
                strokeWidth={1.5}
                className="w-5 h-5 text-text-secondary group-hover:text-accent-primary transition-colors"
              />
            </button>
            {settingsOpen && (
              <div className="absolute right-0 top-full mt-2 w-[320px] rounded-lg border border-border-subtle bg-bg-primary shadow-[0_8px_24px_rgba(0,0,0,0.08)] p-4 z-50">
                <div className="text-sm font-sans font-medium text-text-primary mb-3">
                  Settings
                </div>
                <label className="block text-[12px] font-sans text-text-secondary mb-2">
                  ModelScope Key
                </label>
                <input
                  type="password"
                  value={modelscopeKey}
                  onChange={(event) => setModelscopeKey(event.target.value)}
                  placeholder="Paste your ModelScope key"
                  disabled={!settingsAvailable}
                  className="w-full px-3 py-2 rounded-md border border-border-default bg-bg-primary text-sm font-sans text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary disabled:opacity-60"
                />
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={handleSaveModelscopeKey}
                    className="px-3 py-1.5 rounded-md bg-accent-primary text-white text-xs font-sans font-medium hover:bg-accent-primary-hover transition-colors"
                  >
                    Save
                  </button>
                  <span className="text-[11px] font-sans text-text-tertiary">
                    {settingsAvailable
                      ? settingsStatus === "saved"
                        ? "Saved locally"
                        : settingsStatus === "error"
                          ? "Save failed"
                          : "Stored in chrome.storage.local"
                      : "Available in extension only"}
                  </span>
                </div>
              </div>
            )}
            <button className="p-2 rounded-lg hover:bg-bg-surface-card transition-colors">
              <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white text-sm font-sans">
                U
              </div>
            </button>
          </div>
        </header>

        {/* Tab Bar */}
        <div className="bg-bg-tertiary border-b border-border-subtle px-6">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("library")}
              className={`px-4 py-2.5 text-sm font-sans font-medium transition-all relative ${
                activeTab === "library"
                  ? "text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Library
              {activeTab === "library" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("explore")}
              className={`px-4 py-2.5 text-sm font-sans font-medium transition-all relative ${
                activeTab === "explore"
                  ? "text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Explore
              {activeTab === "explore" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("network")}
              className={`px-4 py-2.5 text-sm font-sans font-medium transition-all relative ${
                activeTab === "network"
                  ? "text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Network
              {activeTab === "network" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary" />
              )}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "library" && <LibraryTab storage={storage} />}
          {activeTab === "explore" && <ExploreTab />}
          {activeTab === "network" && <NetworkTab />}
        </div>
      </div>
    </LibraryDataProvider>
  );
}
