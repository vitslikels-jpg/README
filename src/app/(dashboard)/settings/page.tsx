import { AiModelComparisonTool } from "@/features/settings/components/ai-model-comparison-tool";

export default function SettingsPage() {
  return <AiModelComparisonTool defaultModel={process.env.POLZA_AI_MODEL?.trim() || "google/gemini-3.1-flash-lite"} />;
}
