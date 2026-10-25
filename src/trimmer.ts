/**
 * Client-side audio and video trimmer and format export utilities.
 */

export type ExportFormat = 'mp4' | 'webm' | 'wav';

export function encodeWavFromAudioBuffer(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const numFrames = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function sliceWaveform(
  waveform: number[],
  startRatio: number,
  endRatio: number,
  targetBars = 28
): number[] {
  const src = waveform?.length ? waveform : Array(targetBars).fill(0.35);
  const startIdx = Math.max(0, Math.floor(startRatio * src.length));
  const endIdx = Math.max(startIdx + 1, Math.ceil(endRatio * src.length));
  const sliced = src.slice(startIdx, endIdx);

  const result: number[] = [];
  for (let i = 0; i < targetBars; i++) {
    const pos = (i / (targetBars - 1)) * (sliced.length - 1);
    const low = Math.floor(pos);
    const high = Math.min(sliced.length - 1, Math.ceil(pos));
    const frac = pos - low;
    const val = sliced[low] * (1 - frac) + sliced[high] * frac;
    result.push(Math.max(0.16, Math.min(1, val)));
  }
  return result;
}

export async function trimAudioBlob(
  blob: Blob,
  startRatio: number,
  endRatio: number,
  fallbackDurationMs: number
): Promise<{ blob: Blob; durationMs: number }> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);

    const totalSamples = decoded.length;
    const startSample = Math.max(0, Math.floor(startRatio * totalSamples));
    const endSample = Math.min(
      totalSamples,
      Math.max(startSample + 1, Math.floor(endRatio * totalSamples))
    );
    const trimmedLength = endSample - startSample;

    const trimmedBuffer = audioCtx.createBuffer(
      decoded.numberOfChannels,
      trimmedLength,
      decoded.sampleRate
    );

    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channelData = decoded.getChannelData(c).subarray(startSample, endSample);
      trimmedBuffer.copyToChannel(channelData, c, 0);
    }

    const wavBlob = encodeWavFromAudioBuffer(trimmedBuffer);
    const durationMs = Math.max(300, Math.round((trimmedLength / decoded.sampleRate) * 1000));
    await audioCtx.close().catch(() => {});
    return { blob: wavBlob, durationMs };
  } catch {
    const newDuration = Math.max(
      300,
      Math.round((endRatio - startRatio) * fallbackDurationMs)
    );
    return { blob, durationMs: newDuration };
  }
}

export async function trimVideoBlob(
  blob: Blob,
  startRatio: number,
  endRatio: number,
  fallbackDurationMs: number
): Promise<{ blob: Blob; durationMs: number; thumbnailDataUrl?: string }> {
  const newDurationMs = Math.max(
    400,
    Math.round((endRatio - startRatio) * fallbackDurationMs)
  );

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.src = '';
    };

    const failSafeTimeout = window.setTimeout(() => {
      cleanup();
      resolve({ blob, durationMs: newDurationMs });
    }, 10000);

    video.onloadedmetadata = async () => {
      const totalSec =
        video.duration && isFinite(video.duration)
          ? video.duration
          : fallbackDurationMs / 1000;
      const startSec = Math.max(0, startRatio * totalSec);
      const endSec = Math.max(startSec + 0.25, endRatio * totalSec);
      const clipDurationSec = endSec - startSec;

      video.currentTime = startSec;

      video.onseeked = () => {
        video.onseeked = null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const ctx = canvas.getContext('2d');

          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.75);

          const playbackRate = clipDurationSec > 3 ? Math.min(3, clipDurationSec / 2) : 1;
          video.playbackRate = playbackRate;

          const canvasStream = canvas.captureStream(30);
          const preferredMime = [
            'video/mp4;codecs=avc1',
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
          ].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));

          const recorder = preferredMime
            ? new MediaRecorder(canvasStream, { mimeType: preferredMime })
            : new MediaRecorder(canvasStream);

          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };

          let rafId = 0;
          const renderFrame = () => {
            if (ctx && !video.paused && !video.ended) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            }
            if (video.currentTime >= endSec || video.ended) {
              video.pause();
              if (recorder.state !== 'inactive') recorder.stop();
              return;
            }
            rafId = requestAnimationFrame(renderFrame);
          };

          recorder.onstop = () => {
            cancelAnimationFrame(rafId);
            window.clearTimeout(failSafeTimeout);
            cleanup();
            const trimmedBlob =
              chunks.length > 0
                ? new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
                : blob;
            resolve({
              blob: trimmedBlob,
              durationMs: Math.round(clipDurationSec * 1000),
              thumbnailDataUrl,
            });
          };

          recorder.start(100);
          video
            .play()
            .then(() => {
              rafId = requestAnimationFrame(renderFrame);
            })
            .catch(() => {
              if (recorder.state !== 'inactive') recorder.stop();
            });
        } catch {
          window.clearTimeout(failSafeTimeout);
          cleanup();
          resolve({ blob, durationMs: newDurationMs });
        }
      };
    };

    video.onerror = () => {
      window.clearTimeout(failSafeTimeout);
      cleanup();
      resolve({ blob, durationMs: newDurationMs });
    };
  });
}

export async function exportRecordingBlob(
  blob: Blob,
  mode: 'screen' | 'audio',
  format: ExportFormat
): Promise<{ blob: Blob; extension: ExportFormat; mimeType: string }> {
  if (format === 'wav') {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      const wavBlob = encodeWavFromAudioBuffer(decoded);
      await audioCtx.close().catch(() => {});
      return { blob: wavBlob, extension: 'wav', mimeType: 'audio/wav' };
    } catch {
      return {
        blob: new Blob([blob], { type: 'audio/wav' }),
        extension: 'wav',
        mimeType: 'audio/wav',
      };
    }
  }

  if (format === 'mp4') {
    const mimeType = mode === 'screen' ? 'video/mp4' : 'audio/mp4';
    const mp4Blob = new Blob([blob], { type: mimeType });
    return { blob: mp4Blob, extension: 'mp4', mimeType };
  }

  const mimeType = mode === 'screen' ? 'video/webm' : 'audio/webm';
  const webmBlob = new Blob([blob], { type: mimeType });
  return { blob: webmBlob, extension: 'webm', mimeType };
}
