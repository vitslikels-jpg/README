import { AiModelComparisonTool } from "@/features/settings/components/ai-model-comparison-tool";
import { IikoConnectionCard } from "@/features/settings/components/iiko-connection-card";

export default function SettingsPage() {
  return (
    <div className="pageStack">
      <IikoConnectionCard serverUrl={process.env.IIKO_SERVER_URL?.trim() || ""} />
      <AiModelComparisonTool defaultModel={process.env.POLZA_AI_MODEL?.trim() || "google/gemini-3.1-flash-lite"} />
    </div>
  );
}
