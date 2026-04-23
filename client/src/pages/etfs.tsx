import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { EtfWithPerformance } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  Trash2,
  Pencil,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { AddEtfDialog } from "@/components/add-etf-dialog";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, LineSeries } from "lightweight-charts";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" };
  const time = d.toLocaleTimeString([], opts) + " EST";
  const dayOpts: Intl.DateTimeFormatOptions = { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" };
  const estDateStr = d.toLocaleDateString("en-US", dayOpts);
  const nowDateStr = now.toLocaleDateString("en-US", dayOpts);
  if (estDateStr === nowDateStr) return `today at ${time}`;
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayStr = yesterday.toLocaleDateString("en-US", dayOpts);
  if (estDateStr === yesterdayStr) return `yesterday at ${time}`;
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  return `${dateLabel} at ${time}`;
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function getPerformanceColor(value: number | null): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function PerfPill({ value }: { value: number | null }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-muted-foreground tabular-nums">--</span>;
  }
  const sign = value >= 0 ? "+" : "";
  const cls = value > 0
    ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-800"
    : value < 0
    ? "bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-800"
    : "bg-muted text-muted-foreground ring-1 ring-border";
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums ${cls}`}>
      {sign}{value.toFixed(2)}%
    </span>
  );
}

function getPerformanceBg(value: number | null): string {
  if (value === null || value === undefined) return "bg-muted";
  if (value > 0) return "bg-emerald-50 dark:bg-emerald-950/40";
  if (value < 0) return "bg-red-50 dark:bg-red-950/40";
  return "bg-muted";
}

function PerformanceIcon({ value, className }: { value: number | null; className?: string }) {
  const iconClass = className || "w-3.5 h-3.5";
  if (value === null || value === undefined) return <Minus className={`${iconClass} text-muted-foreground`} />;
  if (value > 0) return <TrendingUp className={`${iconClass} text-emerald-600 dark:text-emerald-400`} />;
  if (value < 0) return <TrendingDown className={`${iconClass} text-red-600 dark:text-red-400`} />;
  return <Minus className={`${iconClass} text-muted-foreground`} />;
}

interface OHLCVPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

const SMA_COLORS = {
  sma10: "#e91e90",
  sma20: "#f59e0b",
  sma50: "#22c55e",
  sma200: "#8b5cf6",
  vwap: "#06b6d4",
};

function computeSMASeries(data: { time: string; close: number }[], period: number) {
  const result: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) {
      result.push({ time: data[i].time, value: sum / period });
    }
  }
  return result;
}

function computeVWAPSeries(data: { time: string; close: number; volume: number }[]) {
  const result: { time: string; value: number }[] = [];
  let cumPV = 0;
  let cumVol = 0;
  for (const d of data) {
    cumPV += d.close * d.volume;
    cumVol += d.volume;
    if (cumVol > 0) {
      result.push({ time: d.time, value: cumPV / cumVol });
    }
  }
  return result;
}

function EtfChart({ etfId, symbol }: { etfId: number; symbol: string }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  const { data, isLoading } = useQuery<{ etf: any; priceHistory: OHLCVPoint[] }>({
    queryKey: [`/api/etfs/${etfId}/price-history?days=365`],
  });

  const processedData = useMemo(() => {
    if (!data?.priceHistory || data.priceHistory.length === 0) return null;

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
    const sma10 = computeSMASeries(closesForSMA, 10);
    const sma20 = computeSMASeries(closesForSMA, 20);
    const sma50 = computeSMASeries(closesForSMA, 50);
    const sma200 = computeSMASeries(closesForSMA, 200);
    const vwap = computeVWAPSeries(closesForSMA);

    return { candles, volumeData, sma10, sma20, sma50, sma200, vwap };
  }, [data]);

  useEffect(() => {
    if (!chartContainerRef.current || !processedData) return;

    const container = chartContainerRef.current;
    container.innerHTML = "";

    const isDark = document.documentElement.classList.contains("dark");

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 400,
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
      rightPriceScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      },
      timeScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        timeVisible: false,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });
    candleSeries.setData(processedData.candles);

    const volPane = chart.addPane({ factor: 0.2 });
    const volSeries = chart.addSeries(HistogramSeries, { priceScaleId: "vol" }, 1);
    volSeries.setData(processedData.volumeData);

    const addSMA = (seriesData: { time: string; value: number }[], color: string, width = 1) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
      s.setData(seriesData);
    };

    addSMA(processedData.sma10, SMA_COLORS.sma10);
    addSMA(processedData.sma20, SMA_COLORS.sma20);
    addSMA(processedData.sma50, SMA_COLORS.sma50, 2);
    addSMA(processedData.sma200, SMA_COLORS.sma200, 2);
    addSMA(processedData.vwap, SMA_COLORS.vwap);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [processedData]);

  if (isLoading) {
    return (
      <div className="mt-4 h-[400px] rounded-md bg-muted/30 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading chart…</div>
      </div>
    );
  }

  if (!processedData) {
    return (
      <div className="mt-4 h-[200px] rounded-md bg-muted/30 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">No price data available for {symbol}.</div>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-3 mb-2 text-xs text-muted-foreground">
        {Object.entries(SMA_COLORS).map(([k, color]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: color }} />
            {k.toUpperCase()}
          </span>
        ))}
      </div>
      <div ref={chartContainerRef} className="w-full rounded-md overflow-hidden" />
    </div>
  );
}

function TopHoldings({ etfId }: { etfId: number }) {
  const { data, isLoading } = useQuery<{ holdings: { symbol: string; weight: number; change30d: number | null }[] }>({
    queryKey: [`/api/etfs/${etfId}/top-holdings`],
    staleTime: 30 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="mt-4" data-testid={`holdings-loading-${etfId}`}>
        <div className="text-sm font-semibold text-muted-foreground mb-2">Top 10 Holdings — 30-Day Performance</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[...Array(10)].map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  const holdings = data?.holdings;
  if (!holdings || holdings.length === 0) return null;

  return (
    <div className="mt-4" data-testid={`holdings-etf-${etfId}`}>
      <h4 className="text-sm font-semibold text-muted-foreground mb-2">Top 10 Holdings — 30-Day Performance</h4>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {holdings.map((h) => (
          <div
            key={h.symbol}
            className={`flex items-center justify-between rounded-md px-3 py-2 ${getPerformanceBg(h.change30d)}`}
            data-testid={`holding-${h.symbol}-${etfId}`}
          >
            <span className="text-sm font-semibold tabular-nums" data-testid={`holding-symbol-${h.symbol}`}>
              {h.symbol}
            </span>
            <span className={`text-sm font-bold tabular-nums ${getPerformanceColor(h.change30d)}`} data-testid={`holding-perf-${h.symbol}`}>
              {formatPercent(h.change30d)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EtfRow({ etf, expanded, onToggle }: { etf: EtfWithPerformance; expanded: boolean; onToggle: () => void }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(etf.name);
  const editInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

  const updateEtfMutation = useMutation({
    mutationFn: async (newName: string) => {
      const res = await apiRequest("PATCH", `/api/etfs/${etf.id}`, {
        name: newName,
        description: etf.description,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/etfs"] });
      setEditing(false);
      toast({ title: "ETF renamed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setEditName(etf.name);
      setEditing(false);
    },
  });

  const handleSaveEdit = () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === etf.name) { setEditName(etf.name); setEditing(false); return; }
    updateEtfMutation.mutate(trimmed);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSaveEdit(); }
    else if (e.key === "Escape") { setEditName(etf.name); setEditing(false); }
  };

  const deleteEtfMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/etfs/${etf.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/etfs"] });
      toast({ title: "ETF deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <tr
        className={`border-b hover:bg-muted/30 transition-colors cursor-pointer ${expanded ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}`}
        onClick={() => { if (!editing) onToggle(); }}
        data-testid={`card-etf-${etf.id}`}
      >
        <td className="py-3 px-4 w-10">
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            data-testid={`button-toggle-etf-${etf.id}`}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>

        <td className="py-3 px-4 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs font-bold shrink-0">{etf.symbol}</Badge>
            {editing ? (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Input
                  ref={editInputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={handleSaveEdit}
                  className="h-7 text-sm font-semibold w-48"
                  data-testid={`input-edit-etf-name-${etf.id}`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={handleSaveEdit}
                  disabled={updateEtfMutation.isPending}
                  data-testid={`button-save-etf-name-${etf.id}`}
                >
                  <Check className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group">
                <span
                  className="font-semibold text-sm"
                  data-testid={`text-etf-name-${etf.id}`}
                >
                  {etf.name}
                </span>
                <button
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setEditName(etf.name); setEditing(true); }}
                  data-testid={`button-edit-etf-name-${etf.id}`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </td>

        <td className="py-3 px-4 text-right tabular-nums font-medium text-sm">
          {etf.currentPrice !== null ? `$${etf.currentPrice.toFixed(2)}` : "--"}
        </td>

        <td className="py-3 px-4 text-right">
          <PerfPill value={etf.change1d} />
        </td>
        <td className="py-3 px-4 text-right">
          <PerfPill value={etf.change1w} />
        </td>
        <td className="py-3 px-4 text-right">
          <PerfPill value={etf.change1m} />
        </td>
        <td className="py-3 px-4 text-right">
          <PerfPill value={etf.change3m} />
        </td>

        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-delete-etf-${etf.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{etf.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this ETF from your tracker. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteEtfMutation.mutate()}
                    data-testid={`button-confirm-delete-etf-${etf.id}`}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr data-testid={`row-etf-detail-${etf.id}`}>
          <td colSpan={8} className="p-0 bg-muted/10 border-b">
            <div className="px-6 py-4">
              <TopHoldings etfId={etf.id} />
              <EtfChart etfId={etf.id} symbol={etf.symbol} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

type EtfSortKey = "name" | "currentPrice" | "change1d" | "change1w" | "change1m" | "change3m";
type SortDir = "asc" | "desc";

function sortEtfs(list: EtfWithPerformance[], key: EtfSortKey, dir: SortDir): EtfWithPerformance[] {
  return [...list].sort((a, b) => {
    const av = a[key] as string | number | null;
    const bv = b[key] as string | number | null;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 text-primary" />
    : <ChevronDown className="w-3 h-3 ml-1 text-primary" />;
}

function SortableTh({
  label, colKey, activeCol, dir, onSort, align = "right", className = "",
}: {
  label: string; colKey: EtfSortKey; activeCol: EtfSortKey; dir: SortDir;
  onSort: (k: EtfSortKey) => void; align?: "left" | "right"; className?: string;
}) {
  const active = activeCol === colKey;
  return (
    <th
      className={`py-3 px-4 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"} text-${align} ${className}`}
      onClick={() => onSort(colKey)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end w-full" : ""}`}>
        {align === "left"
          ? <><SortIcon active={active} dir={dir} />{label}</>
          : <>{label}<SortIcon active={active} dir={dir} /></>}
      </span>
    </th>
  );
}

export default function Etfs() {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [etfSortKey, setEtfSortKey] = useState<EtfSortKey>("name");
  const [etfSortDir, setEtfSortDir] = useState<SortDir>("asc");

  const handleEtfSort = (key: EtfSortKey) => {
    if (key === etfSortKey) setEtfSortDir(d => d === "asc" ? "desc" : "asc");
    else { setEtfSortKey(key); setEtfSortDir(key === "name" ? "asc" : "desc"); }
  };

  const { data: lastUpdatedData } = useQuery<{ lastUpdated: string | null }>({
    queryKey: ["/api/prices/last-updated"],
  });

  const { data: etfList, isLoading, error } = useQuery<EtfWithPerformance[]>({
    queryKey: ["/api/etfs"],
  });

  const toggleOne = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const refreshMutation = useMutation({
    mutationFn: async () => {
      setRefreshing(true);
      const res = await apiRequest("POST", "/api/prices/update");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/themes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/etfs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prices/last-updated"] });
      toast({ title: "Prices Updated", description: data.message || "All prices have been refreshed." });
      setRefreshing(false);
    },
    onError: (err: Error) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
      setRefreshing(false);
    },
  });

  const sortedEtfs = etfList ? sortEtfs(etfList, etfSortKey, etfSortDir) : [];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-etf-page-title">ETFs</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {etfList && etfList.length > 0
                  ? `Tracking ${etfList.length} ETF${etfList.length !== 1 ? "s" : ""}`
                  : "Track ETF performance across multiple timeframes"}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {lastUpdatedData?.lastUpdated && (
                <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="text-etf-last-refreshed">
                  Updated {formatTimestamp(lastUpdatedData.lastUpdated)}
                </span>
              )}
              <Button
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshing || refreshMutation.isPending}
                data-testid="button-refresh-etf-prices"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                Refresh Prices
              </Button>
              <AddEtfDialog />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {isLoading ? (
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/40 border-b px-4 py-3 flex gap-8">
              {[180, 80, 80, 80, 80, 80].map((w, i) => (
                <Skeleton key={i} className={`h-4 w-${w === 180 ? "44" : "12"}`} />
              ))}
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3 border-b flex gap-8 items-center">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-16" />
                {[1, 2, 3, 4].map((j) => <Skeleton key={j} className="h-4 w-14" />)}
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-md bg-destructive/10 flex items-center justify-center mb-5">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Unable to load ETFs</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              There was a problem loading your ETFs. Please check your connection and try again.
            </p>
            <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/etfs"] })}>
              Try Again
            </Button>
          </div>
        ) : etfList && etfList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center mb-5">
              <TrendingUp className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2" data-testid="text-etf-empty-title">No ETFs yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Add ETFs to track their performance across 1-day, 1-week, 1-month and 3-month timeframes.
            </p>
            <AddEtfDialog />
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden border-t-2 border-t-primary/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 border-b">
                  <th className="w-10 py-3 px-4"></th>
                  <SortableTh label="Name" colKey="name" activeCol={etfSortKey} dir={etfSortDir} onSort={handleEtfSort} align="left" />
                  <SortableTh label="Price" colKey="currentPrice" activeCol={etfSortKey} dir={etfSortDir} onSort={handleEtfSort} />
                  <SortableTh label="1 Day" colKey="change1d" activeCol={etfSortKey} dir={etfSortDir} onSort={handleEtfSort} />
                  <SortableTh label="1 Week" colKey="change1w" activeCol={etfSortKey} dir={etfSortDir} onSort={handleEtfSort} />
                  <SortableTh label="1 Month" colKey="change1m" activeCol={etfSortKey} dir={etfSortDir} onSort={handleEtfSort} />
                  <SortableTh label="3 Months" colKey="change3m" activeCol={etfSortKey} dir={etfSortDir} onSort={handleEtfSort} />
                  <th className="py-3 px-4 w-16"></th>
                </tr>
              </thead>
              <tbody key={`${etfSortKey}-${etfSortDir}`}>
                {sortedEtfs.map((etf) => (
                  <EtfRow
                    key={etf.id}
                    etf={etf}
                    expanded={expandedIds.has(etf.id)}
                    onToggle={() => toggleOne(etf.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
