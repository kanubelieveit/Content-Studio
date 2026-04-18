import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Article {
  url: string;
  title: string;
  content: string;
  pdfContents: { url: string; text: string }[];
}

async function firecrawlScrape(apiKey: string, url: string): Promise<any> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "links"],
      onlyMainContent: true,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Firecrawl scrape error for", url, data);
    return null;
  }
  return data;
}

function extractArticleLinks(markdown: string, links: string[], baseUrl: string): string[] {
  // Filter links that look like article pages on the same domain
  const domain = new URL(baseUrl).hostname.replace("www.", "");
  const articleLinks = links.filter((link) => {
    try {
      const u = new URL(link);
      const linkDomain = u.hostname.replace("www.", "");
      // Must be same domain, must have a path longer than just /nyheter
      return (
        linkDomain === domain &&
        u.pathname.length > 10 &&
        !u.pathname.endsWith("/nyheter") &&
        !u.pathname.endsWith("/") &&
        !link.includes("#") &&
        !link.includes("login") &&
        !link.includes("prenumeration")
      );
    } catch {
      return false;
    }
  });

  // Deduplicate
  return [...new Set(articleLinks)];
}

function extractPdfLinks(links: string[]): string[] {
  return [...new Set(links.filter((l) => l.toLowerCase().endsWith(".pdf")))];
}

async function extractPdfWithVision(pdfUrl: string, geminiKey: string): Promise<string> {
  try {
    console.log("Fetching PDF:", pdfUrl);
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      console.error("Failed to fetch PDF:", pdfResponse.status);
      return "";
    }

    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    
    let binary = "";
    for (let i = 0; i < pdfBytes.length; i++) {
      binary += String.fromCharCode(pdfBytes[i]);
    }
    const base64Pdf = btoa(binary);

    console.log("Sending PDF to Gemini for extraction, size:", pdfBytes.length);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: "Extrahera ALL text från detta PDF-dokument. Returnera bara den extraherade texten, inget annat. Behåll styckeindelning." },
                { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini PDF extraction error:", response.status, errText);
      return "";
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (err) {
    console.error("PDF extraction failed:", err);
    return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, mode } = await req.json();

    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");

    let targetUrl = url?.trim() || "https://lexnova.se/nyheter";
    if (!targetUrl.startsWith("http")) {
      targetUrl = `https://${targetUrl}`;
    }

    // Simple mode: just scrape one page (backward compatible)
    if (mode === "simple") {
      console.log("Simple scrape:", targetUrl);
      const result = await firecrawlScrape(apiKey, targetUrl);
      return new Response(JSON.stringify(result || { success: false, error: "Scrape failed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deep mode: scrape listing, find articles, scrape each, extract PDFs
    console.log("Deep scrape starting from:", targetUrl);

    // Step 1: Scrape the listing page to find article links
    const listingResult = await firecrawlScrape(apiKey, targetUrl);
    if (!listingResult) {
      return new Response(
        JSON.stringify({ success: false, error: "Could not scrape listing page" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const listingLinks = listingResult.data?.links || listingResult.links || [];
    const articleUrls = extractArticleLinks(
      listingResult.data?.markdown || listingResult.markdown || "",
      listingLinks,
      targetUrl
    );

    console.log(`Found ${articleUrls.length} article links`);

    // Step 2: Scrape each article (limit to 10 to avoid timeouts)
    const maxArticles = Math.min(articleUrls.length, 10);
    const articles: Article[] = [];

    for (let i = 0; i < maxArticles; i++) {
      const articleUrl = articleUrls[i];
      console.log(`Scraping article ${i + 1}/${maxArticles}: ${articleUrl}`);

      const articleResult = await firecrawlScrape(apiKey, articleUrl);
      if (!articleResult) continue;

      const articleMarkdown = articleResult.data?.markdown || articleResult.markdown || "";
      const articleLinks = articleResult.data?.links || articleResult.links || [];
      const articleTitle = articleResult.data?.metadata?.title || articleResult.metadata?.title || articleUrl;

      // Find PDF links in the article
      const pdfLinks = extractPdfLinks(articleLinks);
      const pdfContents: { url: string; text: string }[] = [];

      // Extract PDF content if we have the AI key
      if (geminiKey && pdfLinks.length > 0) {
        for (const pdfUrl of pdfLinks.slice(0, 3)) {
          console.log(`Extracting PDF: ${pdfUrl}`);
          const pdfText = await extractPdfWithVision(pdfUrl, geminiKey);
          if (pdfText) {
            pdfContents.push({ url: pdfUrl, text: pdfText });
          }
        }
      }

      articles.push({
        url: articleUrl,
        title: articleTitle,
        content: articleMarkdown,
        pdfContents,
      });
    }

    console.log(`Successfully scraped ${articles.length} articles`);

    return new Response(
      JSON.stringify({
        success: true,
        totalArticlesFound: articleUrls.length,
        articles,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
