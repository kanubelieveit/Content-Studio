import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Copy, Check, FileText, Presentation, ClipboardList, Linkedin, Mail, Briefcase, Zap, UserSearch, Newspaper, Loader2, MessageSquare
} from "lucide-react";
import { ContentInput } from "@/components/ContentInput";
import { PresentationTab } from "@/components/tabs/PresentationTab";
import { LinkedInTab } from "@/components/tabs/LinkedInTab";
import { ArticleTab } from "@/components/tabs/ArticleTab";
import { NewsletterTab } from "@/components/tabs/NewsletterTab";
import { MeetingNotesTab } from "@/components/tabs/MeetingNotesTab";
import { ProspectingTab } from "@/components/tabs/ProspectingTab";
import { PersonalMessageTab } from "@/components/tabs/PersonalMessageTab";
import { NewsMonitorTab } from "@/components/tabs/NewsMonitorTab";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { toast } = useToast();

  const [transcript, setTranscript] = useState(() => localStorage.getItem("edu_transcript") || "");
  const [transcriptNote, setTranscriptNote] = useState(() => localStorage.getItem("edu_transcriptNote") || "");
  const [textInput, setTextInput] = useState(() => localStorage.getItem("edu_textInput") || "");
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [isConvertingPptx, setIsConvertingPptx] = useState(false);
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("edu_activeTab") || "presentation");
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);

  useEffect(() => { localStorage.setItem("edu_transcript", transcript); }, [transcript]);
  useEffect(() => { localStorage.setItem("edu_transcriptNote", transcriptNote); }, [transcriptNote]);
  useEffect(() => { localStorage.setItem("edu_textInput", textInput); }, [textInput]);
  useEffect(() => { localStorage.setItem("edu_activeTab", activeTab); }, [activeTab]);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedTranscript(true);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  const source = transcript.trim() || textInput.trim();

  const handleGenerateAll = async () => {
    if (!source) return;
    setIsGeneratingAll(true);
    toast({ title: "Genererar allt innehåll...", description: "LinkedIn, artikel och nyhetsbrev skapas parallellt." });

    try {
      const [linkedinRes, articleRes, newsletterRes] = await Promise.allSettled([
        supabase.functions.invoke("generate-linkedin-post", {
          body: { newsContent: source, tone: "professional", length: "medium" },
        }),
        supabase.functions.invoke("generate-article", {
          body: { content: source, format: "blog", length: "medium" },
        }),
        supabase.functions.invoke("generate-newsletter", {
          body: { content: source },
        }),
      ]);

      const results: string[] = [];
      if (linkedinRes.status === "fulfilled" && linkedinRes.value.data?.post) {
        localStorage.setItem("edu_linkedinPost", linkedinRes.value.data.post);
        results.push("LinkedIn");
      }
      if (articleRes.status === "fulfilled" && articleRes.value.data?.article) {
        localStorage.setItem("edu_article", articleRes.value.data.article);
        results.push("Artikel");
      }
      if (newsletterRes.status === "fulfilled" && newsletterRes.value.data?.newsletter) {
        localStorage.setItem("edu_newsletter", newsletterRes.value.data.newsletter);
        results.push("Nyhetsbrev");
      }

      toast({ title: `${results.length} innehållstyper skapade! ⚡`, description: results.join(", ") });
      if (results.length > 0) setActiveTab("linkedin");
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Auto-generering misslyckades.", variant: "destructive" });
    } finally {
      setIsGeneratingAll(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Header */}
      <header className="hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0zMCAwdjYwTTAgMzBoNjAiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI2cpIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIi8+PC9zdmc+')] opacity-50" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex items-center gap-4 sm:gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-foreground/10 backdrop-blur-sm border border-primary-foreground/10">
              <Briefcase className="h-7 w-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary-foreground font-['Playfair_Display',serif]">
                Wesslau Content Studio
              </h1>
              <p className="text-sm sm:text-base text-primary-foreground/60 mt-1 font-light">
                Skapa professionellt innehåll från ditt källmaterial
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12 space-y-8 sm:space-y-10">

        {/* Step 1: Content Input */}
        <section className="animate-fade-in">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-md">1</div>
            <div>
              <h2 className="text-xl font-semibold text-foreground font-['Inter',sans-serif]">Lägg till innehåll</h2>
              <p className="text-sm text-muted-foreground">Ladda upp, spela in eller klistra in ditt källmaterial</p>
            </div>
          </div>
          <ContentInput
            transcript={transcript}
            setTranscript={setTranscript}
            transcriptNote={transcriptNote}
            setTranscriptNote={setTranscriptNote}
            textInput={textInput}
            setTextInput={setTextInput}
            isConvertingPptx={isConvertingPptx}
            setIsConvertingPptx={setIsConvertingPptx}
          />
        </section>

        {/* Transcript result */}
        {transcript && (
          <section className="animate-fade-in">
            <Card className="card-premium overflow-hidden">
              <CardHeader className="border-b border-border/50 bg-muted/30">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3 text-lg">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    Transkribering
                    {transcriptNote && <span className="text-xs font-normal text-muted-foreground ml-1 bg-muted px-2 py-0.5 rounded-full">({transcriptNote})</span>}
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => handleCopy(transcript)} className="shadow-sm">
                    {copiedTranscript ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
                    {copiedTranscript ? "Kopierat" : "Kopiera"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <Textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  className="min-h-[200px] text-sm border-border/50"
                />
              </CardContent>
            </Card>
          </section>
        )}

        {/* Auto-generate button */}
        {source && (
          <section className="flex justify-center animate-fade-in">
            <Button
              onClick={handleGenerateAll}
              disabled={isGeneratingAll}
              className="px-10 py-7 text-base gap-3 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
            >
              {isGeneratingAll ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
              {isGeneratingAll ? "Genererar allt..." : "Generera LinkedIn + Artikel + Nyhetsbrev"}
            </Button>
          </section>
        )}

        {/* Step 2: Content Creation */}
        <section className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-md">2</div>
            <div>
              <h2 className="text-xl font-semibold text-foreground font-['Inter',sans-serif]">Skapa innehåll</h2>
              <p className="text-sm text-muted-foreground">Välj format och generera med AI</p>
            </div>
          </div>
          <Card className="card-premium overflow-hidden">
            <CardContent className="p-0">
              {!source && (
                <div className="px-6 pt-5 pb-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-accent/60" />
                    Lägg till innehåll i steg 1 för att aktivera generering
                  </p>
                </div>
              )}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="px-4 pt-4 sm:px-6 sm:pt-5">
                  <TabsList className="w-full flex flex-wrap h-auto gap-1.5 bg-muted/50 p-1.5 rounded-xl">
                    <TabsTrigger value="presentation" className="flex-1 min-w-[80px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <Presentation className="h-4 w-4" />
                      <span className="hidden sm:inline">Presentation</span>
                      <span className="sm:hidden">PPT</span>
                    </TabsTrigger>
                    <TabsTrigger value="linkedin" className="flex-1 min-w-[80px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <Linkedin className="h-4 w-4" />
                      LinkedIn
                    </TabsTrigger>
                    <TabsTrigger value="article" className="flex-1 min-w-[80px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <FileText className="h-4 w-4" />
                      Artikel
                    </TabsTrigger>
                    <TabsTrigger value="newsletter" className="flex-1 min-w-[80px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <Mail className="h-4 w-4" />
                      <span className="hidden sm:inline">Nyhetsbrev</span>
                      <span className="sm:hidden">Brev</span>
                    </TabsTrigger>
                    <TabsTrigger value="meeting" className="flex-1 min-w-[80px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <ClipboardList className="h-4 w-4" />
                      Möte
                    </TabsTrigger>
                    <TabsTrigger value="personal-message" className="flex-1 min-w-[80px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <MessageSquare className="h-4 w-4" />
                      <span className="hidden sm:inline">Personligt</span>
                      <span className="sm:hidden">DM</span>
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="p-4 sm:p-6">
                  <TabsContent value="presentation" className="mt-0">
                    <PresentationTab source={source} />
                  </TabsContent>
                  <TabsContent value="linkedin" className="mt-0">
                    <LinkedInTab source={source} />
                  </TabsContent>
                  <TabsContent value="article" className="mt-0">
                    <ArticleTab source={source} />
                  </TabsContent>
                  <TabsContent value="newsletter" className="mt-0">
                    <NewsletterTab source={source} />
                  </TabsContent>
                  <TabsContent value="meeting" className="mt-0">
                    <MeetingNotesTab source={source} />
                  </TabsContent>
                  <TabsContent value="personal-message" className="mt-0">
                    <PersonalMessageTab source={source} />
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </section>

        {/* Step 3: Tools */}
        <section className="animate-fade-in" style={{ animationDelay: "0.2s" }}>
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-md">3</div>
            <div>
              <h2 className="text-xl font-semibold text-foreground font-['Inter',sans-serif]">Verktyg</h2>
              <p className="text-sm text-muted-foreground">Nyhetsbevakning och LinkedIn-prospektering</p>
            </div>
          </div>
          <Card className="card-premium overflow-hidden">
            <CardContent className="p-0">
              <Tabs defaultValue="news">
                <div className="px-4 pt-4 sm:px-6 sm:pt-5">
                  <TabsList className="w-full flex flex-wrap h-auto gap-1.5 bg-muted/50 p-1.5 rounded-xl">
                    <TabsTrigger value="news" className="flex-1 min-w-[130px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <Newspaper className="h-4 w-4" />
                      Nyhetsbevakning
                    </TabsTrigger>
                    <TabsTrigger value="prospecting" className="flex-1 min-w-[130px] gap-2 text-xs sm:text-sm rounded-lg py-2.5 data-[state=active]:shadow-md transition-all">
                      <UserSearch className="h-4 w-4" />
                      Prospektering
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="p-4 sm:p-6">
                  <TabsContent value="news" className="mt-0">
                    <NewsMonitorTab />
                  </TabsContent>
                  <TabsContent value="prospecting" className="mt-0">
                    <ProspectingTab />
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </section>

        {/* Footer */}
        <footer className="text-center py-8 border-t border-border/50">
          <p className="text-xs text-muted-foreground/60 tracking-wide uppercase">Wesslau Content Studio — Powered by AI</p>
        </footer>
      </main>
    </div>
  );
};

export default Index;
