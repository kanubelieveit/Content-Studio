import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Newspaper, Zap, Check, ExternalLink, Copy } from "lucide-react";

interface ScrapedArticle {
  url: string;
  title: string;
  content: string;
  pdfContents?: { url: string; text: string }[];
}

interface GeneratedContent {
  linkedin?: string;
  article?: string;
  newsletter?: string;
}

export function NewsMonitorTab() {
  const { toast } = useToast();
  const [newsUrl, setNewsUrl] = useState(() => localStorage.getItem("edu_newsUrl") || "https://lexnova.se/nyheter");
  const [isScanning, setIsScanning] = useState(false);
  const [articles, setArticles] = useState<ScrapedArticle[]>(() => {
    try { const s = localStorage.getItem("edu_scrapedArticles"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [selectedArticle, setSelectedArticle] = useState<ScrapedArticle | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generated, setGenerated] = useState<GeneratedContent>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem("edu_newsUrl", newsUrl); }, [newsUrl]);
  useEffect(() => { localStorage.setItem("edu_scrapedArticles", JSON.stringify(articles)); }, [articles]);

  const handleScan = async () => {
    setIsScanning(true);
    setArticles([]);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-news", {
        body: { url: newsUrl, mode: "deep" },
      });
      if (error) throw error;
      if (data?.articles?.length) {
        setArticles(data.articles);
        toast({ title: `${data.articles.length} artiklar hittade! 📰` });
      } else {
        toast({ title: "Inga artiklar hittades", variant: "destructive" });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte skanna nyhetskällan.", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  const handleGenerateAll = async (article: ScrapedArticle) => {
    setSelectedArticle(article);
    setIsGeneratingAll(true);
    setGenerated({});

    const fullContent = article.content + (article.pdfContents?.map(p => `\n\n--- PDF: ${p.url} ---\n${p.text}`).join("") || "");

    try {
      // Generate all three in parallel
      const [linkedinRes, articleRes, newsletterRes] = await Promise.allSettled([
        supabase.functions.invoke("generate-linkedin-post", {
          body: { newsContent: fullContent, tone: "professional", length: "medium" },
        }),
        supabase.functions.invoke("generate-article", {
          body: { content: fullContent, format: "blog", length: "medium" },
        }),
        supabase.functions.invoke("generate-newsletter", {
          body: { content: fullContent },
        }),
      ]);

      const result: GeneratedContent = {};
      if (linkedinRes.status === "fulfilled" && linkedinRes.value.data?.post) {
        result.linkedin = linkedinRes.value.data.post;
      }
      if (articleRes.status === "fulfilled" && articleRes.value.data?.article) {
        result.article = articleRes.value.data.article;
      }
      if (newsletterRes.status === "fulfilled" && newsletterRes.value.data?.newsletter) {
        result.newsletter = newsletterRes.value.data.newsletter;
      }

      setGenerated(result);
      const count = Object.keys(result).length;
      toast({ title: `${count} innehållstyper genererade! ⚡` });
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Generering misslyckades.", variant: "destructive" });
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const handleCopy = async (field: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nyhetskälla</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={newsUrl}
            onChange={(e) => setNewsUrl(e.target.value)}
            placeholder="URL till nyhetssida, t.ex. https://lexnova.se/nyheter"
          />
          <p className="text-xs text-muted-foreground">Ange en nyhetssida att bevaka. Systemet hittar artiklar och kan automatiskt generera LinkedIn-inlägg, artiklar och nyhetsbrev.</p>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={handleScan} disabled={isScanning || !newsUrl.trim()} className="px-8">
          {isScanning ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Newspaper className="h-5 w-5 mr-2" />}
          {isScanning ? "Skannar..." : "Skanna nyhetskälla"}
        </Button>
      </div>

      {articles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Newspaper className="h-5 w-5 text-primary" />
              {articles.length} artiklar hittade
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {articles.map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.content.slice(0, 120)}...</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="ghost" size="sm" asChild>
                    <a href={a.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleGenerateAll(a)}
                    disabled={isGeneratingAll}
                  >
                    {isGeneratingAll && selectedArticle?.url === a.url ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Zap className="h-4 w-4 mr-1" />
                    )}
                    Generera allt
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(generated.linkedin || generated.article || generated.newsletter) && (
        <div className="space-y-4">
          {generated.linkedin && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">LinkedIn-inlägg</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => handleCopy("linkedin", generated.linkedin!)}>
                    {copiedField === "linkedin" ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                    {copiedField === "linkedin" ? "Kopierat" : "Kopiera"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={generated.linkedin}
                  onChange={(e) => setGenerated(prev => ({ ...prev, linkedin: e.target.value }))}
                  className="min-h-[150px] text-sm"
                />
              </CardContent>
            </Card>
          )}

          {generated.article && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Artikel</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => handleCopy("article", generated.article!)}>
                    {copiedField === "article" ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                    {copiedField === "article" ? "Kopierat" : "Kopiera"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={generated.article}
                  onChange={(e) => setGenerated(prev => ({ ...prev, article: e.target.value }))}
                  className="min-h-[300px] text-sm"
                />
              </CardContent>
            </Card>
          )}

          {generated.newsletter && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Nyhetsbrev</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => handleCopy("newsletter", generated.newsletter!)}>
                    {copiedField === "newsletter" ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                    {copiedField === "newsletter" ? "Kopierat" : "Kopiera"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={generated.newsletter}
                  onChange={(e) => setGenerated(prev => ({ ...prev, newsletter: e.target.value }))}
                  className="min-h-[300px] text-sm"
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
