import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const channelPrompts: Record<string, string> = {
  linkedin_dm: `Du skriver korta, personliga LinkedIn-direktmeddelanden baserade på marknadsföringsmaterial.
Tonen ska vara varm, genuin och inte säljig. Skriv som ett naturligt DM, inte som ett inlägg.
Max 3-5 meningar. Avsluta med en mjuk fråga eller öppning för dialog.`,

  email_short: `Du skriver korta, personliga mejl baserade på marknadsföringsmaterial.
Tonen ska vara personlig men professionell. Inkludera en tydlig ämnesrad.
Max 3-5 meningar i mejlkroppen. Avsluta med en enkel call-to-action.
Format: Börja med "Ämne: [ämnesrad]" på första raden, sedan en tom rad, sedan mejlkroppen.`,

  email_formal: `Du skriver professionella mejl baserade på marknadsföringsmaterial.
Tonen ska vara formell men tillgänglig. Inkludera en tydlig ämnesrad.
Strukturera med hälsningsfras, 2-3 korta stycken och ett professionellt avslut.
Format: Börja med "Ämne: [ämnesrad]" på första raden, sedan en tom rad, sedan mejlkroppen.`,
};

const stylePrompts: Record<string, string> = {
  warm: "Tonen ska vara varm och personlig, som om du skriver till någon du redan har en relation med.",
  direct: "Tonen ska vara rak och direkt, gå rakt på sak utan onödig inledning.",
  curious: "Tonen ska vara nyfiken och ställa relevanta frågor som visar genuint intresse för mottagarens verksamhet.",
  value_first: "Börja med att erbjuda konkret värde eller en insikt innan du nämner något om dig själv eller din tjänst.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { content, channel, style, instructions } = await req.json();

    if (!content) {
      return new Response(
        JSON.stringify({ error: "content is required" }),
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

    const selectedChannel = channelPrompts[channel] || channelPrompts.linkedin_dm;
    const selectedStyle = stylePrompts[style] || stylePrompts.warm;

    const systemPrompt = `${selectedChannel}

${selectedStyle}

Du omvandlar marknadsföringsmaterial till korta, personliga meddelanden riktade till byggnadsentreprenörer och praktiskt verksamma i byggbranschen.

Regler:
- Skriv ALLTID på svenska
- Fokusera på PRAKTISKA konsekvenser — vad innebär det här för mottagaren?
- Undvik juridisk jargong — skriv som en kunnig rådgivare, inte som en jurist
- Meddelandet ska kännas personligt och relevant, inte som massutskick
- Använd aldrig "Hej [namn]" eller platshållare — börja direkt med innehållet
- Var konkret och specifik, undvik generella fraser${instructions ? `\n\nANVÄNDARENS SPECIFIKA INSTRUKTIONER (prioritera dessa):\n${instructions}` : ""}`;

    const userPrompt = `Omvandla följande marknadsföringsmaterial till ett kort, personligt meddelande:\n\n${content}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
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
    const message = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return new Response(JSON.stringify({ message }), {
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
