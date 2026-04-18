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
    const { transcript, instructions } = await req.json();
    if (!transcript || typeof transcript !== "string" || transcript.trim().length < 50) {
      return new Response(
        JSON.stringify({ success: false, error: "Transkriptet är för kort för att skapa en presentation." }),
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

const systemPrompt = `Du är en expert på att skapa originalt utbildningsmaterial för entreprenadjurister och jurister inom entreprenadbranschen. Du omvandlar föreläsningsinnehåll till eget pedagogiskt material som inte bryter mot upphovsrätt — du skapar ny text som förmedlar samma kunskap på ett nytt sätt.

KRITISKT VIKTIGT — INNEHÅLL:
- Använd ENBART information som finns i transkriptet. Hitta ALDRIG på egna fakta, exempel, rättsfall eller påståenden.
- Ta INTE bort eller förändra något innehåll från transkriptet — allt som sägs ska finnas med.
- Omformulera med egna ord så att texten inte är ordagrann kopia, men förmedla exakt samma budskap, samma exempel, samma slutsatser som talaren.
- Lagrum, rättsfall, namn och siffror ska återges exakt som i transkriptet — dessa får aldrig ändras.

TALARMANUS: Skapa väldigt utförliga talarmanus för varje slide. Talarmanuset ska:
- Täcka ALLT väsentligt innehåll från transkriptet för det aktuella avsnittet — inget får utelämnas
- Återge talarens resonemang, exempel och slutsatser — omformulerat men innehållsmässigt identiskt
- Inkludera alla lagrum, rättsfall och doktrinhänvisningar som nämns
- Formuleras som ett sammanhängande föreläsningsmanus i naturligt talspråk utan förkortningar
- Vara tillräckligt utförligt för att en annan jurist ska kunna hålla exakt samma föreläsning

Tillgängliga layouttyper (välj lämplig per slide):
- "content" — rubrik + punktlista (standard innehållsslide)
- "section" — delseparator med stor rubrik (inför nytt avsnitt)
- "quote" — citatslide för lagtext, domslut eller viktiga citat
- "closing" — avslutning (reserveras för sista sliden)

Returnera EXAKT ett JSON-objekt (ingen markdown, inga kodblock):
{
  "title": "Presentation om [ämne]",
  "subtitle": "Entreprenadjuristens perspektiv",
  "slides": [
    {
      "layoutType": "section",
      "title": "Del 1: Grundläggande begrepp",
      "speakerNotes": "Välkomna. I den här delen..."
    },
    {
      "layoutType": "content",
      "title": "Slide-titel",
      "bullets": ["Juridisk punkt 1", "Punkt 2", "Punkt 3"],
      "speakerNotes": "Utförligt talarmanus redo för röstinspelning..."
    },
    {
      "layoutType": "quote",
      "quoteText": "Lagtexten eller det viktiga citatet",
      "quoteSource": "Källa, t.ex. AB 04 kap 5 § 1",
      "speakerNotes": "Förklaring av citatet..."
    }
  ]
}

Riktlinjer:
- 12-25 slides beroende på innehållets omfattning
- Börja med en "section"-slide som ger en innehållsöversikt
- Max 4-5 bullets per "content"-slide — dela upp vid mer innehåll
- Använd "section"-slides för att markera tydliga avsnittsskiften
- Använd "quote"-slides sparsamt för viktiga lagrum eller domslut
- Avsluta med en sammanfattnings-"content"-slide
- Talarmanus ska vara på naturligt talspråk, redo att läsas upp
- Se till att JSON är komplett med stängda klamrar${instructions ? `\n\nANVÄNDARENS INSTRUKTIONER (prioritera dessa):\n${instructions}` : ""}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            { role: "user", parts: [{ text: `Omvandla följande transkript till en utbildningspresentation. Använd ENBART information från transkriptet, hitta inte på något:\n\n${transcript.slice(0, 40000)}` }] },
          ],
          generationConfig: {
            maxOutputTokens: 65536,
            responseMimeType: "application/json",
          },
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
    console.log("Gemini finish_reason:", data.candidates?.[0]?.finishReason);
    
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Gemini content length:", content.length, "preview:", content.slice(0, 200));
    
    if (!content || content.trim().length === 0) {
      console.error("Empty Gemini response:", JSON.stringify(data).slice(0, 1000));
      return new Response(
        JSON.stringify({ success: false, error: "AI returnerade tomt svar. Försök igen." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON from the response
    let presentation;
    try {
      let cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      
      const jsonStart = cleaned.indexOf("{");
      if (jsonStart === -1) throw new Error("No JSON found in: " + cleaned.slice(0, 300));
      cleaned = cleaned.substring(jsonStart);

      cleaned = cleaned
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/[\x00-\x1F\x7F]/g, (ch) => ch === "\n" || ch === "\t" ? ch : "");

      try {
        presentation = JSON.parse(cleaned);
      } catch {
        // Truncation repair: find the last complete slide object
        // Strategy: find last complete "}" that closes a slide, trim there, close arrays/objects
        const lastCompleteSlide = cleaned.lastIndexOf('"speakerNotes"');
        if (lastCompleteSlide > 0) {
          // Find the closing brace of the slide object before this incomplete one
          const searchArea = cleaned.substring(0, lastCompleteSlide);
          const lastClosingBrace = searchArea.lastIndexOf("}");
          if (lastClosingBrace > 0) {
            // Trim to last complete slide, remove trailing comma, close slides array and root object
            let trimmed = cleaned.substring(0, lastClosingBrace + 1);
            trimmed = trimmed.replace(/,\s*$/, "");
            // Count remaining open brackets/braces
            let openBraces = 0, openBrackets = 0;
            let inStr = false, esc = false;
            for (const ch of trimmed) {
              if (esc) { esc = false; continue; }
              if (ch === "\\") { esc = true; continue; }
              if (ch === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (ch === "{") openBraces++;
              if (ch === "}") openBraces--;
              if (ch === "[") openBrackets++;
              if (ch === "]") openBrackets--;
            }
            for (let i = 0; i < openBrackets; i++) trimmed += "]";
            for (let i = 0; i < openBraces; i++) trimmed += "}";
            try {
              presentation = JSON.parse(trimmed);
              console.log("Recovered truncated JSON, slides:", presentation.slides?.length);
            } catch { /* fall through to generic repair */ }
          }
        }

        if (!presentation) {
          // Generic repair: close open strings/brackets/braces
          let openBraces = 0, openBrackets = 0;
          let inString = false, escape = false;
          for (const ch of cleaned) {
            if (escape) { escape = false; continue; }
            if (ch === "\\") { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === "{") openBraces++;
            if (ch === "}") openBraces--;
            if (ch === "[") openBrackets++;
            if (ch === "]") openBrackets--;
          }
          if (inString) cleaned += '"';
          cleaned = cleaned.replace(/,\s*$/, "");
          for (let i = 0; i < openBrackets; i++) cleaned += "]";
          for (let i = 0; i < openBraces; i++) cleaned += "}";

          try {
            presentation = JSON.parse(cleaned);
          } catch (finalErr) {
            console.error("Failed to parse presentation JSON after repair:", finalErr, "Content:", content.slice(0, 500));
            return new Response(
              JSON.stringify({ success: false, error: "AI-svaret var ofullständigt. Försök igen." }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }
    } catch (parseErr) {
      console.error("Failed to parse presentation JSON:", parseErr, "Content:", content.slice(0, 500));
      return new Response(
        JSON.stringify({ success: false, error: "Kunde inte tolka AI-svaret. Försök igen." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, presentation }),
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
