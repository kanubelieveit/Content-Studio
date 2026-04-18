import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const formatPrompts: Record<string, string> = {
  blog: "Skriv ett blogginlägg på 600-1000 ord. Använd en engagerande rubrik, underrubriker och en tydlig struktur med inledning, huvuddel och avslutning.",
  article: "Skriv en längre, djupgående artikel på 1500-2500 ord. Inkludera analys, bakgrund, praktiska konsekvenser och expertkommentarer. Använd professionell ton.",
  summary: "Skriv en kort sammanfattning på 200-400 ord. Fokusera på de viktigaste punkterna och praktiska implikationerna.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, format, length, instructions } = await req.json();
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

    const formatInstruction = formatPrompts[format] || formatPrompts.blog;
    const lengthGuide = length === "short" ? "Håll texten kort: 200–500 ord." : length === "long" ? "Skriv en utförlig text: 1000–2500 ord." : "Skriv en text på 500–1000 ord.";

    const systemPrompt = `Du är en expert på att skriva praktiskt inriktade artiklar och blogginlägg på svenska, riktade till byggnadsentreprenörer och verksamma i byggbranschen. Du skriver för en advokatbyrå som vill nå och hjälpa byggare — inte jurister.

KRITISKT VIKTIGT: Använd ENBART information från det tillhandahållna innehållet. Hitta ALDRIG PÅ egna fakta.

${formatInstruction}

${lengthGuide}

Riktlinjer:
- Skriv på korrekt svenska med en professionell men jordnära ton som byggentreprenörer uppskattar
- Förklara juridiska begrepp och lagrum i klartext — läsaren är byggare, inte jurist
- Fokusera på PRAKTISKA konsekvenser: vad innebär det här i byggprojektets vardag?
- Inkludera konkreta råd: "Gör så här", "Se till att", "Undvik detta"
- Använd exempel från byggbranschen (entreprenadjuridik, AB 04/ABT 06, besiktningar, ÄTA-arbeten etc.)
- Formatera med Markdown (rubriker, punktlistor, fetstil)
- Avsluta med en sammanfattning och konkreta steg läsaren kan ta${instructions ? `\n\nANVÄNDARENS SPECIFIKA INSTRUKTIONER (prioritera dessa):\n${instructions}` : ""}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            { role: "user", parts: [{ text: `Skriv en artikel baserad på följande innehåll:\n\n${content.slice(0, 40000)}` }] },
          ],
          generationConfig: { maxOutputTokens: 16384 },
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
    const article = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!article.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "AI returnerade tomt svar." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, article: article.trim() }),
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
