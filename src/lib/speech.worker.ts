/// <reference lib="webworker" />

import {
  TextStreamer,
  env,
  pipeline,
  type AutomaticSpeechRecognitionOutput,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import { SPEECH_MODEL_ID } from "./speech-transcriber";
import type { ModelState, WorkerProgressInfo } from "./translation-types";

type WarmupRequest = {
  type: "warmup";
  requestId: number;
};

type TranscribeRequest = {
  type: "transcribe";
  requestId: number;
  audio: Float32Array;
  language: string;
};

type WorkerRequest = WarmupRequest | TranscribeRequest;

env.allowLocalModels = false;

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let workerLastPct = 0;

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === "warmup") {
      await loadTranscriber(message.requestId);
      postMessage({
        type: "ready",
        requestId: message.requestId,
      });
      return;
    }

    if (message.type === "transcribe") {
      const text = await transcribeAudio(message);
      postMessage({
        type: "complete",
        requestId: message.requestId,
        text,
      });
    }
  } catch (error) {
    postMessage({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Speech transcription failed.",
    });
  }
});

async function loadTranscriber(requestId: number): Promise<AutomaticSpeechRecognitionPipeline> {
  const workerNavigator = self.navigator as Navigator & { gpu?: unknown };
  if (!workerNavigator.gpu) {
    const message = "WebGPU is not available in this browser. Use a current Chromium browser with WebGPU enabled.";
    postStatus(requestId, {
      status: "error",
      progress: 0,
      statusText: message,
      error: message,
    });
    throw new Error(message);
  }

  if (!transcriberPromise) {
    workerLastPct = 0;

    transcriberPromise = pipeline("automatic-speech-recognition", SPEECH_MODEL_ID, {
      device: "webgpu",
      dtype: {
        encoder_model: "q4",
        decoder_model_merged: "q4",
      },
      progress_callback(info: WorkerProgressInfo) {
        const nextState = getLoadProgressState(info, workerLastPct);
        if (!nextState) return;

        workerLastPct = nextState.progress;
        postStatus(requestId, nextState);
      },
    }).catch((error: unknown) => {
      transcriberPromise = null;
      throw error;
    });
  }

  return transcriberPromise;
}

async function transcribeAudio({ requestId, audio, language }: TranscribeRequest): Promise<string> {
  const transcriber = await loadTranscriber(requestId);
  postStatus(requestId, {
    status: "transcribing",
    progress: 100,
    statusText: "Turning speech into text locally...",
  });

  let liveText = "";
  const streamer = new TextStreamer(transcriber.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function(text) {
      liveText += text;
      postMessage({
        type: "update",
        requestId,
        text: liveText.trim(),
      });
    },
  });

  const audioDurationSeconds = audio.length / 16_000;
  const shouldChunk = audioDurationSeconds > 29;
  const output = (await transcriber(audio, {
    top_k: 0,
    do_sample: false,
    language: language || undefined,
    task: "transcribe",
    force_full_sequences: false,
    streamer,
    ...(shouldChunk
      ? {
          chunk_length_s: 29,
          stride_length_s: 5,
        }
      : {}),
  })) as AutomaticSpeechRecognitionOutput;

  return (output.text || liveText).trim();
}

function postStatus(requestId: number, state: ModelState) {
  postMessage({
    type: "status",
    requestId,
    state,
  });
}

function getLoadProgressState(info: WorkerProgressInfo, previousProgress: number): ModelState | null {
  if (info.status === "progress_total" && typeof info.progress === "number") {
    const progress = clampProgress(info.progress, previousProgress);
    return {
      status: "loading",
      progress,
      statusText: `Downloading local speech recognition... ${progress}%.`,
    };
  }

  if (info.status === "download" || info.status === "done") {
    return {
      status: "loading",
      progress: previousProgress,
      statusText: "Preparing local speech recognition...",
    };
  }

  return null;
}

function clampProgress(value: number, previousProgress: number): number {
  return Math.max(previousProgress, Math.min(99, Math.round(value)));
}
