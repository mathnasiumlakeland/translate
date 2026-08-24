# AGENTS.md

## Project snapshot

This repo is a browser-only translation app built with React, Vite, Bun, and TypeScript. It runs the HY-MT2 1.8B GGUF translation model locally through Wllama/llama.cpp with WebGPU. There is no backend, no server-side translation path, and no packaged desktop wrapper.

## Stack and workflow

- Package manager: `bun` (`packageManager: bun@1.2.13`)
- App stack: React 19, TypeScript, Vite 6
- Primary validation command: `bun run build`
- Local dev: `bun run dev`
- Preview build: `bun run preview`

`vite.config.ts` supports a deploy base path via `BASE_PATH`. Keep that flow intact for GitHub Pages.

## Important files

- `src/App.tsx`: Main translator UI, turn-taking state, speech recognition orchestration, and model calls.
- `src/lib/model.ts`: Selectable HY-MT2 GGUF model profiles and download metadata.
- `src/lib/translator.ts`: Wllama model loading, caching, and streaming translation path.
- `src/lib/speech.worker.ts`: Local Whisper WebGPU loading and speech transcription.
- `src/lib/translation-types.ts`: Shared model, turn, and worker state types.

## Architecture notes

- Language belongs to the panel. The active panel defines the source side; the opposite panel is the target side.
- After a turn completes, the same speaker remains active unless auto-switch is enabled.
- Translation is intentionally worker-based so model loading and generation do not freeze the UI.
- Browser speech recognition is a convenience input path. It is not the same privacy guarantee as the local HY-MT translation model.

## Validation expectations

Run `bun run build` after code changes. For UI changes, also run the local app in a Chromium browser and verify desktop and narrow/mobile layouts.
