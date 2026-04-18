import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Check, Mail, Download } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { markdownToDocx } from "@/lib/markdown-to-docx";

interface NewsletterTabProps {
  source: string;
}

export function NewsletterTab({ source }: NewsletterTabProps) {
  const { toast } = useToast();
  const [instructions, setInstructions] = useState(() => localStorage.getItem("edu_newsletterInstructions") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [newsletter, setNewsletter] = useState(() => localStorage.getItem("edu_newsletter") || "");
  const [copied, setCopied] = useState(false);

  useEffect(() => { localStorage.setItem("edu_newsletter", newsletter); }, [newsletter]);
  useEffect(() => { localStorage.setItem("edu_newsletterInstructions", instructions); }, [instructions]);

  const handleGenerate = async () => {
    if (!source) return;
    setIsGenerating(true);
    setNewsletter("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-newsletter", {
        body: { content: source, instructions: instructions.trim() || undefined },
      });
      if (error) throw error;
      if (data?.success) {
        setNewsletter(data.newsletter);
        toast({ title: "Nyhetsbrev skapat! 📬" });
      } else {
        toast({ title: "Fel", description: data?.error || "Kunde inte generera nyhetsbrevet.", variant: "destructive" });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera nyhetsbrevet.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(newsletter);
    setCopied(true);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    const blob = await markdownToDocx(newsletter);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nyhetsbrev.docx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instruktioner</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={"T.ex:\n• Målgrupp: befintliga klienter inom fastighetsrätt\n• Inkludera praktiska råd och rekommendationer\n• Avsluta med kontaktuppgifter och CTA"}
            className="min-h-[100px] text-sm"
          />
          <p className="text-xs text-muted-foreground mt-2">Lämna tomt för standardformat.</p>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={handleGenerate} disabled={isGenerating || !source} className="px-8">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Mail className="h-5 w-5 mr-2" />}
          {isGenerating ? "Genererar..." : newsletter ? "Generera nytt nyhetsbrev" : "Skapa nyhetsbrev"}
        </Button>
      </div>

      {newsletter && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="h-5 w-5 text-primary" />
                Nyhetsbrev
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
              value={newsletter}
              onChange={(e) => setNewsletter(e.target.value)}
              className="min-h-[400px] text-sm font-sans bg-muted/30 rounded-xl p-6 border border-border leading-relaxed"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
