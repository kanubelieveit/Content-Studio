import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, instructions } = await req.json();
    if (!content || typeof content !== "string" || content.trim().length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: "Innehållet är för kort." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Google Gemini API-nyckel saknas." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `Du är en expert på att skriva praktiskt inriktade nyhetsbrev riktade till byggnadsentreprenörer och verksamma i byggbranschen. Du skriver för en advokatbyrå som vill nå byggare med relevant, användbar information — inte juridisk teori.

KRITISKT VIKTIGT: Använd ENBART information från det tillhandahållna innehållet. Hitta ALDRIG PÅ egna fakta.

Skapa ett strukturerat nyhetsbrev i Markdown-format med:

# [Engagerande rubrik som en byggentreprenör vill klicka på]

## Det här behöver du veta
[2-3 meningar som sammanfattar vad som är nytt och varför det spelar roll för dig som byggare]

## [Huvudämne 1 — formulerat från byggarens perspektiv]
[Förklara vad det innebär i praktiken för den som driver byggprojekt. Konkreta exempel.]

## [Huvudämne 2]
[...]

## Praktiska tips för dig som entreprenör
- [Konkreta saker att göra eller tänka på i nästa projekt]
- [Risker att undvika]

## Behöver du hjälp?
[Kort, jordnära avslutning — vi hjälper byggare med just den här typen av frågor]

Riktlinjer:
- Jordnära, praktisk ton — skriv som om du pratar med en erfaren byggentreprenör
- Fokusera på vad det BETYDER I PRAKTIKEN, inte juridisk teori
- Förklara lagrum och begrepp i klartext
- Håll det koncist — max 800 ord
- Använd exempel från entreprenadvärlden (AB 04, ABT 06, besiktningar, ÄTA, garantitider etc.)
- Skriv på korrekt svenska${instructions ? `\n\nANVÄNDARENS SPECIFIKA INSTRUKTIONER (prioritera dessa):\n${instructions}` : ""}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            { role: "user", parts: [{ text: `Skapa ett nyhetsbrev baserat på följande innehåll:\n\n${content.slice(0, 40000)}` }] },
          ],
          generationConfig: { maxOutputTokens: 8192 },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "För många förfrågningar. Vänta en stund." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: "AI-generering misslyckades." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const newsletter = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!newsletter.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "AI returnerade tomt svar." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, newsletter: newsletter.trim() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Okänt fel" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
