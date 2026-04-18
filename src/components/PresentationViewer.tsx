import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check, Download, ChevronLeft, ChevronRight, Presentation } from "lucide-react";

interface Slide {
  title: string;
  bullets: string[];
  speakerNotes: string;
}

interface PresentationData {
  title: string;
  slides: Slide[];
}

interface PresentationViewerProps {
  presentation: PresentationData;
  onCopy: (text: string) => void;
  onExportPptx: () => void;
}

export function PresentationViewer({ presentation, onCopy, onExportPptx }: PresentationViewerProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [copied, setCopied] = useState(false);

  const slide = presentation.slides[currentSlide];
  const total = presentation.slides.length;

  const handleCopy = () => {
    const allText = presentation.slides
      .map((s, i) => `## Slide ${i + 1}: ${s.title}\n${s.bullets.map(b => `• ${b}`).join("\n")}\n\n**Manus:** ${s.speakerNotes}`)
      .join("\n\n---\n\n");
    onCopy(`# ${presentation.title}\n\n${allText}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Presentation className="h-5 w-5 text-primary" />
            {presentation.title}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              {copied ? "Kopierat" : "Kopiera allt"}
            </Button>
            <Button variant="default" size="sm" onClick={onExportPptx}>
              <Download className="h-4 w-4 mr-1" />
              Ladda ner .pptx
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Slide preview */}
        <div className="rounded-xl bg-gradient-to-br from-primary/10 via-background to-accent/10 border border-border overflow-hidden">
          <div className="aspect-[16/9] p-8 md:p-12 flex flex-col justify-center">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-6">{slide.title}</h2>
            <ul className="space-y-3">
              {slide.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-3 text-sm md:text-base">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
            disabled={currentSlide === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Föregående
          </Button>
          <span className="text-sm text-muted-foreground font-medium">
            {currentSlide + 1} / {total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentSlide(Math.min(total - 1, currentSlide + 1))}
            disabled={currentSlide === total - 1}
          >
            Nästa
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {/* Speaker notes */}
        <div className="rounded-xl bg-muted/50 border border-border p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Talarmanus — Slide {currentSlide + 1}
          </p>
          <p className="text-sm leading-relaxed">{slide.speakerNotes}</p>
        </div>

        {/* Slide overview thumbnails */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {presentation.slides.map((s, i) => (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              className={`shrink-0 w-28 rounded-lg border-2 p-2 text-left transition-all ${
                i === currentSlide
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/30"
              }`}
            >
              <p className="text-[10px] font-medium truncate">{s.title}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{s.bullets.length} punkter</p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
