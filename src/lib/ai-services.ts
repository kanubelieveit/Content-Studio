const SYSTEM_PROMPT = `Du är en expert på att skapa originalt utbildningsmaterial för entreprenadjurister och jurister inom entreprenadbranschen. Du omvandlar föreläsningsinnehåll till eget pedagogiskt material som inte bryter mot upphovsrätt — du skapar ny text som förmedlar samma kunskap på ett nytt sätt.

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
      "quoteSource": "Källa, t.ex. ABT 06 kap 5 § 1",
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
- Se till att JSON är komplett med stängda klamrar`;

export async function generatePresentation(transcript: string, instructions?: string): Promise<any> {
  const systemWithInstructions = instructions
    ? `${SYSTEM_PROMPT}\n\nANVÄNDARENS INSTRUKTIONER (prioritera dessa):\n${instructions}`
    : SYSTEM_PROMPT;

  const response = await fetch("/api/anthropic/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 16000,
      system: systemWithInstructions,
      messages: [
        {
          role: "user",
          content: `Omvandla följande transkript till en utbildningspresentation. Använd ENBART information från transkriptet:\n\n${transcript.slice(0, 40000)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API-fel: ${response.status} ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";

  // Parse JSON from response
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const jsonStart = cleaned.indexOf("{");
  if (jsonStart === -1) throw new Error("Inget JSON i svaret");
  cleaned = cleaned.substring(jsonStart).replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

  try {
    return JSON.parse(cleaned);
  } catch {
    // Auto-close incomplete JSON
    let open = 0, openBr = 0, inStr = false, esc = false;
    for (const ch of cleaned) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") open++;
      if (ch === "}") open--;
      if (ch === "[") openBr++;
      if (ch === "]") openBr--;
    }
    cleaned = cleaned.replace(/,\s*$/, "");
    for (let i = 0; i < openBr; i++) cleaned += "]";
    for (let i = 0; i < open; i++) cleaned += "}";
    return JSON.parse(cleaned);
  }
}

export async function transcribeAudio(audioBlob: Blob, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", audioBlob, filename);
  formData.append("model_id", "scribe_v1");
  formData.append("language_code", "swe");

  const response = await fetch("/api/elevenlabs/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": import.meta.env.VITE_ELEVENLABS_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs STT-fel: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.text || "";
}

export async function textToSpeech(text: string, voiceId: string): Promise<Blob> {
  const response = await fetch(`/api/elevenlabs/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": import.meta.env.VITE_ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: text.trim().replace(/\bAB\s*06\b/g, "ABT 06"),
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!response.ok) throw new Error(`ElevenLabs TTS-fel: ${response.status}`);
  return response.blob();
}
