import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ThemeWithPerformance, StockPerformance } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus as PlusIcon,
  Trash2,
  X,
  Pencil,
  Check,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { AddStockDialog } from "@/components/add-stock-dialog";
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

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return "--";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatDollarVolume(value: number | null): string {
  if (value === null || value === undefined) return "--";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
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

type StockSortKey = "symbol" | "dollarVolume" | "atrMultiple" | "adr" | "currentPrice" | "change1d" | "change1w" | "change1m" | "change3m";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="w-3 h-3 ml-1 text-muted-foreground/40" />;
  return dir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 text-primary" />
    : <ChevronDown className="w-3 h-3 ml-1 text-primary" />;
}

function SortableTh({
  label, colKey, activeCol, dir, onSort, align = "right", className = ""
}: {
  label: string; colKey: StockSortKey; activeCol: StockSortKey; dir: SortDir;
  onSort: (k: StockSortKey) => void; align?: "left" | "right"; className?: string;
}) {
  const active = activeCol === colKey;
  return (
    <th
      className={`py-2.5 px-4 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"} ${align === "right" ? "text-right" : "text-left"} ${className}`}
      onClick={(e) => { e.stopPropagation(); onSort(colKey); }}
    >
      <span className="inline-flex items-center gap-0.5">
        {align === "left"
          ? <><SortIcon active={active} dir={dir} />{label}</>
          : <>{label}<SortIcon active={active} dir={dir} /></>}
      </span>
    </th>
  );
}

function sortStocks(stocks: StockPerformance[], key: StockSortKey, dir: SortDir): StockPerformance[] {
  return [...stocks].sort((a, b) => {
    const av: string | number | null = a[key] as string | number | null;
    const bv: string | number | null = b[key] as string | number | null;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

export function ThemeCard({ theme, isExpanded, onToggle }: {
  theme: ThemeWithPerformance;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(theme.name);
  const [sortCol, setSortCol] = useState<StockSortKey>("change1d");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const editInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleSort = (col: StockSortKey) => {
    if (col === sortCol) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const sortedStocks = sortStocks(theme.stocks, sortCol, sortDir);

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

  const updateThemeMutation = useMutation({
    mutationFn: async (newName: string) => {
      const res = await apiRequest("PATCH", `/api/themes/${theme.id}`, {
        name: newName,
        description: theme.description,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/themes"] });
      setEditing(false);
      toast({ title: "Theme renamed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setEditName(theme.name);
      setEditing(false);
    },
  });

  const handleSaveEdit = () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === theme.name) {
      setEditName(theme.name);
      setEditing(false);
      return;
    }
    updateThemeMutation.mutate(trimmed);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSaveEdit(); }
    else if (e.key === "Escape") { setEditName(theme.name); setEditing(false); }
  };

  const deleteThemeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/themes/${theme.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/themes"] });
      toast({ title: "Theme deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteStockMutation = useMutation({
    mutationFn: async (stockSymbol: string) => {
      await apiRequest("DELETE", `/api/themes/${theme.id}/stocks/${stockSymbol}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/themes"] });
      toast({ title: "Stock removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const stockCount = theme.stocks.length;

  return (
    <>
      <tr
        className={`border-b border-border transition-colors cursor-pointer ${isExpanded ? "bg-blue-50 dark:bg-blue-950/30" : "bg-card hover:bg-muted/60"}`}
        onClick={() => { if (!editing) onToggle(); }}
        data-testid={`row-theme-${theme.id}`}
      >
        <td className="py-3 px-4 w-8">
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            data-testid={`button-expand-theme-${theme.id}`}
          >
            {isExpanded
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>

        <td className="py-3 px-4 min-w-[200px] border-r border-border">
          {editing ? (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Input
                ref={editInputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={handleSaveEdit}
                className="h-7 text-sm font-semibold w-48"
                data-testid={`input-edit-theme-name-${theme.id}`}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={handleSaveEdit}
                disabled={updateThemeMutation.isPending}
                data-testid={`button-save-theme-name-${theme.id}`}
              >
                <Check className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group">
              <span
                className="font-semibold text-sm"
                data-testid={`text-theme-name-${theme.id}`}
              >
                {theme.name}
              </span>
              <button
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setEditName(theme.name); setEditing(true); }}
                data-testid={`button-edit-theme-name-${theme.id}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}
        </td>

        <td className="py-3 px-4 text-center border-r border-border">
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {stockCount}
          </span>
        </td>

        <td className="py-3 px-4 text-right border-r border-border">
          <PerfPill value={theme.avgChange1d} />
        </td>
        <td className="py-3 px-4 text-right border-r border-border">
          <PerfPill value={theme.avgChange1w} />
        </td>
        <td className="py-3 px-4 text-right border-r border-border">
          <PerfPill value={theme.avgChange1m} />
        </td>
        <td className="py-3 px-4 text-right">
          <PerfPill value={theme.avgChange3m} />
        </td>

        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <AddStockDialog themeId={theme.id} themeName={theme.name} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-delete-theme-${theme.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{theme.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this theme and all its stocks. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteThemeMutation.mutate()}
                    data-testid={`button-confirm-delete-theme-${theme.id}`}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr data-testid={`row-theme-detail-${theme.id}`}>
          <td colSpan={8} className="p-0 bg-muted/10 border-b">
            {theme.stocks.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No stocks in this theme yet. Click the
                <PlusIcon className="w-3.5 h-3.5 inline mx-1 -mt-0.5" />
                button to add stocks.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid={`table-stocks-${theme.id}`}>
                  <thead>
                    <tr className="bg-muted/50">
                      <SortableTh label="Symbol" colKey="symbol" activeCol={sortCol} dir={sortDir} onSort={handleSort} align="left" className="pl-14 border-r border-border" />
                      <SortableTh label="$ Vol" colKey="dollarVolume" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="ATR Mult" colKey="atrMultiple" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="ADR" colKey="adr" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="Price" colKey="currentPrice" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="1 Day" colKey="change1d" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="1 Week" colKey="change1w" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="1 Month" colKey="change1m" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <SortableTh label="3 Months" colKey="change3m" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                      <th className="w-10 py-2.5 px-3"></th>
                    </tr>
                  </thead>
                  <tbody key={`${theme.id}-${sortCol}-${sortDir}`}>
                    {sortedStocks.map((stock: StockPerformance, idx: number) => (
                      <tr
                        key={`${theme.id}-${stock.symbol}`}
                        className={`transition-colors hover:bg-muted/20 ${idx < sortedStocks.length - 1 ? "border-b border-border/50" : ""}`}
                        data-testid={`row-stock-${stock.symbol}`}
                      >
                        <td className="py-2.5 px-4 pl-14 border-r border-border/50">
                          <Link href={`/charts/${stock.symbol}`}>
                            <span
                              className="font-bold text-sm hover:text-primary hover:underline cursor-pointer transition-colors"
                              data-testid={`link-stock-chart-${stock.symbol}`}
                            >
                              {stock.symbol}
                            </span>
                          </Link>
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-medium text-muted-foreground text-sm" data-testid={`text-dollar-vol-${stock.symbol}`}>
                          {formatDollarVolume(stock.dollarVolume)}
                        </td>
                        <td className={`py-2.5 px-4 text-right tabular-nums font-semibold text-sm ${getPerformanceColor(stock.atrMultiple)}`} data-testid={`text-atr-multiple-${stock.symbol}`}>
                          {stock.atrMultiple !== null ? `${stock.atrMultiple.toFixed(2)}x` : "--"}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-medium text-blue-600 dark:text-blue-400 text-sm" data-testid={`text-adr-${stock.symbol}`}>
                          {stock.adr !== null ? `${stock.adr.toFixed(2)}%` : "--"}
                        </td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-medium text-sm">
                          {stock.currentPrice !== null ? `$${stock.currentPrice.toFixed(2)}` : "--"}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <PerfPill value={stock.change1d} />
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <PerfPill value={stock.change1w} />
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <PerfPill value={stock.change1m} />
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <PerfPill value={stock.change3m} />
                        </td>
                        <td className="py-2.5 px-3">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => deleteStockMutation.mutate(stock.symbol)}
                            disabled={deleteStockMutation.isPending}
                            data-testid={`button-remove-stock-${stock.symbol}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
