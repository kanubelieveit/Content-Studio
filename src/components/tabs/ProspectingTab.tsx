import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, UserPlus, Copy, Check, ExternalLink, MessageSquare } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SearchResult {
  url: string;
  title: string;
  description: string;
}

const messageTones = [
  { value: "professional", label: "Professionell" },
  { value: "casual", label: "Personlig & varm" },
  { value: "direct", label: "Direkt & konkret" },
];

export function ProspectingTab() {
  const { toast } = useToast();
  const [title, setTitle] = useState(() => localStorage.getItem("edu_prospectTitle") || "");
  const [company, setCompany] = useState(() => localStorage.getItem("edu_prospectCompany") || "");
  const [location, setLocation] = useState(() => localStorage.getItem("edu_prospectLocation") || "Sverige");
  const [industry, setIndustry] = useState(() => localStorage.getItem("edu_prospectIndustry") || "");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>(() => {
    try { const s = localStorage.getItem("edu_prospectResults"); return s ? JSON.parse(s) : []; } catch { return []; }
  });

  // Outreach message state
  const [selectedProfile, setSelectedProfile] = useState<SearchResult | null>(null);
  const [messageTone, setMessageTone] = useState("professional");
  const [messageContext, setMessageContext] = useState("");
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [outreachMessage, setOutreachMessage] = useState("");
  const [copiedMessage, setCopiedMessage] = useState(false);

  useEffect(() => { localStorage.setItem("edu_prospectTitle", title); }, [title]);
  useEffect(() => { localStorage.setItem("edu_prospectCompany", company); }, [company]);
  useEffect(() => { localStorage.setItem("edu_prospectLocation", location); }, [location]);
  useEffect(() => { localStorage.setItem("edu_prospectIndustry", industry); }, [industry]);
  useEffect(() => { localStorage.setItem("edu_prospectResults", JSON.stringify(results)); }, [results]);

  const handleSearch = async () => {
    const query = [
      title && `"${title}"`,
      company && `"${company}"`,
      industry,
      location,
    ].filter(Boolean).join(" ");

    if (!query.trim()) {
      toast({ title: "Ange minst ett sökkriterium", variant: "destructive" });
      return;
    }

    setIsSearching(true);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-news", {
        body: { url: `https://www.google.com/search?q=site:linkedin.com/in/ ${query}`, mode: "simple" },
      });

      if (error) throw error;

      // Parse search results from the scraped content
      const markdown = data?.data?.markdown || data?.markdown || "";
      const links = data?.data?.links || data?.links || [];
      
      // Filter LinkedIn profile links
      const profileLinks = links.filter((link: string) => 
        link.includes("linkedin.com/in/") && !link.includes("/posts/") && !link.includes("/pulse/")
      );

      // Also try Firecrawl search endpoint directly
      const { data: searchData, error: searchError } = await supabase.functions.invoke("scrape-news", {
        body: { url: `site:linkedin.com/in/ ${query}`, mode: "simple" },
      });

      const searchResults: SearchResult[] = [];
      const seenUrls = new Set<string>();

      // Extract from links
      for (const link of profileLinks.slice(0, 20)) {
        if (seenUrls.has(link)) continue;
        seenUrls.add(link);
        // Extract name from URL
        const parts = link.split("/in/")[1]?.split("/")[0]?.split("-");
        const name = parts?.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || link;
        searchResults.push({ url: link, title: name, description: "" });
      }

      // If we got markdown, try to extract titles/descriptions
      if (markdown && searchResults.length === 0) {
        const linkedinMatches = markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s]*linkedin\.com\/in\/[^\s)]+)\)/g);
        for (const match of linkedinMatches) {
          const url = match[2];
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          searchResults.push({ url, title: match[1], description: "" });
        }
      }

      if (searchResults.length === 0) {
        toast({ title: "Inga LinkedIn-profiler hittades", description: "Prova att ändra sökkriterierna.", variant: "destructive" });
      } else {
        toast({ title: `${searchResults.length} profiler hittades! 🔍` });
      }

      setResults(searchResults);
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Sökningen misslyckades.", variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerateOutreach = async (profile: SearchResult) => {
    setSelectedProfile(profile);
    setIsGeneratingMessage(true);
    setOutreachMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-linkedin-post", {
        body: {
          newsContent: `Jag vill skriva ett personligt LinkedIn-meddelande till följande person:\n\nNamn: ${profile.title}\nProfil: ${profile.url}\nBeskrivning: ${profile.description || "Ej tillgänglig"}\n\n${messageContext ? `Kontext för meddelandet: ${messageContext}` : ""}`,
          tone: messageTone,
          length: "short",
          instructions: `VIKTIGT: Skriv ett kort, personligt LinkedIn-meddelande (INTE ett inlägg). Meddelandet ska vara max 300 tecken. Det ska vara en kontaktförfrågan eller InMail. Börja INTE med hashtags. Var personlig och hänvisa till personens profil/roll. Avsluta med en tydlig fråga eller förslag på nästa steg. Skriv på svenska.`,
        },
      });
      if (error) throw error;
      if (data?.post) {
        setOutreachMessage(data.post);
        toast({ title: "Outreach-meddelande skapat! 💬" });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera meddelandet.", variant: "destructive" });
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(outreachMessage);
    setCopiedMessage(true);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sök LinkedIn-profiler</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Titel / Roll</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="T.ex. HR-chef, VD, Compliance Officer" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Företag</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="T.ex. Volvo, H&M, SEB" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Bransch</label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="T.ex. bank, fastigheter, tech" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Plats</label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="T.ex. Stockholm, Sverige" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={handleSearch} disabled={isSearching} className="px-8">
          {isSearching ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Search className="h-5 w-5 mr-2" />}
          {isSearching ? "Söker..." : "Sök profiler"}
        </Button>
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <UserPlus className="h-5 w-5 text-primary" />
              {results.length} profiler hittade
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Outreach settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 p-4 rounded-lg bg-muted/30 border border-border">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Ton för meddelande</label>
                <Select value={messageTone} onValueChange={setMessageTone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {messageTones.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Kontext <span className="text-muted-foreground font-normal">(valfritt)</span></label>
                <Input value={messageContext} onChange={(e) => setMessageContext(e.target.value)} placeholder="T.ex. GDPR-seminarium, nytt erbjudande..." />
              </div>
            </div>

            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{r.title}</p>
                  {r.description && <p className="text-xs text-muted-foreground truncate">{r.description}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="ghost" size="sm" asChild>
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateOutreach(r)}
                    disabled={isGeneratingMessage}
                  >
                    {isGeneratingMessage && selectedProfile?.url === r.url ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MessageSquare className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {outreachMessage && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="h-5 w-5 text-primary" />
                Outreach-meddelande
                {selectedProfile && <span className="text-sm font-normal text-muted-foreground ml-2">till {selectedProfile.title}</span>}
              </CardTitle>
              <Button variant="outline" size="sm" onClick={handleCopyMessage}>
                {copiedMessage ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copiedMessage ? "Kopierat" : "Kopiera"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={outreachMessage}
              onChange={(e) => setOutreachMessage(e.target.value)}
              className="min-h-[150px] text-sm font-sans bg-muted/30 rounded-xl p-4 border border-border leading-relaxed"
            />
            <p className="text-xs text-muted-foreground mt-2">{outreachMessage.length} tecken</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
