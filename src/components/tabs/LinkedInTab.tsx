import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Check, Linkedin } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface LinkedInTabProps {
  source: string;
}

const tones = [
  { value: "professional", label: "Professionellt inlägg" },
  { value: "simple", label: "Enkelt & begripligt (byggare)" },
  { value: "casual", label: "Personligt & tillgängligt inlägg" },
  { value: "thought_leader", label: "Tankeledare-inlägg" },
  { value: "educational", label: "Pedagogiskt inlägg" },
  { value: "dm_personal", label: "DM — Personligt meddelande" },
  { value: "dm_followup", label: "DM — Uppföljning" },
  { value: "dm_prospecting", label: "DM — Prospektering / kall kontakt" },
];

const lengths = [
  { value: "short", label: "Kort (< 500 tecken)" },
  { value: "medium", label: "Medium (500–1000 tecken)" },
  { value: "long", label: "Långt (1000–1500 tecken)" },
];

export function LinkedInTab({ source }: LinkedInTabProps) {
  const { toast } = useToast();
  const [tone, setTone] = useState("professional");
  const [length, setLength] = useState("medium");
  const [instructions, setInstructions] = useState(() => localStorage.getItem("edu_linkedinInstructions") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [post, setPost] = useState(() => localStorage.getItem("edu_linkedinPost") || "");
  const [copied, setCopied] = useState(false);

  useEffect(() => { localStorage.setItem("edu_linkedinPost", post); }, [post]);
  useEffect(() => { localStorage.setItem("edu_linkedinInstructions", instructions); }, [instructions]);

  const handleGenerate = async () => {
    if (!source) return;
    setIsGenerating(true);
    setPost("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-linkedin-post", {
        body: { newsContent: source, tone, length, instructions: instructions.trim() || undefined },
      });
      if (error) throw error;
      if (data?.post) {
        setPost(data.post);
        toast({ title: "LinkedIn-inlägg skapat! 💼" });
      } else {
        toast({ title: "Fel", description: data?.error || "Kunde inte generera inlägget.", variant: "destructive" });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera LinkedIn-inlägget.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(post);
    setCopied(true);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inställningar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Ton</label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {tones.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
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
              placeholder="T.ex: Fokusera på GDPR-aspekten, nämn min byrå Wesslau, rikta mot tech-bolag..."
              className="min-h-[80px] text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={handleGenerate} disabled={isGenerating || !source} className="px-8">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Linkedin className="h-5 w-5 mr-2" />}
          {isGenerating ? "Genererar..." : post ? "Generera nytt inlägg" : "Skapa LinkedIn-inlägg"}
        </Button>
      </div>

      {post && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Linkedin className="h-5 w-5 text-primary" />
                LinkedIn-inlägg
              </CardTitle>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? "Kopierat" : "Kopiera"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/30 rounded-xl p-6 border border-border">
              <Textarea
                value={post}
                onChange={(e) => setPost(e.target.value)}
                className="min-h-[200px] text-sm font-sans leading-relaxed border-0 bg-transparent p-0 focus-visible:ring-0 resize-none"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3">{post.length} tecken</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
