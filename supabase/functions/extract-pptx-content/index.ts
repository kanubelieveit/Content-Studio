import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExtractedSlide {
  title: string;
  bullets: string[];
  speakerNotes: string;
}

function extractTextFromXml(xml: string): string[] {
  // Extract all <a:t> text nodes
  const texts: string[] = [];
  for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) {
    if (m[1].trim()) texts.push(m[1]);
  }
  return texts;
}

function extractSlideContent(slideXml: string): { title: string; bodyTexts: string[] } {
  // Find all <p:sp> shapes
  const shapes = [...slideXml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)];
  
  let title = "";
  const bodyTexts: string[] = [];

  for (const shape of shapes) {
    const inner = shape[1];
    const isTitle = /<p:ph[^>]*type="(?:title|ctrTitle)"/.test(inner);
    const isBody = /<p:ph[^>]*(?:type="body"|idx="1")/.test(inner);
    const isSubtitle = /<p:ph[^>]*type="subTitle"/.test(inner);
    
    // Skip footer/date/slide number placeholders
    if (/<p:ph[^>]*type="(?:dt|ftr|sldNum)"/.test(inner)) continue;

    // Extract paragraphs with their text
    const paragraphs = [...inner.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)];
    
    if (isTitle) {
      const texts: string[] = [];
      for (const p of paragraphs) {
        const runs = [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)];
        const lineText = runs.map(r => r[1]).join("").trim();
        if (lineText) texts.push(lineText);
      }
      title = texts.join(" ");
    } else if (isBody || isSubtitle) {
      for (const p of paragraphs) {
        const runs = [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)];
        const lineText = runs.map(r => r[1]).join("").trim();
        if (lineText) bodyTexts.push(lineText);
      }
    }
  }

  // If no title found from placeholders, use first text shape
  if (!title && shapes.length > 0) {
    for (const shape of shapes) {
      const inner = shape[1];
      if (/<p:ph[^>]*type="(?:dt|ftr|sldNum)"/.test(inner)) continue;
      const texts = extractTextFromXml(inner);
      if (texts.length > 0) {
        title = texts[0];
        break;
      }
    }
  }

  return { title, bodyTexts };
}

function extractNotesContent(notesXml: string): string {
  // Notes slides have <p:sp> with body text
  const shapes = [...notesXml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)];
  const lines: string[] = [];
  
  for (const shape of shapes) {
    const inner = shape[1];
    // Skip the slide image placeholder
    if (/<p:ph[^>]*type="sldImg"/.test(inner)) continue;
    // Get body/notes placeholder
    if (/<p:ph[^>]*(?:type="body"|idx="1")/.test(inner) || !/<p:ph/.test(inner)) {
      const paragraphs = [...inner.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)];
      for (const p of paragraphs) {
        const runs = [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)];
        const lineText = runs.map(r => r[1]).join("").trim();
        if (lineText) lines.push(lineText);
      }
    }
  }
  
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return new Response(
        JSON.stringify({ success: false, error: "Ladda upp en .pptx-fil." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file || !file.name.endsWith(".pptx")) {
      return new Response(
        JSON.stringify({ success: false, error: "Filen måste vara en .pptx-fil." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Find all slide files in order
    const slideFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)\.xml/)?.[1] || "0");
        const numB = parseInt(b.match(/(\d+)\.xml/)?.[1] || "0");
        return numA - numB;
      });

    console.log(`Found ${slideFiles.length} slides in uploaded PPTX`);

    const slides: ExtractedSlide[] = [];

    for (const slideFile of slideFiles) {
      const slideXml = await zip.files[slideFile].async("text");
      const { title, bodyTexts } = extractSlideContent(slideXml);

      // Try to find corresponding notes slide
      const slideNum = slideFile.match(/slide(\d+)\.xml/)?.[1];
      let speakerNotes = "";
      
      if (slideNum) {
        const notesFile = zip.file(`ppt/notesSlides/notesSlide${slideNum}.xml`);
        if (notesFile) {
          const notesXml = await notesFile.async("text");
          speakerNotes = extractNotesContent(notesXml);
        }
      }

      // Skip empty slides (no title and no body)
      if (!title && bodyTexts.length === 0) continue;

      slides.push({
        title: title || `Slide ${slides.length + 1}`,
        bullets: bodyTexts,
        speakerNotes,
      });

      console.log(`Slide "${title}": ${bodyTexts.length} bullets, notes: ${speakerNotes.length} chars`);
    }

    return new Response(
      JSON.stringify({ success: true, slides, fileName: file.name }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Kunde inte läsa presentationen." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
