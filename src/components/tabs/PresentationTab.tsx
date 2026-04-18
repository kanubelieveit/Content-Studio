import { useState, useEffect, useRef } from "react";
import { generatePresentation, textToSpeech } from "@/lib/ai-services";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Presentation, Download, FolderOpen, Volume2 } from "lucide-react";
import { PresentationViewer } from "@/components/PresentationViewer";
import { generatePptxFromTemplate } from "@/lib/pptx-from-template";
import type { ThemeVariant } from "@/lib/pptx-from-template";

interface Slide {
  layoutType?: string;
  title?: string;
  bullets?: string[];
  quoteText?: string;
  quoteSource?: string;
  speakerNotes: string;
}

interface PresentationData {
  title: string;
  subtitle?: string;
  slides: Slide[];
}

interface PresentationTabProps {
  source: string;
}

const TEMPLATE_URL = "/templates/wesslau-tema.pptx";

export function PresentationTab({ source }: PresentationTabProps) {
  const { toast } = useToast();
  const [instructions, setInstructions] = useState(() => localStorage.getItem("edu_presentationInstructions") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [voiceId, setVoiceId] = useState(() => localStorage.getItem("edu_voiceId") || "FzF9ACIefsb6wbrYVjf1");
  const [savedirName, setSavedirName] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeVariant>("blue");
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  const [presentation, setPresentation] = useState<PresentationData | null>(() => {
    try { const s = localStorage.getItem("edu_presentation"); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  useEffect(() => { localStorage.setItem("edu_presentationInstructions", instructions); }, [instructions]);
  useEffect(() => { localStorage.setItem("edu_voiceId", voiceId); }, [voiceId]);
  useEffect(() => { localStorage.setItem("edu_presentation", presentation ? JSON.stringify(presentation) : ""); }, [presentation]);

  const pickSaveDir = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      dirHandleRef.current = handle;
      setSavedirName(handle.name);
      toast({ title: "Sparmapp vald", description: `Sparar till: ${handle.name}` });
    } catch { /* cancelled */ }
  };

  const handleGenerate = async () => {
    if (!source) return;
    setIsGenerating(true);
    setPresentation(null);
    try {
      const presentation = await generatePresentation(source, instructions.trim() || undefined);
      setPresentation(presentation);
      toast({ title: "Presentation skapad! 🎓" });
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera presentationen.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportAll = async () => {
    if (!presentation) return;
    if (!voiceId.trim()) {
      toast({ title: "Voice ID saknas", description: "Fyll i ElevenLabs Voice ID för att generera ljud.", variant: "destructive" });
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    const timestamp = new Date().toISOString().slice(0, 10);
    const safeName = presentation.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
    const folderName = `${timestamp}_${safeName}`;

    try {
      // Step 1: Generate PPTX
      setExportStatus("Genererar PowerPoint...");
      setExportProgress(10);
      const resp = await fetch(TEMPLATE_URL);
      if (!resp.ok) throw new Error("Kunde inte ladda mallen");
      const templateBuffer = await resp.arrayBuffer();
      const pptxBlob = await generatePptxFromTemplate(templateBuffer, { ...presentation, theme });
      setExportProgress(25);

      // Step 2: TTS per slide
      const slidesWithNotes = presentation.slides.filter(s => s.speakerNotes?.trim());
      const totalSlides = slidesWithNotes.length;
      const audioFiles: { name: string; blob: Blob }[] = [];

      for (let i = 0; i < slidesWithNotes.length; i++) {
        const slide = slidesWithNotes[i];
        const slideTitle = (slide.title || slide.quoteText || `Del ${i + 1}`).slice(0, 40).replace(/[\\/:*?"<>|]/g, "_");
        setExportStatus(`Genererar ljud för slide ${i + 1}/${totalSlides}: ${slideTitle}...`);
        setExportProgress(25 + Math.round((i / totalSlides) * 65));

        try {
          const audioBlob = await textToSpeech(slide.speakerNotes, voiceId.trim());
          const num = String(i + 1).padStart(2, "0");
          audioFiles.push({ name: `slide_${num}_${slideTitle}.mp3`, blob: audioBlob });
        } catch (e) {
          console.warn(`TTS error for slide ${i + 1}:`, e);
        }
      }

      setExportStatus("Sparar filer...");
      setExportProgress(95);

      // Step 3: Save to folder or ZIP
      if (dirHandleRef.current) {
        const subDir = await dirHandleRef.current.getDirectoryHandle(folderName, { create: true });

        const pptxFile = await subDir.getFileHandle(`${safeName}.pptx`, { create: true });
        const pptxWriter = await pptxFile.createWritable();
        await pptxWriter.write(pptxBlob);
        await pptxWriter.close();

        for (const { name, blob } of audioFiles) {
          const audioFile = await subDir.getFileHandle(name, { create: true });
          const audioWriter = await audioFile.createWritable();
          await audioWriter.write(blob);
          await audioWriter.close();
        }

        toast({
          title: "Klart! 🎉",
          description: `${audioFiles.length} ljudfiler + PPTX sparade i "${folderName}"`,
        });
      } else {
        // Fallback: ZIP download
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        const folder = zip.folder(folderName)!;
        folder.file(`${safeName}.pptx`, pptxBlob);
        for (const { name, blob } of audioFiles) folder.file(name, blob);
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${folderName}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: "Klart! 🎉", description: `ZIP med ${audioFiles.length} ljudfiler + PPTX nedladdad.` });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Export misslyckades. Se konsolen.", variant: "destructive" });
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      setExportStatus("");
    }
  };

  const handleExportPptxOnly = async () => {
    if (!presentation) return;
    try {
      const resp = await fetch(TEMPLATE_URL);
      if (!resp.ok) throw new Error("Kunde inte ladda mallen");
      const templateBuffer = await resp.arrayBuffer();
      const blob = await generatePptxFromTemplate(templateBuffer, { ...presentation, theme });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${presentation.title.replace(/[^a-zA-ZåäöÅÄÖ0-9 ]/g, "").slice(0, 50)}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PowerPoint exporterad! 📥" });
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte exportera.", variant: "destructive" });
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Kopierat!" });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inställningar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">ElevenLabs Voice ID</label>
            <Input
              placeholder="Klistra in Voice ID från ElevenLabs..."
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Tema</label>
            <div className="flex gap-2">
              {(["blue", "gray", "white"] as ThemeVariant[]).map(t => (
                <Button
                  key={t}
                  size="sm"
                  variant={theme === t ? "default" : "outline"}
                  onClick={() => setTheme(t)}
                >
                  {t === "blue" ? "Blå" : t === "gray" ? "Grå" : "Vit"}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={pickSaveDir}>
              <FolderOpen className="h-4 w-4 mr-2" />
              {savedirName ? `Sparmapp: ${savedirName}` : "Välj sparmapp"}
            </Button>
            {savedirName && <span className="text-xs text-muted-foreground">Filer sparas direkt till disk</span>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Instruktioner (valfritt)</label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={"Beskriv hur presentationen ska utformas, t.ex:\n• Fokus på praktiska konsekvenser för entreprenadjurister\n• Inkludera konkreta rättsfall och exempel\n• Målgrupp: erfarna jurister"}
              className="min-h-[100px] text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-center gap-3">
        {presentation && (
          <Button variant="outline" onClick={() => setPresentation(null)}>Rensa</Button>
        )}
        <Button onClick={handleGenerate} disabled={isGenerating || !source} className="px-8">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Presentation className="h-5 w-5 mr-2" />}
          {isGenerating ? "Genererar..." : presentation ? "Generera ny" : "Skapa utbildningsmaterial"}
        </Button>
      </div>

      {isGenerating && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm font-medium">AI skapar originalt utbildningsmaterial med talarmanus...</p>
            </div>
            <Progress value={45} className="h-2" />
          </CardContent>
        </Card>
      )}

      {isExporting && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm font-medium">{exportStatus}</p>
            </div>
            <Progress value={exportProgress} className="h-2" />
          </CardContent>
        </Card>
      )}

      {presentation && !isExporting && (
        <>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={handleExportAll} disabled={!voiceId.trim()} className="px-6">
              <Volume2 className="h-4 w-4 mr-2" />
              Generera PPTX + talarsljud
            </Button>
            <Button variant="outline" onClick={handleExportPptxOnly}>
              <Download className="h-4 w-4 mr-2" />
              Bara PPTX
            </Button>
          </div>
          {!voiceId.trim() && (
            <p className="text-xs text-center text-muted-foreground">Fyll i Voice ID ovan för att generera talarsljud</p>
          )}
          <PresentationViewer presentation={presentation as any} onCopy={handleCopy} onExportPptx={handleExportPptxOnly} />
        </>
      )}
    </div>
  );
}
