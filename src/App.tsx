/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor,
  Volume2,
  Square,
  Play,
  Pause,
  Download,
  Trash2,
  FolderOpen,
  X,
  Maximize2,
  Layers,
  Check,
  Scissors,
  Cloud,
  CloudUpload,
  ExternalLink,
  Loader2,
  LogOut,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  StoredRecording,
  getAllRecordings,
  saveRecording,
  deleteRecordingFromDB,
} from './db';
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  uploadRecordingToDrive,
  deleteRecordingFromDrive,
} from './auth';
import {
  trimAudioBlob,
  trimVideoBlob,
  sliceWaveform,
  exportRecordingBlob,
  ExportFormat,
} from './trimmer';

type RecordMode = 'screen' | 'audio';

interface RecordingItem extends StoredRecording {
  url: string;
}

function GoogleLogoSvg({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      className={className}
      style={{ display: 'block' }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

function GoogleDriveSvg({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}

export default function App() {
  const [mode, setMode] = useState<RecordMode>('screen');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'screen' | 'audio'>('all');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playProgress, setPlayProgress] = useState<Record<string, number>>({});
  const [expandedVideo, setExpandedVideo] = useState<RecordingItem | null>(null);
  const [justSavedPulse, setJustSavedPulse] = useState(false);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);

  // Export Format Selection State per recording (default MP4 for video, WAV for audio)
  const [exportMenuOpenId, setExportMenuOpenId] = useState<string | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<Record<string, ExportFormat>>({});
  const [exportingIds, setExportingIds] = useState<Record<string, boolean>>({});

  // Minimalist Video/Audio Trimming State
  const [trimmingId, setTrimmingId] = useState<string | null>(null);
  const [trimRange, setTrimRange] = useState<{ start: number; end: number }>({
    start: 0.1,
    end: 0.9,
  });
  const [isApplyingTrim, setIsApplyingTrim] = useState(false);
  const draggingHandleRef = useRef<'start' | 'end' | null>(null);
  const trimTrackRef = useRef<HTMLDivElement | null>(null);

  // Google Drive Cloud Auth & Upload State
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingUploadItem, setPendingUploadItem] = useState<RecordingItem | null>(null);
  const [uploadingIds, setUploadingIds] = useState<Record<string, boolean>>({});
  const [confirmDeleteDriveItem, setConfirmDeleteDriveItem] = useState<RecordingItem | null>(
    null
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const auxCleanupRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);
  const waveformSamplesRef = useRef<number[]>([]);
  const thumbnailRef = useRef<string | undefined>(undefined);
  const animFrameRef = useRef<number | null>(null);

  // Audio/Video playback refs
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const modalVideoRef = useRef<HTMLVideoElement | null>(null);

  // Update browser tab favicon dynamically when recording is active
  useEffect(() => {
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (link) {
      link.href = isRecording ? '/favicon-recording.svg' : '/favicon.svg';
    }
  }, [isRecording]);

  // Initialize Auth & Load saved recordings from IndexedDB
  useEffect(() => {
    const unsub = initAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );

    let mounted = true;
    getAllRecordings().then((stored) => {
      if (!mounted) return;
      const items: RecordingItem[] = stored.map((rec) => ({
        ...rec,
        url: URL.createObjectURL(rec.blob),
      }));
      setRecordings(items);
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const stopActivePlayback = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    Object.values(videoRefs.current).forEach((v) => {
      if (v && !v.paused) v.pause();
    });
    setPlayingId(null);
  }, []);

  // Global pointer listeners for smooth dual-handle trim dragging
  useEffect(() => {
    if (!trimmingId) return;

    const handlePointerMove = (e: PointerEvent) => {
      const handle = draggingHandleRef.current;
      const track = trimTrackRef.current;
      if (!handle || !track) return;

      const rect = track.getBoundingClientRect();
      const rawRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

      setTrimRange((prev) => {
        if (handle === 'start') {
          const nextStart = Math.min(rawRatio, prev.end - 0.08);
          const vid = videoRefs.current[trimmingId];
          if (vid && vid.duration && isFinite(vid.duration)) {
            vid.currentTime = nextStart * vid.duration;
          }
          return { ...prev, start: Math.max(0, nextStart) };
        } else {
          const nextEnd = Math.max(rawRatio, prev.start + 0.08);
          const vid = videoRefs.current[trimmingId];
          if (vid && vid.duration && isFinite(vid.duration)) {
            vid.currentTime = nextEnd * vid.duration;
          }
          return { ...prev, end: Math.min(1, nextEnd) };
        }
      });
    };

    const handlePointerUp = () => {
      draggingHandleRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [trimmingId]);

  const createSyntheticFallbackStream = (targetMode: RecordMode) => {
    const cleanups: (() => void)[] = [];
    const audioCtx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.02, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(dest);
    osc.start();

    cleanups.push(() => {
      try {
        osc.stop();
        audioCtx.close();
      } catch {
        // ignore
      }
    });

    if (targetMode === 'audio') {
      return {
        stream: dest.stream,
        cleanup: () => cleanups.forEach((fn) => fn()),
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const interval = window.setInterval(() => {
      if (!ctx) return;
      frame++;
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.roundRect(140, 90, 1000, 540, 24);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(144, 94, 992, 532, 20);
      ctx.fill();

      const pulseRadius = 70 + Math.sin(frame * 0.08) * 14;
      ctx.fillStyle = 'rgba(86, 140, 199, 0.18)';
      ctx.beginPath();
      ctx.arc(640, 360, pulseRadius + 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#568cc7';
      ctx.beginPath();
      ctx.arc(640, 360, 68, 0, Math.PI * 2);
      ctx.fill();
    }, 33);

    cleanups.push(() => window.clearInterval(interval));

    const canvasStream = canvas.captureStream(30);
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    return {
      stream: combined,
      cleanup: () => cleanups.forEach((fn) => fn()),
    };
  };

  const captureVideoThumbnail = (stream: MediaStream): Promise<string | undefined> => {
    return new Promise((resolve) => {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        resolve(undefined);
        return;
      }
      const tempVideo = document.createElement('video');
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.srcObject = stream;
      const timeout = window.setTimeout(() => {
        tempVideo.srcObject = null;
        resolve(undefined);
      }, 1200);

      tempVideo.onloadeddata = () => {
        window.setTimeout(() => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 480;
            canvas.height = 270;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
              window.clearTimeout(timeout);
              tempVideo.srcObject = null;
              resolve(dataUrl);
              return;
            }
          } catch {
            // ignore
          }
          window.clearTimeout(timeout);
          tempVideo.srcObject = null;
          resolve(undefined);
        }, 200);
      };
      tempVideo.play().catch(() => {
        window.clearTimeout(timeout);
        resolve(undefined);
      });
    });
  };

  const stopRecording = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setAudioLevel(0);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = async () => {
    stopActivePlayback();
    chunksRef.current = [];
    waveformSamplesRef.current = [];
    thumbnailRef.current = undefined;
    pausedDurationRef.current = 0;
    pauseStartRef.current = null;

    let activeStream: MediaStream | null = null;
    const cleanups: (() => void)[] = [];
    const currentMode = mode;

    if (currentMode === 'screen') {
      const callStart = performance.now();
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: true,
        });

        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          cleanups.push(() => micStream.getTracks().forEach((t) => t.stop()));
          const audioCtx = new AudioContext();
          const dest = audioCtx.createMediaStreamDestination();
          if (displayStream.getAudioTracks().length > 0) {
            const sysSource = audioCtx.createMediaStreamSource(displayStream);
            sysSource.connect(dest);
          }
          const micSource = audioCtx.createMediaStreamSource(micStream);
          micSource.connect(dest);
          cleanups.push(() => audioCtx.close().catch(() => {}));

          activeStream = new MediaStream([
            ...displayStream.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ]);
          cleanups.push(() => displayStream.getTracks().forEach((t) => t.stop()));
        } catch {
          activeStream = displayStream;
        }
      } catch (err) {
        const elapsed = performance.now() - callStart;
        const domErr = err as DOMException;
        if (elapsed > 250 && domErr?.name === 'NotAllowedError') {
          return;
        }
        const fallback = createSyntheticFallbackStream('screen');
        activeStream = fallback.stream;
        cleanups.push(fallback.cleanup);
      }
    } else {
      const callStart = performance.now();
      try {
        activeStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch (err) {
        const elapsed = performance.now() - callStart;
        const domErr = err as DOMException;
        if (elapsed > 250 && domErr?.name === 'NotAllowedError') {
          return;
        }
        const fallback = createSyntheticFallbackStream('audio');
        activeStream = fallback.stream;
        cleanups.push(fallback.cleanup);
      }
    }

    if (!activeStream) return;
    streamRef.current = activeStream;
    auxCleanupRef.current = () => cleanups.forEach((fn) => fn());

    if (currentMode === 'screen') {
      captureVideoThumbnail(activeStream).then((thumb) => {
        thumbnailRef.current = thumb;
      });
    }

    const videoTrack = activeStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        stopRecording();
      };
    }

    try {
      if (activeStream.getAudioTracks().length > 0) {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(activeStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        cleanups.push(() => audioCtx.close().catch(() => {}));

        let tick = 0;
        const updateLevel = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length / 255;
          const level = Math.min(1, avg * 2.4);
          setAudioLevel(level);
          tick++;
          if (tick % 4 === 0 && waveformSamplesRef.current.length < 120) {
            waveformSamplesRef.current.push(Math.max(0.15, Math.min(1, level * 1.4)));
          }
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        animFrameRef.current = requestAnimationFrame(updateLevel);
      } else {
        let phase = 0;
        const updatePulse = () => {
          phase += 0.06;
          const syntheticLevel = 0.2 + Math.abs(Math.sin(phase)) * 0.35;
          setAudioLevel(syntheticLevel);
          if (waveformSamplesRef.current.length < 120) {
            waveformSamplesRef.current.push(syntheticLevel);
          }
          animFrameRef.current = requestAnimationFrame(updatePulse);
        };
        animFrameRef.current = requestAnimationFrame(updatePulse);
      }
    } catch {
      // ignore
    }

    // Prefer native MP4 if supported, otherwise WebM
    const preferredMimeTypes =
      currentMode === 'screen'
        ? [
            'video/mp4;codecs=avc1,mp4a.40.2',
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
          ]
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const supportedMime =
      preferredMimeTypes.find(
        (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
      ) || '';

    const recorder = supportedMime
      ? new MediaRecorder(activeStream, { mimeType: supportedMime })
      : new MediaRecorder(activeStream);

    mediaRecorderRef.current = recorder;
    startTimeRef.current = Date.now();

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = async () => {
      const totalElapsed = Math.max(
        500,
        Date.now() - startTimeRef.current - pausedDurationRef.current
      );
      const mimeType =
        recorder.mimeType || (currentMode === 'screen' ? 'video/webm' : 'audio/webm');
      const blob = new Blob(chunksRef.current, { type: mimeType });

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (auxCleanupRef.current) {
        auxCleanupRef.current();
        auxCleanupRef.current = null;
      }

      setIsRecording(false);
      setIsPaused(false);
      setAudioLevel(0);

      const rawSamples = waveformSamplesRef.current;
      const barsCount = 28;
      const normalizedWaveform: number[] = [];
      for (let i = 0; i < barsCount; i++) {
        if (rawSamples.length === 0) {
          normalizedWaveform.push(0.25 + ((i * 7) % 10) * 0.06);
        } else {
          const idx = Math.floor((i / barsCount) * rawSamples.length);
          normalizedWaveform.push(Math.max(0.18, Math.min(1, rawSamples[idx] || 0.3)));
        }
      }

      const newRec: StoredRecording = {
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        blob,
        mode: currentMode,
        createdAt: Date.now(),
        durationMs: totalElapsed,
        waveform: normalizedWaveform,
        thumbnailDataUrl: thumbnailRef.current,
      };

      await saveRecording(newRec);
      const url = URL.createObjectURL(blob);
      setRecordings((prev) => [{ ...newRec, url }, ...prev]);

      setJustSavedPulse(true);
      setIsLibraryOpen(true);
      window.setTimeout(() => setJustSavedPulse(false), 1600);
    };

    recorder.start(200);
    setIsRecording(true);
    setIsPaused(false);
  };

  const togglePauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      pauseStartRef.current = Date.now();
      setIsPaused(true);
    } else if (recorder.state === 'paused') {
      recorder.resume();
      if (pauseStartRef.current) {
        pausedDurationRef.current += Date.now() - pauseStartRef.current;
        pauseStartRef.current = null;
      }
      setIsPaused(false);
    }
  };

  const handleMainButtonClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const togglePlayRecording = (item: RecordingItem) => {
    if (playingId === item.id) {
      stopActivePlayback();
      return;
    }

    stopActivePlayback();

    const isTrimmingThis = trimmingId === item.id;
    const startRatio = isTrimmingThis ? trimRange.start : 0;
    const endRatio = isTrimmingThis ? trimRange.end : 1;

    if (item.mode === 'screen') {
      const vid = videoRefs.current[item.id];
      if (vid) {
        const dur =
          vid.duration && isFinite(vid.duration) ? vid.duration : item.durationMs / 1000;
        vid.currentTime = startRatio * dur;
        vid.play().catch(() => {});
        setPlayingId(item.id);
      }
    } else {
      const audio = new Audio(item.url);
      audioPlayerRef.current = audio;
      setPlayingId(item.id);

      audio.onloadedmetadata = () => {
        const dur =
          audio.duration && isFinite(audio.duration)
            ? audio.duration
            : item.durationMs / 1000;
        if (dur > 0 && startRatio > 0) {
          audio.currentTime = startRatio * dur;
        }
      };

      audio.ontimeupdate = () => {
        const dur =
          audio.duration && isFinite(audio.duration)
            ? audio.duration
            : item.durationMs / 1000;
        if (dur > 0) {
          const ratio = Math.min(1, audio.currentTime / dur);
          setPlayProgress((prev) => ({
            ...prev,
            [item.id]: ratio,
          }));
          if (ratio >= endRatio) {
            audio.pause();
            setPlayingId(null);
            setPlayProgress((prev) => ({ ...prev, [item.id]: startRatio }));
          }
        }
      };

      audio.onended = () => {
        setPlayingId(null);
        setPlayProgress((prev) => ({ ...prev, [item.id]: startRatio }));
      };

      audio.play().catch(() => {
        setPlayingId(null);
      });
    }
  };

  const handleSeekRecording = (item: RecordingItem, e: React.MouseEvent<HTMLDivElement>) => {
    if (trimmingId === item.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlayProgress((prev) => ({ ...prev, [item.id]: ratio }));

    if (item.mode === 'screen') {
      const vid = videoRefs.current[item.id];
      if (vid && vid.duration && isFinite(vid.duration)) {
        vid.currentTime = ratio * vid.duration;
      }
    } else if (playingId === item.id && audioPlayerRef.current) {
      const audio = audioPlayerRef.current;
      const dur =
        audio.duration && isFinite(audio.duration)
          ? audio.duration
          : item.durationMs / 1000;
      if (dur > 0) {
        audio.currentTime = ratio * dur;
      }
    }
  };

  const handleOpenTrimmer = (item: RecordingItem) => {
    stopActivePlayback();
    setExportMenuOpenId(null);
    if (trimmingId === item.id) {
      setTrimmingId(null);
      return;
    }
    setTrimmingId(item.id);
    setTrimRange({ start: 0.1, end: 0.9 });
    setPlayProgress((prev) => ({ ...prev, [item.id]: 0.1 }));
  };

  const handleApplyTrim = async (item: RecordingItem) => {
    if (isApplyingTrim) return;
    stopActivePlayback();
    setIsApplyingTrim(true);

    try {
      const { start, end } = trimRange;
      const newWaveform = sliceWaveform(item.waveform, start, end);

      let newBlob = item.blob;
      let newDurationMs = item.durationMs;
      let newThumbnail = item.thumbnailDataUrl;

      if (item.mode === 'audio') {
        const res = await trimAudioBlob(item.blob, start, end, item.durationMs);
        newBlob = res.blob;
        newDurationMs = res.durationMs;
      } else {
        const res = await trimVideoBlob(item.blob, start, end, item.durationMs);
        newBlob = res.blob;
        newDurationMs = res.durationMs;
        if (res.thumbnailDataUrl) {
          newThumbnail = res.thumbnailDataUrl;
        }
      }

      const updatedStored: StoredRecording = {
        id: item.id,
        blob: newBlob,
        mode: item.mode,
        createdAt: item.createdAt,
        durationMs: newDurationMs,
        waveform: newWaveform,
        thumbnailDataUrl: newThumbnail,
      };

      await saveRecording(updatedStored);
      URL.revokeObjectURL(item.url);
      const newUrl = URL.createObjectURL(newBlob);

      setRecordings((prev) =>
        prev.map((r) => (r.id === item.id ? { ...updatedStored, url: newUrl } : r))
      );
      setPlayProgress((prev) => ({ ...prev, [item.id]: 0 }));
      setTrimmingId(null);
    } finally {
      setIsApplyingTrim(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
        setShowAuthModal(false);
        if (pendingUploadItem) {
          const itemToUpload = pendingUploadItem;
          setPendingUploadItem(null);
          await performDriveUpload(itemToUpload);
        }
      }
    } catch (err) {
      console.error('Google Sign-In failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const performDriveUpload = async (item: RecordingItem) => {
    setUploadingIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      const ext = item.blob.type.includes('wav')
        ? 'wav'
        : item.blob.type.includes('mp4')
          ? 'mp4'
          : 'webm';
      const fileName = `${item.mode}-recording-${item.createdAt}.${ext}`;
      const mimeType =
        item.blob.type || (item.mode === 'screen' ? 'video/webm' : 'audio/webm');

      const uploaded = await uploadRecordingToDrive(item.blob, fileName, mimeType);
      const updatedRec: StoredRecording = {
        id: item.id,
        blob: item.blob,
        mode: item.mode,
        createdAt: item.createdAt,
        durationMs: item.durationMs,
        waveform: item.waveform,
        thumbnailDataUrl: item.thumbnailDataUrl,
        driveFileId: uploaded.id,
        driveWebViewLink:
          uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
      };

      await saveRecording(updatedRec);
      setRecordings((prev) =>
        prev.map((r) => (r.id === item.id ? { ...updatedRec, url: r.url } : r))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
        setPendingUploadItem(item);
        setShowAuthModal(true);
      }
    } finally {
      setUploadingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleDriveButtonClick = async (item: RecordingItem) => {
    if (uploadingIds[item.id]) return;

    if (item.driveFileId && item.driveWebViewLink) {
      const token = await getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        setShowAuthModal(true);
        return;
      }
      setConfirmDeleteDriveItem(item);
      return;
    }

    const token = await getAccessToken();
    if (!token || needsAuth) {
      setPendingUploadItem(item);
      setShowAuthModal(true);
      return;
    }

    await performDriveUpload(item);
  };

  const handleConfirmDeleteFromDrive = async () => {
    const item = confirmDeleteDriveItem;
    if (!item || !item.driveFileId) return;
    setConfirmDeleteDriveItem(null);
    setUploadingIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      await deleteRecordingFromDrive(item.driveFileId);
      const updatedRec: StoredRecording = {
        id: item.id,
        blob: item.blob,
        mode: item.mode,
        createdAt: item.createdAt,
        durationMs: item.durationMs,
        waveform: item.waveform,
        thumbnailDataUrl: item.thumbnailDataUrl,
        driveFileId: undefined,
        driveWebViewLink: undefined,
      };
      await saveRecording(updatedRec);
      setRecordings((prev) =>
        prev.map((r) => (r.id === item.id ? { ...updatedRec, url: r.url } : r))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'AUTH_REQUIRED') {
        setNeedsAuth(true);
        setShowAuthModal(true);
      }
    } finally {
      setUploadingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const getFormatForItem = (item: RecordingItem): ExportFormat => {
    if (selectedFormats[item.id]) return selectedFormats[item.id];
    return item.mode === 'screen' ? 'mp4' : 'wav';
  };

  const handleExportDownload = async (item: RecordingItem, explicitFormat?: ExportFormat) => {
    const format = explicitFormat || getFormatForItem(item);
    setExportingIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      const exported = await exportRecordingBlob(item.blob, item.mode, format);
      const downloadUrl = URL.createObjectURL(exported.blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${item.mode}-${item.createdAt}.${exported.extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 4000);

      setDownloadedId(item.id);
      setExportMenuOpenId(null);
      window.setTimeout(() => {
        setDownloadedId((prev) => (prev === item.id ? null : prev));
      }, 1400);
    } finally {
      setExportingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleDelete = async (item: RecordingItem) => {
    if (playingId === item.id) {
      stopActivePlayback();
    }
    if (expandedVideo?.id === item.id) {
      setExpandedVideo(null);
    }
    if (trimmingId === item.id) {
      setTrimmingId(null);
    }
    await deleteRecordingFromDB(item.id);
    URL.revokeObjectURL(item.url);
    setRecordings((prev) => prev.filter((r) => r.id !== item.id));
  };

  const filteredRecordings = recordings.filter((r) =>
    libraryFilter === 'all' ? true : r.mode === libraryFilter
  );

  return (
    <div className="relative min-h-screen w-full bg-white flex flex-col items-center justify-center select-none overflow-hidden">
      {/* Active Recording Blinking Visual Indicator Beacon at Top */}
      {isRecording && (
        <div
          role="status"
          aria-live="polite"
          aria-label={isPaused ? 'Recording paused' : 'Recording in progress'}
          className="fixed top-7 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-white border border-red-200/90 shadow-[0_8px_24px_-4px_rgba(224,82,82,0.22)] transition-all duration-200"
        >
          <span className="relative flex w-3 h-3">
            {!isPaused && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full w-3 h-3 ${
                isPaused ? 'bg-amber-500' : 'bg-red-500'
              }`}
            />
          </span>
          {mode === 'screen' ? (
            <Monitor className="w-4 h-4 text-slate-600" />
          ) : (
            <Volume2 className="w-4 h-4 text-slate-600" />
          )}
        </div>
      )}

      {/* Main Minimalist Center Stage — Matches Reference Layout Without Any Text */}
      <main className="flex flex-col items-center justify-center gap-12 z-10">
        {/* Top Segmented Mode Switcher (Icon-Only: Screen on Left, Audio on Right) */}
        <div
          role="group"
          aria-label="Recording mode"
          className={`flex items-center p-1.5 rounded-full bg-[#eef1f6] shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] transition-opacity duration-200 ${
            isRecording ? 'pointer-events-none' : ''
          }`}
        >
          <button
            type="button"
            aria-label="Full screen recording"
            aria-pressed={mode === 'screen'}
            onClick={() => setMode('screen')}
            className={`relative w-24 h-11 rounded-full flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer ${
              mode === 'screen'
                ? 'bg-white text-[#4b5563] shadow-[0_2px_8px_rgba(15,23,42,0.08)]'
                : 'text-[#64748b] hover:text-[#334155]'
            }`}
          >
            <Monitor className="w-5 h-5 stroke-[2]" />
            {isRecording && mode === 'screen' && (
              <span className="relative flex w-2.5 h-2.5">
                {!isPaused && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80" />
                )}
                <span
                  className={`relative inline-flex rounded-full w-2.5 h-2.5 ${
                    isPaused ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                />
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label="Audio only recording"
            aria-pressed={mode === 'audio'}
            onClick={() => setMode('audio')}
            className={`relative w-24 h-11 rounded-full flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer ${
              mode === 'audio'
                ? 'bg-white text-[#4b5563] shadow-[0_2px_8px_rgba(15,23,42,0.08)]'
                : 'text-[#64748b] hover:text-[#334155]'
            }`}
          >
            <Volume2 className="w-5 h-5 stroke-[2]" />
            {isRecording && mode === 'audio' && (
              <span className="relative flex w-2.5 h-2.5">
                {!isPaused && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80" />
                )}
                <span
                  className={`relative inline-flex rounded-full w-2.5 h-2.5 ${
                    isPaused ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                />
              </span>
            )}
          </button>
        </div>

        {/* Central Circular Record Button + Blinking/Reactive Halo Rings + Pause Satellite */}
        <div className="relative flex items-center justify-center">
          {/* Outer blinking & audio-reactive rings when recording */}
          {isRecording && (
            <>
              {!isPaused && (
                <div
                  aria-hidden="true"
                  className="absolute w-52 h-52 rounded-full border-2 border-[#e05252]/40 animate-ping pointer-events-none"
                />
              )}
              <div
                aria-hidden="true"
                style={{
                  transform: `scale(${1.12 + (isPaused ? 0 : audioLevel * 0.35)})`,
                  opacity: isPaused ? 0.18 : 0.24 + audioLevel * 0.25,
                }}
                className={`absolute w-48 h-48 rounded-full transition-transform duration-75 pointer-events-none ${
                  isPaused ? 'bg-amber-500' : 'bg-[#e05252]'
                }`}
              />
              <div
                aria-hidden="true"
                style={{
                  transform: `scale(${1.06 + (isPaused ? 0 : audioLevel * 0.18)})`,
                  opacity: 0.4,
                }}
                className={`absolute w-48 h-48 rounded-full border-2 transition-transform duration-75 pointer-events-none ${
                  isPaused ? 'border-amber-500' : 'border-[#e05252]'
                }`}
              />
            </>
          )}

          {/* Primary Circle Button: Soft Blue when Idle, Vivid Blinking/Glowing Red when Recording */}
          <button
            type="button"
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            onClick={handleMainButtonClick}
            className={`relative w-48 h-48 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-4 active:scale-95 ${
              isRecording
                ? isPaused
                  ? 'bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-500/30 shadow-[0_20px_38px_-6px_rgba(245,158,11,0.48)]'
                  : 'bg-[#e05252] hover:bg-[#d04343] focus-visible:ring-red-500/30 shadow-[0_20px_38px_-6px_rgba(224,82,82,0.52)]'
                : 'bg-[#568cc7] hover:bg-[#4b81bc] focus-visible:ring-[#568cc7]/30 shadow-[0_20px_38px_-6px_rgba(86,140,199,0.52)]'
            }`}
          >
            {isRecording ? (
              <div className="flex flex-col items-center justify-center gap-2">
                <Square className="w-12 h-12 text-white fill-white transition-transform duration-200" />
              </div>
            ) : (
              <svg
                viewBox="0 0 64 64"
                fill="none"
                aria-hidden="true"
                className="w-16 h-16 text-white transition-transform duration-200"
              >
                <rect x="23" y="10" width="18" height="28" rx="9" fill="currentColor" />
                <path
                  d="M15 29C15 38.3888 22.6112 46 32 46C41.3888 46 49 38.3888 49 29"
                  stroke="currentColor"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                />
                <path
                  d="M32 46V55"
                  stroke="currentColor"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>

          {/* Satellite Pause / Resume Button during active recording */}
          {isRecording && (
            <button
              type="button"
              aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
              onClick={togglePauseRecording}
              className="absolute -right-20 w-13 h-13 rounded-full bg-[#eef1f6] hover:bg-[#e2e8f0] text-[#4b5563] shadow-[0_6px_16px_rgba(15,23,42,0.08)] flex items-center justify-center transition-all duration-150 cursor-pointer active:scale-95"
            >
              {isPaused ? (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              ) : (
                <Pause className="w-5 h-5 fill-current" />
              )}
            </button>
          )}
        </div>
      </main>

      {/* Small Floating Button to Open Recordings Library */}
      <div className="fixed bottom-7 right-7 z-30 flex items-center gap-3">
        <button
          type="button"
          aria-label="Open recordings library"
          aria-expanded={isLibraryOpen}
          onClick={() => setIsLibraryOpen((prev) => !prev)}
          className={`relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#568cc7]/30 active:scale-95 ${
            isLibraryOpen
              ? 'bg-[#568cc7] text-white shadow-[0_12px_28px_-4px_rgba(86,140,199,0.5)]'
              : 'bg-[#eef1f6] hover:bg-[#e3e8f0] text-[#4b5563] shadow-[0_6px_20px_rgba(15,23,42,0.08)]'
          } ${justSavedPulse ? 'scale-110 ring-4 ring-[#568cc7]/40' : ''}`}
        >
          {isLibraryOpen ? (
            <X className="w-6 h-6 stroke-[2.2]" />
          ) : (
            <FolderOpen className="w-6 h-6 stroke-[2]" />
          )}

          {/* Text-free visual indicator dots showing recordings exist */}
          {!isLibraryOpen && recordings.length > 0 && (
            <div
              aria-hidden="true"
              className="absolute -top-1 -right-1 flex items-center gap-0.5 bg-white px-1.5 py-1 rounded-full shadow-sm border border-slate-200/80"
            >
              {recordings.slice(0, 3).map((r) => (
                <span key={r.id} className="w-2 h-2 rounded-full bg-[#568cc7]" />
              ))}
            </div>
          )}
        </button>
      </div>

      {/* Clean Minimalist Recordings Library Drawer / Popover */}
      {isLibraryOpen && (
        <aside
          aria-label="Recordings library"
          className="fixed bottom-24 right-7 z-30 w-[calc(100vw-3.5rem)] max-w-sm bg-white rounded-3xl border border-slate-200/90 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.16)] p-4 flex flex-col gap-3 max-h-[76vh] transition-all duration-200"
        >
          {/* Library Filter & Cloud Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-1 bg-[#eef1f6] p-1 rounded-full">
              <button
                type="button"
                aria-label="All recordings"
                onClick={() => setLibraryFilter('all')}
                className={`w-9 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  libraryFilter === 'all'
                    ? 'bg-white text-[#568cc7] shadow-xs'
                    : 'text-[#64748b] hover:text-[#334155]'
                }`}
              >
                <Layers className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Screen recordings"
                onClick={() => setLibraryFilter('screen')}
                className={`w-9 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  libraryFilter === 'screen'
                    ? 'bg-white text-[#568cc7] shadow-xs'
                    : 'text-[#64748b] hover:text-[#334155]'
                }`}
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Audio recordings"
                onClick={() => setLibraryFilter('audio')}
                className={`w-9 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  libraryFilter === 'audio'
                    ? 'bg-white text-[#568cc7] shadow-xs'
                    : 'text-[#64748b] hover:text-[#334155]'
                }`}
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Unobtrusive Google Drive Connection Status / Trigger */}
              {!needsAuth && user ? (
                <button
                  type="button"
                  aria-label="Disconnect Google Drive"
                  onClick={() => logout()}
                  className="h-8 px-2.5 rounded-full bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200/80 flex items-center gap-1.5 text-emerald-700 transition-colors cursor-pointer"
                >
                  <GoogleDriveSvg className="w-3.5 h-3.5" />
                  <Check className="w-3 h-3" />
                  <LogOut className="w-3 h-3 text-slate-400 hover:text-slate-600 ml-0.5" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Connect Google Drive"
                  onClick={() => setShowAuthModal(true)}
                  className="w-8 h-8 rounded-full bg-[#eef1f6] hover:bg-[#e2e8f0] flex items-center justify-center transition-colors cursor-pointer"
                >
                  <GoogleDriveSvg className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                aria-label="Close library"
                onClick={() => setIsLibraryOpen(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Recordings List */}
          <div className="overflow-y-auto flex flex-col gap-3 pr-0.5">
            {filteredRecordings.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-4 text-slate-300">
                <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
                  {libraryFilter === 'audio' ? (
                    <Volume2 className="w-7 h-7 stroke-[1.6]" />
                  ) : (
                    <Monitor className="w-7 h-7 stroke-[1.6]" />
                  )}
                </div>
              </div>
            ) : (
              filteredRecordings.map((item) => {
                const isPlaying = playingId === item.id;
                const progress = playProgress[item.id] || 0;
                const isDownloaded = downloadedId === item.id;
                const isTrimming = trimmingId === item.id;
                const isUploading = Boolean(uploadingIds[item.id]);
                const isExporting = Boolean(exportingIds[item.id]);
                const isSavedInDrive = Boolean(item.driveFileId);
                const isExportMenuOpen = exportMenuOpenId === item.id;
                const currentFormat = getFormatForItem(item);
                const formatOptions: ExportFormat[] =
                  item.mode === 'screen' ? ['mp4', 'webm', 'wav'] : ['wav', 'mp4', 'webm'];

                return (
                  <div
                    key={item.id}
                    className={`group rounded-2xl bg-[#f8fafc] border p-3 flex flex-col gap-2.5 transition-colors ${
                      isTrimming
                        ? 'border-[#568cc7] bg-[#f4f8fc]'
                        : 'border-slate-200/70 hover:border-slate-300/90'
                    }`}
                  >
                    {/* Visual Media Preview: Video for Screen Mode, Waveform for Audio Mode */}
                    {item.mode === 'screen' ? (
                      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-900">
                        <video
                          ref={(el) => {
                            videoRefs.current[item.id] = el;
                          }}
                          src={item.url}
                          poster={item.thumbnailDataUrl}
                          playsInline
                          onTimeUpdate={(e) => {
                            const vid = e.currentTarget;
                            const dur =
                              vid.duration && isFinite(vid.duration)
                                ? vid.duration
                                : item.durationMs / 1000;
                            if (dur > 0) {
                              const ratio = Math.min(1, vid.currentTime / dur);
                              setPlayProgress((prev) => ({
                                ...prev,
                                [item.id]: ratio,
                              }));
                              if (isTrimming && ratio >= trimRange.end) {
                                vid.pause();
                                setPlayingId(null);
                                vid.currentTime = trimRange.start * dur;
                              }
                            }
                          }}
                          onEnded={() => {
                            setPlayingId(null);
                            setPlayProgress((prev) => ({
                              ...prev,
                              [item.id]: isTrimming ? trimRange.start : 0,
                            }));
                          }}
                          onClick={() => togglePlayRecording(item)}
                          className="w-full h-full object-cover cursor-pointer"
                        />

                        {/* Expand Fullscreen Icon Button */}
                        <button
                          type="button"
                          aria-label="Expand video"
                          onClick={() => {
                            stopActivePlayback();
                            setExpandedVideo(item);
                          }}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center backdrop-blur-xs transition-colors cursor-pointer"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      /* Audio Waveform Visualizer & Dual-Handle Trim / Scrubbing Track */
                      <div
                        ref={isTrimming ? trimTrackRef : undefined}
                        role="slider"
                        aria-label="Audio timeline"
                        aria-valuenow={Math.round(progress * 100)}
                        tabIndex={0}
                        onClick={(e) => handleSeekRecording(item, e)}
                        className="relative h-14 w-full rounded-xl bg-white border border-slate-200/60 px-3 flex items-center justify-between gap-1 cursor-pointer overflow-hidden"
                      >
                        {(item.waveform?.length ? item.waveform : Array(28).fill(0.35)).map(
                          (peak, idx, arr) => {
                            const barRatio = idx / arr.length;
                            const inTrimWindow =
                              !isTrimming ||
                              (barRatio >= trimRange.start && barRatio <= trimRange.end);
                            const active =
                              inTrimWindow &&
                              barRatio <= progress &&
                              (isPlaying || progress > 0);

                            return (
                              <span
                                key={idx}
                                style={{ height: `${Math.max(18, Math.round(peak * 100))}%` }}
                                className={`flex-1 rounded-full transition-colors duration-150 ${
                                  !inTrimWindow
                                    ? 'bg-slate-100'
                                    : active
                                      ? 'bg-[#568cc7]'
                                      : isTrimming
                                        ? 'bg-[#568cc7]/45'
                                        : 'bg-slate-200 group-hover:bg-slate-300'
                                }`}
                              />
                            );
                          }
                        )}

                        {isTrimming && (
                          <>
                            <div
                              style={{ width: `${trimRange.start * 100}%` }}
                              className="absolute inset-y-0 left-0 bg-slate-900/10 pointer-events-none"
                            />
                            <div
                              style={{ width: `${(1 - trimRange.end) * 100}%` }}
                              className="absolute inset-y-0 right-0 bg-slate-900/10 pointer-events-none"
                            />
                            <div
                              style={{
                                left: `${trimRange.start * 100}%`,
                                width: `${(trimRange.end - trimRange.start) * 100}%`,
                              }}
                              className="absolute inset-y-0 border-y-2 border-[#568cc7] pointer-events-none"
                            />
                            <div
                              role="slider"
                              aria-label="Trim start handle"
                              aria-valuenow={Math.round(trimRange.start * 100)}
                              tabIndex={0}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                draggingHandleRef.current = 'start';
                              }}
                              style={{ left: `calc(${trimRange.start * 100}% - 8px)` }}
                              className="absolute inset-y-1 w-4 rounded-md bg-[#568cc7] shadow-md flex items-center justify-center cursor-ew-resize z-10"
                            >
                              <span className="w-0.5 h-5 bg-white rounded-full" />
                            </div>
                            <div
                              role="slider"
                              aria-label="Trim end handle"
                              aria-valuenow={Math.round(trimRange.end * 100)}
                              tabIndex={0}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                draggingHandleRef.current = 'end';
                              }}
                              style={{ left: `calc(${trimRange.end * 100}% - 8px)` }}
                              className="absolute inset-y-1 w-4 rounded-md bg-[#568cc7] shadow-md flex items-center justify-center cursor-ew-resize z-10"
                            >
                              <span className="w-0.5 h-5 bg-white rounded-full" />
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Interactive Progress Scrub Bar or Video Dual-Handle Trim Bar */}
                    {item.mode === 'screen' && (
                      <div
                        ref={isTrimming ? trimTrackRef : undefined}
                        role="slider"
                        aria-label="Video timeline"
                        aria-valuenow={Math.round(progress * 100)}
                        tabIndex={0}
                        onClick={(e) => handleSeekRecording(item, e)}
                        className={`relative w-full rounded-full cursor-pointer transition-all ${
                          isTrimming ? 'h-6 bg-slate-200/80 my-0.5' : 'h-1.5 bg-slate-200 overflow-hidden'
                        }`}
                      >
                        {!isTrimming ? (
                          <div
                            style={{ width: `${Math.max(progress * 100, isPlaying ? 4 : 0)}%` }}
                            className="h-full bg-[#568cc7] rounded-full transition-all duration-100"
                          />
                        ) : (
                          <>
                            <div
                              style={{
                                left: `${trimRange.start * 100}%`,
                                width: `${(trimRange.end - trimRange.start) * 100}%`,
                              }}
                              className="absolute inset-y-0 bg-[#568cc7]/25 border-y-2 border-[#568cc7] rounded-xs pointer-events-none"
                            />
                            <div
                              role="slider"
                              aria-label="Trim start handle"
                              aria-valuenow={Math.round(trimRange.start * 100)}
                              tabIndex={0}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                draggingHandleRef.current = 'start';
                              }}
                              style={{ left: `calc(${trimRange.start * 100}% - 8px)` }}
                              className="absolute -inset-y-0.5 w-4 rounded-md bg-[#568cc7] shadow-sm flex items-center justify-center cursor-ew-resize z-10"
                            >
                              <span className="w-0.5 h-3.5 bg-white rounded-full" />
                            </div>
                            <div
                              role="slider"
                              aria-label="Trim end handle"
                              aria-valuenow={Math.round(trimRange.end * 100)}
                              tabIndex={0}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                draggingHandleRef.current = 'end';
                              }}
                              style={{ left: `calc(${trimRange.end * 100}% - 8px)` }}
                              className="absolute -inset-y-0.5 w-4 rounded-md bg-[#568cc7] shadow-sm flex items-center justify-center cursor-ew-resize z-10"
                            >
                              <span className="w-0.5 h-3.5 bg-white rounded-full" />
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Export Format Selector Strip (MP4 / WEBM / WAV) */}
                    {isExportMenuOpen && (
                      <div className="flex items-center justify-between bg-white border border-slate-200/80 rounded-xl p-1.5 gap-1">
                        <div className="flex items-center gap-1 flex-1">
                          {formatOptions.map((fmt) => {
                            const active = currentFormat === fmt;
                            return (
                              <button
                                key={fmt}
                                type="button"
                                aria-label={`Export as ${fmt.toUpperCase()}`}
                                onClick={() => {
                                  setSelectedFormats((prev) => ({ ...prev, [item.id]: fmt }));
                                  handleExportDownload(item, fmt);
                                }}
                                className={`flex-1 h-7 rounded-lg text-[11px] font-mono font-semibold tracking-wider uppercase flex items-center justify-center transition-colors cursor-pointer ${
                                  active
                                    ? 'bg-[#568cc7] text-white shadow-2xs'
                                    : 'text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {fmt.toUpperCase()}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action Controls Row */}
                    <div className="flex items-center justify-between pt-0.5">
                      <div className="flex items-center gap-1.5">
                        {/* Play / Pause Button */}
                        <button
                          type="button"
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                          onClick={() => togglePlayRecording(item)}
                          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                            isPlaying
                              ? 'bg-[#568cc7] text-white'
                              : 'bg-white hover:bg-slate-100 text-[#4b5563] border border-slate-200/80'
                          }`}
                        >
                          {isPlaying ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current ml-0.5" />
                          )}
                        </button>

                        {/* Minimalist Trim Toggle Button (Scissors) */}
                        <button
                          type="button"
                          aria-label="Trim recording"
                          aria-pressed={isTrimming}
                          onClick={() => handleOpenTrimmer(item)}
                          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                            isTrimming
                              ? 'bg-[#568cc7] text-white'
                              : 'bg-white hover:bg-slate-100 text-[#4b5563] border border-slate-200/80'
                          }`}
                        >
                          <Scissors className="w-4 h-4" />
                        </button>

                        {/* Confirm & Apply Trim Button */}
                        {isTrimming && (
                          <button
                            type="button"
                            aria-label="Apply trim"
                            disabled={isApplyingTrim}
                            onClick={() => handleApplyTrim(item)}
                            className="w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            {isApplyingTrim ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4 stroke-[2.5]" />
                            )}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Open in Google Drive Link */}
                        {isSavedInDrive && item.driveWebViewLink && (
                          <a
                            href={item.driveWebViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open in Google Drive"
                            className="w-9 h-9 rounded-full bg-white hover:bg-slate-100 text-[#568cc7] border border-slate-200/80 flex items-center justify-center transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}

                        {/* Save to Google Drive / Cloud Button */}
                        <button
                          type="button"
                          aria-label={
                            isSavedInDrive
                              ? 'Saved to Google Drive'
                              : 'Save to Google Drive'
                          }
                          disabled={isUploading}
                          onClick={() => handleDriveButtonClick(item)}
                          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                            isSavedInDrive
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                              : 'bg-white hover:bg-slate-100 text-[#4b5563] border border-slate-200/80'
                          }`}
                        >
                          {isUploading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[#568cc7]" />
                          ) : isSavedInDrive ? (
                            <Cloud className="w-4 h-4 fill-emerald-500/20" />
                          ) : (
                            <CloudUpload className="w-4 h-4" />
                          )}
                        </button>

                        {/* Export Format Selector + Download Button */}
                        <button
                          type="button"
                          aria-label="Choose export format and download"
                          disabled={isExporting}
                          onClick={() => {
                            setTrimmingId(null);
                            setExportMenuOpenId((prev) =>
                              prev === item.id ? null : item.id
                            );
                          }}
                          className={`h-9 px-2.5 rounded-full flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                            isDownloaded
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                              : isExportMenuOpen
                                ? 'bg-[#568cc7] text-white'
                                : 'bg-white hover:bg-slate-100 text-[#4b5563] border border-slate-200/80'
                          }`}
                        >
                          {isExporting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : isDownloaded ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                          <span className="text-[10px] font-mono font-semibold uppercase tracking-tight">
                            {currentFormat}
                          </span>
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          aria-label="Delete recording"
                          onClick={() => handleDelete(item)}
                          className="w-9 h-9 rounded-full bg-white hover:bg-red-50 text-slate-400 hover:text-red-500 border border-slate-200/80 hover:border-red-200 flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {/* Unobtrusive Google Sign-In Popover Modal for Google Drive Integration */}
      {showAuthModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Connect Google Drive"
          className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            setShowAuthModal(false);
            setPendingUploadItem(null);
          }}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl p-6 flex flex-col items-center gap-5 max-w-xs w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-2xl bg-[#eef1f6] flex items-center justify-center">
              <GoogleDriveSvg className="w-8 h-8" />
            </div>

            <button
              type="button"
              disabled={isLoggingIn}
              onClick={handleGoogleLogin}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-state" />
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <GoogleLogoSvg className="w-4 h-4" />
                </div>
                <span className="gsi-material-button-contents">Sign in with Google</span>
                <span style={{ display: 'none' }}>Sign in with Google</span>
              </div>
            </button>

            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setShowAuthModal(false);
                setPendingUploadItem(null);
              }}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Explicit Confirmation Modal Before Deleting a Recording from Google Drive */}
      {confirmDeleteDriveItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm remove from Google Drive"
          className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setConfirmDeleteDriveItem(null)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl p-6 flex flex-col items-center gap-5 max-w-xs w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center">
              <Trash2 className="w-7 h-7" />
            </div>

            <p className="text-sm text-slate-600 text-center">
              Delete this recording file from Google Drive?
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => setConfirmDeleteDriveItem(null)}
                className="w-11 h-11 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label="Confirm delete from Google Drive"
                onClick={handleConfirmDeleteFromDrive}
                className="w-11 h-11 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors cursor-pointer shadow-sm"
              >
                <Check className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Screen Recording Lightbox Modal with Export Format Selection */}
      {expandedVideo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Video preview"
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-6"
          onClick={() => setExpandedVideo(null)}
        >
          <div
            className="relative w-full max-w-4xl bg-white rounded-3xl p-4 shadow-2xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-950">
              <video
                ref={modalVideoRef}
                src={expandedVideo.url}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                {/* Direct Export Format Buttons (MP4 / WEBM / WAV) */}
                {(['mp4', 'webm', 'wav'] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    aria-label={`Export as ${fmt.toUpperCase()}`}
                    onClick={() => handleExportDownload(expandedVideo, fmt)}
                    className="h-10 px-3.5 rounded-full bg-[#eef1f6] hover:bg-[#568cc7] text-[#4b5563] hover:text-white flex items-center gap-1.5 text-xs font-mono font-semibold uppercase transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>{fmt}</span>
                  </button>
                ))}

                <button
                  type="button"
                  aria-label="Save to Google Drive"
                  onClick={() => handleDriveButtonClick(expandedVideo)}
                  className="w-10 h-10 rounded-full bg-[#eef1f6] hover:bg-[#e2e8f0] text-[#4b5563] flex items-center justify-center transition-colors cursor-pointer"
                >
                  <CloudUpload className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Delete recording"
                  onClick={() => handleDelete(expandedVideo)}
                  className="w-10 h-10 rounded-full bg-[#eef1f6] hover:bg-red-50 text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  aria-label="Close preview"
                  onClick={() => setExpandedVideo(null)}
                  className="w-10 h-10 rounded-full bg-[#568cc7] hover:bg-[#4b81bc] text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
