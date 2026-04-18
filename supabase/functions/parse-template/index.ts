import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// EMU to inches (1 inch = 914400 EMU)
function emuToInches(emu: string | number): number {
  return Number(emu) / 914400;
}

function parseThemeColors(themeXml: string): Record<string, string> {
  const colors: Record<string, string> = {};
  const colorNames = ["dk1", "dk2", "lt1", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  for (const name of colorNames) {
    const srgbMatch = new RegExp(`<a:${name}>[^]*?<a:srgbClr\\s+val="([A-Fa-f0-9]{6})"`, "i").exec(themeXml);
    if (srgbMatch) { colors[name] = srgbMatch[1]; continue; }
    const sysMatch = new RegExp(`<a:${name}>[^]*?<a:sysClr[^>]+lastClr="([A-Fa-f0-9]{6})"`, "i").exec(themeXml);
    if (sysMatch) { colors[name] = sysMatch[1]; }
  }
  return colors;
}

function parseFonts(themeXml: string): { heading: string; body: string } {
  const headingMatch = /<a:majorFont>[^]*?<a:latin\s+typeface="([^"]+)"/.exec(themeXml);
  const bodyMatch = /<a:minorFont>[^]*?<a:latin\s+typeface="([^"]+)"/.exec(themeXml);
  return {
    heading: headingMatch?.[1] || "Calibri",
    body: bodyMatch?.[1] || "Calibri",
  };
}

function resolveThemeColor(colorRef: string, themeColors: Record<string, string>): string | null {
  // Map scheme color names to theme color keys
  const schemeMap: Record<string, string> = {
    "tx1": "dk1", "tx2": "dk2", "bg1": "lt1", "bg2": "lt2",
    "dk1": "dk1", "dk2": "dk2", "lt1": "lt1", "lt2": "lt2",
    "accent1": "accent1", "accent2": "accent2", "accent3": "accent3",
    "accent4": "accent4", "accent5": "accent5", "accent6": "accent6",
    "hlink": "hlink", "folHlink": "folHlink",
  };
  const key = schemeMap[colorRef];
  return key ? (themeColors[key] || null) : null;
}

interface ShapeInfo {
  type: "rect" | "image" | "text" | "line";
  x: number; y: number; w: number; h: number;
  fill?: string;
  text?: string;
  fontSize?: number;
  fontFace?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  imageRelId?: string;
  imageUrl?: string;
}

interface LayoutInfo {
  name: string;
  background?: string;
  shapes: ShapeInfo[];
}

function parseShapesFromXml(xml: string, themeColors: Record<string, string>): ShapeInfo[] {
  const shapes: ShapeInfo[] = [];
  
  // Parse sp (shape) elements
  const spMatches = xml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g);
  for (const m of spMatches) {
    const spXml = m[1];
    
    // Get position/size from spPr > xfrm
    const offMatch = /<a:off\s+x="(\d+)"\s+y="(\d+)"/.exec(spXml);
    const extMatch = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/.exec(spXml);
    if (!offMatch || !extMatch) continue;
    
    const x = emuToInches(offMatch[1]);
    const y = emuToInches(offMatch[2]);
    const w = emuToInches(extMatch[1]);
    const h = emuToInches(extMatch[2]);
    
    // Check for fill color
    let fill: string | undefined;
    const solidFillSrgb = /<a:solidFill>\s*<a:srgbClr\s+val="([A-Fa-f0-9]{6})"/.exec(spXml);
    const solidFillScheme = /<a:solidFill>\s*<a:schemeClr\s+val="([^"]+)"/.exec(spXml);
    if (solidFillSrgb) {
      fill = solidFillSrgb[1];
    } else if (solidFillScheme) {
      fill = resolveThemeColor(solidFillScheme[1], themeColors) || undefined;
    }
    
    // Check for text content
    const textMatches = spXml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
    let textContent = "";
    for (const tm of textMatches) {
      textContent += tm[1];
    }
    
    // Get font info
    let fontSize: number | undefined;
    let fontFace: string | undefined;
    let bold: boolean | undefined;
    let color: string | undefined;
    
    const szMatch = /sz="(\d+)"/.exec(spXml);
    if (szMatch) fontSize = Number(szMatch[1]) / 100; // hundredths of pt to pt
    
    const typefaceMatch = /<a:latin\s+typeface="([^"]+)"/.exec(spXml);
    if (typefaceMatch) fontFace = typefaceMatch[1];
    
    if (/\bb="1"/.test(spXml)) bold = true;
    
    const textColorSrgb = /<a:rPr[^>]*>[\s\S]*?<a:solidFill>\s*<a:srgbClr\s+val="([A-Fa-f0-9]{6})"/.exec(spXml);
    const textColorScheme = /<a:rPr[^>]*>[\s\S]*?<a:solidFill>\s*<a:schemeClr\s+val="([^"]+)"/.exec(spXml);
    if (textColorSrgb) {
      color = textColorSrgb[1];
    } else if (textColorScheme) {
      color = resolveThemeColor(textColorScheme[1], themeColors) || undefined;
    }
    
    if (textContent.trim()) {
      shapes.push({ type: "text", x, y, w, h, text: textContent, fontSize, fontFace, bold, color, fill });
    } else if (fill) {
      shapes.push({ type: "rect", x, y, w, h, fill });
    }
  }
  
  // Parse pic (picture) elements  
  const picMatches = xml.matchAll(/<p:pic\b[^>]*>([\s\S]*?)<\/p:pic>/g);
  for (const m of picMatches) {
    const picXml = m[1];
    const offMatch = /<a:off\s+x="(\d+)"\s+y="(\d+)"/.exec(picXml);
    const extMatch = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/.exec(picXml);
    const embedMatch = /r:embed="([^"]+)"/.exec(picXml);
    if (!offMatch || !extMatch) continue;
    
    shapes.push({
      type: "image",
      x: emuToInches(offMatch[1]),
      y: emuToInches(offMatch[2]),
      w: emuToInches(extMatch[1]),
      h: emuToInches(extMatch[2]),
      imageRelId: embedMatch?.[1],
    });
  }
  
  // Parse cxnSp (connector/line) elements
  const lineMatches = xml.matchAll(/<p:cxnSp\b[^>]*>([\s\S]*?)<\/p:cxnSp>/g);
  for (const m of lineMatches) {
    const lineXml = m[1];
    const offMatch = /<a:off\s+x="(\d+)"\s+y="(\d+)"/.exec(lineXml);
    const extMatch = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/.exec(lineXml);
    if (!offMatch || !extMatch) continue;
    
    let lineColor: string | undefined;
    const lnSrgb = /<a:ln[^>]*>[\s\S]*?<a:srgbClr\s+val="([A-Fa-f0-9]{6})"/.exec(lineXml);
    const lnScheme = /<a:ln[^>]*>[\s\S]*?<a:schemeClr\s+val="([^"]+)"/.exec(lineXml);
    if (lnSrgb) lineColor = lnSrgb[1];
    else if (lnScheme) lineColor = resolveThemeColor(lnScheme[1], themeColors) || undefined;
    
    shapes.push({
      type: "line",
      x: emuToInches(offMatch[1]),
      y: emuToInches(offMatch[2]),
      w: emuToInches(extMatch[1]),
      h: emuToInches(extMatch[2]),
      fill: lineColor,
    });
  }
  
  return shapes;
}

function parseBgColor(xml: string, themeColors: Record<string, string>): string | undefined {
  const bgSrgb = /<p:bg[\s\S]*?<a:srgbClr\s+val="([A-Fa-f0-9]{6})"/.exec(xml);
  if (bgSrgb) return bgSrgb[1];
  const bgScheme = /<p:bg[\s\S]*?<a:schemeClr\s+val="([^"]+)"/.exec(xml);
  if (bgScheme) return resolveThemeColor(bgScheme[1], themeColors) || undefined;
  return undefined;
}

async function resolveImageUrls(
  shapes: ShapeInfo[],
  relsXml: string,
  zip: JSZip,
  supabase: any
): Promise<void> {
  for (const shape of shapes) {
    if (shape.type !== "image" || !shape.imageRelId) continue;
    
    const relMatch = new RegExp(`Id="${shape.imageRelId}"[^>]+Target="([^"]+)"`, "i").exec(relsXml);
    if (!relMatch) continue;
    
    let targetPath = relMatch[1];
    if (targetPath.startsWith("../")) {
      targetPath = "ppt/" + targetPath.replace(/^\.\.\//g, "");
    }
    
    const imageFile = zip.files[targetPath];
    if (!imageFile) continue;
    
    try {
      const imageData = await imageFile.async("uint8array");
      const ext = targetPath.split(".").pop()?.toLowerCase() || "png";
      const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "application/octet-stream";
      const fileName = `layout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      
      const { error } = await supabase.storage
        .from("template-assets")
        .upload(fileName, imageData, { contentType: mimeType, upsert: true });
      
      if (!error) {
        const { data: urlData } = supabase.storage.from("template-assets").getPublicUrl(fileName);
        shape.imageUrl = urlData?.publicUrl || undefined;
      }
    } catch (err) {
      console.error("Failed to upload layout image:", err);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let arrayBuffer: ArrayBuffer;
    let fileName = "template.pptx";

    const ct = req.headers.get("content-type") || "";

    if (ct.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      if (!file || !file.name.endsWith(".pptx")) {
        return new Response(
          JSON.stringify({ success: false, error: "Filen måste vara en .pptx-fil." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      arrayBuffer = await file.arrayBuffer();
      fileName = file.name;
    } else if (ct.includes("application/json")) {
      // Accept { url: "https://..." } to parse a remote file
      const body = await req.json();
      if (!body.url) {
        return new Response(
          JSON.stringify({ success: false, error: "Ange url till .pptx-fil." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const resp = await fetch(body.url);
      if (!resp.ok) throw new Error("Kunde inte ladda ner filen");
      arrayBuffer = await resp.arrayBuffer();
    } else {
      return new Response(
        JSON.stringify({ success: false, error: "Ladda upp en .pptx-fil eller skicka {url}." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Parsing template:", fileName, arrayBuffer.byteLength);

    const zip = await JSZip.loadAsync(arrayBuffer);

    // Extract theme colors and fonts
    let themeColors: Record<string, string> = {};
    let fonts = { heading: "Calibri", body: "Calibri" };

    const themeFile = Object.keys(zip.files).find((f) => f.startsWith("ppt/theme/theme") && f.endsWith(".xml"));
    if (themeFile) {
      const themeXml = await zip.files[themeFile].async("text");
      themeColors = parseThemeColors(themeXml);
      fonts = parseFonts(themeXml);
      console.log("Theme colors:", themeColors);
      console.log("Fonts:", fonts);
    }

    // Extract ALL slide layouts
    const layoutFiles = Object.keys(zip.files)
      .filter((f) => f.startsWith("ppt/slideLayouts/slideLayout") && f.endsWith(".xml"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)\.xml/)?.[1] || "0");
        const numB = parseInt(b.match(/(\d+)\.xml/)?.[1] || "0");
        return numA - numB;
      });

    console.log("Found", layoutFiles.length, "slide layouts");

    const layouts: LayoutInfo[] = [];

    for (const layoutFile of layoutFiles) {
      const layoutXml = await zip.files[layoutFile].async("text");
      
      // Get layout name
      const nameMatch = /<p:cSld\s+name="([^"]*)"/.exec(layoutXml);
      const name = nameMatch?.[1] || layoutFile.split("/").pop()?.replace(".xml", "") || "Unknown";
      
      // Get background
      const background = parseBgColor(layoutXml, themeColors);
      
      // Get shapes
      const shapes = parseShapesFromXml(layoutXml, themeColors);
      
      // Resolve image URLs
      const relsPath = layoutFile.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels";
      if (zip.files[relsPath]) {
        const relsXml = await zip.files[relsPath].async("text");
        await resolveImageUrls(shapes, relsXml, zip, supabase);
      }
      
      layouts.push({ name, background, shapes });
      console.log(`Layout "${name}": ${shapes.length} shapes, bg: ${background || "inherit"}`);
    }

    // Also extract slide master shapes (common elements like logos)
    const masterFiles = Object.keys(zip.files)
      .filter((f) => f.startsWith("ppt/slideMasters/slideMaster") && f.endsWith(".xml"));

    let masterShapes: ShapeInfo[] = [];
    let masterBackground: string | undefined;

    for (const masterFile of masterFiles) {
      const masterXml = await zip.files[masterFile].async("text");
      masterBackground = parseBgColor(masterXml, themeColors);
      masterShapes = parseShapesFromXml(masterXml, themeColors);
      
      const relsPath = masterFile.replace("slideMasters/", "slideMasters/_rels/") + ".rels";
      if (zip.files[relsPath]) {
        const relsXml = await zip.files[relsPath].async("text");
        await resolveImageUrls(masterShapes, relsXml, zip, supabase);
      }
      
      console.log(`Master: ${masterShapes.length} shapes, bg: ${masterBackground || "none"}`);
      break; // Usually only one master
    }

    return new Response(
      JSON.stringify({
        success: true,
        themeColors,
        fonts,
        layouts,
        masterShapes,
        masterBackground,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Kunde inte tolka mallen." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
