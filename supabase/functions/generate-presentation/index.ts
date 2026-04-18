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

const systemPrompt = `Du är en expert på att omvandla transkript till praktiskt inriktade presentationer på svenska, riktade till byggnadsentreprenörer och verksamma i byggbranschen. Publiken är byggare och projektledare — inte jurister.

KRITISKT VIKTIGT: Du ska ENBART använda information som finns i transkriptet. Hitta ALDRIG PÅ egna fakta, exempel eller påståenden. Allt innehåll i slides och talarmanus MÅSTE komma direkt från transkriptet.

VIKTIGT OM TALARMANUS: Skapa alltid VÄLDIGT UTFÖRLIGA talarmanus. Användaren vill helre börja med mycket detaljer och själv skala ned efter behov. Talarmanuset ska innehålla:
- Alla viktiga detaljer från transkriptet
- Kompletterande förklaringar och kontext
- Konkreta exempel som nämns i transkriptet
- Praktiska konsekvenser och åtgärder
- Fullständiga formuleringar, inte korta stolpar

Returnera EXAKT ett JSON-objekt (ingen markdown, inga kodblock) med denna struktur:
{
  "title": "Titel baserad på transkriptets ämne",
  "slides": [
    {
      "title": "Slide-titel",
      "bullets": ["Punkt från transkriptet", "Punkt 2", "Punkt 3"],
      "speakerNotes": "UTFÖRLIGT talermanus med alla detaljer, exempel och förklaringar från transkriptet."
    }
  ]
}

Riktlinjer:
- Skapa 10-20+ slides beroende på transkriptets längd
- **Max 4-5 bullet points per slide** — om det finns mer information, dela upp på fler slides
- Talarmanuset ska återge talarens poänger, förklaringar och exempel — inte dina egna
- Behåll facktermer, namn, lagrum och specifika detaljer exakt som de nämns
- Strukturera innehållet i en logisk ordning som följer transkriptets upplägg
- Första sliden: titelsida med ämnet
- Sista sliden: sammanfattning av de viktigaste punkterna från transkriptet
- Om talaren ger konkreta exempel eller hänvisar till specifika fall — inkludera dem ordagrant
- Skriv talarmanuset som instruktioner till en person som ska hålla samma presentation, med talarens egna formuleringar och argument
- Formulera bullet points och titlar så att byggentreprenörer förstår dem direkt — undvik onödig juridisk jargong
- Lyft fram praktiska konsekvenser: vad ska byggaren GÖRA annorlunda?
- Se till att JSON-objektet är komplett och korrekt formaterat. Avsluta ALLTID med stängda klamrar.${instructions ? `\n\nANVÄNDARENS SPECIFIKA INSTRUKTIONER (prioritera dessa):\n${instructions}` : ""}`;

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
