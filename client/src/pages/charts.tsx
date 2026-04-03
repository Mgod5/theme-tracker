import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  BarChart2,
  AlertCircle,
  MousePointer2,
  ArrowUpRight,
  Type,
  Trash2,
} from "lucide-react";
import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries } from "lightweight-charts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OHLCVPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

interface StockChartData {
  symbol: string;
  currentPrice: number | null;
  sector: string | null;
  themes: string[];
  adr: number | null;
  atrMultiple: number | null;
  dollarVolume: number | null;
  avgVolume20d: number | null;
  volumeDirection: "rising" | "falling" | null;
  rsi14: number | null;
  rsiPrev: number | null;
  priceHistory: OHLCVPoint[];
}

type DrawMode = "none" | "trend-line" | "text";

interface DrawnLine {
  id: string;
  p1: { time: string; price: number };
  p2: { time: string; price: number };
}

interface DrawnText {
  id: string;
  time: string;
  price: number;
  text: string;
}

// ── Chart constants ────────────────────────────────────────────────────────────

const CHART_HEIGHT = 460;

const SMA_COLORS = {
  sma10: "#e91e90",
  sma20: "#f59e0b",
  sma50: "#22c55e",
  sma200: "#8b5cf6",
  vwap: "#06b6d4",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeSMASeries(data: { time: string; close: number }[], period: number) {
  const result: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

function computeVWAPSeries(data: { time: string; close: number; volume: number }[]) {
  const result: { time: string; value: number }[] = [];
  let cumPV = 0, cumVol = 0;
  for (const d of data) {
    cumPV += d.close * d.volume;
    cumVol += d.volume;
    if (cumVol > 0) result.push({ time: d.time, value: cumPV / cumVol });
  }
  return result;
}

function formatDollarVolume(value: number | null): string {
  if (value === null) return "--";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatVolume(value: number | null): string {
  if (value === null) return "--";
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

// Convert lightweight-charts Time (any format) to YYYY-MM-DD string
function timeToStr(t: any): string {
  if (t === null || t === undefined) return "";
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString().split("T")[0];
  if (typeof t === "object" && "year" in t) {
    return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  }
  return String(t);
}

// Extend a line segment between two pixel points to the chart edges
function extendedLine(
  x1: number, y1: number,
  x2: number, y2: number,
  w: number,
) {
  if (Math.abs(x2 - x1) < 0.5) return { x1, y1: -500, x2, y2: 2000 };
  const slope = (y2 - y1) / (x2 - x1);
  return {
    x1: 0,
    y1: y1 - slope * x1,
    x2: w,
    y2: y1 + slope * (w - x1),
  };
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-4 py-3 min-w-[90px]">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold whitespace-nowrap">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color || "text-foreground"}`}>{value}</span>
    </div>
  );
}

// ── Drawing toolbar ────────────────────────────────────────────────────────────

function DrawingToolbar({
  mode, onMode, onClearAll, hasFocus,
}: {
  mode: DrawMode;
  onMode: (m: DrawMode) => void;
  onClearAll: () => void;
  hasFocus: boolean;
}) {
  return (
    <div className="flex items-center gap-1 mb-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">Draw</span>
      <Button
        size="sm"
        variant={mode === "none" ? "secondary" : "ghost"}
        onClick={() => onMode("none")}
        title="Select / Pan"
        data-testid="button-draw-select"
        className="gap-1.5 h-7 px-2"
      >
        <MousePointer2 className="w-3.5 h-3.5" />
        <span className="text-xs">Select</span>
      </Button>
      <Button
        size="sm"
        variant={mode === "trend-line" ? "secondary" : "ghost"}
        onClick={() => onMode(mode === "trend-line" ? "none" : "trend-line")}
        title="Draw trend line (click two points)"
        data-testid="button-draw-trendline"
        className="gap-1.5 h-7 px-2"
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
        <span className="text-xs">Trend Line</span>
      </Button>
      <Button
        size="sm"
        variant={mode === "text" ? "secondary" : "ghost"}
        onClick={() => onMode(mode === "text" ? "none" : "text")}
        title="Add text annotation"
        data-testid="button-draw-text"
        className="gap-1.5 h-7 px-2"
      >
        <Type className="w-3.5 h-3.5" />
        <span className="text-xs">Text</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClearAll}
        title="Clear all drawings"
        data-testid="button-draw-clear"
        className="gap-1.5 h-7 px-2"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span className="text-xs">Clear</span>
      </Button>
      {mode !== "none" && (
        <span className="text-[10px] text-amber-500 ml-1">
          {mode === "trend-line"
            ? "Click two points on the chart to draw a trend line. Press Esc to cancel."
            : "Click anywhere on the chart to place text. Press Esc to cancel."}
        </span>
      )}
    </div>
  );
}

// ── Candlestick chart with drawing overlay ────────────────────────────────────

function StockCandlestickChart({ symbol, data }: { symbol: string; data: StockChartData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<any>(null);

  // Drawing state
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [pendingP1, setPendingP1] = useState<{ time: string; price: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [lines, setLines] = useState<DrawnLine[]>([]);
  const [texts, setTexts] = useState<DrawnText[]>([]);
  const [textInput, setTextInput] = useState({
    visible: false, x: 0, y: 0, time: "", price: 0, value: "",
  });
  // Incrementing this forces SVG to re-read pixel positions after chart scroll/zoom
  const [svgTick, setSvgTick] = useState(0);

  // Load persisted drawings for this symbol on mount
  useEffect(() => {
    fetch(`/api/stocks/${symbol}/drawings`)
      .then((r) => r.ok ? r.json() : [])
      .then((saved: Array<{ id: number; type: string; data: string }>) => {
        const loadedLines: DrawnLine[] = [];
        const loadedTexts: DrawnText[] = [];
        for (const d of saved) {
          try {
            const p = JSON.parse(d.data);
            if (d.type === "trend-line" && p.p1 && p.p2) {
              loadedLines.push({ id: String(d.id), p1: p.p1, p2: p.p2 });
            } else if (d.type === "text" && p.time != null && p.text != null) {
              loadedTexts.push({ id: String(d.id), time: p.time, price: p.price, text: p.text });
            }
          } catch {}
        }
        setLines(loadedLines);
        setTexts(loadedTexts);
      })
      .catch(() => {});
  }, [symbol]);

  // Save a drawing to the DB; updates its local id to the DB id after save
  const saveDrawing = useCallback((type: string, drawingData: object, tempId: string) => {
    fetch(`/api/stocks/${symbol}/drawings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data: JSON.stringify(drawingData) }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((saved: { id: number } | null) => {
        if (!saved) return;
        const dbId = String(saved.id);
        if (type === "trend-line") {
          setLines((prev) => prev.map((l) => l.id === tempId ? { ...l, id: dbId } : l));
        } else if (type === "text") {
          setTexts((prev) => prev.map((t) => t.id === tempId ? { ...t, id: dbId } : t));
        }
      })
      .catch(() => {});
  }, [symbol]);

  // Escape key cancels pending drawing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawMode("none");
        setPendingP1(null);
        setMousePos(null);
        setTextInput((p) => ({ ...p, visible: false, value: "" }));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Reset pending state when mode changes
  useEffect(() => {
    setPendingP1(null);
    setMousePos(null);
    setTextInput((p) => ({ ...p, visible: false, value: "" }));
  }, [drawMode]);

  // Process chart data
  const processedData = useMemo(() => {
    const candles = data.priceHistory
      .filter((p) => p.close != null)
      .map((p) => ({
        time: p.date,
        open: p.open ?? p.close,
        high: p.high ?? p.close,
        low: p.low ?? p.close,
        close: p.close,
        volume: p.volume || 0,
      }));
    if (candles.length === 0) return null;

    const volumeData = candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)",
    }));
    const closesForSMA = candles.map((c) => ({ time: c.time, close: c.close, volume: c.volume }));
    return {
      candles,
      volumeData,
      sma10: computeSMASeries(closesForSMA, 10),
      sma20: computeSMASeries(closesForSMA, 20),
      sma50: computeSMASeries(closesForSMA, 50),
      sma200: computeSMASeries(closesForSMA, 200),
      vwap: computeVWAPSeries(closesForSMA),
    };
  }, [data]);

  // Build and destroy the chart
  useEffect(() => {
    if (!containerRef.current || !processedData) return;
    const container = containerRef.current;
    container.innerHTML = "";
    const isDark = document.documentElement.classList.contains("dark");

    const chart = createChart(container, {
      width: container.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#a1a1aa" : "#71717a",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)" },
      timeScale: { borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)", timeVisible: false },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#16a34a", wickDownColor: "#dc2626",
    });
    candleSeries.setData(processedData.candles);
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeSeries.setData(processedData.volumeData);

    const addLine = (lineData: { time: string; value: number }[], color: string) => {
      if (!lineData.length) return;
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(lineData);
    };
    addLine(processedData.sma10, SMA_COLORS.sma10);
    addLine(processedData.sma20, SMA_COLORS.sma20);
    addLine(processedData.sma50, SMA_COLORS.sma50);
    addLine(processedData.sma200, SMA_COLORS.sma200);
    addLine(processedData.vwap, SMA_COLORS.vwap);

    chart.timeScale().fitContent();

    // Re-render SVG overlay whenever chart scrolls or zooms
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      setSvgTick((t) => t + 1);
    });

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      setSvgTick((t) => t + 1);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [processedData]);

  // Convert time/price to pixel coords within the chart container
  const getPixel = useCallback((time: string, price: number) => {
    if (!chartRef.current || !candleSeriesRef.current) return null;
    const x = chartRef.current.timeScale().timeToCoordinate(time as any);
    const y = candleSeriesRef.current.priceToCoordinate(price);
    if (x === null || y === null) return null;
    return { x: x as number, y: y as number };
  }, []);

  // Convert pixel coords to time/price
  const pixelToTimePrice = useCallback((px: number, py: number) => {
    if (!chartRef.current || !candleSeriesRef.current) return null;
    const rawTime = chartRef.current.timeScale().coordinateToTime(px);
    const price = candleSeriesRef.current.coordinateToPrice(py);
    if (rawTime === null || price === null) return null;
    return { time: timeToStr(rawTime), price };
  }, []);

  // Overlay mouse handlers
  const handleOverlayClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drawMode === "none") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const tp = pixelToTimePrice(px, py);
    if (!tp) return;

    if (drawMode === "trend-line") {
      if (!pendingP1) {
        setPendingP1(tp);
      } else {
        if (pendingP1.time !== tp.time || pendingP1.price !== tp.price) {
          const tempId = `temp:${crypto.randomUUID()}`;
          setLines((prev) => [...prev, { id: tempId, p1: pendingP1, p2: tp }]);
          saveDrawing("trend-line", { p1: pendingP1, p2: tp }, tempId);
        }
        setPendingP1(null);
        setDrawMode("none");
      }
    } else if (drawMode === "text") {
      setTextInput({ visible: true, x: px, y: py, time: tp.time, price: tp.price, value: "" });
    }
  }, [drawMode, pendingP1, pixelToTimePrice]);

  const handleOverlayMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drawMode !== "trend-line" || !pendingP1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [drawMode, pendingP1]);

  const commitText = useCallback(() => {
    const val = textInput.value.trim();
    if (val) {
      const tempId = `temp:${crypto.randomUUID()}`;
      const newText = { id: tempId, time: textInput.time, price: textInput.price, text: val };
      setTexts((prev) => [...prev, newText]);
      saveDrawing("text", { time: textInput.time, price: textInput.price, text: val }, tempId);
    }
    setTextInput((p) => ({ ...p, visible: false, value: "" }));
    setDrawMode("none");
  }, [textInput, saveDrawing]);

  const w = containerRef.current?.clientWidth ?? 600;

  if (!processedData) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No price history available
      </div>
    );
  }

  return (
    <div>
      {/* SMA/VWAP legend + title */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground">{symbol} Daily — up to 3 Years</span>
        {[
          { label: "SMA 10", color: SMA_COLORS.sma10 },
          { label: "SMA 20", color: SMA_COLORS.sma20 },
          { label: "SMA 50", color: SMA_COLORS.sma50 },
          { label: "SMA 200", color: SMA_COLORS.sma200 },
          { label: "VWAP", color: SMA_COLORS.vwap },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-[10px] text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Drawing toolbar */}
      <DrawingToolbar
        mode={drawMode}
        onMode={setDrawMode}
        onClearAll={() => {
          setLines([]);
          setTexts([]);
          setPendingP1(null);
          fetch(`/api/stocks/${symbol}/drawings`, { method: "DELETE" }).catch(() => {});
        }}
        hasFocus={drawMode !== "none"}
      />

      {/* Chart container with SVG overlay */}
      <div
        style={{ position: "relative", height: `${CHART_HEIGHT}px`, userSelect: "none" }}
        data-testid={`chart-stock-${symbol}`}
      >
        {/* lightweight-charts renders into this div */}
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* SVG drawing overlay */}
        <svg
          data-svg-tick={svgTick}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: drawMode !== "none" ? "all" : "none",
            cursor: drawMode !== "none" ? "crosshair" : "default",
            overflow: "hidden",
          }}
          onClick={handleOverlayClick}
          onMouseMove={handleOverlayMouseMove}
        >
          {/* Rendered trend lines */}
          {lines.map((line) => {
            const pp1 = getPixel(line.p1.time, line.p1.price);
            const pp2 = getPixel(line.p2.time, line.p2.price);
            if (!pp1 || !pp2) return null;
            const ext = extendedLine(pp1.x, pp1.y, pp2.x, pp2.y, w);
            return (
              <g key={line.id}>
                <line
                  x1={ext.x1} y1={ext.y1} x2={ext.x2} y2={ext.y2}
                  stroke="#f59e0b" strokeWidth={1.5} opacity={0.85}
                />
                <circle cx={pp1.x} cy={pp1.y} r={3} fill="#f59e0b" opacity={0.9} />
                <circle cx={pp2.x} cy={pp2.y} r={3} fill="#f59e0b" opacity={0.9} />
              </g>
            );
          })}

          {/* Preview line while placing second point */}
          {drawMode === "trend-line" && pendingP1 && mousePos && (() => {
            const pp1 = getPixel(pendingP1.time, pendingP1.price);
            if (!pp1) return null;
            return (
              <g>
                <line
                  x1={pp1.x} y1={pp1.y} x2={mousePos.x} y2={mousePos.y}
                  stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" opacity={0.6}
                />
                <circle cx={pp1.x} cy={pp1.y} r={3} fill="#f59e0b" />
              </g>
            );
          })()}

          {/* Text annotations */}
          {texts.map((txt) => {
            const pp = getPixel(txt.time, txt.price);
            if (!pp) return null;
            return (
              <text
                key={txt.id}
                x={pp.x + 4}
                y={pp.y - 4}
                fill="#fbbf24"
                fontSize="12"
                fontFamily="system-ui, sans-serif"
                fontWeight="600"
                stroke="rgba(0,0,0,0.6)"
                strokeWidth="3"
                paintOrder="stroke"
                style={{ userSelect: "none" }}
              >
                {txt.text}
              </text>
            );
          })}
        </svg>

        {/* Text annotation input */}
        {textInput.visible && (
          <input
            autoFocus
            value={textInput.value}
            onChange={(e) => setTextInput((p) => ({ ...p, value: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") { setTextInput((p) => ({ ...p, visible: false })); setDrawMode("none"); }
            }}
            onBlur={commitText}
            placeholder="Type label…"
            style={{
              position: "absolute",
              left: textInput.x + 4,
              top: textInput.y - 20,
              background: "rgba(15, 15, 15, 0.85)",
              border: "1px solid #f59e0b",
              borderRadius: "3px",
              color: "#fbbf24",
              fontSize: "12px",
              fontFamily: "system-ui, sans-serif",
              fontWeight: 600,
              outline: "none",
              padding: "2px 6px",
              minWidth: "100px",
              zIndex: 20,
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Charts page ───────────────────────────────────────────────────────────────

export default function Charts() {
  const params = useParams<{ symbol?: string }>();
  const symbol = params?.symbol?.toUpperCase();

  const { data, isLoading, error } = useQuery<StockChartData>({
    queryKey: ["/api/stocks", symbol, "chart"],
    queryFn: async () => {
      const res = await fetch(`/api/stocks/${symbol}/chart`);
      if (!res.ok) throw new Error("Failed to fetch chart data");
      return res.json();
    },
    enabled: !!symbol,
  });

  const rsiDirection = data?.rsi14 != null && data?.rsiPrev != null
    ? (data.rsi14 > data.rsiPrev ? "rising" : "falling") : null;
  const rsiColor = rsiDirection === "rising"
    ? "text-emerald-600 dark:text-emerald-400"
    : rsiDirection === "falling" ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
  const volColor = data?.volumeDirection === "rising"
    ? "text-emerald-600 dark:text-emerald-400"
    : data?.volumeDirection === "falling" ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
  const atrColor = data?.atrMultiple != null
    ? (data.atrMultiple > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")
    : "text-muted-foreground";

  if (!symbol) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-background flex items-center justify-center">
        <div className="text-center space-y-3 px-4">
          <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center mx-auto">
            <BarChart2 className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold">No stock selected</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Click any stock symbol on the Dashboard to view its candlestick chart.
          </p>
          <Link href="/">
            <Button variant="outline" className="gap-2 mt-2" data-testid="button-go-to-dashboard">
              <ArrowLeft className="w-4 h-4" />
              Go to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      {/* Sticky sub-header */}
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 mb-2 text-muted-foreground" data-testid="button-back-to-dashboard">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Button>
          </Link>
          {data && (
            <>
              <div className="flex items-center gap-3 flex-wrap mb-1.5">
                <h1 className="text-3xl font-bold tracking-tight" data-testid="text-stock-symbol">
                  {data.symbol}
                </h1>
                {data.currentPrice != null && (
                  <span className="text-2xl font-semibold tabular-nums text-muted-foreground" data-testid="text-stock-price">
                    ${data.currentPrice.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-2.5">
                {data.themes.map((t) => (
                  <Badge key={t} variant="secondary" data-testid={`badge-theme-${t}`}>{t}</Badge>
                ))}
                {data.sector && (
                  <span className="text-sm text-muted-foreground" data-testid="text-sector">{data.sector}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <StatCard label="ADR" value={data.adr != null ? `${data.adr.toFixed(2)}%` : "--"} color="text-blue-600 dark:text-blue-400" />
                <StatCard label="$ Vol" value={formatDollarVolume(data.dollarVolume)} />
                <StatCard label="ATR Mult" value={data.atrMultiple != null ? `${data.atrMultiple.toFixed(2)}x` : "--"} color={atrColor} />
                <StatCard label="RSI (14)" value={data.rsi14 != null ? data.rsi14.toFixed(1) : "--"} color={rsiColor} />
                <StatCard label="Avg Vol (20d)" value={formatVolume(data.avgVolume20d)} color={volColor} />
              </div>
            </>
          )}
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-9 w-48" />
              <Skeleton className="h-4 w-64" />
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-22 rounded-lg" />)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {isLoading ? (
          <Skeleton className="h-[540px] w-full rounded-xl" />
        ) : error || !data ? (
          <div className="flex items-center gap-3 py-12 text-muted-foreground">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>
              Unable to load chart for <strong>{symbol}</strong>. Make sure this symbol has been added to a theme first.
            </span>
          </div>
        ) : (
          <Card className="p-5 sm:p-6">
            <StockCandlestickChart symbol={symbol} data={data} />
          </Card>
        )}
      </div>
    </div>
  );
}
