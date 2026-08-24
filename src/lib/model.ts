export type TranslationModelId = "compact" | "balanced" | "quality";

export type TranslationModelProfile = {
  id: TranslationModelId;
  name: string;
  shortName: string;
  quantization: string;
  description: string;
  deviceHint: string;
  sizeBytes: number;
  sizeLabel: string;
  repo: string;
  file: string;
};

export const DEFAULT_TRANSLATION_MODEL_ID: TranslationModelId = "balanced";

export const TRANSLATION_MODELS: readonly TranslationModelProfile[] = [
  {
    id: "compact",
    name: "Compact",
    shortName: "Compact Q3",
    quantization: "Q3_K_S",
    description: "A smaller download with a modest quality tradeoff.",
    deviceHint: "Best for recent iPhones",
    sizeBytes: 871_854_848,
    sizeLabel: "831 MB",
    repo: "mradermacher/Hy-MT2-1.8B-GGUF",
    file: "Hy-MT2-1.8B.Q3_K_S.gguf",
  },
  {
    id: "balanced",
    name: "Everyday",
    shortName: "Everyday Q4",
    quantization: "Q4_K_M",
    description: "The best balance of translation quality and download size.",
    deviceHint: "Recommended for recent iPads",
    sizeBytes: 1_133_080_448,
    sizeLabel: "1.06 GB",
    repo: "tencent/Hy-MT2-1.8B-GGUF",
    file: "Hy-MT2-1.8B-Q4_K_M.gguf",
  },
  {
    id: "quality",
    name: "Quality",
    shortName: "Quality Q5",
    quantization: "Q5_K_M",
    description: "Keeps more model detail for nuanced translation.",
    deviceHint: "Best for powerful iPads and computers",
    sizeBytes: 1_298_756_352,
    sizeLabel: "1.21 GB",
    repo: "mradermacher/Hy-MT2-1.8B-GGUF",
    file: "Hy-MT2-1.8B.Q5_K_M.gguf",
  },
] as const;

export const MODEL_CARD_URL = "https://huggingface.co/tencent/Hy-MT2-1.8B";
export const MODEL_COLLECTION_URL = "https://huggingface.co/collections/tencent/hy-mt2";

export function getTranslationModel(modelId: TranslationModelId): TranslationModelProfile {
  return TRANSLATION_MODELS.find((model) => model.id === modelId) ?? TRANSLATION_MODELS[1];
}

export function isTranslationModelId(value: string | null): value is TranslationModelId {
  return TRANSLATION_MODELS.some((model) => model.id === value);
}
