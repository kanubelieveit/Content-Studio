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
    const { transcript } = await req.json();
    if (!transcript || typeof transcript !== "string" || transcript.trim().length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: "Transkriptet är för kort för att skapa mötesanteckningar." }),
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

    const systemPrompt = `Du är en expert på att sammanställa mötesprotokoll och minnesanteckningar från transkript på svenska. Kontexten är byggbranschen — mötena handlar typiskt om byggprojekt, entreprenader, besiktningar och liknande.

KRITISKT VIKTIGT: Använd ENBART information från transkriptet. Hitta ALDRIG PÅ egna fakta, namn, beslut eller detaljer.

Skapa ett strukturerat mötesprotokoll/minnesanteckning i Markdown-format med följande struktur:

# Mötesprotokoll / Minnesanteckning

**Datum:** [Om det framgår av transkriptet, annars "Ej angivet"]
**Deltagare:** [Lista namn som nämns i transkriptet]
**Mötesledare/Intervjuare:** [Om det framgår]

## Sammanfattning
[2-4 meningar som sammanfattar mötets/samtalets syfte och huvudsakliga innehåll]

## Diskuterade ämnen

### [Ämne 1]
- Vad som diskuterades
- Viktiga synpunkter och argument som framfördes
- Vilken/vilka som sa vad (om det framgår)

### [Ämne 2]
[...]

## Beslut och överenskommelser
- [Lista konkreta beslut som fattades]
- [Överenskommelser som gjordes]

## Åtgärdspunkter
- [ ] [Åtgärd] — Ansvarig: [Person] (om det framgår)

## Viktiga citat och uttalanden
> [Direkta citat eller nyckeluttalanden som är särskilt viktiga]

## Övriga noteringar
[Eventuella observationer, oklarheter eller frågor som bör följas upp]

Riktlinjer:
- Var saklig och neutral i tonen
- Inkludera alla viktiga detaljer som namn, datum, lagrum, belopp etc. exakt som de nämns
- Om det är ett klientmöte eller vittnesförhör, var extra noggrann med att återge uttalanden korrekt
- Markera tydligt om något är oklart i transkriptet
- Skriv på korrekt svenska med juridisk/professionell ton`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            { role: "user", parts: [{ text: `Skapa ett mötesprotokoll/minnesanteckning baserat på följande transkript. Använd ENBART information från transkriptet:\n\n${transcript.slice(0, 40000)}` }] },
          ],
          generationConfig: { maxOutputTokens: 8192 },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "För många förfrågningar. Vänta en stund och försök igen." }),
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
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!content || content.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "AI returnerade tomt svar. Försök igen." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, meetingNotes: content.trim() }),
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
