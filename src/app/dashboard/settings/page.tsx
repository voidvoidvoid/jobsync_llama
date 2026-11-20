"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AiSettings from "@/components/settings/AiSettings";
import ApiKeySettings from "@/components/settings/ApiKeySettings";
import DataSettings from "@/components/settings/DataSettings";
import DealBreakerSettings from "@/components/settings/DealBreakerSettings";
import DisplaySettings from "@/components/settings/DisplaySettings";
import McpAccessSettings from "@/components/settings/McpAccessSettings";
import SettingsSidebar, { type SettingsSection } from "@/components/settings/SettingsSidebar";

const SECTIONS: SettingsSection[] = [
  "ai-provider",
  "api-keys",
  "deal-breakers",
  "appearance",
  "mcp-access",
  "data",
];

function SettingsContent() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("ai-provider");

  // Links elsewhere in the app can open a section: /dashboard/settings?section=api-keys
  const requested = useSearchParams().get("section");
  const linked =
    requested && SECTIONS.includes(requested as SettingsSection)
      ? (requested as SettingsSection)
      : null;
  const [prevLinked, setPrevLinked] = useState<SettingsSection | null>(null);
  if (linked !== prevLinked) {
    setPrevLinked(linked);
    if (linked) setActiveSection(linked);
  }

  return (
    <div className="flex flex-col col-span-3">
      <h3 className="text-2xl font-semibold leading-none tracking-tight mb-4">
        Settings
      </h3>
      <div className="flex gap-3 sm:gap-6">
        <SettingsSidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <div className="flex-1 min-w-0">
          {activeSection === "ai-provider" && <AiSettings />}
          {activeSection === "api-keys" && <ApiKeySettings />}
          {activeSection === "deal-breakers" && <DealBreakerSettings />}
          {activeSection === "appearance" && <DisplaySettings />}
          {activeSection === "mcp-access" && <McpAccessSettings />}
          {activeSection === "data" && <DataSettings />}
        </div>
      </div>
    </div>
  );
}

function Settings() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}

export default Settings;
