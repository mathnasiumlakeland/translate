# Translate

A browser-only two-person translator for `translate.mathnasium.pro`.

## Run

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

## Model

- Translation: HY-MT2 1.8B GGUF, running locally through Wllama/llama.cpp with WebGPU acceleration.
- Model choices:
  - Compact: Q3_K_S, about 831 MB. Intended for recent iPhones and other memory-constrained devices.
  - Everyday: Q4_K_M, about 1.06 GB. Recommended for recent iPads and most computers.
  - Quality: Q5_K_M, about 1.21 GB. Intended for powerful iPads and computers.
- Speech input: `onnx-community/whisper-small` with q4 encoder and decoder weights through Transformers.js and WebGPU, about 300 MB.
- Privacy: conversation text and microphone audio stay in the browser. Model files are downloaded from Hugging Face once and cached in browser storage.

The official Tencent 1.25-bit and 2-bit GGUF releases depend on Tencent's newer STQ llama.cpp kernels. The app uses standard browser-compatible GGUF quantizations of the same HY-MT2 1.8B base for its Compact and Quality tiers; Everyday uses Tencent's official Q4_K_M file.

## Deploy

This is a fully static, browser-only site. The GitHub Pages workflow mirrors the Transcribe app: Bun installs locked dependencies, Vite builds `dist`, and Pages deploys that artifact. Pushes to `main` deploy automatically; the workflow can also be run manually.

The production hostname is `translate.mathnasium.pro`, declared in `public/CNAME`. After creating the empty `mathnasiumlakeland/translate` repository:

1. Add it as `origin` and push the local `main` branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Add a DNS CNAME record for `translate.mathnasium.pro` pointing to `mathnasiumlakeland.github.io`.
4. Confirm the custom domain in Pages settings, then enable **Enforce HTTPS** after GitHub provisions the certificate.

The workflow gets the correct deployment base path from GitHub Pages, so it works both at the custom root domain and at the repository Pages URL during setup.
