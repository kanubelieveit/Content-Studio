import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Check, FileText, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { markdownToDocx } from "@/lib/markdown-to-docx";

interface ArticleTabProps {
  source: string;
}

const formats = [
  { value: "blog", label: "Blogginlägg" },
  { value: "article", label: "Längre artikel" },
  { value: "summary", label: "Kort sammanfattning" },
];

const lengths = [
  { value: "short", label: "Kort (200–500 ord)" },
  { value: "medium", label: "Medium (500–1000 ord)" },
  { value: "long", label: "Lång (1000–2500 ord)" },
];

export function ArticleTab({ source }: ArticleTabProps) {
  const { toast } = useToast();
  const [format, setFormat] = useState("blog");
  const [length, setLength] = useState("medium");
  const [instructions, setInstructions] = useState(() => localStorage.getItem("edu_articleInstructions") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [article, setArticle] = useState(() => localStorage.getItem("edu_article") || "");
  const [copied, setCopied] = useState(false);

  useEffect(() => { localStorage.setItem("edu_article", article); }, [article]);
  useEffect(() => { localStorage.setItem("edu_articleInstructions", instructions); }, [instructions]);

  const handleGenerate = async () => {
    if (!source) return;
    setIsGenerating(true);
    setArticle("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-article", {
        body: { content: source, format, length, instructions: instructions.trim() || undefined },
      });
      if (error) throw error;
      if (data?.success) {
        setArticle(data.article);
        toast({ title: "Artikel skapad! 📝" });
      } else {
        toast({ title: "Fel", description: data?.error || "Kunde inte generera artikeln.", variant: "destructive" });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera artikeln.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(article);
    setCopied(true);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    const blob = await markdownToDocx(article);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "artikel.docx";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inställningar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Format</label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {formats.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Längd</label>
            <Select value={length} onValueChange={setLength}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {lengths.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Specifika instruktioner <span className="text-muted-foreground font-normal">(valfritt)</span></label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="T.ex: Skriv för byråns hemsida, inkludera SEO-nyckelord, rikta mot företagsledare..."
              className="min-h-[80px] text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={handleGenerate} disabled={isGenerating || !source} className="px-8">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <FileText className="h-5 w-5 mr-2" />}
          {isGenerating ? "Genererar..." : article ? "Generera ny artikel" : "Skapa artikel"}
        </Button>
      </div>

      {article && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-primary" />
                Artikel
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
              value={article}
              onChange={(e) => setArticle(e.target.value)}
              className="min-h-[400px] text-sm font-sans bg-muted/30 rounded-xl p-6 border border-border leading-relaxed"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
