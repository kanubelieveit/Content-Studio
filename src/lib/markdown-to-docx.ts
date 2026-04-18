import JSZip from "jszip";

/**
 * Convert markdown text to a simple .docx file.
 * Uses the Office Open XML format with JSZip.
 */
export async function markdownToDocx(markdown: string): Promise<Blob> {
  const zip = new JSZip();

  // Convert markdown to OOXML paragraphs
  const paragraphs = markdownToParagraphs(markdown);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.file("word/document.xml", documentXml);

  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="36"/><w:color w:val="002C50"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="28"/><w:color w:val="002C50"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="200" w:after="60"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="24"/><w:color w:val="002C50"/></w:rPr>
  </w:style>
</w:styles>`);

  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToParagraphs(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      // Empty line = spacing paragraph
      result.push(`    <w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`);
      continue;
    }

    // Heading 1: # 
    if (/^# /.test(trimmed)) {
      const text = trimmed.replace(/^# /, "");
      result.push(makeParagraph(text, "Heading1"));
      continue;
    }

    // Heading 2: ##
    if (/^## /.test(trimmed)) {
      const text = trimmed.replace(/^## /, "");
      result.push(makeParagraph(text, "Heading2"));
      continue;
    }

    // Heading 3: ###
    if (/^### /.test(trimmed)) {
      const text = trimmed.replace(/^### /, "");
      result.push(makeParagraph(text, "Heading3"));
      continue;
    }

    // Blockquote: >
    if (/^> /.test(trimmed)) {
      const text = trimmed.replace(/^> /, "");
      result.push(`    <w:p>
      <w:pPr><w:ind w:left="720"/></w:pPr>
      ${makeRuns(text, true)}
    </w:p>`);
      continue;
    }

    // Checkbox: - [ ] or - [x]
    if (/^- \[[ x]\] /.test(trimmed)) {
      const checked = trimmed.startsWith("- [x]");
      const text = trimmed.replace(/^- \[[ x]\] /, "");
      const prefix = checked ? "☑ " : "☐ ";
      result.push(makeBulletParagraph(prefix + text));
      continue;
    }

    // Bullet: - or *
    if (/^[-*] /.test(trimmed)) {
      const text = trimmed.replace(/^[-*] /, "");
      result.push(makeBulletParagraph(text));
      continue;
    }

    // Horizontal rule: ---
    if (/^-{3,}$/.test(trimmed)) {
      result.push(`    <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`);
      continue;
    }

    // Regular paragraph (handle **bold** inline)
    result.push(`    <w:p>${makeRuns(trimmed)}</w:p>`);
  }

  return result.join("\n");
}

function makeParagraph(text: string, style: string): string {
  return `    <w:p>
      <w:pPr><w:pStyle w:val="${style}"/></w:pPr>
      ${makeRuns(text)}
    </w:p>`;
}

function makeBulletParagraph(text: string): string {
  return `    <w:p>
      <w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">•  </w:t></w:r>${makeRuns(text)}
    </w:p>`;
}

function makeRuns(text: string, italic?: boolean): string {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        const inner = part.slice(2, -2);
        return `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:b/>${italic ? "<w:i/>" : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(inner)}</w:t></w:r>`;
      }
      if (!part) return "";
      return `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>${italic ? "<w:i/>" : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`;
    })
    .join("");
}
