import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Presentation } from "lucide-react";
import { PresentationViewer } from "@/components/PresentationViewer";
import { generatePptxFromTemplate } from "@/lib/pptx-from-template";

interface PresentationTabProps {
  source: string;
}

export function PresentationTab({ source }: PresentationTabProps) {
  const { toast } = useToast();
  const [instructions, setInstructions] = useState(() => localStorage.getItem("edu_presentationInstructions") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [presentation, setPresentation] = useState<{ title: string; slides: { title: string; bullets: string[]; speakerNotes: string }[] } | null>(() => {
    try { const s = localStorage.getItem("edu_presentation"); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  const TEMPLATE_URL = "https://irlxpxoqderbkeconjyq.supabase.co/storage/v1/object/public/template-assets/PPT_mall-4.pptx";

  useEffect(() => { localStorage.setItem("edu_presentationInstructions", instructions); }, [instructions]);
  useEffect(() => { localStorage.setItem("edu_presentation", presentation ? JSON.stringify(presentation) : ""); }, [presentation]);

  const handleGenerate = async () => {
    if (!source) return;
    setIsGenerating(true);
    setPresentation(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-presentation", {
        body: { transcript: source, instructions: instructions.trim() || undefined },
      });
      if (error) throw error;
      if (!data?.success) {
        toast({ title: "Fel", description: data?.error || "Kunde inte generera presentation.", variant: "destructive" });
        return;
      }
      setPresentation(data.presentation);
      toast({ title: "Presentation skapad! 🎓" });
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera presentationen.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportPptx = async () => {
    if (!presentation) return;
    toast({ title: "Förbereder export..." });
    try {
      const resp = await fetch(TEMPLATE_URL);
      if (!resp.ok) throw new Error("Kunde inte ladda mallen");
      const templateBuffer = await resp.arrayBuffer();
      const blob = await generatePptxFromTemplate(templateBuffer, presentation);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${presentation.title.replace(/[^a-zA-ZåäöÅÄÖ0-9 ]/g, "").slice(0, 50)}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PowerPoint exporterad! 📥" });
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte exportera presentationen.", variant: "destructive" });
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
          <CardTitle className="text-base">Instruktioner för presentationen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={"Beskriv hur presentationen ska utformas, t.ex:\n• Målgrupp: HR-chefer inom bank\n• Fokus: praktiska konsekvenser av nya regler\n• Ton: professionell men tillgänglig\n• Antal slides: ca 15\n• Inkludera konkreta exempel och case"}
            className="min-h-[120px] text-sm"
          />
          <p className="text-xs text-muted-foreground">Lämna tomt för standardgenerering.</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-center gap-3">
        {presentation && (
          <Button variant="outline" onClick={() => setPresentation(null)}>Rensa presentation</Button>
        )}
        <Button onClick={handleGenerate} disabled={isGenerating || !source} className="px-8">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Presentation className="h-5 w-5 mr-2" />}
          {isGenerating ? "Genererar..." : presentation ? "Generera ny presentation" : "Skapa presentation"}
        </Button>
      </div>

      {isGenerating && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm font-medium">AI:n analyserar innehållet och skapar slides med manus...</p>
            </div>
            <Progress value={45} className="h-2" />
          </CardContent>
        </Card>
      )}

      {presentation && (
        <PresentationViewer presentation={presentation} onCopy={handleCopy} onExportPptx={handleExportPptx} />
      )}
    </div>
  );
}
