import * as Select from "@radix-ui/react-select";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeToMono16k } from "./lib/audio";
import {
  DEFAULT_TRANSLATION_MODEL_ID,
  MODEL_CARD_URL,
  MODEL_COLLECTION_URL,
  TRANSLATION_MODELS,
  getTranslationModel,
  isTranslationModelId,
  type TranslationModelId,
} from "./lib/model";
import { loadSpeechModel, transcribeSpeech } from "./lib/speech-transcriber";
import { loadTranslationModel, translateText } from "./lib/translator";
import type { ModelState, ModelStatus, Side, Turn } from "./lib/translation-types";

type LanguageOption = {
  code: string;
  label: string;
  translationName: string;
};

type PanelState = {
  languageCode: string;
  draftText: string;
};

type AppMode = "text" | "speech";
type CaptureStatus = "idle" | "recording" | "stopping" | "transcribing";
type Screen = "select" | "loading" | "workspace";

type EditingMessage = {
  turnId: string;
  side: Side;
  text: string;
};

type RuntimeSummary = {
  status: ModelStatus;
  label: string;
  progress: number;
  ready: boolean;
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", label: "English", translationName: "English" },
  { code: "es", label: "Spanish", translationName: "Spanish" },
  { code: "zh", label: "Chinese", translationName: "Chinese" },
  { code: "zh-Hant", label: "Chinese (Traditional)", translationName: "Traditional Chinese" },
  { code: "yue", label: "Cantonese", translationName: "Cantonese" },
  { code: "fr", label: "French", translationName: "French" },
  { code: "de", label: "German", translationName: "German" },
  { code: "it", label: "Italian", translationName: "Italian" },
  { code: "pt", label: "Portuguese", translationName: "Portuguese" },
  { code: "ja", label: "Japanese", translationName: "Japanese" },
  { code: "ko", label: "Korean", translationName: "Korean" },
  { code: "ar", label: "Arabic", translationName: "Arabic" },
  { code: "ru", label: "Russian", translationName: "Russian" },
  { code: "tr", label: "Turkish", translationName: "Turkish" },
  { code: "th", label: "Thai", translationName: "Thai" },
  { code: "vi", label: "Vietnamese", translationName: "Vietnamese" },
  { code: "id", label: "Indonesian", translationName: "Indonesian" },
  { code: "ms", label: "Malay", translationName: "Malay" },
  { code: "tl", label: "Filipino", translationName: "Filipino" },
  { code: "hi", label: "Hindi", translationName: "Hindi" },
  { code: "pl", label: "Polish", translationName: "Polish" },
  { code: "cs", label: "Czech", translationName: "Czech" },
  { code: "nl", label: "Dutch", translationName: "Dutch" },
  { code: "km", label: "Khmer", translationName: "Khmer" },
  { code: "my", label: "Burmese", translationName: "Burmese" },
  { code: "fa", label: "Persian", translationName: "Persian" },
  { code: "gu", label: "Gujarati", translationName: "Gujarati" },
  { code: "ur", label: "Urdu", translationName: "Urdu" },
  { code: "te", label: "Telugu", translationName: "Telugu" },
  { code: "mr", label: "Marathi", translationName: "Marathi" },
  { code: "he", label: "Hebrew", translationName: "Hebrew" },
  { code: "bn", label: "Bengali", translationName: "Bengali" },
  { code: "ta", label: "Tamil", translationName: "Tamil" },
  { code: "uk", label: "Ukrainian", translationName: "Ukrainian" },
  { code: "bo", label: "Tibetan", translationName: "Tibetan" },
  { code: "kk", label: "Kazakh", translationName: "Kazakh" },
  { code: "mn", label: "Mongolian", translationName: "Mongolian" },
  { code: "ug", label: "Uyghur", translationName: "Uyghur" },
];

const INITIAL_MODEL_STATE: ModelState = {
  status: "idle",
  progress: 0,
  statusText: "Not downloaded yet.",
};

const SIDE_LABELS: Record<Side, string> = {
  left: "Person 1",
  right: "Person 2",
};

const MODEL_READY_ANIMATION_MS = 320;
const SAVED_MODEL_KEY = "translate.hy-mt2-model";

function App() {
  const [screen, setScreen] = useState<Screen>("select");
  const [mode, setMode] = useState<AppMode>("speech");
  const [selectedModelId, setSelectedModelId] = useState<TranslationModelId>(readSavedModelId);
  const [panels, setPanels] = useState<Record<Side, PanelState>>({
    left: { languageCode: "en", draftText: "" },
    right: { languageCode: "es", draftText: "" },
  });
  const [activeSide, setActiveSide] = useState<Side>("left");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [translationModelState, setTranslationModelState] = useState<ModelState>(INITIAL_MODEL_STATE);
  const [speechModelState, setSpeechModelState] = useState<ModelState>(INITIAL_MODEL_STATE);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [captureSide, setCaptureSide] = useState<Side | null>(null);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [tableMode, setTableMode] = useState(true);
  const [speechUnavailable, setSpeechUnavailable] = useState(false);
  const [appNotice, setAppNotice] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);

  const panelsRef = useRef(panels);
  const autoTranslateRef = useRef(autoTranslate);
  const autoSwitchRef = useRef(autoSwitch);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const capturedChunksRef = useRef<Blob[]>([]);
  const speechTextRef = useRef("");
  const loadRunIdRef = useRef(0);

  const isTranslating = activeTurnId !== null;
  const canUseSpeechInput = mode === "speech" && !speechUnavailable && canRecordSpeech();
  const sourceLanguage = getLanguage(panels[activeSide].languageCode);
  const targetSide = getOppositeSide(activeSide);
  const targetLanguage = getLanguage(panels[targetSide].languageCode);
  const latestTurn = turns.at(-1) ?? null;
  const selectedModel = getTranslationModel(selectedModelId);
  const appClass = [
    "app-shell",
    tableMode ? "table-mode-enabled" : "",
    mode === "speech" ? "speech-mode" : "text-mode",
  ]
    .filter(Boolean)
    .join(" ");
  const runtime = useMemo(
    () => getRuntimeSummary(mode, translationModelState, speechModelState, captureStatus, isTranslating),
    [captureStatus, isTranslating, mode, speechModelState, translationModelState],
  );

  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);

  useEffect(() => {
    autoTranslateRef.current = autoTranslate;
  }, [autoTranslate]);

  useEffect(() => {
    autoSwitchRef.current = autoSwitch;
  }, [autoSwitch]);

  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // A recorder can already be shutting down while the app unmounts.
      }
      stopTracks(captureStreamRef.current);
    };
  }, []);

  async function warmModels(nextMode = mode): Promise<boolean> {
    setAppNotice(null);
    try {
      if (canWarmModel(translationModelState)) {
        await loadTranslationModel(selectedModelId, setTranslationModelState);
      }
      if (nextMode === "speech" && canWarmModel(speechModelState)) {
        await loadSpeechModel(setSpeechModelState);
      }
      return true;
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Model loading failed.");
      return false;
    }
  }

  function enterTranslator(nextMode: AppMode) {
    setMode(nextMode);
    setScreen("loading");
    void loadWorkspace(nextMode);
  }

  async function loadWorkspace(nextMode: AppMode) {
    const runId = loadRunIdRef.current + 1;
    loadRunIdRef.current = runId;
    const loaded = await warmModels(nextMode);
    if (!loaded || loadRunIdRef.current !== runId) return;
    await delay(MODEL_READY_ANIMATION_MS);
    if (loadRunIdRef.current === runId) setScreen("workspace");
  }

  function goBackToSelect() {
    loadRunIdRef.current += 1;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // A recorder can already be closing.
      }
    }
    mediaRecorderRef.current = null;
    capturedChunksRef.current = [];
    stopTracks(captureStreamRef.current);
    captureStreamRef.current = null;
    setCaptureStatus("idle");
    setCaptureSide(null);
    setEditingMessage(null);
    setScreen("select");
    setAppNotice(null);
  }

  function chooseModel(modelId: TranslationModelId) {
    if (modelId === selectedModelId) return;
    setSelectedModelId(modelId);
    setTranslationModelState(INITIAL_MODEL_STATE);
    window.localStorage.setItem(SAVED_MODEL_KEY, modelId);
  }

  function setPanelLanguage(side: Side, languageCode: string) {
    setPanels((current) => ({
      ...current,
      [side]: { ...current[side], languageCode },
    }));
  }

  function setPanelDraft(side: Side, draftText: string) {
    setPanels((current) => ({
      ...current,
      [side]: { ...current[side], draftText },
    }));
  }

  function selectSide(side: Side) {
    if (captureStatus !== "idle" || isTranslating) return;
    setActiveSide(side);
    setAppNotice(null);
  }

  function swapLanguages() {
    if (captureStatus !== "idle" || isTranslating || editingMessage) return;
    setPanels((current) => ({
      left: {
        ...current.left,
        languageCode: current.right.languageCode,
        draftText: current.right.draftText,
      },
      right: {
        ...current.right,
        languageCode: current.left.languageCode,
        draftText: current.left.draftText,
      },
    }));
  }

  function clearConversation() {
    if (captureStatus !== "idle" || isTranslating) return;
    setTurns([]);
    setEditingMessage(null);
    setPanels((current) => ({
      left: { ...current.left, draftText: "" },
      right: { ...current.right, draftText: "" },
    }));
    setAppNotice(null);
  }

  async function startListening(side: Side) {
    if (captureStatus !== "idle") {
      if (captureSide === side && captureStatus === "recording") stopListening();
      return;
    }
    if (mode !== "speech") return;

    if (!canRecordSpeech()) {
      setSpeechUnavailable(true);
      setAppNotice("Audio recording is not available in this browser. Use text mode instead.");
      return;
    }

    setActiveSide(side);
    setAppNotice(null);
    speechTextRef.current = panelsRef.current[side].draftText.trim();
    capturedChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) capturedChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setSpeechUnavailable(true);
        setAppNotice("Audio recording stopped unexpectedly. Use text mode if this keeps happening.");
      };
      recorder.onstop = () => void finishSpeechCapture(side);

      captureStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setCaptureSide(side);
      setCaptureStatus("recording");
      recorder.start();
    } catch (error) {
      stopTracks(captureStreamRef.current);
      captureStreamRef.current = null;
      mediaRecorderRef.current = null;
      setCaptureStatus("idle");
      setCaptureSide(null);
      setSpeechUnavailable(true);
      setAppNotice(formatCaptureError(error));
    }
  }

  function stopListening() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setCaptureStatus("stopping");
    recorder.stop();
  }

  async function finishSpeechCapture(side: Side) {
    const chunks = capturedChunksRef.current;
    capturedChunksRef.current = [];
    mediaRecorderRef.current = null;
    stopTracks(captureStreamRef.current);
    captureStreamRef.current = null;

    if (!chunks.length) {
      setCaptureStatus("idle");
      setCaptureSide(null);
      setAppNotice("No audio was captured.");
      return;
    }

    setCaptureStatus("transcribing");
    try {
      const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
      const audio = await decodeToMono16k(blob);
      const transcript = await transcribeSpeech(audio, "", setSpeechModelState, (text) => {
        setPanelDraft(side, appendSpeechText(speechTextRef.current, text));
      });
      const finalTranscript = appendSpeechText(speechTextRef.current, transcript);

      setPanelDraft(side, finalTranscript);
      setCaptureStatus("idle");
      setCaptureSide(null);

      if (!finalTranscript) {
        setAppNotice("No speech was detected.");
        return;
      }
      if (autoTranslateRef.current) await translateSide(side, finalTranscript);
    } catch (error) {
      setCaptureStatus("idle");
      setCaptureSide(null);
      setAppNotice(error instanceof Error ? error.message : "Speech transcription failed.");
    }
  }

  async function translateSide(side: Side, overrideText?: string) {
    if (activeTurnId || editingMessage) return;
    const sourceText = (overrideText ?? panelsRef.current[side].draftText).trim();
    if (!sourceText) {
      setAppNotice("Speak or type something before translating.");
      return;
    }

    const nextTargetSide = getOppositeSide(side);
    const nextSourceLanguage = getLanguage(panelsRef.current[side].languageCode);
    const nextTargetLanguage = getLanguage(panelsRef.current[nextTargetSide].languageCode);
    const turnId = createTurnId();
    const nextTurn: Turn = {
      id: turnId,
      speakerSide: side,
      sourceLanguage: nextSourceLanguage.label,
      targetLanguage: nextTargetLanguage.label,
      sourceText,
      targetText: "",
      status: "translating",
      createdAt: Date.now(),
    };

    setAppNotice(null);
    setActiveSide(side);
    setActiveTurnId(turnId);
    setTurns((current) => [...current, nextTurn]);
    setPanelDraft(side, "");

    try {
      const finalText = await translateText(
        selectedModelId,
        {
          turnId,
          sourceText,
          sourceLanguage: nextSourceLanguage.translationName,
          targetLanguage: nextTargetLanguage.translationName,
        },
        setTranslationModelState,
        (text) => {
          setTurns((current) => current.map((turn) => (turn.id === turnId ? { ...turn, targetText: text } : turn)));
        },
      );

      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, targetText: finalText, status: "complete" } : turn,
        ),
      );
      if (autoSwitchRef.current) setActiveSide(nextTargetSide);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation failed.";
      setTurns((current) =>
        current.map((turn) => (turn.id === turnId ? { ...turn, status: "error", error: message } : turn)),
      );
      setAppNotice(message);
    } finally {
      setActiveTurnId(null);
    }
  }

  function startEditingTurn(turnId: string, side: Side, text: string) {
    if (captureStatus !== "idle" || activeTurnId) return;
    setActiveSide(side);
    setAppNotice(null);
    setEditingMessage({ turnId, side, text });
  }

  async function saveEditingTurn() {
    const edit = editingMessage;
    if (!edit || activeTurnId || captureStatus !== "idle") return;
    const sourceText = edit.text.trim();
    if (!sourceText) {
      setAppNotice("Edited text cannot be empty.");
      return;
    }
    setEditingMessage(null);
    await retranslateTurnFromEdit(edit.turnId, edit.side, sourceText);
  }

  async function retranslateTurnFromEdit(turnId: string, side: Side, sourceText: string) {
    if (activeTurnId || !turns.some((turn) => turn.id === turnId)) return;
    const nextTargetSide = getOppositeSide(side);
    const nextSourceLanguage = getLanguage(panelsRef.current[side].languageCode);
    const nextTargetLanguage = getLanguage(panelsRef.current[nextTargetSide].languageCode);

    setAppNotice(null);
    setActiveSide(side);
    setActiveTurnId(turnId);
    setTurns((current) =>
      current.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              speakerSide: side,
              sourceLanguage: nextSourceLanguage.label,
              targetLanguage: nextTargetLanguage.label,
              sourceText,
              targetText: "",
              status: "translating",
              error: undefined,
            }
          : turn,
      ),
    );

    try {
      const finalText = await translateText(
        selectedModelId,
        {
          turnId,
          sourceText,
          sourceLanguage: nextSourceLanguage.translationName,
          targetLanguage: nextTargetLanguage.translationName,
        },
        setTranslationModelState,
        (text) => {
          setTurns((current) => current.map((turn) => (turn.id === turnId ? { ...turn, targetText: text } : turn)));
        },
      );
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, targetText: finalText, status: "complete" } : turn,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation failed.";
      setTurns((current) =>
        current.map((turn) => (turn.id === turnId ? { ...turn, status: "error", error: message } : turn)),
      );
      setAppNotice(message);
    } finally {
      setActiveTurnId(null);
    }
  }

  if (screen === "select") {
    return (
      <main className="select-screen">
        <div className="setup-layout">
          <header className="setup-intro">
            <a className="select-title" href={MODEL_COLLECTION_URL} target="_blank" rel="noreferrer">Translate</a>
            <p className="select-subtitle">Local conversation translation with HY-MT2</p>
          </header>

          <section className="setup-languages" aria-labelledby="languages-title">
            <div className="section-heading">
              <div>
                <h2 id="languages-title">Languages</h2>
              </div>
              <button className="quiet-button" type="button" onClick={swapLanguages}>
                <SwapIcon /> Swap
              </button>
            </div>
            <div className="language-pair">
              <LanguageSelect
                label="Person 1"
                value={panels.left.languageCode}
                disabled={false}
                onActivate={() => setActiveSide("left")}
                onValueChange={(value) => setPanelLanguage("left", value)}
              />
              <span className="pair-arrow" aria-hidden="true"><ArrowIcon /></span>
              <LanguageSelect
                label="Person 2"
                value={panels.right.languageCode}
                disabled={false}
                onActivate={() => setActiveSide("right")}
                onValueChange={(value) => setPanelLanguage("right", value)}
              />
            </div>
          </section>

          <section className="model-picker" aria-labelledby="model-title">
            <div className="section-heading">
              <div>
                <h2 id="model-title">Model</h2>
              </div>
              <a className="text-link" href={MODEL_CARD_URL} target="_blank" rel="noreferrer">About HY-MT2</a>
            </div>
            <div className="model-options" role="radiogroup" aria-label="Translation model">
              {TRANSLATION_MODELS.map((model) => {
                const selected = model.id === selectedModelId;
                return (
                  <label className={`model-option ${selected ? "is-selected" : ""}`} key={model.id}>
                    <input
                      type="radio"
                      name="translation-model"
                      value={model.id}
                      checked={selected}
                      onChange={() => chooseModel(model.id)}
                    />
                    <span className="model-radio" aria-hidden="true"><span /></span>
                    <span className="model-copy">
                      <span className="model-name-line">
                        <strong>{model.name}</strong>
                        {model.id === DEFAULT_TRANSLATION_MODEL_ID ? <em>Recommended</em> : null}
                      </span>
                      <span>{model.description}</span>
                      <small>{model.deviceHint}</small>
                    </span>
                    <span className="model-size">
                      <strong>{model.sizeLabel}</strong>
                      <span>{model.quantization}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="start-section" aria-labelledby="start-title">
            <div className="section-heading">
              <div>
                <h2 id="start-title">Mode</h2>
              </div>
            </div>
            <div className="start-actions">
              <button className="start-button primary" type="button" onClick={() => enterTranslator("speech")}>
                <span className="start-icon"><MicrophoneIcon /></span>
                <span><strong>Voice conversation</strong><small>Speak, review, translate</small></span>
                <ArrowIcon />
              </button>
              <button className="start-button" type="button" onClick={() => enterTranslator("text")}>
                <span className="start-icon"><KeyboardIcon /></span>
                <span><strong>Text conversation</strong><small>Type on either side</small></span>
                <ArrowIcon />
              </button>
            </div>
            <p className="download-note">First download: {selectedModel.sizeLabel}. Voice mode also adds about 300 MB for local speech recognition. Files stay in this browser for next time.</p>
          </section>
        </div>
      </main>
    );
  }

  if (screen === "loading") {
    return (
      <main className="loading-screen">
        <header className="setup-header compact">
          <button className="brand-mark button-reset" type="button" onClick={goBackToSelect}>
            <span>Translate</span>
          </button>
          <button type="button" className="quiet-button" onClick={goBackToSelect}>Back</button>
        </header>
        <section className="loading-stage" aria-label="Preparing local models">
          <div className="loading-copy">
            <p className="eyebrow">One-time setup</p>
            <h1>{runtime.status === "error" ? "Something interrupted the download." : "Preparing your local interpreter."}</h1>
            <p>Keep this tab open. Once cached, the models can be reused without downloading them again.</p>
          </div>
          <div className="load-list">
            <ModelLoadRow
              name={`HY-MT2 · ${selectedModel.shortName}`}
              detail={selectedModel.sizeLabel}
              state={translationModelState}
            />
            {mode === "speech" ? (
              <ModelLoadRow name="Whisper small · Local speech" detail="about 300 MB" state={speechModelState} />
            ) : null}
          </div>
          {runtime.status === "error" ? (
            <button className="retry-button" type="button" onClick={() => void loadWorkspace(mode)}>Retry download</button>
          ) : (
            <div className="privacy-line"><LockIcon /> No audio or conversation text is sent to a server.</div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={appClass}>
      <header className="top-bar">
        <button className="top-brand button-reset" type="button" onClick={goBackToSelect}>
          <span>Translate</span>
        </button>
        <span className="top-bar-divider">/</span>
        <span className="top-bar-mode">{mode === "speech" ? "Voice" : "Text"}</span>
        <div className={`runtime-pill is-${runtime.status}`} role="status">
          <span>{runtime.label}</span>
        </div>
        <button type="button" className="model-chip" onClick={goBackToSelect}>
          <span>HY-MT2</span>
          <strong>{selectedModel.name}</strong>
        </button>
      </header>

      <section className="translator-workspace" aria-label="Two-person conversation translator">
        <TranslatorPanel
          side="left"
          activeSide={activeSide}
          appMode={mode}
          panel={panels.left}
          turns={turns}
          latestTurnId={latestTurn?.id ?? null}
          captureStatus={captureStatus}
          captureSide={captureSide}
          canUseSpeechInput={canUseSpeechInput}
          isTranslating={isTranslating}
          editingMessage={editingMessage}
          tableMode={tableMode}
          autoTranslate={autoTranslate}
          onSelectSide={selectSide}
          onDraftChange={setPanelDraft}
          onLanguageChange={setPanelLanguage}
          onListen={startListening}
          onStopListening={stopListening}
          onTranslate={(side) => void translateSide(side)}
          onStartEdit={startEditingTurn}
          onEditChange={(text) => setEditingMessage((current) => (current ? { ...current, text } : current))}
          onCancelEdit={() => setEditingMessage(null)}
          onSaveEdit={() => void saveEditingTurn()}
        />

        <CenterControls
          activeSide={activeSide}
          appMode={mode}
          sourceLanguage={sourceLanguage.label}
          targetLanguage={targetLanguage.label}
          captureStatus={captureStatus}
          isTranslating={isTranslating}
          autoTranslate={autoTranslate}
          autoSwitch={autoSwitch}
          tableMode={tableMode}
          onSwapLanguages={swapLanguages}
          onClear={clearConversation}
          onToggleAutoTranslate={() => setAutoTranslate((value) => !value)}
          onToggleAutoSwitch={() => setAutoSwitch((value) => !value)}
          onToggleTableMode={() => setTableMode((value) => !value)}
        />

        <TranslatorPanel
          side="right"
          activeSide={activeSide}
          appMode={mode}
          panel={panels.right}
          turns={turns}
          latestTurnId={latestTurn?.id ?? null}
          captureStatus={captureStatus}
          captureSide={captureSide}
          canUseSpeechInput={canUseSpeechInput}
          isTranslating={isTranslating}
          editingMessage={editingMessage}
          tableMode={tableMode}
          autoTranslate={autoTranslate}
          onSelectSide={selectSide}
          onDraftChange={setPanelDraft}
          onLanguageChange={setPanelLanguage}
          onListen={startListening}
          onStopListening={stopListening}
          onTranslate={(side) => void translateSide(side)}
          onStartEdit={startEditingTurn}
          onEditChange={(text) => setEditingMessage((current) => (current ? { ...current, text } : current))}
          onCancelEdit={() => setEditingMessage(null)}
          onSaveEdit={() => void saveEditingTurn()}
        />
      </section>

      {appNotice ? (
        <div className="notice-bar" role="alert">
          <span>{appNotice}</span>
          <button type="button" onClick={() => setAppNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      ) : null}
    </main>
  );
}

type TranslatorPanelProps = {
  side: Side;
  activeSide: Side;
  appMode: AppMode;
  panel: PanelState;
  turns: Turn[];
  latestTurnId: string | null;
  captureStatus: CaptureStatus;
  captureSide: Side | null;
  canUseSpeechInput: boolean;
  isTranslating: boolean;
  editingMessage: EditingMessage | null;
  tableMode: boolean;
  autoTranslate: boolean;
  onSelectSide: (side: Side) => void;
  onDraftChange: (side: Side, draftText: string) => void;
  onLanguageChange: (side: Side, languageCode: string) => void;
  onListen: (side: Side) => void;
  onStopListening: () => void;
  onTranslate: (side: Side) => void;
  onStartEdit: (turnId: string, side: Side, text: string) => void;
  onEditChange: (text: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
};

function TranslatorPanel({
  side,
  activeSide,
  appMode,
  panel,
  turns,
  latestTurnId,
  captureStatus,
  captureSide,
  canUseSpeechInput,
  isTranslating,
  editingMessage,
  tableMode,
  autoTranslate,
  onSelectSide,
  onDraftChange,
  onLanguageChange,
  onListen,
  onStopListening,
  onTranslate,
  onStartEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
}: TranslatorPanelProps) {
  const isActive = side === activeSide;
  const language = getLanguage(panel.languageCode);
  const messages = turns.map((turn) => getPanelMessage(turn, side));
  const isRecordingHere = captureStatus === "recording" && captureSide === side;
  const isWorkingHere = (captureStatus === "stopping" || captureStatus === "transcribing") && captureSide === side;
  const canSubmit = panel.draftText.trim().length > 0 && !isTranslating && !editingMessage && captureStatus === "idle";
  const feedRef = useRef<HTMLDivElement | null>(null);
  const latestText = messages.at(-1)?.text;

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages.length, latestText]);

  return (
    <section className={`translator-panel ${side}-panel ${isActive ? "is-active" : ""}`}>
      <div className="panel-content">
        <div className="panel-header">
          <button className="speaker-button" type="button" onClick={() => onSelectSide(side)}>
            <span className="speaker-index">{SIDE_LABELS[side]}</span>
            <span className={`speaker-state ${isActive ? "is-active" : ""}`}>
              <span /> {isActive ? "Ready to speak" : "Tap this side"}
            </span>
          </button>
          <LanguageSelect
            label="Language"
            value={panel.languageCode}
            disabled={isTranslating || captureStatus !== "idle"}
            rotated={tableMode && side === "right"}
            onActivate={() => onSelectSide(side)}
            onValueChange={(languageCode) => onLanguageChange(side, languageCode)}
          />
        </div>

        <div className="transcript-feed" ref={feedRef} aria-live="polite">
          {messages.length ? (
            messages.map((message) => {
              const isEditingThis = editingMessage?.turnId === message.id && editingMessage.side === side;
              const displayText = message.text || (message.status === "error" ? message.error : "Translating…");
              const canEditMessage = Boolean(message.text) && captureStatus === "idle" && !isTranslating;

              return (
                <article
                  className={`message-row ${message.intent} ${message.id === latestTurnId ? "is-latest" : ""}`}
                  key={`${message.id}-${side}`}
                >
                  <div className="message-meta">
                    <span>{message.intent === "spoken" ? "Said on this side" : "Translation"}</span>
                    <span>{message.language}</span>
                  </div>
                  {isEditingThis ? (
                    <div className="message-edit-panel">
                      <textarea
                        value={editingMessage.text}
                        onChange={(event) => onEditChange(event.target.value)}
                        aria-label={`Edit ${message.language} text`}
                        rows={3}
                        autoFocus
                      />
                      <div className="message-edit-actions">
                        <button type="button" onClick={onCancelEdit}>Cancel</button>
                        <button type="button" onClick={onSaveEdit} disabled={!editingMessage.text.trim()}>Save & translate</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p>{displayText}</p>
                      {canEditMessage ? (
                        <button
                          className="message-edit-button"
                          type="button"
                          onClick={() => onStartEdit(message.id, side, message.text)}
                          aria-label={`Edit ${message.language} text`}
                        >
                          Edit
                        </button>
                      ) : null}
                    </>
                  )}
                </article>
              );
            })
          ) : (
            <div className="empty-feed">
              <span className="empty-language">{language.label}</span>
              <strong>{appMode === "speech" ? "Tap Speak and say something" : "Type a message below"}</strong>
              <p>The original and translation will stay visible on both sides.</p>
            </div>
          )}
        </div>

        <div className="composer">
          <textarea
            value={panel.draftText}
            onChange={(event) => onDraftChange(side, event.target.value)}
            onFocus={() => onSelectSide(side)}
            placeholder={appMode === "speech" ? `${language.label} transcript appears here…` : `Type in ${language.label}…`}
            disabled={isTranslating || captureStatus === "transcribing"}
            rows={3}
            aria-label={`${language.label} message`}
          />
          <div className="composer-actions">
            {appMode === "speech" ? (
              <button
                className={`speak-button ${isRecordingHere ? "is-recording" : ""} ${isWorkingHere ? "is-working" : ""}`}
                type="button"
                onClick={() => (isRecordingHere ? onStopListening() : onListen(side))}
                disabled={!canUseSpeechInput || isTranslating || (captureStatus !== "idle" && !isRecordingHere)}
              >
                <span className="speak-icon">
                  {isWorkingHere ? <SpinnerIcon /> : isRecordingHere ? <StopIcon /> : <MicrophoneIcon />}
                </span>
                <span>
                  <strong>{isWorkingHere ? "Working…" : isRecordingHere ? "Stop" : "Speak"}</strong>
                  <small>{isRecordingHere ? "Tap when finished" : autoTranslate ? "Translates when you stop" : "Records locally"}</small>
                </span>
              </button>
            ) : null}
            <button
              className="translate-button"
              type="button"
              onClick={() => onTranslate(side)}
              disabled={!canSubmit}
              aria-label={`Translate ${language.label} message`}
            >
              <span>{appMode === "speech" ? "Translate text" : "Translate"}</span>
              <ArrowIcon />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

type LanguageSelectProps = {
  label: string;
  value: string;
  disabled: boolean;
  rotated?: boolean;
  onActivate: () => void;
  onValueChange: (value: string) => void;
};

function LanguageSelect({ label, value, disabled, rotated = false, onActivate, onValueChange }: LanguageSelectProps) {
  const currentLanguage = getLanguage(value);
  return (
    <div className="language-select">
      <span>{label}</span>
      <Select.Root value={value} onValueChange={onValueChange} disabled={disabled} onOpenChange={(open) => open && onActivate()}>
        <Select.Trigger className="language-select-trigger" aria-label={`${label}: ${currentLanguage.label}`} onFocus={onActivate}>
          <Select.Value>{currentLanguage.label}</Select.Value>
          <Select.Icon className="language-select-chevron" aria-hidden="true"><span /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className={`language-select-content ${rotated ? "is-table-rotated" : ""}`}
            position="popper"
            side={rotated ? "top" : "bottom"}
            sideOffset={8}
            align="end"
          >
            <Select.Viewport className="language-select-viewport">
              {LANGUAGE_OPTIONS.map((option) => (
                <Select.Item className="language-select-item" key={option.code} value={option.code}>
                  <Select.ItemIndicator className="language-select-item-indicator">✓</Select.ItemIndicator>
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

type CenterControlsProps = {
  activeSide: Side;
  appMode: AppMode;
  sourceLanguage: string;
  targetLanguage: string;
  captureStatus: CaptureStatus;
  isTranslating: boolean;
  autoTranslate: boolean;
  autoSwitch: boolean;
  tableMode: boolean;
  onSwapLanguages: () => void;
  onClear: () => void;
  onToggleAutoTranslate: () => void;
  onToggleAutoSwitch: () => void;
  onToggleTableMode: () => void;
};

function CenterControls({
  activeSide,
  appMode,
  sourceLanguage,
  targetLanguage,
  captureStatus,
  isTranslating,
  autoTranslate,
  autoSwitch,
  tableMode,
  onSwapLanguages,
  onClear,
  onToggleAutoTranslate,
  onToggleAutoSwitch,
  onToggleTableMode,
}: CenterControlsProps) {
  const controlsDisabled = isTranslating || captureStatus !== "idle";
  return (
    <aside className={`center-controls active-${activeSide}`} aria-label="Conversation controls">
      <div className="direction-readout">
        <span className="direction-arrow" aria-hidden="true"><ArrowIcon /></span>
        <span><strong>{sourceLanguage}</strong><small>to {targetLanguage}</small></span>
      </div>
      <div className="center-actions">
        <button type="button" onClick={onSwapLanguages} disabled={controlsDisabled} title="Swap languages">
          <SwapIcon /><span>Swap</span>
        </button>
        {appMode === "speech" ? (
          <button type="button" className={autoTranslate ? "is-on" : ""} onClick={onToggleAutoTranslate} aria-pressed={autoTranslate} title="Translate automatically after recording">
            <SparkIcon /><span>Auto translate</span>
          </button>
        ) : null}
        <button type="button" className={autoSwitch ? "is-on" : ""} onClick={onToggleAutoSwitch} aria-pressed={autoSwitch} title="Move to the other speaker after translation">
          <NextIcon /><span>Next speaker</span>
        </button>
        <button type="button" className={tableMode ? "is-on" : ""} onClick={onToggleTableMode} aria-pressed={tableMode} title="Rotate the far side on a shared screen">
          <TableIcon /><span>Table view</span>
        </button>
        <button type="button" onClick={onClear} disabled={controlsDisabled} title="Clear conversation">
          <ClearIcon /><span>Clear</span>
        </button>
      </div>
    </aside>
  );
}

function ModelLoadRow({ name, detail, state }: { name: string; detail: string; state: ModelState }) {
  const progress = state.status === "ready" ? 100 : clampProgress(state.progress);
  return (
    <div className={`load-row is-${state.status}`}>
      <div className="load-row-heading">
        <span><strong>{name}</strong><small>{detail}</small></span>
        <span className="load-percentage">{progress}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span className="progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      <p>{state.statusText}</p>
    </div>
  );
}

function getPanelMessage(turn: Turn, side: Side) {
  const isSpeaker = turn.speakerSide === side;
  return {
    id: turn.id,
    intent: isSpeaker ? "spoken" : "translated",
    language: isSpeaker ? turn.sourceLanguage : turn.targetLanguage,
    text: isSpeaker ? turn.sourceText : turn.targetText,
    status: turn.status,
    error: turn.error,
  };
}

function getRuntimeSummary(
  mode: AppMode,
  translationModelState: ModelState,
  speechModelState: ModelState,
  captureStatus: CaptureStatus,
  isTranslating: boolean,
): RuntimeSummary {
  const states = mode === "speech" ? [translationModelState, speechModelState] : [translationModelState];
  const progress = Math.round(states.reduce((sum, state) => sum + clampProgress(state.progress), 0) / states.length);

  if (captureStatus === "recording") return { status: "transcribing", label: "Listening", progress, ready: false };
  if (captureStatus === "stopping" || captureStatus === "transcribing") {
    return { status: "transcribing", label: "Transcribing", progress, ready: false };
  }
  if (isTranslating) return { status: "translating", label: "Translating", progress, ready: false };
  if (states.some((state) => state.status === "error")) return { status: "error", label: "Needs attention", progress: 0, ready: false };
  if (states.some((state) => state.status === "loading")) return { status: "loading", label: "Preparing", progress, ready: false };
  if (states.every((state) => state.status === "ready")) return { status: "ready", label: "Ready · Local", progress: 100, ready: true };
  return { status: "idle", label: "Local", progress: 0, ready: false };
}

function MicrophoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></svg>;
}

function StopIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>;
}

function SpinnerIcon() {
  return <svg className="spinner-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-3.1-6.3" /></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
}

function SwapIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>;
}

function KeyboardIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h.01M15 13h2M7 16h10" /></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
}

function SparkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4zM18.5 15l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" /></svg>;
}

function NextIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h9a4 4 0 0 1 4 4v6M14 14l4 3 4-3" /></svg>;
}

function TableIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 12h16M9 7h6M9 17h6" /></svg>;
}

function ClearIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
}

function readSavedModelId(): TranslationModelId {
  const saved = window.localStorage.getItem(SAVED_MODEL_KEY);
  return isTranslationModelId(saved) ? saved : DEFAULT_TRANSLATION_MODEL_ID;
}

function canWarmModel(state: ModelState): boolean {
  return !["loading", "ready", "transcribing", "translating"].includes(state.status);
}

function canRecordSpeech(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function formatCaptureError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was blocked. Allow microphone access or use text mode.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Use text mode instead.";
  }
  return error instanceof Error ? error.message : "Could not start audio recording.";
}

function getLanguage(code: string): LanguageOption {
  return LANGUAGE_OPTIONS.find((option) => option.code === code) ?? LANGUAGE_OPTIONS[0];
}

function getOppositeSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

function appendSpeechText(base: string, addition: string): string {
  const cleanBase = base.trim();
  const cleanAddition = addition.trim();
  if (!cleanBase) return cleanAddition;
  if (!cleanAddition) return cleanBase;
  return `${cleanBase} ${cleanAddition}`.replace(/\s+/g, " ");
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createTurnId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default App;
