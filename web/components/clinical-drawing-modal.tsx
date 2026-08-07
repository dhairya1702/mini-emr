"use client";

import { Eraser, PenLine, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

const DRAWING_COLOR_PRESETS = [
  { label: "Black", value: "#0f172a" },
  { label: "Red", value: "#dc2626" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#16a34a" },
  { label: "Purple", value: "#9333ea" },
  { label: "Yellow", value: "#ca8a04" },
  { label: "Brown", value: "#92400e" },
] as const;

type Props = {
  open: boolean;
  title: string;
  value?: string | null;
  canvasWidth?: number;
  canvasHeight?: number;
  outputType?: "image/png" | "image/webp";
  onClose: () => void;
  onSave: (dataUrl: string | null) => void;
};

export function ClinicalDrawingModal({ open, title, value, canvasWidth = 1680, canvasHeight = 800, outputType = "image/png", onClose, onSave }: Props) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [mode, setMode] = useState<"draw" | "erase">("draw");
  const [colour, setColour] = useState("#0f172a");
  const [brushSize, setBrushSize] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [undoDepth, setUndoDepth] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setIsDrawing(false);
    setMode("draw");
    setZoom(1);
    setUndoDepth(0);
    historyRef.current = [];
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const image = new window.Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
  }, [open, value]);

  if (!open) return null;

  function beginDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    historyRef.current = [...historyRef.current, canvas.toDataURL("image/png")].slice(-12);
    setUndoDepth(historyRef.current.length);
    const rect = canvas.getBoundingClientRect();
    context.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = colour;
    context.lineWidth = mode === "erase" ? brushSize * 4 : brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height));
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDrawing(true);
  }

  function continueDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    context.lineTo((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height));
    context.stroke();
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    historyRef.current = [];
    setUndoDepth(0);
  }

  function undoDrawing() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const previous = historyRef.current.pop();
    setUndoDepth(historyRef.current.length);
    if (!canvas || !context || !previous) return;
    const image = new window.Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = previous;
  }

  function saveDrawing() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const hasInk = pixels.some((channel, index) => index % 4 === 3 && channel > 0);
    onSave(hasInk ? canvas.toDataURL(outputType, outputType === "image/webp" ? 0.82 : undefined) : null);
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-2 sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
    <div className="flex h-[calc(100dvh-1rem)] w-full max-w-[1500px] flex-col overflow-hidden rounded-[22px] border border-[#bfd7e8] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.4)] sm:h-[calc(100dvh-2.5rem)]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#dbe7ef] bg-[#f8fbfd] px-4 py-3 sm:px-6">
        <h2 className="mr-2 text-sm font-semibold text-slate-900">{title}</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMode("draw")} className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${mode === "draw" ? "border-[#6daed8] bg-[#dbeaf4] text-[#235f8e]" : "border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#f3f8fb]"}`}><PenLine className="mr-1.5 inline h-4 w-4" />Draw</button>
          <button type="button" onClick={() => setMode("erase")} className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${mode === "erase" ? "border-[#6daed8] bg-[#dbeaf4] text-[#235f8e]" : "border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#f3f8fb]"}`}><Eraser className="mr-1.5 inline h-4 w-4" />Erase</button>
        </div>
        <div className="h-8 w-px bg-[#dbe7ef]" />
        <div className="flex flex-wrap items-center gap-2" aria-label="Drawing colours">
          {DRAWING_COLOR_PRESETS.map((preset) => <button key={preset.value} type="button" title={preset.label} aria-label={`${preset.label} drawing colour`} aria-pressed={colour === preset.value} onClick={() => { setColour(preset.value); setMode("draw"); }} className={`h-8 w-8 rounded-full border-2 transition hover:scale-110 ${colour === preset.value ? "border-slate-900 ring-2 ring-sky-200" : "border-white ring-1 ring-slate-300"}`} style={{ backgroundColor: preset.value }} />)}
          <label className="relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)] ring-1 ring-slate-300" title="Custom colour"><span className="sr-only">Choose custom drawing colour</span><input type="color" value={colour} onChange={(event) => { setColour(event.target.value); setMode("draw"); }} className="absolute inset-0 cursor-pointer opacity-0" /></label>
        </div>
        <div className="h-8 w-px bg-[#dbe7ef]" />
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))} disabled={zoom <= 0.5} className="rounded-lg border border-[#bfd7e8] bg-white p-2 text-slate-700 transition hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-45" aria-label="Zoom drawing out"><ZoomOut className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs font-medium text-slate-600">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((current) => Math.min(2, Number((current + 0.25).toFixed(2))))} disabled={zoom >= 2} className="rounded-lg border border-[#bfd7e8] bg-white p-2 text-slate-700 transition hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-45" aria-label="Zoom drawing in"><ZoomIn className="h-4 w-4" /></button>
        </div>
        <div className="h-8 w-px bg-[#dbe7ef]" />
        <div className="flex items-center gap-3"><span className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Brush</span><input type="range" min={1} max={20} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} className="w-28 accent-[#2f8fd3] sm:w-36" /><span className="w-9 text-xs text-slate-500">{brushSize}px</span></div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={undoDrawing} disabled={!undoDepth} className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:cursor-not-allowed disabled:opacity-45"><Undo2 className="mr-1.5 inline h-4 w-4" />Undo</button>
          <button type="button" onClick={clearDrawing} className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb]">Clear</button>
          <button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] bg-white p-2 text-slate-600 transition hover:bg-[#f3f8fb]" aria-label="Close drawing"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-[#eef5f9] p-3 sm:p-5"><canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} onPointerDown={beginDrawing} onPointerMove={continueDrawing} onPointerUp={() => setIsDrawing(false)} onPointerCancel={() => setIsDrawing(false)} className="aspect-[21/10] h-auto max-w-none shrink-0 touch-none rounded-[18px] border border-[#bfd7e8] bg-white shadow-inner" style={{ width: `${zoom * 100}%` }} /></div>
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#dbe7ef] px-4 py-3 sm:px-6"><button type="button" onClick={onClose} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f8fb]">Cancel</button><button type="button" onClick={saveDrawing} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">Save</button></div>
    </div>
  </div>;
}
