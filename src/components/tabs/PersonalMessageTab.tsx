import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Check, MessageSquare, Mail, Linkedin } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface PersonalMessageTabProps {
  source: string;
}

const channels = [
  { value: "linkedin_dm", label: "LinkedIn DM", icon: Linkedin },
  { value: "email_short", label: "Kort personligt mejl", icon: Mail },
  { value: "email_formal", label: "Formellt mejl", icon: Mail },
];

const styles = [
  { value: "warm", label: "Varm & personlig" },
  { value: "direct", label: "Rak & direkt" },
  { value: "curious", label: "Nyfiken & frågande" },
  { value: "value_first", label: "Värde först" },
];

export function PersonalMessageTab({ source }: PersonalMessageTabProps) {
  const { toast } = useToast();
  const [channel, setChannel] = useState("linkedin_dm");
  const [style, setStyle] = useState("warm");
  const [instructions, setInstructions] = useState(() => localStorage.getItem("edu_personalMsgInstructions") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState(() => localStorage.getItem("edu_personalMsg") || "");
  const [copied, setCopied] = useState(false);

  useEffect(() => { localStorage.setItem("edu_personalMsg", message); }, [message]);
  useEffect(() => { localStorage.setItem("edu_personalMsgInstructions", instructions); }, [instructions]);

  const handleGenerate = async () => {
    if (!source) return;
    setIsGenerating(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("generate-personal-message", {
        body: { content: source, channel, style, instructions: instructions.trim() || undefined },
      });
      if (error) throw error;
      if (data?.message) {
        setMessage(data.message);
        toast({ title: "Meddelande skapat! ✉️" });
      } else {
        toast({ title: "Fel", description: data?.error || "Kunde inte generera meddelandet.", variant: "destructive" });
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Fel", description: "Kunde inte generera meddelandet.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    toast({ title: "Kopierat!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const currentChannel = channels.find(c => c.value === channel);
  const ChannelIcon = currentChannel?.icon || MessageSquare;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inställningar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Kanal</label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {channels.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Stil</label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {styles.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Specifika instruktioner <span className="text-muted-foreground font-normal">(valfritt)</span></label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="T.ex: Nämn vår nya guide om AB 04, rikta mot byggkonsulter, håll det extra kort..."
              className="min-h-[80px] text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={handleGenerate} disabled={isGenerating || !source} className="px-8">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <MessageSquare className="h-5 w-5 mr-2" />}
          {isGenerating ? "Genererar..." : message ? "Generera nytt meddelande" : "Skapa personligt meddelande"}
        </Button>
      </div>

      {message && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ChannelIcon className="h-5 w-5 text-primary" />
                {currentChannel?.label || "Meddelande"}
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
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-[200px] text-sm font-sans leading-relaxed border-0 bg-transparent p-0 focus-visible:ring-0 resize-none"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3">{message.length} tecken</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
