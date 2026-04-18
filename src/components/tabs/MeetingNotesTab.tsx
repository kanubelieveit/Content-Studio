import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Check, ClipboardList, Download } from "lucide-react";
import { markdownToDocx } from "@/lib/markdown-to-docx";
import { Textarea } from "@/components/ui/textarea";

interface MeetingNotesTabProps {
  source: string;
}

export function MeetingNotesTab({ source }: MeetingNotesTabProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState(() => localStorage.getItem("edu_meetingNotes") || "");
  const [copied, setCopied] = useState(false);

  useEffect(() => { localStorage.setItem("edu_meetingNotes", meetingNotes); }, [meetingNotes]);

  const handleGenerate = async () => {
    if (!source) return;
    setIsGenerating(true);
    setMeetingNotes("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-meeting-notes", {
        body: { transcript: source },
      });
      if (error) throw error;
      if (!data?.success) {
        toast({ title: "Fel", description: data?.error || "Kunde inte generera mötesanteckningar.", variant: "destructive" });
        return;
      }
      setMeetingNotes(data.meetingNotes);
      toast({ title: "Mötesanteckningar skapade! 📋" });
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera mötesanteckningarna.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(meetingNotes);
    setCopied(true);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    const blob = await markdownToDocx(meetingNotes);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "motesanteckningar.docx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <Button onClick={handleGenerate} disabled={isGenerating || !source} className="px-8">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <ClipboardList className="h-5 w-5 mr-2" />}
          {isGenerating ? "Genererar..." : meetingNotes ? "Generera nya anteckningar" : "Skapa mötesanteckningar"}
        </Button>
      </div>

      {isGenerating && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm font-medium">AI:n analyserar transkriptet och skapar mötesanteckningar...</p>
            </div>
            <Progress value={50} className="h-2" />
          </CardContent>
        </Card>
      )}

      {meetingNotes && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardList className="h-5 w-5 text-primary" />
                Mötesanteckningar
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? "Kopierat" : "Kopiera"}
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-1" /> Ladda ner .docx
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={meetingNotes}
              onChange={(e) => setMeetingNotes(e.target.value)}
              className="min-h-[400px] text-sm font-sans bg-muted/30 rounded-xl p-6 border border-border leading-relaxed"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
