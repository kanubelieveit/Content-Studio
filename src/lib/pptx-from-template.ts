import JSZip from "jszip";

export type SlideLayoutType = "content" | "section" | "quote" | "closing";
export type ThemeVariant = "blue" | "gray" | "white";

export interface SlideContent {
  title: string;
  bullets?: string[];
  quoteText?: string;
  quoteSource?: string;
  speakerNotes: string;
  layoutType?: SlideLayoutType;
}

export interface PresentationContent {
  title: string;
  subtitle?: string;
  slides: SlideContent[];
  theme?: ThemeVariant;
}

// Layout numbers per theme variant
const LAYOUTS: Record<ThemeVariant, Record<string, number>> = {
  blue:  { title: 1,  content: 7,  section: 9,  quote: 27, closing: 35 },
  gray:  { title: 37, content: 45, section: 47, quote: 60, closing: 68 },
  white: { title: 70, content: 76, section: 78, quote: 91, closing: 99 },
};

export async function generatePptxFromTemplate(
  templateArrayBuffer: ArrayBuffer,
  content: PresentationContent
): Promise<Blob> {
  const zip = await JSZip.loadAsync(templateArrayBuffer);
  const origZip = await JSZip.loadAsync(templateArrayBuffer);

  const theme = content.theme ?? "blue";
  const layouts = LAYOUTS[theme];

  const presXml = await zip.file("ppt/presentation.xml")!.async("text");
  const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")!.async("text");

  const sldSzMatch = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const slideCx = sldSzMatch ? parseInt(sldSzMatch[1], 10) : 9144000;
  const slideCy = sldSzMatch ? parseInt(sldSzMatch[2], 10) : 6858000;

  // Find title slide from template (clone it)
  const relEntries: { rId: string; target: string }[] = [];
  for (const m of presRelsXml.matchAll(/Id="(rId\d+)"[^>]*Target="(slides\/slide\d+\.xml)"/g)) {
    relEntries.push({ rId: m[1], target: m[2] });
  }
  const slideOrder: string[] = [];
  for (const m of presXml.matchAll(/r:id="(rId\d+)"/g)) {
    const entry = relEntries.find(e => e.rId === m[1]);
    if (entry) slideOrder.push(entry.target);
  }

  // Remove all existing slides from zip
  const existingNums = slideOrder.map(f => parseInt(f.match(/slide(\d+)/)?.[1] || "0"));
  for (const num of existingNums) {
    zip.remove(`ppt/slides/slide${num}.xml`);
    zip.remove(`ppt/slides/_rels/slide${num}.xml.rels`);
    zip.remove(`ppt/notesSlides/notesSlide${num}.xml`);
    zip.remove(`ppt/notesSlides/_rels/notesSlide${num}.xml.rels`);
  }

  // Copy all media from original template
  for (const [path, file] of Object.entries(origZip.files)) {
    if (path.startsWith("ppt/media/") && !zip.file(path)) {
      zip.file(path, await file.async("uint8array"));
    }
  }

  // Ensure notesMaster
  const notesMasterFile = origZip.file("ppt/notesMasters/notesMaster1.xml");
  if (notesMasterFile) {
    zip.file("ppt/notesMasters/notesMaster1.xml", await notesMasterFile.async("uint8array"));
    const nmRels = origZip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels");
    if (nmRels) zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", await nmRels.async("uint8array"));
  }

  const newSlideFiles: string[] = [];
  let slideCounter = 1;

  // --- Title slide: clone from template slide 1 ---
  const titleSlideXml = await origZip.file("ppt/slides/slide1.xml")!.async("text");
  const titleSlideRels = await origZip.file("ppt/slides/_rels/slide1.xml.rels")?.async("text");
  let patchedTitle = titleSlideXml;
  if (content.title) patchedTitle = replacePlaceholderText(patchedTitle, ["ctrTitle", "title"], content.title);
  if (content.subtitle) patchedTitle = replacePlaceholderText(patchedTitle, ["subTitle", "body"], content.subtitle);
  zip.file(`ppt/slides/slide${slideCounter}.xml`, removeDatePlaceholder(patchedTitle));
  if (titleSlideRels) zip.file(`ppt/slides/_rels/slide${slideCounter}.xml.rels`, titleSlideRels);
  newSlideFiles.push(`slides/slide${slideCounter}.xml`);
  slideCounter++;

  // --- Content slides ---
  for (const slide of content.slides) {
    const lType = slide.layoutType ?? "content";
    let slideXml: string;
    let slideRels: string;

    if (lType === "section") {
      slideXml = createSectionSlide(slide.title, layouts.section);
      slideRels = createSlideRels(layouts.section, slideCounter);
    } else if (lType === "quote") {
      slideXml = createQuoteSlide(slide.quoteText ?? slide.title, slide.quoteSource ?? "", layouts.quote);
      slideRels = createSlideRels(layouts.quote, slideCounter);
    } else {
      slideXml = createContentSlide(slide.title, slide.bullets ?? [], layouts.content, slideCx, slideCy);
      slideRels = createSlideRels(layouts.content, slideCounter);
    }

    // Add notes ref to rels
    const slideRelsWithNotes = slideRels.replace(
      "</Relationships>",
      `<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideCounter}.xml"/></Relationships>`
    );

    zip.file(`ppt/slides/slide${slideCounter}.xml`, slideXml);
    zip.file(`ppt/slides/_rels/slide${slideCounter}.xml.rels`, slideRelsWithNotes);
    zip.file(`ppt/notesSlides/notesSlide${slideCounter}.xml`, createNotesSlideXml(slide.speakerNotes));
    zip.file(`ppt/notesSlides/_rels/notesSlide${slideCounter}.xml.rels`, createNotesRels(slideCounter));

    newSlideFiles.push(`slides/slide${slideCounter}.xml`);
    slideCounter++;
  }

  // --- Closing slide: clone from last template slide ---
  const lastTemplateNum = existingNums[existingNums.length - 1];
  if (lastTemplateNum) {
    const closingXml = await origZip.file(`ppt/slides/slide${lastTemplateNum}.xml`)!.async("text");
    const closingRels = await origZip.file(`ppt/slides/_rels/slide${lastTemplateNum}.xml.rels`)?.async("text");
    zip.file(`ppt/slides/slide${slideCounter}.xml`, removeDatePlaceholder(closingXml));
    if (closingRels) zip.file(`ppt/slides/_rels/slide${slideCounter}.xml.rels`, closingRels);
    newSlideFiles.push(`slides/slide${slideCounter}.xml`);
    slideCounter++;
  }

  // Update presentation.xml slide list
  let newPresXml = presXml;
  const sldIdLstMatch = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
  if (sldIdLstMatch) {
    let newSldIdLst = "<p:sldIdLst>";
    newSlideFiles.forEach((_, i) => {
      newSldIdLst += `<p:sldId id="${256 + i}" r:id="rId${100 + i}"/>`;
    });
    newSldIdLst += "</p:sldIdLst>";
    newPresXml = newPresXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, newSldIdLst);
  }
  zip.file("ppt/presentation.xml", newPresXml);

  // Update presentation rels
  let newPresRels = presRelsXml.replace(/<Relationship[^>]*Target="slides\/slide\d+\.xml"[^>]*\/>/g, "");
  let newRelEntries = "";
  newSlideFiles.forEach((file, i) => {
    newRelEntries += `<Relationship Id="rId${100 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${file}"/>`;
  });
  newPresRels = newPresRels.replace("</Relationships>", newRelEntries + "</Relationships>");
  zip.file("ppt/_rels/presentation.xml.rels", newPresRels);

  // Update Content_Types.xml
  let contentTypes = await zip.file("[Content_Types].xml")!.async("text");
  contentTypes = contentTypes
    .replace(/<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "")
    .replace(/<Override[^>]*PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>/g, "");
  let newOverrides = "";
  for (let i = 1; i < slideCounter; i++) {
    newOverrides += `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }
  for (let i = 2; i < slideCounter - 1; i++) {
    newOverrides += `<Override PartName="/ppt/notesSlides/notesSlide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`;
  }
  if (!contentTypes.includes("notesMaster1.xml")) {
    newOverrides += `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`;
  }
  contentTypes = contentTypes.replace("</Types>", newOverrides + "</Types>");
  zip.file("[Content_Types].xml", contentTypes);

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

// --- Slide XML builders ---

function createContentSlide(title: string, bullets: string[], _layoutNum: number, _cx: number, _cy: number): string {
  const bulletsXml = bullets.map(b =>
    `<a:p><a:pPr marL="342900" indent="-342900"><a:buChar char="&#x2022;"/></a:pPr><a:r><a:rPr lang="sv-SE" sz="1600" dirty="0"/><a:t>${escapeXml(b)}</a:t></a:r></a:p>`
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="sv-SE" sz="2400" dirty="0"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${bulletsXml}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function createSectionSlide(title: string, _layoutNum: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="sv-SE" sz="3600" b="1" dirty="0"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function createQuoteSlide(quoteText: string, source: string, _layoutNum: number): string {
  const sourceXml = source
    ? `<a:p><a:r><a:rPr lang="sv-SE" sz="1400" i="1" dirty="0"/><a:t>— ${escapeXml(source)}</a:t></a:r></a:p>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Body 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="sv-SE" sz="2000" i="1" dirty="0"/><a:t>"${escapeXml(quoteText)}"</a:t></a:r></a:p>
          ${sourceXml}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function createSlideRels(layoutNum: number, _slideNum: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${layoutNum}.xml"/>
</Relationships>`;
}

function createNotesRels(slideNum: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNum}.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>`;
}

function createNotesSlideXml(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="sv-SE" dirty="0"/><a:t>${escapeXml(notes)}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
}

// --- Helpers ---

function replacePlaceholderText(xml: string, phTypes: string[], newText: string): string {
  const shapes = findAllShapes(xml);
  for (const { full, inner, start, end } of shapes) {
    const hasPlaceholder = phTypes.some(pt => new RegExp(`<p:ph[^>]*type="${pt}"`, "i").test(inner));
    if (!hasPlaceholder) continue;
    const txBodyMatch = inner.match(/<p:txBody>([\s\S]*)<\/p:txBody>/);
    if (!txBodyMatch) continue;
    const txBody = txBodyMatch[1];
    const bodyPrMatch = txBody.match(/<a:bodyPr[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/);
    const lstStyleMatch = txBody.match(/<a:lstStyle[^>]*(?:\/>|>[\s\S]*?<\/a:lstStyle>)/);
    const bodyPr = bodyPrMatch?.[0] ?? "<a:bodyPr/>";
    const lstStyle = lstStyleMatch?.[0] ?? "<a:lstStyle/>";
    const newTxBody = `<p:txBody>${bodyPr}${lstStyle}<a:p><a:r><a:rPr lang="sv-SE" dirty="0"/><a:t>${escapeXml(newText)}</a:t></a:r></a:p></p:txBody>`;
    const newInner = inner.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, newTxBody);
    const newFull = full.replace(inner, newInner);
    xml = xml.substring(0, start) + newFull + xml.substring(end);
    break;
  }
  return xml;
}

function removeDatePlaceholder(xml: string): string {
  const shapes = findAllShapes(xml);
  for (const { full, inner } of shapes) {
    if (/<p:ph[^>]*type="dt"/.test(inner)) xml = xml.replace(full, "");
  }
  return xml;
}

function findAllShapes(xml: string): { full: string; inner: string; start: number; end: number }[] {
  const results: { full: string; inner: string; start: number; end: number }[] = [];
  const closeTag = "</p:sp>";
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    let startIdx = xml.indexOf("<p:sp>", searchFrom);
    const startIdx2 = xml.indexOf("<p:sp ", searchFrom);
    if (startIdx === -1 && startIdx2 === -1) break;
    if (startIdx === -1) startIdx = startIdx2;
    else if (startIdx2 !== -1 && startIdx2 < startIdx) startIdx = startIdx2;
    const endIdx = xml.indexOf(closeTag, startIdx);
    if (endIdx === -1) break;
    const fullEnd = endIdx + closeTag.length;
    const full = xml.substring(startIdx, fullEnd);
    const openClose = xml.indexOf(">", startIdx);
    const inner = xml.substring(openClose + 1, endIdx);
    results.push({ full, inner, start: startIdx, end: fullEnd });
    searchFrom = fullEnd;
  }
  return results;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
