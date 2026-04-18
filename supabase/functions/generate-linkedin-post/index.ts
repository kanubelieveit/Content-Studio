import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const tonePrompts: Record<string, string> = {
  professional: `Du skriver LinkedIn-inlägg med en professionell men jordnära ton, riktade till praktiskt verksamma byggnadsentreprenörer. 
    Fokusera på konkreta, praktiska konsekvenser — inte juridisk teori. 
    Förklara vad regler och nyheter innebär i vardagen på bygget, för den som driver projekt och anställer hantverkare.`,
  simple: `Du skriver LinkedIn-inlägg med enkel, rak och begriplig svenska riktad till byggnadsentreprenörer och byggkonsulter.
    Undvik krångliga ord och juridisk jargong helt. Använd vardagligt språk som på bygget.
    Förklara som om du pratar med en erfaren byggare över en kaffe — tydligt, utan fluff, rakt på sak.
    Fokusera på vad de behöver veta och göra, inte på teori eller lagparagrafer.`,
  casual: `Du skriver LinkedIn-inlägg med en lättsam, tillgänglig ton riktade till byggnadsentreprenörer. 
    Undvik juridisk jargong helt. Prata som en kunnig rådgivare som förstår byggarens vardag. 
    Använd konkreta exempel från byggbranschen.`,
  thought_leader: `Du skriver LinkedIn-inlägg som en insiktsfull rådgivare för byggbranschen. 
    Ta ställning i frågor som påverkar entreprenörer, ställ frågor som byggar känner igen sig i. 
    Visa på trender och risker som påverkar byggprojekt och entreprenader.`,
  educational: `Du skriver LinkedIn-inlägg med ett pedagogiskt syfte riktat till byggnadsentreprenörer. 
    Förklara juridiska nyheter och regler så att den som driver byggprojekt förstår — utan juridisk bakgrund. 
    Använd konkreta exempel från bygg- och entreprenadvärlden.`,
  dm_personal: `Du skriver korta, personliga LinkedIn-direktmeddelanden (DM) till byggnadsentreprenörer.
    Tonen ska vara varm, genuin och inte säljig. Referera till mottagarens arbete eller branschnyhet.
    Max 3-4 meningar. Avsluta med en mjuk fråga eller öppning för dialog.
    Skriv INTE som ett inlägg — detta är ett privat meddelande.`,
  dm_followup: `Du skriver uppföljningsmeddelanden via LinkedIn DM till byggnadsentreprenörer.
    Kontexten kan vara efter ett möte, en offert, en mässa eller en tidigare kontakt.
    Tonen ska vara professionell men personlig. Påminn kort om den tidigare kontakten.
    Max 3-5 meningar. Inkludera ett konkret nästa steg eller förslag.
    Skriv INTE som ett inlägg — detta är ett privat meddelande.`,
  dm_prospecting: `Du skriver första-kontakt-meddelanden (kall outreach) via LinkedIn DM till byggnadsentreprenörer.
    Börja med något relevant om mottagarens verksamhet — visa att du gjort research.
    Undvik säljpitch. Fokusera på att erbjuda värde och starta en dialog.
    Max 4-5 meningar. Avsluta med en enkel, lågtrösklig fråga.
    Skriv INTE som ett inlägg — detta är ett privat meddelande.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { newsContent, tone, length, instructions } = await req.json();

    if (!newsContent) {
      return new Response(
        JSON.stringify({ error: "newsContent is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: "Google Gemini API-nyckel saknas." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const selectedTone = tonePrompts[tone] || tonePrompts.professional;
const lengthGuide = length === "short" ? "Max 500 tecken." : length === "long" ? "1000-1500 tecken. Mer djupgående." : "500-1000 tecken (LinkedIn-optimal längd).";

    const systemPrompt = `${selectedTone}

Du ska skriva om nyheter och ämnen till engagerande LinkedIn-inlägg på svenska, riktade till byggnadsentreprenörer och praktiskt verksamma i byggbranschen.

Regler:
- ${lengthGuide}
- Börja med en hook som en byggentreprenör känner igen sig i — ett vardagsproblem, en risk, en möjlighet
- Inkludera relevanta hashtags (3-5 st, t.ex. #byggbranschen #entreprenad #entreprenadjuridik)
- Avsluta med en fråga eller call-to-action som är relevant för byggare
- Använd radbrytningar för läsbarhet
- Använd emojis sparsamt men effektivt
- Skriv ALLTID på svenska
- Fokusera på PRAKTISKA konsekvenser — vad innebär det här för den som driver byggprojekt?${instructions ? `\n\nANVÄNDARENS SPECIFIKA INSTRUKTIONER (prioritera dessa):\n${instructions}` : ""}`;
    const isDM = tone?.startsWith("dm_");
    const userPrompt = isDM
      ? `Skriv ett kort LinkedIn-direktmeddelande baserat på följande innehåll:\n\n${newsContent}`
      : `Skriv om följande juridiska nyhet till ett LinkedIn-inlägg:\n\n${newsContent}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            { role: "user", parts: [{ text: userPrompt }] },
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Begränsningen nådd, försök igen om en stund." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("Gemini error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI-tjänsten svarade inte korrekt" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const post = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return new Response(JSON.stringify({ post }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
