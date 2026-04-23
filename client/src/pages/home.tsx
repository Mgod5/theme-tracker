import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ThemeWithPerformance } from "@shared/schema";
import { ThemeCard } from "@/components/theme-card";
import { AddThemeDialog } from "@/components/add-theme-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, TrendingUp, AlertCircle, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { useState, useCallback } from "react";

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

type ThemeSortKey = "name" | "stocks" | "avgChange1d" | "avgChange1w" | "avgChange1m" | "avgChange3m";
type SortDir = "asc" | "desc";

function sortThemes(list: ThemeWithPerformance[], key: ThemeSortKey, dir: SortDir): ThemeWithPerformance[] {
  return [...list].sort((a, b) => {
    let av: string | number | null;
    let bv: string | number | null;
    if (key === "name") { av = a.name; bv = b.name; }
    else if (key === "stocks") { av = a.stocks.length; bv = b.stocks.length; }
    else { av = a[key]; bv = b[key]; }
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
  label: string; colKey: ThemeSortKey; activeCol: ThemeSortKey; dir: SortDir;
  onSort: (k: ThemeSortKey) => void; align?: "left" | "right" | "center"; className?: string;
}) {
  const active = activeCol === colKey;
  return (
    <th
      className={`py-3 px-4 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none transition-colors whitespace-nowrap ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"} text-${align} ${className}`}
      onClick={() => onSort(colKey)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end w-full" : align === "center" ? "justify-center w-full" : ""}`}>
        {align === "left"
          ? <><SortIcon active={active} dir={dir} />{label}</>
          : <>{label}<SortIcon active={active} dir={dir} /></>}
      </span>
    </th>
  );
}

export default function Home() {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [sortCol, setSortCol] = useState<ThemeSortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const handleSort = (key: ThemeSortKey) => {
    if (key === sortCol) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };

  const toggleOne = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const { data: lastUpdatedData } = useQuery<{ lastUpdated: string | null }>({
    queryKey: ["/api/prices/last-updated"],
  });

  const { data: themes, isLoading, error } = useQuery<ThemeWithPerformance[]>({
    queryKey: ["/api/themes"],
  });

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

  const totalStocks = themes?.reduce((sum, t) => sum + t.stocks.length, 0) ?? 0;
  const sortedThemes = themes ? sortThemes(themes, sortCol, sortDir) : [];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Themes</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {themes && themes.length > 0
                  ? `Tracking ${themes.length} theme${themes.length !== 1 ? "s" : ""} with ${totalStocks} stock${totalStocks !== 1 ? "s" : ""}`
                  : "Track investment themes and their stock performance"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdatedData?.lastUpdated && (
                <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="text-last-refreshed">
                  Updated {formatTimestamp(lastUpdatedData.lastUpdated)}
                </span>
              )}
              <Button
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshing || refreshMutation.isPending}
                data-testid="button-refresh-prices"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                Refresh Prices
              </Button>
              <AddThemeDialog />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {isLoading ? (
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/40 border-b px-4 py-3 flex gap-8">
              {[200, 80, 80, 80, 80, 80].map((w, i) => (
                <Skeleton key={i} className={`h-4 w-${w === 200 ? "48" : "12"}`} />
              ))}
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3 border-b flex gap-8 items-center">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-8" />
                {[1, 2, 3, 4].map((j) => <Skeleton key={j} className="h-4 w-14" />)}
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-md bg-destructive/10 flex items-center justify-center mb-5">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Unable to load themes</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              There was a problem loading your investment themes. Please check your connection and try again.
            </p>
            <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/themes"] })}>
              Try Again
            </Button>
          </div>
        ) : themes && themes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center mb-5">
              <TrendingUp className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2" data-testid="text-empty-title">Get started</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Create your first investment theme to start tracking stock performance across 1-day, 1-week, 1-month and 3-month timeframes.
            </p>
            <AddThemeDialog />
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="w-10 py-3 px-4"></th>
                  <SortableTh label="Theme Name" colKey="name" activeCol={sortCol} dir={sortDir} onSort={handleSort} align="left" />
                  <SortableTh label="Stocks" colKey="stocks" activeCol={sortCol} dir={sortDir} onSort={handleSort} align="center" />
                  <SortableTh label="1 Day" colKey="avgChange1d" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="1 Week" colKey="avgChange1w" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="1 Month" colKey="avgChange1m" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="3 Months" colKey="avgChange3m" activeCol={sortCol} dir={sortDir} onSort={handleSort} />
                  <th className="py-3 px-4 w-24"></th>
                </tr>
              </thead>
              <tbody key={`${sortCol}-${sortDir}`}>
                {sortedThemes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    isExpanded={expandedIds.has(theme.id)}
                    onToggle={() => toggleOne(theme.id)}
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
