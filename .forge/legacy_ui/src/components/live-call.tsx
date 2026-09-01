// Live Call — full-screen continuous voice/vision dialogue.
// • Always-on mic (RMS-based VAD)  → captured audio uploaded to local bridge as voice note.
// • LLM reply auto-spoken via VoiceProvider (per-language TTS).
// • "Capture & Analyze" freezes a frame, sends to /api/vision/analyze.
// • All heavy compute lives on the Mac Studio — Dell is just the sensor.
import { memo, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, PhoneOff, Eye, Loader2, Volume2, VolumeX, Camera, CameraOff, RotateCw } from "lucide-react";
import { ChatAPI, VisionAPI, STTAPI, UploadsAPI, type ChatMessage } from "@/lib/api-client";
import { useVoice, detectLang } from "@/lib/voice-store";
import { useVisionConfig, buildVisionPayload } from "@/lib/vision-config-store";
import { LiveCallSocket, type LiveServerMsg } from "@/lib/live-call-ws";
import { toast } from "sonner";

// Memoize transcript overlay so per-token setState'ler video paint'ini durdurmasın.
const TranscriptOverlay = memo(function TranscriptOverlay({ user, assistant }: { user: string; assistant: string }) {
  return (
    <div className="absolute bottom-3 left-3 right-3 grid grid-cols-2 gap-3 pointer-events-none">
      {user && (
        <div className="p-2 rounded bg-background/70 text-xs font-mono">
          <span className="text-muted-foreground">You · </span>{user}
        </div>
      )}
      {assistant && (
        <div className="p-2 rounded bg-background/70 text-xs font-mono col-start-2">
          <span className="text-primary">Assistant · </span>{assistant.slice(0, 220)}{assistant.length > 220 ? "…" : ""}
        </div>
      )}
    </div>
  );
});

type Props = {
  open: boolean;
  onClose: () => void;
  threadId: string | null;
  history: ChatMessage[];
  model: string;
  mode: "local" | "deepdive" | "websearch";
  agents: string[];
  onUserUtterance: (text: string) => void;     // append to chat
  onAssistantReply: (text: string, source: string) => void;
};

type Phase = "idle" | "listening" | "thinking" | "speaking";

const SILENCE_MS = 1100;            // VAD: how long of quiet to consider end-of-speech
const MIN_UTTER_MS = 600;           // ignore micro-blips
const RMS_THRESHOLD = 0.025;        // voice presence threshold

export function LiveCall({
  open, onClose, threadId, history, model, mode, agents,
  onUserUtterance, onAssistantReply,
}: Props) {
  const { speak, cancel, playbackRate, setPlaybackRate } = useVoice();
  const { snapshot: visionSnapshot } = useVisionConfig();
  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [autoRead, setAutoRead] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastUser, setLastUser] = useState("");
  const [lastAssistant, setLastAssistant] = useState("");
  const [wsStatus, setWsStatus] = useState<"connecting"|"open"|"closed"|"error">("closed");
  const [mediaWarning, setMediaWarning] = useState<string | null>(null);

  const wsRef = useRef<LiveCallSocket | null>(null);
  const assistantBufRef = useRef<string>("");
  const assistantSourceRef = useRef<string>("local");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const speakingRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ---------- Open / close lifecycle ----------
  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setMediaWarning(null);

    // Open WS handshake first — server channel ready before mic opens.
    const ws = new LiveCallSocket(
      (msg: LiveServerMsg) => {
        if (msg.type === "ready") {
          ws.send({ type: "hello", threadId, model, mode, agents,
            history: history.map(m => ({ role: m.role, content: m.content })) });
        } else if (msg.type === "delta") {
          assistantBufRef.current += msg.chunk;
          setLastAssistant(assistantBufRef.current);
        } else if (msg.type === "done") {
          assistantSourceRef.current = msg.source || "local";
          const full = assistantBufRef.current;
          assistantBufRef.current = "";
          if (full) onAssistantReply(full, assistantSourceRef.current);
          if (autoRead && full) {
            speakingRef.current = true;
            setPhase("speaking");
            void Promise.resolve(speak(full, detectLang(full))).finally(() => {
              const wait = () => {
                if (typeof window !== "undefined" && window.speechSynthesis?.speaking) { setTimeout(wait, 200); return; }
                speakingRef.current = false;
                restartListening();
              };
              setTimeout(wait, 300);
            });
          } else {
            restartListening();
          }
        } else if (msg.type === "vision") {
          const text = msg.text || msg.error || "(vizyon sonucu yok)";
          setLastAssistant(text);
          const profile = visionSnapshot();
          if (msg.ok && text) {
            if (profile.voiceMode === "silent") {
              // Sessiz Gözcü — sadece chat'e düşer, ses üretilmez.
              onAssistantReply(text, "vision:silent");
            } else if (profile.voiceMode === "direct") {
              // Doğrudan Sesli — vizyon kendi metnini seçilen dilde okur.
              onAssistantReply(text, "vision:direct");
              if (autoRead) speak(text, profile.voiceLang);
            } else if (wsRef.current && wsStatus === "open") {
              // Elara Üzerinden — operatörün belirlediği bağlam etiketiyle paslanır.
              const label = profile.contextLabel?.trim() || "[Visual Report]";
              wsRef.current.send({ type: "user", text: `${label}: ${text}` });
            }
          }
        } else if (msg.type === "error") {
          toast.error(`WS: ${msg.message}`);
          restartListening();
        }
      },
      (status) => setWsStatus(status),
    );
    wsRef.current = ws;
    ws.connect();

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        const insecure = typeof window !== "undefined" && !window.isSecureContext;
        const inIframe = typeof window !== "undefined" && window.self !== window.top;
        const msg = insecure
          ? "Browser blocks mic/camera in insecure context. HTTPS or localhost required."
          : inIframe
            ? "Mic/camera are disabled in this preview iframe. Open in a new tab via ↗ (top-right) or use the published published URL."
            : "Browser does not expose the mic/camera API in this context.";
        setMediaWarning(msg);
        toast.warning(msg);
        return;
      }
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 24, max: 60 } }, audio: false });
        if (canceled) { cam.getTracks().forEach(t => t.stop()); return; }
        camStreamRef.current = cam;
        if (videoRef.current) { videoRef.current.srcObject = cam; videoRef.current.play().catch(()=>{}); }
      } catch (e) { const msg = `Camera: ${(e as Error).message}`; setMediaWarning(msg); toast.error(msg); }
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (canceled) { mic.getTracks().forEach(t => t.stop()); return; }
        micStreamRef.current = mic;
        startListening();
      } catch (e) { const msg = `Microphone: ${(e as Error).message}`; setMediaWarning(msg); toast.error(msg); }
    })();
    return () => {
      canceled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const teardown = () => {
    try { recRef.current?.state !== "inactive" && recRef.current?.stop(); } catch { /* */ }
    recRef.current = null;
    // Drop any pending audio chunks so blobs are GC-able.
    chunksRef.current = [];
    assistantBufRef.current = "";
    micStreamRef.current?.getTracks().forEach(t => t.stop()); micStreamRef.current = null;
    camStreamRef.current?.getTracks().forEach(t => t.stop()); camStreamRef.current = null;
    if (videoRef.current) { try { videoRef.current.pause(); videoRef.current.srcObject = null; } catch { /* */ } }
    audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null;
    analyserRef.current = null;
    wsRef.current?.close(); wsRef.current = null;
    cancel();
    setPhase("idle");
  };

  // ---------- Camera on/off (mic gibi bağımsız toggle) ----------
  const stopCamera = () => {
    try { camStreamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* */ }
    camStreamRef.current = null;
    if (videoRef.current) { try { videoRef.current.pause(); videoRef.current.srcObject = null; } catch { /* */ } }
    setCameraOn(false);
  };
  const startCamera = async () => {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 24, max: 60 } }, audio: false });
      camStreamRef.current = cam;
      if (videoRef.current) { videoRef.current.srcObject = cam; videoRef.current.play().catch(() => {}); }
      setCameraOn(true);
    } catch (e) { toast.error(`Camera: ${(e as Error).message}`); }
  };


  // Single source of truth for VAD: scans the analyser buffer each frame and
  // stops the recorder when an utterance ends. Used by both startListening
  // (first attach) and restartListening (after each assistant reply).
  const runVadLoop = () => {
    const an = analyserRef.current; if (!an) return;
    const buf = new Uint8Array(an.fftSize);
    let lastVoice = 0;
    let voiceStart = 0;
    const tick = () => {
      if (!analyserRef.current || phaseRef.current !== "listening") return;
      analyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      const isVoice = rms > RMS_THRESHOLD;

      if (!muted && !speakingRef.current) {
        if (isVoice) {
          if (!voiceStart) voiceStart = now;
          lastVoice = now;
        } else if (voiceStart && lastVoice && now - lastVoice > SILENCE_MS) {
          if (now - voiceStart > MIN_UTTER_MS) {
            voiceStart = 0; lastVoice = 0;
            try { recRef.current?.requestData?.(); recRef.current?.stop(); } catch { /* */ }
            setPhase("thinking");
            return; // stop polling until restart
          }
          voiceStart = 0; lastVoice = 0;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const startListening = () => {
    const stream = micStreamRef.current; if (!stream) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC(); audioCtxRef.current = ac;
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser(); an.fftSize = 1024;
    src.connect(an); analyserRef.current = an;

    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = handleUtteranceEnd;
    recRef.current = rec;
    rec.start();
    setPhase("listening");
    runVadLoop();
  };

  const handleUtteranceEnd = async () => {
    const blob = new Blob(chunksRef.current, { type: recRef.current?.mimeType || "audio/webm" });
    chunksRef.current = [];

    // Sovereign STT — Mac-side Whisper transcribes the utterance.
    let transcript = "";
    try {
      const stt = await STTAPI.transcribe(blob, { lang: "auto" });
      transcript = (stt.text || "").trim();
      if (!transcript && stt.error) {
        toast.error(`STT: ${stt.error}`);
      }
    } catch (e) {
      toast.error(`STT: ${(e as Error).message}`);
    }
    if (!transcript) {
      // Nothing usable — drop back to listening without bothering the LLM.
      restartListening();
      return;
    }
    setLastUser(transcript);
    onUserUtterance(transcript);

    // Persist the audio blob for forensics (fire-and-forget).
    if (threadId) {
      try {
        const file = new File([blob], `livecall-${Date.now()}.webm`, { type: blob.type });
        UploadsAPI.upload(file, threadId).catch(() => {});
      } catch { /* */ }
    }

    // Stream over WS — assistant tokens arrive via onMessage 'delta'/'done'.
    assistantBufRef.current = "";
    const ws = wsRef.current;
    if (ws && wsStatus === "open") {
      ws.send({ type: "user", text: transcript });
    } else {
      // Fallback: HTTP/SSE if WS not yet established.
      try {
        let assistant = ""; let source = "local";
        const userMsg: ChatMessage = {
          id: `u-${Date.now()}`, thread_id: threadId ?? "", role: "user",
          content: transcript, created_at: new Date().toISOString(),
        };
        await ChatAPI.streamChat({
          threadId: threadId ?? "", model, mode, agents,
          messages: [...history, userMsg].map(m => ({ role: m.role, content: m.content })),
          onMeta: (meta) => { if (meta.source) source = meta.source; },
          onDelta: (chunk) => { assistant += chunk; setLastAssistant(assistant); },
        });
        onAssistantReply(assistant, source);
        if (autoRead && assistant) {
          speakingRef.current = true; setPhase("speaking");
          speak(assistant, detectLang(assistant));
          const wait = () => {
            if (typeof window !== "undefined" && window.speechSynthesis?.speaking) { setTimeout(wait, 200); return; }
            speakingRef.current = false; restartListening();
          };
          setTimeout(wait, 300);
        } else { restartListening(); }
      } catch (e) {
        toast.error(`Live call: ${(e as Error).message}`);
        restartListening();
      }
    }
  };

  const restartListening = () => {
    if (!open) return;
    // Rebuild the recorder; analyser/audioCtx is preserved.
    const stream = micStreamRef.current; if (!stream) { setPhase("idle"); return; }
    try {
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = handleUtteranceEnd;
      recRef.current = rec;
      rec.start();
      setPhase("listening");
      runVadLoop();
    } catch { setPhase("idle"); }
  };

  // ---------- Capture & Analyze ----------
  const captureAndAnalyze = async () => {
    const v = videoRef.current; if (!v) return;
    setAnalyzing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth || 640; canvas.height = v.videoHeight || 480;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      const visionPayload = buildVisionPayload(visionSnapshot());
      const profile = visionSnapshot();
      // Prefer WS path → server bridges to vision endpoint, replies via 'vision' msg.
      if (wsRef.current && wsStatus === "open") {
        wsRef.current.send({ type: "frame", image: dataUrl, ...visionPayload });
      } else {
        const res = await VisionAPI.analyze(dataUrl, {
          ...visionPayload,
          deepDive: mode === "deepdive",
        });
        const visionText = res.text || res.error || "(vizyon sonucu yok)";
        setLastAssistant(visionText);
        if (res.text) {
          if (profile.voiceMode === "silent") {
            onAssistantReply(visionText, "vision:silent");
          } else if (profile.voiceMode === "direct") {
            onAssistantReply(visionText, "vision:direct");
            if (autoRead) speak(visionText, profile.voiceLang);
          } else {
            const label = profile.contextLabel?.trim() || "[Visual Report]";
            const payload = `${label}: ${visionText}`;
            try {
              let assistant = ""; let source = "local";
              const userMsg: ChatMessage = {
                id: `u-${Date.now()}`, thread_id: threadId ?? "", role: "user",
                content: payload, created_at: new Date().toISOString(),
              };
              await ChatAPI.streamChat({
                threadId: threadId ?? "", model, mode, agents,
                messages: [...history, userMsg].map(m => ({ role: m.role, content: m.content })),
                onMeta: (meta) => { if (meta.source) source = meta.source; },
                onDelta: (chunk) => { assistant += chunk; setLastAssistant(assistant); },
              });
              onAssistantReply(assistant, source);
              if (autoRead && assistant) speak(assistant, profile.voiceLang);
            } catch (e) { toast.error(`Elara: ${(e as Error).message}`); }
          }
        }
      }
    } catch (e) { toast.error(`Vision: ${(e as Error).message}`); }
    finally {
      setAnalyzing(false);
      // Komutan kuralı: capture biter bitmez kamera donanımı serbest bırakılır.
      // Kullanıcı yeniden analiz isterse "Camera" butonuyla tek tıkla açar.
      stopCamera();
    }
  };

  // ---------- UI ----------
  const phaseColor =
    phase === "listening" ? "bg-emerald-500" :
    phase === "thinking"  ? "bg-amber-500"  :
    phase === "speaking"  ? "bg-cyan-500"   : "bg-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="max-w-5xl p-0 bg-background border-primary/40">
        <div className="relative aspect-video bg-black rounded-t-md overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            style={{ transform: "translateZ(0) scaleX(-1)", backfaceVisibility: "hidden" }}
            muted
            playsInline
            autoPlay
            disablePictureInPicture
          />
          {!cameraOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <CameraOff className="h-10 w-10" />
                <span className="text-xs font-mono uppercase tracking-widest">Camera Off</span>
              </div>
            </div>
          )}
          <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
            <Badge variant="outline" className="font-mono bg-background/70">
              <span className={`inline-block h-2 w-2 rounded-full mr-2 ${phaseColor}${phase === "listening" ? " animate-pulse" : ""}`}/>
              LIVE · {phase.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="font-mono bg-background/70">{mode}</Badge>
            <Badge variant="outline" className="font-mono bg-background/70">{model}</Badge>
            <Badge variant="outline" className={`font-mono bg-background/70 ${wsStatus==="open"?"text-emerald-400":wsStatus==="error"?"text-destructive":"text-muted-foreground"}`}>
              WS · {wsStatus}
            </Badge>
          </div>
          {mediaWarning && (
            <div className="absolute inset-x-3 top-14 rounded border border-destructive/50 bg-background/85 p-2 text-xs font-mono text-destructive">
              {mediaWarning}
            </div>
          )}
          <TranscriptOverlay user={lastUser} assistant={lastAssistant} />
        </div>

        <div className="p-4 flex flex-wrap items-center gap-2 justify-center">
          <Button variant={muted ? "destructive" : "outline"} size="sm" onClick={() => setMuted(m => !m)}>
            {muted ? <MicOff className="h-4 w-4 mr-1"/> : <Mic className="h-4 w-4 mr-1"/>}
            {muted ? "Muted" : "Mic"}
          </Button>
          <Button
            variant={cameraOn ? "outline" : "destructive"}
            size="sm"
            onClick={() => { if (cameraOn) stopCamera(); else void startCamera(); }}
            title={cameraOn ? "Kamerayı kapat" : "Kamerayı aç"}
          >
            {cameraOn ? <Camera className="h-4 w-4 mr-1"/> : <CameraOff className="h-4 w-4 mr-1"/>}
            {cameraOn ? "Camera" : "Cam Off"}
          </Button>
          <Button variant={autoRead ? "default" : "outline"} size="sm" onClick={() => { if (autoRead) cancel(); setAutoRead(a => !a); }}>
            {autoRead ? <Volume2 className="h-4 w-4 mr-1"/> : <VolumeX className="h-4 w-4 mr-1"/>}
            Auto-Read
          </Button>
          <Button variant="outline" size="sm" onClick={captureAndAnalyze} disabled={analyzing || !cameraOn}>
            {analyzing ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/> : <Eye className="h-4 w-4 mr-1"/>}
            Capture &amp; Analyze
          </Button>
          <div className="flex items-center gap-2 px-3 py-1 border border-border rounded">
            <RotateCw className="h-3 w-3 text-muted-foreground"/>
            <span className="text-[10px] font-mono uppercase">Speed</span>
            {[0.8, 1.0, 1.25, 1.5].map(r => (
              <button key={r} onClick={() => setPlaybackRate(r)}
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${playbackRate===r?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-primary"}`}>
                {r}x
              </button>
            ))}
          </div>
          <Button variant="destructive" size="sm" onClick={() => { teardown(); onClose(); }}>
            <PhoneOff className="h-4 w-4 mr-1"/>End Call
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
