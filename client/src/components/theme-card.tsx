import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ThemeWithPerformance, StockPerformance } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus as PlusIcon,
  Minus as MinusIcon,
  Trash2,
  TrendingUp,
  TrendingDown,
  Minus,
  X,
  Pencil,
  Check,
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

export function ThemeCard({ theme }: { theme: ThemeWithPerformance }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(theme.name);
  const editInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      setEditName(theme.name);
      setEditing(false);
    }
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
    <Card className="overflow-visible" data-testid={`card-theme-${theme.id}`}>
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={handleSaveEdit}
                    className="text-lg font-bold w-64"
                    data-testid={`input-edit-theme-name-${theme.id}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleSaveEdit}
                    disabled={updateThemeMutation.isPending}
                    data-testid={`button-save-theme-name-${theme.id}`}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 group">
                  <h3 className="text-lg font-bold" data-testid={`text-theme-name-${theme.id}`}>
                    {theme.name}
                  </h3>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => { setEditName(theme.name); setEditing(true); }}
                    data-testid={`button-edit-theme-name-${theme.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
              <Badge variant="secondary">
                {stockCount} {stockCount === 1 ? "stock" : "stocks"}
              </Badge>
            </div>
            {theme.description && (
              <p className="text-sm text-muted-foreground mt-1">{theme.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <AddStockDialog themeId={theme.id} themeName={theme.name} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" data-testid={`button-delete-theme-${theme.id}`}>
                  <Trash2 className="w-4 h-4" />
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
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <PerformanceCell label="1 Day" value={theme.avgChange1d} />
            <PerformanceCell label="1 Week" value={theme.avgChange1w} />
            <PerformanceCell label="1 Month" value={theme.avgChange1m} />
            <PerformanceCell label="3 Months" value={theme.avgChange3m} />
          </div>
          <Button
            variant="outline"
            onClick={() => setExpanded(!expanded)}
            data-testid={`button-expand-theme-${theme.id}`}
            className="gap-2"
          >
            {expanded ? (
              <>
                <MinusIcon className="w-4 h-4" />
                Collapse
              </>
            ) : (
              <>
                <PlusIcon className="w-4 h-4" />
                Expand
              </>
            )}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t">
          {theme.stocks.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No stocks in this theme yet. Click the
              <PlusIcon className="w-3.5 h-3.5 inline mx-1 -mt-0.5" />
              button above to add stocks.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid={`table-stocks-${theme.id}`}>
                <thead>
                  <tr className="bg-muted/40">
                    <th className="text-left py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground border-r-2 border-border">Symbol</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">$ Vol</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">ATR Mult</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">ADR</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Price</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">1 Day</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">1 Week</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">1 Month</th>
                    <th className="text-right py-3 px-5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">3 Months</th>
                    <th className="w-12 py-3 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {theme.stocks.map((stock: StockPerformance, idx: number) => (
                    <tr
                      key={stock.symbol}
                      className={`transition-colors ${idx < theme.stocks.length - 1 ? "border-b" : ""}`}
                      data-testid={`row-stock-${stock.symbol}`}
                    >
                      <td className="py-3 px-5 border-r-2 border-border">
                        <Link href={`/charts/${stock.symbol}`}>
                          <span
                            className="font-bold text-sm hover:text-primary hover:underline cursor-pointer transition-colors"
                            data-testid={`link-stock-chart-${stock.symbol}`}
                          >
                            {stock.symbol}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 px-5 text-right tabular-nums font-medium text-muted-foreground" data-testid={`text-dollar-vol-${stock.symbol}`}>
                        {formatDollarVolume(stock.dollarVolume)}
                      </td>
                      <td className={`py-3 px-5 text-right tabular-nums font-semibold ${getPerformanceColor(stock.atrMultiple)}`} data-testid={`text-atr-multiple-${stock.symbol}`}>
                        {stock.atrMultiple !== null ? `${stock.atrMultiple.toFixed(2)}x` : "--"}
                      </td>
                      <td className="py-3 px-5 text-right tabular-nums font-medium text-blue-600 dark:text-blue-400" data-testid={`text-adr-${stock.symbol}`}>
                        {stock.adr !== null ? `${stock.adr.toFixed(2)}%` : "--"}
                      </td>
                      <td className="py-3 px-5 text-right tabular-nums font-medium">
                        {stock.currentPrice !== null ? `$${stock.currentPrice.toFixed(2)}` : "--"}
                      </td>
                      <td className={`py-3 px-5 text-right tabular-nums font-semibold ${getPerformanceColor(stock.change1d)}`}>
                        {formatPercent(stock.change1d)}
                      </td>
                      <td className={`py-3 px-5 text-right tabular-nums font-semibold ${getPerformanceColor(stock.change1w)}`}>
                        {formatPercent(stock.change1w)}
                      </td>
                      <td className={`py-3 px-5 text-right tabular-nums font-semibold ${getPerformanceColor(stock.change1m)}`}>
                        {formatPercent(stock.change1m)}
                      </td>
                      <td className={`py-3 px-5 text-right tabular-nums font-semibold ${getPerformanceColor(stock.change3m)}`}>
                        {formatPercent(stock.change3m)}
                      </td>
                      <td className="py-3 px-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteStockMutation.mutate(stock.symbol)}
                          disabled={deleteStockMutation.isPending}
                          data-testid={`button-remove-stock-${stock.symbol}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
