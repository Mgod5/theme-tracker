import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { EtfWithPerformance } from "@shared/schema";
import { Card } from "@/components/ui/card";
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
  Maximize2,
  Minimize2,
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

function PerformanceCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={`flex flex-col items-center gap-1 rounded-md px-4 py-2.5 ${getPerformanceBg(value)}`}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <div className="flex items-center gap-1">
        <PerformanceIcon value={value} className="w-3 h-3" />
        <span className={`text-sm font-bold tabular-nums ${getPerformanceColor(value)}`}>
          {formatPercent(value)}
        </span>
      </div>
    </div>
  );
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

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeries.setData(processedData.volumeData);

    const addLineSeries = (lineData: { time: string; value: number }[], color: string, width: 1 | 2 | 3 | 4 = 1) => {
      if (lineData.length === 0) return;
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(lineData);
    };

    addLineSeries(processedData.sma10, SMA_COLORS.sma10);
    addLineSeries(processedData.sma20, SMA_COLORS.sma20);
    addLineSeries(processedData.sma50, SMA_COLORS.sma50);
    addLineSeries(processedData.sma200, SMA_COLORS.sma200);
    addLineSeries(processedData.vwap, SMA_COLORS.vwap, 1);

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
      chartRef.current = null;
    };
  }, [processedData]);

  if (isLoading) {
    return <Skeleton className="w-full h-64 rounded-md" />;
  }

  if (!processedData) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No price history available
      </div>
    );
  }

  return (
    <div className="mt-4" data-testid={`chart-etf-${etfId}`}>
      <h4 className="text-sm font-semibold text-muted-foreground mb-2">
        {symbol} Daily — 12 Months
      </h4>
      <div className="flex items-center gap-3 mb-2 flex-wrap">
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
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}

interface HoldingPerformance {
  symbol: string;
  name: string;
  weight: number;
  change30d: number | null;
}

function TopHoldings({ etfId }: { etfId: number }) {
  const { data, isLoading } = useQuery<{ holdings: HoldingPerformance[] }>({
    queryKey: ["/api/etfs", etfId, "top-holdings"],
    queryFn: async () => {
      const res = await fetch(`/api/etfs/${etfId}/top-holdings`);
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) {
    return (
      <div className="mt-4" data-testid={`holdings-loading-${etfId}`}>
        <h4 className="text-sm font-semibold text-muted-foreground mb-2">Top 10 Holdings — 30-Day Performance</h4>
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full rounded" />
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
        {holdings.map((h, idx) => (
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

function EtfCard({ etf, expanded, onToggle }: { etf: EtfWithPerformance; expanded: boolean; onToggle: () => void }) {
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
    if (!trimmed || trimmed === etf.name) {
      setEditName(etf.name);
      setEditing(false);
      return;
    }
    updateEtfMutation.mutate(trimmed);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      setEditName(etf.name);
      setEditing(false);
    }
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
    <Card className="overflow-visible" data-testid={`card-etf-${etf.id}`}>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                onClick={onToggle}
                className="flex items-center gap-1.5 hover:opacity-70 transition-opacity"
                data-testid={`button-toggle-etf-${etf.id}`}
              >
                {expanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </button>
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={handleSaveEdit}
                    className="text-lg font-bold w-64"
                    data-testid={`input-edit-etf-name-${etf.id}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleSaveEdit}
                    disabled={updateEtfMutation.isPending}
                    data-testid={`button-save-etf-name-${etf.id}`}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 group">
                  <h3
                    className="text-lg font-bold cursor-pointer"
                    onClick={onToggle}
                    data-testid={`text-etf-name-${etf.id}`}
                  >
                    {etf.name}
                  </h3>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => { setEditName(etf.name); setEditing(true); }}
                    data-testid={`button-edit-etf-name-${etf.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
              <Badge variant="secondary">{etf.symbol}</Badge>
              {etf.currentPrice !== null && (
                <span className="text-sm font-medium tabular-nums text-muted-foreground">
                  ${etf.currentPrice.toFixed(2)}
                </span>
              )}
            </div>
            {expanded && etf.description && (
              <p className="text-sm text-muted-foreground mt-1 ml-7">{etf.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" data-testid={`button-delete-etf-${etf.id}`}>
                  <Trash2 className="w-4 h-4" />
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
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap mt-4">
          <PerformanceCell label="1 Day" value={etf.change1d} />
          <PerformanceCell label="1 Week" value={etf.change1w} />
          <PerformanceCell label="1 Month" value={etf.change1m} />
          <PerformanceCell label="3 Months" value={etf.change3m} />
        </div>

        {expanded && (
          <>
            <TopHoldings etfId={etf.id} />
            <EtfChart etfId={etf.id} symbol={etf.symbol} />
          </>
        )}
      </div>
    </Card>
  );
}

export default function Etfs() {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const { data: lastUpdatedData } = useQuery<{ lastUpdated: string | null }>({
    queryKey: ["/api/prices/last-updated"],
  });

  const { data: etfList, isLoading, error } = useQuery<EtfWithPerformance[]>({
    queryKey: ["/api/etfs"],
  });

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/etfs"] });
  }, []);

  const allExpanded = etfList ? etfList.length > 0 && etfList.every((e) => expandedIds.has(e.id)) : false;
  const allCollapsed = etfList ? etfList.length > 0 && etfList.every((e) => !expandedIds.has(e.id)) : true;

  const expandAll = useCallback(() => {
    if (etfList) setExpandedIds(new Set(etfList.map((e) => e.id)));
  }, [etfList]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const toggleOne = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
      toast({
        title: "Prices Updated",
        description: data.message || "All prices have been refreshed.",
      });
      setRefreshing(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Update Failed",
        description: err.message,
        variant: "destructive",
      });
      setRefreshing(false);
    },
  });

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
              {etfList && etfList.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={expandAll}
                    disabled={allExpanded}
                    data-testid="button-expand-all"
                  >
                    <Maximize2 className="w-3.5 h-3.5 mr-1.5" />
                    Expand All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={collapseAll}
                    disabled={allCollapsed}
                    data-testid="button-collapse-all"
                  >
                    <Minimize2 className="w-3.5 h-3.5 mr-1.5" />
                    Collapse All
                  </Button>
                </>
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
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1">
                    <Skeleton className="h-5 w-48 mb-2" />
                    <Skeleton className="h-3 w-72" />
                  </div>
                </div>
                <div className="flex gap-6">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="flex flex-col gap-1.5">
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-5 w-20" />
                    </div>
                  ))}
                </div>
              </Card>
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
          <div className="space-y-4">
            {etfList?.slice().sort((a, b) => a.name.localeCompare(b.name)).map((etf) => (
              <EtfCard
                key={etf.id}
                etf={etf}
                expanded={expandedIds.has(etf.id)}
                onToggle={() => toggleOne(etf.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
