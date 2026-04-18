import JSZip from "jszip";

interface SlideContent {
  title: string;
  bullets: string[];
  speakerNotes: string;
}

interface PresentationContent {
  title: string;
  slides: SlideContent[];
}

/**
 * Generate a .pptx by cloning real slides from the template and replacing text.
 * This preserves all logos, images, colors, fonts, and formatting exactly.
 */
export async function generatePptxFromTemplate(
  templateArrayBuffer: ArrayBuffer,
  content: PresentationContent
): Promise<Blob> {
  const zip = await JSZip.loadAsync(templateArrayBuffer);

  // 1. Read presentation.xml and its rels to understand slide structure
  const presXml = await zip.file("ppt/presentation.xml")!.async("text");
  const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")!.async("text");

  // Slide size (EMU). Default 10"×7.5" = 9144000×6858000
  const sldSzMatch = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const slideCx = sldSzMatch ? parseInt(sldSzMatch[1], 10) : 9144000;
  const slideCy = sldSzMatch ? parseInt(sldSzMatch[2], 10) : 6858000;

  // Map rIds to slide files
  const relEntries: { rId: string; target: string }[] = [];
  for (const m of presRelsXml.matchAll(/Id=\"(rId\d+)\"[^>]*Target=\"(slides\/slide\d+\.xml)\"/g)) {
    relEntries.push({ rId: m[1], target: m[2] });
  }

  // Find slide order from presentation.xml
  const slideOrder: string[] = [];
  for (const m of presXml.matchAll(/r:id=\"(rId\d+)\"/g)) {
    const entry = relEntries.find(e => e.rId === m[1]);
    if (entry) slideOrder.push(entry.target);
  }

  console.log("Template slides:", slideOrder);

  // 2. Identify slide types by checking their layout reference
  const slideLayouts: Map<string, string> = new Map(); // slide file -> layout name

  for (const slideFile of slideOrder) {
    const slideNum = slideFile.match(/slide(\d+)\.xml/)?.[1];
    if (!slideNum) continue;

    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsFile = zip.file(relsPath);
    if (!relsFile) continue;

    const relsContent = await relsFile.async("text");
    const layoutMatch = relsContent.match(/Target="\.\.\/slideLayouts\/slideLayout(\d+)\.xml"/);
    if (!layoutMatch) continue;

    const layoutPath = `ppt/slideLayouts/slideLayout${layoutMatch[1]}.xml`;
    const layoutFile = zip.file(layoutPath);
    if (!layoutFile) continue;

    const layoutXml = await layoutFile.async("text");
    const nameMatch = layoutXml.match(/<p:cSld\s+name="([^"]*)"/);
    slideLayouts.set(slideFile, nameMatch?.[1] || "Unknown");
  }

  console.log("Slide layouts:", Object.fromEntries(slideLayouts));

  // 3. Find the title slide, content template slide, and end slide
  let titleSlide: string | null = null;
  let contentTemplateSlide: string | null = null;
  let endSlide: string | null = null;

  for (const [file, layoutName] of slideLayouts) {
    if (!titleSlide && layoutName.toLowerCase().includes("title slide")) {
      titleSlide = file;
    }
    if (!contentTemplateSlide && layoutName === "Rubrik och innehåll") {
      contentTemplateSlide = file;
    }
    if (layoutName.toLowerCase().includes("avslut")) {
      endSlide = file; // take the last one
    }
  }

  // Fallbacks
  if (!titleSlide) titleSlide = slideOrder[0];
  if (!contentTemplateSlide) contentTemplateSlide = slideOrder.length > 1 ? slideOrder[1] : slideOrder[0];
  if (!endSlide && slideOrder.length > 2) endSlide = slideOrder[slideOrder.length - 1];

  console.log("Title slide:", titleSlide, "Content template:", contentTemplateSlide, "End slide:", endSlide);

  // 4. Read the content template slide XML and rels
  const contentNum = contentTemplateSlide.match(/slide(\d+)/)?.[1]!;
  const contentSlideXml = await zip.file(`ppt/slides/slide${contentNum}.xml`)!.async("text");
  const contentSlideRelsXml = await zip.file(`ppt/slides/_rels/slide${contentNum}.xml.rels`)?.async("text") || "";

  // 5. Build new slide list: title + N content slides + end slide
  // First, remove all existing slides from the zip
  const existingSlideNums = slideOrder.map(f => parseInt(f.match(/slide(\d+)/)?.[1] || "0"));
  for (const num of existingSlideNums) {
    zip.remove(`ppt/slides/slide${num}.xml`);
    if (zip.file(`ppt/slides/_rels/slide${num}.xml.rels`)) {
      zip.remove(`ppt/slides/_rels/slide${num}.xml.rels`);
    }
    // Remove notes if present
    if (zip.file(`ppt/notesSlides/notesSlide${num}.xml`)) {
      zip.remove(`ppt/notesSlides/notesSlide${num}.xml`);
    }
  }

  // 6. Create new slides
  const newSlideFiles: string[] = [];
  let slideCounter = 1;

  // Title slide (slide 1)
  const titleNum = titleSlide.match(/slide(\d+)/)?.[1]!;
  const titleXml = await readSlideFromOriginal(templateArrayBuffer, parseInt(titleNum));
  const titleRels = await readSlideRelsFromOriginal(templateArrayBuffer, parseInt(titleNum));
  
  // Copy any images referenced by the title slide rels
  await copySlideAssets(templateArrayBuffer, parseInt(titleNum), zip);
  
  zip.file(`ppt/slides/slide${slideCounter}.xml`, removeDatePlaceholder(titleXml));
  if (titleRels) zip.file(`ppt/slides/_rels/slide${slideCounter}.xml.rels`, titleRels);
  newSlideFiles.push(`slides/slide${slideCounter}.xml`);
  slideCounter++;

  // Content slides (slide 2..N+1)
  for (let slideIdx = 0; slideIdx < content.slides.length; slideIdx++) {
    const slideContent = content.slides[slideIdx];
    
    let newXml = replaceSlideText(contentSlideXml, slideContent.title, slideContent.bullets, slideCx, slideCy);
    
    // Build rels - start from content slide rels, add notes reference
    let slideRels = contentSlideRelsXml;
    const notesRId = `rIdNotes${slideCounter}`;
    
    zip.file(`ppt/slides/slide${slideCounter}.xml`, newXml);
    
    if (slideRels) {
      slideRels = slideRels.replace("</Relationships>",
        `<Relationship Id="${notesRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideCounter}.xml"/></Relationships>`);
      zip.file(`ppt/slides/_rels/slide${slideCounter}.xml.rels`, slideRels);
    }
    
    // Create notes slide with speaker notes
    const notesXml = createNotesSlideXml(slideCounter, slideContent.speakerNotes);
    zip.file(`ppt/notesSlides/notesSlide${slideCounter}.xml`, notesXml);
    zip.file(`ppt/notesSlides/_rels/notesSlide${slideCounter}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideCounter}.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>`);
    
    // Copy content slide assets
    await copySlideAssets(templateArrayBuffer, parseInt(contentNum), zip);
    
    newSlideFiles.push(`slides/slide${slideCounter}.xml`);
    slideCounter++;
  }

  // End slide (last)
  if (endSlide) {
    const endNum = endSlide.match(/slide(\d+)/)?.[1]!;
    const endXml = await readSlideFromOriginal(templateArrayBuffer, parseInt(endNum));
    const endRels = await readSlideRelsFromOriginal(templateArrayBuffer, parseInt(endNum));
    
    await copySlideAssets(templateArrayBuffer, parseInt(endNum), zip);
    
    zip.file(`ppt/slides/slide${slideCounter}.xml`, removeDatePlaceholder(endXml));
    if (endRels) zip.file(`ppt/slides/_rels/slide${slideCounter}.xml.rels`, endRels);
    newSlideFiles.push(`slides/slide${slideCounter}.xml`);
    slideCounter++;
  }

  // 7. Update presentation.xml - replace slide list
  let newPresXml = presXml;
  
  // Remove existing sldIdLst entries and rebuild
  const sldIdLstMatch = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
  if (sldIdLstMatch) {
    let newSldIdLst = "<p:sldIdLst>";
    newSlideFiles.forEach((file, i) => {
      const sldId = 256 + i; // PowerPoint slide IDs start at 256
      const rId = `rId${100 + i}`; // Use high rIds to avoid conflicts
      newSldIdLst += `<p:sldId id="${sldId}" r:id="${rId}"/>`;
    });
    newSldIdLst += "</p:sldIdLst>";
    newPresXml = newPresXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, newSldIdLst);
  }

  zip.file("ppt/presentation.xml", newPresXml);

  // 8. Update presentation.xml.rels - add new slide references, remove old ones
  let newPresRels = presRelsXml;
  
  // Remove old slide relationships
  newPresRels = newPresRels.replace(/<Relationship[^>]*Target="slides\/slide\d+\.xml"[^>]*\/>/g, "");
  
  // Add new slide relationships before closing tag
  let newRelEntries = "";
  newSlideFiles.forEach((file, i) => {
    const rId = `rId${100 + i}`;
    newRelEntries += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${file}"/>`;
  });
  
  newPresRels = newPresRels.replace("</Relationships>", newRelEntries + "</Relationships>");
  zip.file("ppt/_rels/presentation.xml.rels", newPresRels);

  // 9. Ensure notesMaster exists (copy from template if present)
  const origZipForNotes = await JSZip.loadAsync(templateArrayBuffer);
  const notesMasterFile = origZipForNotes.file("ppt/notesMasters/notesMaster1.xml");
  if (notesMasterFile) {
    zip.file("ppt/notesMasters/notesMaster1.xml", await notesMasterFile.async("uint8array"));
    const notesMasterRels = origZipForNotes.file("ppt/notesMasters/_rels/notesMaster1.xml.rels");
    if (notesMasterRels) {
      zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels", await notesMasterRels.async("uint8array"));
    }
  }

  // 10. Update [Content_Types].xml
  let contentTypes = await zip.file("[Content_Types].xml")!.async("text");
  
  // Remove old slide/notes entries
  contentTypes = contentTypes.replace(/<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "");
  contentTypes = contentTypes.replace(/<Override[^>]*PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>/g, "");
  
  // Add new slide + notes entries
  let newOverrides = "";
  for (let i = 1; i < slideCounter; i++) {
    newOverrides += `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }
  // Add notes slide overrides for content slides (slides 2..N+1)
  for (let i = 2; i < slideCounter - (endSlide ? 1 : 0); i++) {
    newOverrides += `<Override PartName="/ppt/notesSlides/notesSlide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`;
  }
  // Add notesMaster if not already there
  if (!contentTypes.includes("notesMaster1.xml")) {
    newOverrides += `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`;
  }
  contentTypes = contentTypes.replace("</Types>", newOverrides + "</Types>");
  zip.file("[Content_Types].xml", contentTypes);

  // 10. Generate the final .pptx
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  return blob;
}

/** Read a slide XML from the original template buffer (before we modified the zip) */
async function readSlideFromOriginal(templateBuf: ArrayBuffer, slideNum: number): Promise<string> {
  const origZip = await JSZip.loadAsync(templateBuf);
  return origZip.file(`ppt/slides/slide${slideNum}.xml`)!.async("text");
}

/** Read a slide's rels from the original template */
async function readSlideRelsFromOriginal(templateBuf: ArrayBuffer, slideNum: number): Promise<string | null> {
  const origZip = await JSZip.loadAsync(templateBuf);
  const file = origZip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`);
  return file ? file.async("text") : null;
}

/** Copy all image/media assets referenced by a slide from the original template */
async function copySlideAssets(templateBuf: ArrayBuffer, slideNum: number, targetZip: JSZip): Promise<void> {
  const origZip = await JSZip.loadAsync(templateBuf);
  const relsFile = origZip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`);
  if (!relsFile) return;
  
  const relsXml = await relsFile.async("text");
  const targetMatches = relsXml.matchAll(/Target="([^"]+)"/g);
  
  for (const m of targetMatches) {
    let target = m[1];
    if (target.startsWith("../")) {
      target = "ppt/" + target.replace(/^\.\.\//g, "");
    } else if (!target.startsWith("ppt/")) {
      target = `ppt/slides/${target}`;
    }
    
    // Only copy media files (images, etc.)
    if (target.includes("media/") || target.includes("image")) {
      const file = origZip.file(target);
      if (file && !targetZip.file(target)) {
        const data = await file.async("uint8array");
        targetZip.file(target, data);
      }
    }
  }
  
  // Also ensure all ppt/media files are present (logos, etc.)
  const mediaFiles = Object.keys(origZip.files).filter(f => f.startsWith("ppt/media/"));
  for (const mediaFile of mediaFiles) {
    if (!targetZip.file(mediaFile)) {
      const data = await origZip.file(mediaFile)!.async("uint8array");
      targetZip.file(mediaFile, data);
    }
  }
}

/** Replace text in a slide XML - finds title and body placeholders, repositions shapes */
function replaceSlideText(slideXml: string, title: string, bullets: string[], slideCx: number, slideCy: number): string {
  let result = slideXml;

  // Replace title placeholder text
  result = replacePlaceholderText(result, ["title", "ctrTitle"], title);

  // Replace body placeholder text with bullets
  result = replaceBodyPlaceholder(result, bullets);

  // Reposition shapes for better layout
  result = repositionShapes(result, slideCx, slideCy);

  return result;
}

/** Reposition shapes on content slides. */
function repositionShapes(xml: string, slideCx: number, slideCy: number): string {
  const shapes = findAllShapes(xml);

  // Tunables (in EMU)
  const marginLeft = 548640; // 0.6"
  const marginRight = 137160; // 0.15"
  const marginBottom = 109728; // 0.12"

  // Move content clearly below logo area
  const titleY = 1920240; // 2.1"
  const titleH = 640080; // 0.7"
  const bodyY = 2651760; // 2.9"

  const contentW = slideCx - marginLeft - marginRight;

  const dateW = 2286000; // 2.5" – wide enough for full date on one line
  const dateH = 256032; // ~0.28"
  const slideNumW = 365760; // 0.4"
  const slideNumH = 256032;

  // Place slide number at far right, date just left of it
  const slideNumX = Math.max(marginLeft, slideCx - marginRight - slideNumW);
  const dateX = Math.max(marginLeft, slideNumX - dateW);
  const footerY = Math.max(0, slideCy - marginBottom - dateH);

  for (const { full, inner } of shapes) {
    const isTitle = /<p:ph[^>]*type="(?:title|ctrTitle)"/i.test(inner);
    const isBody = /<p:ph[^>]*(?:type="body"|idx="1")/.test(inner);
    const isDate = /<p:ph[^>]*type="dt"/.test(inner);
    const isSlideNum = /<p:ph[^>]*type="sldNum"/.test(inner);
    const isFtr = /<p:ph[^>]*type="ftr"/.test(inner);

    // Remove date placeholder entirely
    if (isDate) {
      xml = xml.replace(full, "");
      continue;
    }

    let newFull = full;

    if (isTitle) {
      newFull = setShapePosition(newFull, marginLeft, titleY, contentW, titleH);
    } else if (isBody) {
      const bodyH = Math.max(914400, footerY - bodyY);
      newFull = setShapePosition(newFull, marginLeft, bodyY, contentW, bodyH);
    } else if (isSlideNum) {
      newFull = setShapePosition(newFull, slideNumX, footerY, slideNumW, slideNumH);
    } else if (isFtr) {
      newFull = setShapePosition(newFull, marginLeft, footerY, 4114800, dateH);
    }

    if (newFull !== full) {
      xml = xml.replace(full, newFull);
    }
  }

  return xml;
}

/** Set or replace the position/size of a shape via its <a:xfrm> inside <p:spPr> */
function setShapePosition(shapeXml: string, x: number, y: number, cx: number, cy: number): string {
  const xfrm = `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
  
  // If shape already has <a:xfrm>, replace it
  if (/<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/.test(shapeXml)) {
    return shapeXml.replace(/<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/, xfrm);
  }
  
  // If <p:spPr> exists but has no xfrm, inject it
  if (/<p:spPr[^>]*\/>/.test(shapeXml)) {
    return shapeXml.replace(/<p:spPr[^>]*\/>/, `<p:spPr>${xfrm}</p:spPr>`);
  }
  if (/<p:spPr[^>]*>/.test(shapeXml)) {
    return shapeXml.replace(/<p:spPr([^>]*)>/, `<p:spPr$1>${xfrm}`);
  }
  
  return shapeXml;
}

function replacePlaceholderText(xml: string, phTypes: string[], newText: string): string {
  // Match entire <p:sp>...</p:sp> blocks (non-greedy won't work with nested tags, use greedy with tracking)
  const shapes = findAllShapes(xml);
  
  for (const { full, inner, start, end } of shapes) {
    // Check if this shape has one of the target placeholder types
    const hasPlaceholder = phTypes.some(pt => {
      return new RegExp(`<p:ph[^>]*type="${pt}"`, "i").test(inner);
    });
    if (!hasPlaceholder) continue;
    
    // Find <p:txBody> and replace/create content
    const txBodyMatch = inner.match(/<p:txBody>([\s\S]*)<\/p:txBody>/);
    if (!txBodyMatch) continue;
    
    const txBody = txBodyMatch[1];
    
    // Extract existing run properties (rPr) for formatting
    const rPrMatch = txBody.match(/<a:rPr([^>]*(?:\/>|>[^<]*<\/a:rPr>))/);
    const endRPrMatch = txBody.match(/<a:endParaRPr([^>]*(?:\/>|>[^<]*<\/a:endParaRPr>))/);
    
    // Build rPr from existing run props or endParaRPr
    let rPr = "";
    if (rPrMatch) {
      rPr = `<a:rPr${rPrMatch[1]}`;
      // Ensure it's properly closed
      if (!rPr.includes("</a:rPr>") && !rPr.endsWith("/>")) rPr += "/>";
    } else if (endRPrMatch) {
      // Convert endParaRPr to rPr
      let attrs = endRPrMatch[1];
      if (attrs.endsWith("/>")) {
        rPr = `<a:rPr${attrs}`;
      } else {
        rPr = `<a:rPr${attrs.replace("</a:endParaRPr>", "</a:rPr>")}`;
      }
    }
    
    // Extract paragraph properties
    const pPrMatch = txBody.match(/<a:pPr[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    
    // Build new txBody content - keep bodyPr and lstStyle, replace paragraphs
    const bodyPrMatch = txBody.match(/<a:bodyPr[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/);
    const lstStyleMatch = txBody.match(/<a:lstStyle[^>]*(?:\/>|>[\s\S]*?<\/a:lstStyle>)/);
    const bodyPr = bodyPrMatch ? bodyPrMatch[0] : "<a:bodyPr/>";
    const lstStyle = lstStyleMatch ? lstStyleMatch[0] : "<a:lstStyle/>";
    
    // Force a reasonable title font size (2400 = 24pt) to avoid overlapping logo
    let titleRPr = rPr;
    titleRPr = titleRPr.replace(/sz="\d+"/, 'sz="2400"');
    if (!titleRPr.includes('sz="')) {
      titleRPr = titleRPr.replace('<a:rPr', '<a:rPr sz="2400"');
    }
    const newTxBody = `<p:txBody>${bodyPr}${lstStyle}<a:p>${pPr}<a:r>${titleRPr}<a:t>${escapeXml(newText)}</a:t></a:r></a:p></p:txBody>`;
    
    // Replace the txBody in the shape
    const newInner = inner.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, newTxBody);
    const newFull = full.replace(inner, newInner);
    xml = xml.substring(0, start) + newFull + xml.substring(end);
    
    break; // Only replace first matching shape
  }
  
  return xml;
}

function replaceBodyPlaceholder(xml: string, bullets: string[]): string {
  if (bullets.length === 0) return xml;
  
  const shapes = findAllShapes(xml);
  
  for (const { full, inner, start, end } of shapes) {
    // Check for body placeholder (type="body" or idx="1")
    const isBody = /<p:ph[^>]*(?:type="body"|idx="1")/.test(inner);
    if (!isBody) continue;
    
    const txBodyMatch = inner.match(/<p:txBody>([\s\S]*)<\/p:txBody>/);
    if (!txBodyMatch) continue;
    
    const txBody = txBodyMatch[1];
    
    // Extract formatting from existing content
    const rPrMatch = txBody.match(/<a:rPr([^>]*(?:\/>|>[^<]*<\/a:rPr>))/);
    const endRPrMatch = txBody.match(/<a:endParaRPr([^>]*(?:\/>|>[^<]*<\/a:endParaRPr>))/);
    
    let rPr = "";
    if (rPrMatch) {
      rPr = `<a:rPr${rPrMatch[1]}`;
      if (!rPr.includes("</a:rPr>") && !rPr.endsWith("/>")) rPr += "/>";
    } else if (endRPrMatch) {
      let attrs = endRPrMatch[1];
      if (attrs.endsWith("/>")) {
        rPr = `<a:rPr${attrs}`;
      } else {
        rPr = `<a:rPr${attrs.replace("</a:endParaRPr>", "</a:rPr>")}`;
      }
    }
    
    // Extract first paragraph properties (for bullet formatting etc.)
    const pPrMatch = txBody.match(/<a:pPr[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    
    const bodyPrMatch = txBody.match(/<a:bodyPr[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/);
    const lstStyleMatch = txBody.match(/<a:lstStyle[^>]*(?:\/>|>[\s\S]*?<\/a:lstStyle>)/);
    const bodyPr = bodyPrMatch ? bodyPrMatch[0] : "<a:bodyPr/>";
    const lstStyle = lstStyleMatch ? lstStyleMatch[0] : "<a:lstStyle/>";
    
    // Force body font size (1600 = 16pt) to fit content
    let bodyRPr = rPr;
    bodyRPr = bodyRPr.replace(/sz="\d+"/, 'sz="1600"');
    if (!bodyRPr.includes('sz="')) {
      bodyRPr = bodyRPr.replace('<a:rPr', '<a:rPr sz="1600"');
    }
    
    // Build paragraph properties with bullet character
    // Use a clean bullet: "●" with Wingdings-style or standard char bullet
    const bulletPPr = `<a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial" panose="020B0604020202020204"/><a:buChar char="&#x2022;"/><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr>`;
    
    // Build paragraphs for each bullet
    const newParagraphs = bullets.map(bullet => 
      `<a:p>${bulletPPr}<a:r>${bodyRPr}<a:t>${escapeXml(bullet)}</a:t></a:r></a:p>`
    ).join("");
    
    const newTxBody = `<p:txBody>${bodyPr}${lstStyle}${newParagraphs}</p:txBody>`;
    
    const newInner = inner.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, newTxBody);
    const newFull = full.replace(inner, newInner);
    xml = xml.substring(0, start) + newFull + xml.substring(end);
    
    break;
  }
  
  return xml;
}

/** Find all <p:sp> shape elements with their positions */
function findAllShapes(xml: string): { full: string; inner: string; start: number; end: number }[] {
  const results: { full: string; inner: string; start: number; end: number }[] = [];
  const openTag = "<p:sp>";
  const openTagAlt = "<p:sp ";
  const closeTag = "</p:sp>";
  
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    let startIdx = xml.indexOf(openTag, searchFrom);
    const startIdx2 = xml.indexOf(openTagAlt, searchFrom);
    
    if (startIdx === -1 && startIdx2 === -1) break;
    if (startIdx === -1) startIdx = startIdx2;
    else if (startIdx2 !== -1 && startIdx2 < startIdx) startIdx = startIdx2;
    
    // Find matching close tag (handle nesting - though p:sp shouldn't nest)
    const endIdx = xml.indexOf(closeTag, startIdx);
    if (endIdx === -1) break;
    
    const fullEnd = endIdx + closeTag.length;
    const full = xml.substring(startIdx, fullEnd);
    
    // Extract inner content (between opening and closing tags)
    const openClose = xml.indexOf(">", startIdx);
    const inner = xml.substring(openClose + 1, endIdx);
    
    results.push({ full, inner, start: startIdx, end: fullEnd });
    searchFrom = fullEnd;
  }
  
  return results;
}

/** Create a notes slide XML with speaker notes text */
function createNotesSlideXml(slideNum: number, notes: string): string {
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
        <p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
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

/** Remove all date placeholder shapes from slide XML */
function removeDatePlaceholder(xml: string): string {
  const shapes = findAllShapes(xml);
  for (const { full, inner } of shapes) {
    if (/<p:ph[^>]*type="dt"/.test(inner)) {
      xml = xml.replace(full, "");
    }
  }
  return xml;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
