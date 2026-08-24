export type Side = "left" | "right";

export type ModelStatus = "idle" | "loading" | "ready" | "transcribing" | "translating" | "error";

export type ModelState = {
  status: ModelStatus;
  progress: number;
  statusText: string;
  error?: string;
};

export type TurnStatus = "translating" | "complete" | "error";

export type Turn = {
  id: string;
  speakerSide: Side;
  sourceLanguage: string;
  targetLanguage: string;
  sourceText: string;
  targetText: string;
  status: TurnStatus;
  error?: string;
  createdAt: number;
};

export type TranslatePayload = {
  turnId: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export type WorkerProgressInfo = {
  status: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
};
