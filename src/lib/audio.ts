export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext({ sampleRate: 16_000 });

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
      audioBuffer.getChannelData(index),
    );

    if (!channels.length) {
      throw new Error("Decoded media contains no audio channels.");
    }

    const mono = new Float32Array(audioBuffer.length);
    for (let index = 0; index < audioBuffer.length; index += 1) {
      let sum = 0;
      for (const channel of channels) {
        sum += channel[index] ?? 0;
      }
      mono[index] = sum / channels.length;
    }

    return mono;
  } finally {
    await audioContext.close();
  }
}
