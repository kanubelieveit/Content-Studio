import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, Mic, Loader2, FileUp, Presentation, Download } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ContentInputProps {
  transcript: string;
  setTranscript: (v: string) => void;
  transcriptNote: string;
  setTranscriptNote: (v: string) => void;
  textInput: string;
  setTextInput: (v: string) => void;
  isConvertingPptx: boolean;
  setIsConvertingPptx: (v: boolean) => void;
  onPptxConverted?: (data: { title: string; slides: any[] }) => void;
}

export function ContentInput({
  transcript, setTranscript,
  transcriptNote, setTranscriptNote,
  textInput, setTextInput,
  isConvertingPptx, setIsConvertingPptx,
  onPptxConverted,
}: ContentInputProps) {
  const { toast } = useToast();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingPhase, setRecordingPhase] = useState<"idle" | "recording" | "processing" | "ready" | "transcribing">("idle");
  const [recordedSize, setRecordedSize] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedExt, setRecordedExt] = useState<string>("webm");
  const [savedirName, setSavedirName] = useState<string | null>(null);
  const [recordingTitle, setRecordingTitle] = useState<string>("");
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const TEMPLATE_URL = "https://irlxpxoqderbkeconjyq.supabase.co/storage/v1/object/public/template-assets/PPT_mall-4.pptx";

  const fixTranscriptErrors = (text: string) =>
    text.replace(/\bAB\s*06\b/g, "ABT 06");

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsTranscribing(true);
    setTranscript("");
    setTranscriptNote("");
    try {
      const { transcribeAudio } = await import("@/lib/ai-services");
      const text = await transcribeAudio(file, file.name);
      if (text) {
        setTranscript(fixTranscriptErrors(text));
        toast({ title: "Transkribering klar! 🎉" });
      } else {
        toast({ title: "Fel", description: "Transkribering returnerade tom text.", variant: "destructive" });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte transkribera filen.", variant: "destructive" });
    } finally {
      setIsTranscribing(false);
      e.target.value = "";
    }
  };

  const handleWordUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith(".txt")) {
      const text = await file.text();
      setTextInput(text);
      toast({ title: "Textfil inläst!", description: `${text.length.toLocaleString()} tecken.` });
      e.target.value = "";
      return;
    }
    if (file.name.endsWith(".docx")) {
      try {
        const { default: JSZip } = await import("jszip");
        const zip = await JSZip.loadAsync(file);
        const docXml = await zip.file("word/document.xml")?.async("string");
        if (docXml) {
          const text = docXml.replace(/<w:p[^>]*>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
          setTextInput(text);
          toast({ title: "Word-fil inläst!", description: `${text.length.toLocaleString()} tecken.` });
        } else {
          toast({ title: "Fel", description: "Kunde inte läsa Word-filen.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Fel", description: "Kunde inte läsa Word-filen.", variant: "destructive" });
      }
      e.target.value = "";
      return;
    }
    toast({ title: "Fel filtyp", description: "Ladda upp en .docx eller .txt-fil.", variant: "destructive" });
    e.target.value = "";
  };

  const handlePptxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsConvertingPptx(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pptx-content`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: formData,
        }
      );
      const data = await response.json();
      if (!data?.success || !data.slides?.length) {
        toast({ title: "Fel", description: data?.error || "Kunde inte läsa presentationen.", variant: "destructive" });
        return;
      }
      toast({ title: `${data.slides.length} slides extraherade`, description: "Konverterar till Wesslau-mallen..." });
      const { generatePptxFromTemplate } = await import("@/lib/pptx-from-template");
      const templateResp = await fetch(TEMPLATE_URL);
      if (!templateResp.ok) throw new Error("Kunde inte ladda mallen");
      const templateBuffer = await templateResp.arrayBuffer();
      const presentationData = { title: data.slides[0]?.title || file.name.replace(".pptx", ""), slides: data.slides };
      const blob = await generatePptxFromTemplate(templateBuffer, presentationData);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Wesslau_${file.name}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Klart! 🎉", description: "Presentationen har konverterats till Wesslau-mallen." });
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte konvertera presentationen.", variant: "destructive" });
    } finally {
      setIsConvertingPptx(false);
      e.target.value = "";
    }
  };

  const startRecording = async (withMic: boolean) => {
    setTextInput("");
    setTranscript("");
    setTranscriptNote("");
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      displayStream.getVideoTracks().forEach((track) => track.stop());
      let recordStream: MediaStream;
      let micStream: MediaStream | null = null;
      if (withMic) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        const tabAudioTracks = displayStream.getAudioTracks();
        if (tabAudioTracks.length > 0) {
          const tabSource = audioContext.createMediaStreamSource(new MediaStream(tabAudioTracks));
          tabSource.connect(destination);
        }
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(destination);
        recordStream = destination.stream;
      } else {
        recordStream = new MediaStream(displayStream.getAudioTracks());
      }
      streamRef.current = displayStream;
      const _micRef = micStream;
      audioChunksRef.current = [];
      setRecordingTime(0);
      const mediaRecorder = new MediaRecorder(recordStream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = async () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (_micRef) { _micRef.getTracks().forEach((t) => t.stop()); }
        setRecordingPhase("processing");
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        setRecordedSize(audioBlob.size);
        if (audioBlob.size < 1000) {
          toast({ title: "Ingen inspelning", description: "Inget ljud fångades.", variant: "destructive" });
          setIsRecording(false);
          setRecordingPhase("idle");
          return;
        }
        const ext = mediaRecorder.mimeType.includes("webm") ? "webm" : "mp4";
        setRecordedBlob(audioBlob);
        setRecordedExt(ext);
        setIsRecording(false);
        setRecordingPhase("ready");
      };
      displayStream.getTracks().forEach((track) => {
        track.onended = () => { if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop(); };
      });
      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingPhase("recording");
      timerRef.current = setInterval(() => setRecordingTime((prev) => prev + 1), 1000);
      toast({ title: "Inspelning startad 🔴", description: withMic ? "Flikljud + mikrofon fångas." : "Flikljud fångas." });
    } catch {
      toast({ title: "Kunde inte starta inspelning", description: "Tillåt delning av flikens ljud.", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    if (streamRef.current) { streamRef.current.getTracks().forEach((track) => track.stop()); streamRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const downloadRecording = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inspelning_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}.${recordedExt}`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Ljudfil nedladdad" });
  };

  const transcribeRecording = async (withMic: boolean) => {
    if (!recordedBlob) return;
    setRecordingPhase("transcribing");
    setIsTranscribing(true);
    setTranscript("");
    setTranscriptNote(withMic ? "Transkriberad från mötesinspelning (flik + mikrofon)" : "Transkriberad från flikljud-inspelning");
    try {
      const { transcribeAudio } = await import("@/lib/ai-services");
      const text = await transcribeAudio(recordedBlob, `recording.${recordedExt}`);
      if (text) {
        setTranscript(fixTranscriptErrors(text));
        await saveRecordingBundle(recordedBlob, recordedExt, fixTranscriptErrors(text), withMic, recordingTitle);
        toast({ title: "Transkribering klar & sparad! 🎉", description: dirHandleRef.current ? `Sparat i mappen: ${dirHandleRef.current.name}` : "ZIP med ljud och text har laddats ner." });
      } else {
        toast({ title: "Fel", description: "Transkribering returnerade tom text.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Fel", description: "Kunde inte transkribera inspelningen.", variant: "destructive" });
    } finally {
      setIsTranscribing(false);
      setRecordingPhase("idle");
      setRecordedBlob(null);
    }
  };

  const pickSaveDir = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      dirHandleRef.current = handle;
      setSavedirName(handle.name);
      toast({ title: "Sparmapp vald", description: `Sparar till: ${handle.name}` });
    } catch {
      // user cancelled
    }
  };

  const saveRecordingBundle = async (audioBlob: Blob, ext: string, transcriptText: string, withMic: boolean, title: string) => {
    const timestamp = new Date().toISOString().slice(0, 10);
    const safeName = title.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
    const folderName = safeName ? `${timestamp}_${safeName}` : `inspelning_${timestamp}`;
    const meta = withMic ? "Källa: Flikljud + mikrofon" : "Källa: Flikljud";
    const transcriptContent = `${meta}\nDatum: ${new Date().toLocaleString("sv-SE")}\n\n${transcriptText}`;

    if (dirHandleRef.current) {
      const subDir = await dirHandleRef.current.getDirectoryHandle(folderName, { create: true });
      const audioFile = await subDir.getFileHandle(`audio.${ext}`, { create: true });
      const audioWriter = await audioFile.createWritable();
      await audioWriter.write(audioBlob);
      await audioWriter.close();
      const txtFile = await subDir.getFileHandle("transkribering.txt", { create: true });
      const txtWriter = await txtFile.createWritable();
      await txtWriter.write(transcriptContent);
      await txtWriter.close();
    } else {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const folder = zip.folder(folderName)!;
      folder.file(`audio.${ext}`, audioBlob);
      folder.file("transkribering.txt", transcriptContent);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folderName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">1</span>
          Lägg till innehåll
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 cursor-pointer hover:border-primary/30 transition-all">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Ladda upp ljud- eller videofil (MP3, MP4, WAV, M4A, etc.)</span>
          <input type="file" accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.webm,.ogg,.mov" className="hidden" onChange={handleFileUpload} disabled={isTranscribing || isRecording} />
        </label>

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">eller spela in ljud</span></div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={pickSaveDir}>
            <Download className="h-4 w-4 mr-2" />
            {savedirName ? `Sparmapp: ${savedirName}` : "Välj sparmapp"}
          </Button>
          {savedirName && <span className="text-xs text-muted-foreground">Filer sparas direkt till disk</span>}
        </div>

        {recordingPhase === "idle" && !isRecording ? (
          <div className="space-y-3">
            <Input
              placeholder="Föreläsningens titel (används som mappnamn)"
              value={recordingTitle}
              onChange={(e) => setRecordingTitle(e.target.value)}
              disabled={isTranscribing}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button variant="outline" className="py-6" onClick={() => startRecording(false)} disabled={isTranscribing}>
                <Mic className="h-5 w-5 mr-2" /> Spela in flikljud
              </Button>
              <Button variant="outline" className="py-6" onClick={() => startRecording(true)} disabled={isTranscribing}>
                <Mic className="h-5 w-5 mr-2" /> Spela in möte (flik + mikrofon)
              </Button>
            </div>
          </div>
        ) : recordingPhase === "recording" ? (
          <div className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
              </span>
              <span className="text-sm font-medium flex-1">Spelar in... <span className="font-mono text-base">{formatTime(recordingTime)}</span></span>
              <Button variant="destructive" size="sm" onClick={stopRecording}>Stoppa inspelning</Button>
            </div>
          </div>
        ) : recordingPhase === "ready" ? (
          <div className="rounded-xl border-2 border-green-500/50 bg-green-50/50 p-5 space-y-3">
            <p className="text-sm font-medium">Inspelning klar ({(recordedSize / 1024 / 1024).toFixed(1)} MB)</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => transcribeRecording(false)}>
                Transkribera & spara allt (ZIP)
              </Button>
              <Button variant="outline" size="sm" onClick={downloadRecording}>
                <Download className="h-4 w-4 mr-2" /> Bara ljudfilen
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setRecordingPhase("idle"); setRecordedBlob(null); }}>
                Kasta bort
              </Button>
            </div>
          </div>
        ) : (recordingPhase === "processing" || recordingPhase === "transcribing") ? (
          <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm font-medium">{recordingPhase === "processing" ? "Förbereder inspelning..." : "Transkriberar ljud..."}</p>
            </div>
            <Progress value={recordingPhase === "processing" ? 30 : 65} className="h-2" />
          </div>
        ) : null}

        {isTranscribing && recordingPhase === "idle" && (
          <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-sm font-medium">Transkriberar fil...</p>
          </div>
        )}

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">eller klistra in / ladda upp text</span></div>
        </div>

        <Textarea value={textInput} onChange={(e) => setTextInput(e.target.value)} placeholder="Klistra in text, transkribering eller utbildningsmaterial här..." className="min-h-[200px] text-sm" />

        <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 cursor-pointer hover:border-primary/30 transition-all">
          <FileUp className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Ladda upp Word-fil (.docx) eller textfil (.txt)</span>
          <input type="file" accept=".docx,.txt" className="hidden" onChange={handleWordUpload} />
        </label>

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">eller konvertera befintlig presentation</span></div>
        </div>

        <label className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 cursor-pointer hover:border-primary/30 transition-all ${isConvertingPptx ? "opacity-50 pointer-events-none" : ""}`}>
          {isConvertingPptx ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Presentation className="h-5 w-5 text-muted-foreground" />}
          <span className="text-sm text-muted-foreground">{isConvertingPptx ? "Konverterar presentation..." : "Ladda upp .pptx → konvertera till Wesslau-mall"}</span>
          <input type="file" accept=".pptx" className="hidden" onChange={handlePptxUpload} disabled={isConvertingPptx} />
        </label>
      </CardContent>
    </Card>
  );
}
