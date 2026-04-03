import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ThemeWithPerformance } from "@shared/schema";
import { ThemeCard } from "@/components/theme-card";
import { AddThemeDialog } from "@/components/add-theme-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, TrendingUp, Plus, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";

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

export default function Home() {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const { data: lastUpdatedData } = useQuery<{ lastUpdated: string | null }>({
    queryKey: ["/api/prices/last-updated"],
  });

  const { data: themes, isLoading, error } = useQuery<ThemeWithPerformance[]>({
    queryKey: ["/api/themes"],
  });

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/themes"] });
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

  const totalStocks = themes?.reduce((sum, t) => sum + t.stocks.length, 0) ?? 0;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Dashboard</h1>
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
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <Skeleton className="h-10 w-10 rounded-md" />
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
          <div className="space-y-4">
            {themes?.slice().sort((a, b) => a.name.localeCompare(b.name)).map((theme) => (
              <ThemeCard key={theme.id} theme={theme} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
