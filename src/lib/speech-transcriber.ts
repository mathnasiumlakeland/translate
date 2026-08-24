import type { ModelState } from "./translation-types";

export const SPEECH_MODEL_ID = "onnx-community/whisper-small";

type WorkerRequestType = "warmup" | "transcribe";

type WorkerStatusMessage = {
  type: "status";
  requestId: number;
  state: ModelState;
};

type WorkerReadyMessage = {
  type: "ready";
  requestId: number;
};

type WorkerUpdateMessage = {
  type: "update";
  requestId: number;
  text: string;
};

type WorkerCompleteMessage = {
  type: "complete";
  requestId: number;
  text: string;
};

type WorkerErrorMessage = {
  type: "error";
  requestId: number;
  message: string;
};

type WorkerResponse =
  | WorkerStatusMessage
  | WorkerReadyMessage
  | WorkerUpdateMessage
  | WorkerCompleteMessage
  | WorkerErrorMessage;

type PendingRequest<T> = {
  onState: (state: ModelState) => void;
  onUpdate?: (text: string) => void;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  kind: WorkerRequestType;
};

let speechWorker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, PendingRequest<string | void>>();

export function loadSpeechModel(onState: (state: ModelState) => void): Promise<void> {
  return runWorkerRequest<void>("warmup", { onState });
}

export function transcribeSpeech(
  audio: Float32Array,
  language: string,
  onState: (state: ModelState) => void,
  onUpdate: (text: string) => void,
): Promise<string> {
  return runWorkerRequest<string>(
    "transcribe",
    {
      onState,
      onUpdate,
    },
    {
      audio,
      language,
    },
    [audio.buffer as ArrayBuffer],
  );
}

function runWorkerRequest<T extends string | void>(
  type: WorkerRequestType,
  callbacks: {
    onState: (state: ModelState) => void;
    onUpdate?: (text: string) => void;
  },
  payload?: Record<string, unknown>,
  transfer?: Transferable[],
): Promise<T> {
  const worker = getSpeechWorker();
  const nextRequestId = ++requestId;

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(nextRequestId, {
      ...callbacks,
      kind: type,
      resolve: resolve as PendingRequest<string | void>["resolve"],
      reject,
    });

    worker.postMessage(
      {
        type,
        requestId: nextRequestId,
        ...payload,
      },
      transfer ?? [],
    );
  });
}

function getSpeechWorker(): Worker {
  if (!speechWorker) {
    speechWorker = new Worker(new URL("./speech.worker.ts", import.meta.url), {
      type: "module",
    });
    speechWorker.addEventListener("message", handleWorkerMessage);
    speechWorker.addEventListener("error", handleWorkerError);
  }

  return speechWorker;
}

function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
  const message = event.data;
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;

  switch (message.type) {
    case "status":
      pending.onState(message.state);
      return;
    case "ready":
      pending.onState({
        status: "ready",
        progress: 100,
        statusText: "Local speech recognition is ready.",
      });
      pendingRequests.delete(message.requestId);
      pending.resolve(undefined);
      return;
    case "update":
      pending.onUpdate?.(message.text);
      return;
    case "complete":
      pending.onState({
        status: "ready",
        progress: 100,
        statusText: "Local speech recognition is ready.",
      });
      pendingRequests.delete(message.requestId);
      pending.resolve(message.text);
      return;
    case "error":
      pending.onState({
        status: "error",
        progress: 0,
        statusText: message.message,
        error: message.message,
      });
      pendingRequests.delete(message.requestId);
      pending.reject(new Error(message.message));
      return;
    default:
      return;
  }
}

function handleWorkerError() {
  for (const [id, pending] of pendingRequests.entries()) {
    const message = "The speech worker crashed while loading or running Whisper.";
    pending.onState({
      status: "error",
      progress: 0,
      statusText: message,
      error: message,
    });
    pending.reject(new Error(message));
    pendingRequests.delete(id);
  }
}
