export const settingsDescription =
  "General system settings for the workspace: identity, defaults, retention and regional constraints — plus the reference layout patterns used across the studio.";

export const settingsMeta = "workspace · sovereign-prod";

export const settingsPanels = [
  {
    id: "set.workspace",
    label: "Workspace identity",
    value: "sovereign-prod",
    tone: "sapphire" as const,
  },
  { id: "set.region", label: "Primary region", value: "eu-west", tone: "amethyst" as const },
  { id: "set.retention", label: "Trace retention", value: "90 d", tone: "emerald" as const },
  { id: "set.theme", label: "Interface theme", value: "obsidian", tone: "topaz" as const },
];

/** Compact grid stat tiles (icons stay in the component). */
export const settingsStats = [
  { key: "vram", label: "VRAM", value: "24 GB", tone: "sapphire" as const },
  { key: "compute", label: "Compute", value: "8 × H100", tone: "amethyst" as const },
  { key: "latency", label: "p95 latency", value: "382 ms", tone: "emerald" as const },
  { key: "vectors", label: "Vector store", value: "1.4 M", tone: "topaz" as const },
];

export const settingsConfigs = [
  {
    title: "Policy enforcement",
    description:
      "Her orkestrasyon adımını yayınlanmış politika setine karşı doğrular; ihlal eden çağrılar onay kuyruğuna düşer.",
    meta: "scope · workspace",
    defaultChecked: true,
  },
  {
    title: "Autonomous forging",
    description:
      "MetaForge önerilerinin düşük riskli olanlarını insan onayı olmadan derleyip sandbox'a almasına izin verir.",
    meta: "risk · medium",
    defaultChecked: false,
  },
];

export const settingsActions = [
  {
    title: "Model registry",
    description: "Kayıtlı model ve adaptörlerin sürüm bilgilerini sağlayıcılardan tekrar çeker.",
    meta: "synced 12m",
    action: "Yenile",
    tone: "sapphire" as const,
  },
  {
    title: "Knowledge index",
    description:
      "RAG koleksiyonlarının gömme indeksini yeniden oluşturur ve bayat parçaları temizler.",
    meta: "drift 2.1%",
    action: "Güncelle",
    tone: "amethyst" as const,
  },
  {
    title: "Fleet telemetry",
    description: "Ajan filosundan canlı sağlık, kuyruk ve maliyet metriklerini yeniden toplar.",
    meta: "live",
    action: "Yenile",
    tone: "emerald" as const,
  },
];
