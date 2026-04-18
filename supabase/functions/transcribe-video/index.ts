import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function transcribeBlob(blob: Blob, filename: string, elevenlabsKey: string): Promise<string> {
  console.log("Transcribing file:", filename, "size:", blob.size, "type:", blob.type);

  if (blob.size > 100 * 1024 * 1024) {
    throw new Error("Filen är för stor (max 100MB)");
  }

  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("model_id", "scribe_v2");
  formData.append("tag_audio_events", "false");
  formData.append("diarize", "true");
  formData.append("language_code", "swe");

  console.log("Sending to ElevenLabs STT...");

  const sttResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": elevenlabsKey,
    },
    body: formData,
  });

  if (!sttResponse.ok) {
    const errText = await sttResponse.text();
    console.error("ElevenLabs STT error:", sttResponse.status, errText);
    throw new Error(`Transkribering misslyckades: ${sttResponse.status}`);
  }

  const result = await sttResponse.json();
  return result.text || "";
}

async function scrapePage(pageUrl: string, firecrawlKey: string, waitFor = 0): Promise<{ html: string; markdown: string; title: string; links: string[] }> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firecrawlKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: pageUrl,
      formats: ["html", "markdown", "links"],
      onlyMainContent: false,
      ...(waitFor > 0 ? { waitFor } : {}),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("Firecrawl error:", data);
    return { html: "", markdown: "", title: "", links: [] };
  }

  return {
    html: data.data?.html || data.html || "",
    markdown: data.data?.markdown || data.markdown || "",
    title: data.data?.metadata?.title || data.metadata?.title || "",
    links: data.data?.links || data.links || [],
  };
}

function extractVideoUrls(html: string, links: string[]): string[] {
  const videoPatterns = [
    /(?:src|href)=["']?(https?:\/\/(?:www\.)?youtube\.com\/(?:embed|watch)[^"'\s>]+)/gi,
    /(?:src|href)=["']?(https?:\/\/youtu\.be\/[^"'\s>]+)/gi,
    /(?:src|href)=["']?(https?:\/\/(?:player\.)?vimeo\.com\/[^"'\s>]+)/gi,
    /(?:src|href)=["']?(https?:\/\/[^"'\s>]+\.(?:mp4|webm|m4v|mov|mp3|m4a|wav|ogg))/gi,
    /<(?:video|source|audio)[^>]+src=["']?(https?:\/\/[^"'\s>]+)/gi,
  ];

  const foundUrls = new Set<string>();
  for (const pattern of videoPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      foundUrls.add(match[1].replace(/["']$/, ""));
    }
  }
  for (const link of links) {
    if (/\.(mp4|webm|m4v|mov|mp3|m4a|wav|ogg)(\?|$)/i.test(link)) {
      foundUrls.add(link);
    }
  }

  return [...foundUrls];
}

async function fetchVimeoTextTracks(videoId: string, pageUrl: string): Promise<string | null> {
  console.log("Fetching Vimeo text tracks for video:", videoId, "referer:", pageUrl);

  // Try multiple referer strategies
  const referers = [pageUrl, `https://player.vimeo.com/video/${videoId}`, "https://vimeo.com/"];
  
  for (const referer of referers) {
    const configUrl = `https://player.vimeo.com/video/${videoId}/config`;
    try {
      const configResp = await fetch(configUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": referer,
          "Origin": new URL(referer).origin,
        },
      });
      if (!configResp.ok) {
        console.log("Vimeo config response with referer", referer, ":", configResp.status);
        await configResp.text(); // consume body
        continue; // try next referer
      }

      const config = await configResp.json();
      console.log("Got Vimeo config, checking for text tracks...");

      const textTracks = config?.request?.text_tracks || [];
      console.log("Text tracks found:", textTracks.length);

      if (textTracks.length === 0) continue;

      // Find the best text track (prefer Swedish, then any)
      const swedishTrack = textTracks.find((t: any) => t.lang === "sv" || t.lang === "swe");
      const track = swedishTrack || textTracks[0];

      if (!track?.url) {
        console.log("No track URL found, track:", JSON.stringify(track));
        continue;
      }

      // Fetch the actual subtitle/caption file
      let trackUrl = track.url;
      if (trackUrl.startsWith("/")) {
        trackUrl = `https://player.vimeo.com${trackUrl}`;
      }

      console.log("Fetching text track from:", trackUrl);
      const trackResp = await fetch(trackUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": referer,
        },
      });

      if (!trackResp.ok) {
        console.log("Text track fetch failed:", trackResp.status);
        await trackResp.text();
        continue;
      }

      const trackContent = await trackResp.text();
      console.log("Text track content length:", trackContent.length);

      // Parse WebVTT / SRT format
      const lines = trackContent.split("\n");
      const textLines: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === "WEBVTT") continue;
        if (trimmed.startsWith("NOTE")) continue;
        if (/^\d+$/.test(trimmed)) continue;
        if (/^\d{2}:\d{2}/.test(trimmed) && trimmed.includes("-->")) continue;
        if (/^Kind:/.test(trimmed) || /^Language:/.test(trimmed)) continue;
        textLines.push(trimmed);
      }

      const transcript = textLines.join(" ").replace(/\s+/g, " ").trim();
      if (transcript.length > 50) {
        console.log("Successfully extracted Vimeo transcript, length:", transcript.length);
        return transcript;
      }
    } catch (err) {
      console.error("Error with referer", referer, ":", err);
      continue;
    }
  }

  return null;
}

function extractVimeoVideoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : null;
}

function extractTranscriptFromHtml(html: string): string | null {
  const transcriptPatterns = [
    /<div[^>]*class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*id="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<section[^>]*class="[^"]*transcript[^"]*"[^>]*>([\s\S]*?)<\/section>/gi,
    /<div[^>]*class="[^"]*captions?[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*subtitles?[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];

  for (const pattern of transcriptPatterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      const text = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length > 100) {
        console.log("Found transcript in HTML, length:", text.length);
        return text;
      }
    }
  }
  return null;
}

async function extractContentWithAI(pageContent: string, geminiKey: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Du är en assistent som extraherar transkript och textinnehåll från webbsidor med utbildningsvideor. Fokusera på att hitta: 1) Videotranskript eller undertexter, 2) Sammanfattningar, 3) Talarpresentationer, 4) Utbildningsmaterial. Om du hittar ett transkript, markera det med '## Transkript'." }] },
        contents: [
          { role: "user", parts: [{ text: `Denna sida innehåller en utbildningsvideo. Extrahera ALLT textinnehåll, särskilt transkript, undertexter och beskrivningar:\n\n${pageContent.slice(0, 50000)}` }] },
        ],
      }),
    }
  );

  if (!response.ok) throw new Error("AI-extraktion misslyckades");
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const elevenlabsKey = Deno.env.get("ELEVENLABS_API_KEY");
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");

    const contentType = req.headers.get("content-type") || "";

    // Handle file upload (multipart form data)
    if (contentType.includes("multipart/form-data")) {
      if (!elevenlabsKey) {
        return new Response(
          JSON.stringify({ success: false, error: "ElevenLabs inte konfigurerat" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const formData = await req.formData();
      const file = formData.get("file") as File;

      if (!file) {
        return new Response(
          JSON.stringify({ success: false, error: "Ingen fil skickad" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("File upload received:", file.name, file.size);
      const transcript = await transcribeBlob(file, file.name, elevenlabsKey);

      return new Response(
        JSON.stringify({ success: true, transcript, source: file.name }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle JSON requests (URL-based)
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: "URL eller fil krävs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http")) {
      targetUrl = `https://${targetUrl}`;
    }

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl inte konfigurerat" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Scanning page for media:", targetUrl);
    const pageData = await scrapePage(targetUrl, firecrawlKey);
    const videoUrls = extractVideoUrls(pageData.html, pageData.links);
    const pageTitle = pageData.title;
    console.log(`Found ${videoUrls.length} media URLs`);

    // First, check if the page contains a transcript directly in HTML
    const htmlTranscript = extractTranscriptFromHtml(pageData.html);
    if (htmlTranscript) {
      console.log("Found transcript directly in page HTML");
      return new Response(
        JSON.stringify({
          success: true,
          pageTitle,
          mediaUrls: videoUrls,
          transcript: htmlTranscript,
          note: "Transkript hittades direkt på sidan.",
          requiresUpload: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for Vimeo embeds and try to fetch transcript via Vimeo's text tracks API
    const vimeoUrls = videoUrls.filter(u => u.includes("vimeo.com") || u.includes("player.vimeo.com"));
    if (vimeoUrls.length > 0) {
      // Extract unique video IDs
      const videoIds = new Set<string>();
      for (const vUrl of vimeoUrls) {
        const id = extractVimeoVideoId(vUrl);
        if (id) videoIds.add(id);
      }

      for (const videoId of videoIds) {
        const vimeoTranscript = await fetchVimeoTextTracks(videoId, targetUrl);
        if (vimeoTranscript) {
          return new Response(
            JSON.stringify({
              success: true,
              pageTitle,
              mediaUrls: videoUrls,
              transcript: vimeoTranscript,
              note: "Transkript hämtades från Vimeos textspår (undertexter).",
              requiresUpload: false,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Try to download and transcribe direct media files
    const directMediaUrls = videoUrls.filter(
      (u) => /\.(mp4|webm|m4v|mov|mp3|m4a|wav|ogg)(\?|$)/i.test(u)
    );

    if (directMediaUrls.length > 0 && elevenlabsKey) {
      for (const mediaUrl of directMediaUrls) {
        try {
          const mediaResponse = await fetch(mediaUrl);
          if (mediaResponse.ok) {
            const blob = await mediaResponse.blob();
            const ext = mediaUrl.split(".").pop()?.split("?")[0] || "mp4";
            const transcript = await transcribeBlob(blob, `media.${ext}`, elevenlabsKey);
            return new Response(
              JSON.stringify({ success: true, pageTitle, transcript, transcribedUrl: mediaUrl, mediaUrls: videoUrls }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } catch (err) {
          console.error("Failed to transcribe direct media:", mediaUrl, err);
        }
      }
    }

    // Fallback: extract page content with AI, focusing on transcript
    const embeddedVideos = videoUrls.filter(
      (u) => u.includes("vimeo.com") || u.includes("youtube.com") || u.includes("youtu.be")
    );

    if (geminiKey && (pageData.markdown || pageData.html)) {
      console.log("Extracting content with AI (looking for transcript)");
      const contentForAI = pageData.markdown + "\n\n--- RAW HTML EXCERPT ---\n\n" + pageData.html.slice(0, 30000);
      const aiContent = await extractContentWithAI(contentForAI, geminiKey);

      return new Response(
        JSON.stringify({
          success: true,
          pageTitle,
          mediaUrls: videoUrls,
          transcript: aiContent,
          note: embeddedVideos.length > 0
            ? "Sidans innehåll har extraherats. Transkriptfliken i Vimeo kunde inte nås. Testa inspelning av flikljud."
            : "Textinnehållet har extraherats från sidan.",
          requiresUpload: embeddedVideos.length > 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        pageTitle,
        mediaUrls: videoUrls,
        transcript: null,
        note: "Videon kan inte laddas ner direkt. Ladda upp en ljudfil manuellt för transkribering.",
        requiresUpload: true,
      }),
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
