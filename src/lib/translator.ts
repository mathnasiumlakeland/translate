import type { Wllama } from "@wllama/wllama";
import { getTranslationModel, type TranslationModelId } from "./model";
import type { ModelState, TranslatePayload } from "./translation-types";

let translator: Wllama | null = null;
let loadedModelId: TranslationModelId | null = null;
let loadingModelId: TranslationModelId | null = null;
let loadingPromise: Promise<Wllama> | null = null;

export async function loadTranslationModel(
  modelId: TranslationModelId,
  onState: (state: ModelState) => void,
): Promise<void> {
  await getTranslator(modelId, onState);
}

export async function translateText(
  modelId: TranslationModelId,
  payload: TranslatePayload,
  onState: (state: ModelState) => void,
  onUpdate: (text: string) => void,
): Promise<string> {
  const runtime = await getTranslator(modelId, onState);

  onState({
    status: "translating",
    progress: 100,
    statusText: `Translating ${payload.sourceLanguage} to ${payload.targetLanguage} locally...`,
  });

  let streamedText = "";
  await runtime.createChatCompletion({
    messages: [{ role: "user", content: buildPrompt(payload) }],
    stream: true,
    max_tokens: 128,
    temperature: 0.7,
    top_p: 0.6,
    top_k: 20,
    penalty_repeat: modelId === "compact" ? 1.2 : 1.05,
    onData(chunk) {
      const token = chunk.choices[0]?.delta.content ?? "";
      if (!token) return;

      streamedText += token;
      onUpdate(normalizeTranslation(streamedText));
    },
  });

  const finalText = normalizeTranslation(streamedText);
  onState({
    status: "ready",
    progress: 100,
    statusText: "HY-MT2 is ready.",
  });
  return finalText;
}

async function getTranslator(
  modelId: TranslationModelId,
  onState: (state: ModelState) => void,
): Promise<Wllama> {
  if (translator?.isModelLoaded() && loadedModelId === modelId) {
    onState({ status: "ready", progress: 100, statusText: "HY-MT2 is ready from this browser." });
    return translator;
  }

  if (loadingPromise && loadingModelId === modelId) {
    return loadingPromise;
  }

  if (loadingPromise) {
    await loadingPromise.catch(() => undefined);
    return getTranslator(modelId, onState);
  }

  loadingModelId = modelId;
  loadingPromise = createTranslator(modelId, onState).finally(() => {
    loadingPromise = null;
    loadingModelId = null;
  });
  return loadingPromise;
}

async function createTranslator(
  modelId: TranslationModelId,
  onState: (state: ModelState) => void,
): Promise<Wllama> {
  const profile = getTranslationModel(modelId);

  if (translator) {
    await translator.exit();
    translator = null;
    loadedModelId = null;
  }

  onState({
    status: "loading",
    progress: 1,
    statusText: `Checking ${profile.shortName} in the browser cache...`,
  });

  const [wllamaModule, wasmModule, compatWasmModule, compatWorkerModule] = await Promise.all([
    import("@wllama/wllama"),
    import("@wllama/wllama/esm/wasm/wllama.wasm?url"),
    import("@wllama/wllama-compat/wasm/wllama.wasm?url"),
    import("@wllama/wllama-compat/wasm/wllama.js?raw"),
  ]);

  const nextTranslator = new wllamaModule.Wllama(
    { default: wasmModule.default },
    { logger: wllamaModule.LoggerWithoutDebug, parallelDownloads: 3, suppressNativeLog: true },
  );

  nextTranslator.setCompat({
    wasm: compatWasmModule.default,
    worker: { code: compatWorkerModule.default },
  });

  try {
    await nextTranslator.loadModelFromHF(
      { repo: profile.repo, file: profile.file },
      {
        n_ctx: 1024,
        n_batch: 128,
        n_gpu_layers: 99,
        flash_attn: true,
        progressCallback({ loaded, total }) {
          const progress = total > 0 ? Math.max(2, Math.min(96, Math.round((loaded / total) * 96))) : 2;
          onState({
            status: "loading",
            progress,
            statusText: `Downloading ${profile.shortName}... ${formatBytes(loaded)} of ${formatBytes(total || profile.sizeBytes)}`,
          });
        },
      },
    );

    onState({ status: "loading", progress: 99, statusText: "Preparing HY-MT2 for local translation..." });
    translator = nextTranslator;
    loadedModelId = modelId;
    onState({ status: "ready", progress: 100, statusText: "HY-MT2 is ready from this browser." });
    return nextTranslator;
  } catch (error) {
    await nextTranslator.exit();
    const message = formatRuntimeError(error);
    onState({ status: "error", progress: 0, statusText: message, error: message });
    throw new Error(message);
  }
}

function buildPrompt(payload: TranslatePayload): string {
  return `Translate the following text from ${payload.sourceLanguage} into ${payload.targetLanguage}. Note that you should only output the translated result without any additional explanation:\n${payload.sourceText}`;
}

function normalizeTranslation(value: string): string {
  const cleaned = value
    .replace(/<｜hy_place▁holder▁no▁2｜>/g, "")
    .replace(/<\|eos\|>/g, "")
    .trim();

  return collapseRepeatedSentences(cleaned);
}

function collapseRepeatedSentences(value: string): string {
  const sentences = value.match(/[^.!?。！？]+[.!?。！？]+/gu) ?? [];
  if (sentences.length < 2) return value;

  for (let blockSize = 1; blockSize <= Math.floor(sentences.length / 2); blockSize += 1) {
    const firstBlock = sentences.slice(0, blockSize).map(normalizeSentenceForComparison);
    const secondBlock = sentences.slice(blockSize, blockSize * 2).map(normalizeSentenceForComparison);
    if (firstBlock.every((sentence, index) => sentence === secondBlock[index])) {
      return sentences.slice(0, blockSize).join("").trim();
    }
  }

  return value;
}

function normalizeSentenceForComparison(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/^[¡¿'"“”‘’]+/u, "")
    .replace(/\s+/g, " ");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  const megabytes = value / (1024 * 1024);
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${Math.round(megabytes)} MB`;
}

function formatRuntimeError(error: unknown): string {
  const original = error instanceof Error ? error.message : "HY-MT2 could not be loaded.";
  if (/memory|allocation|out of bounds|out of memory/i.test(original)) {
    return "This device ran out of memory while loading the model. Go back and choose a smaller model.";
  }
  if (/fetch|network|download/i.test(original)) {
    return "The HY-MT2 download was interrupted. Check the connection and retry; completed files stay cached.";
  }
  return original;
}
