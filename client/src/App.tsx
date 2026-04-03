import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Charts from "@/pages/charts";
import Etfs from "@/pages/etfs";
import { BarChart3, LineChart, TrendingUp, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

function NavHeader() {
  const [location] = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14 gap-4">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="text-base font-semibold text-foreground" data-testid="text-app-title">
              ThemeTracker
            </span>
          </Link>
          <nav className="flex items-center gap-1" data-testid="nav-main">
            <Link href="/">
              <Button
                variant={location === "/" ? "secondary" : "ghost"}
                size="default"
                className="gap-2"
                data-testid="nav-link-dashboard"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Button>
            </Link>
            <Link href="/etfs">
              <Button
                variant={location === "/etfs" ? "secondary" : "ghost"}
                size="default"
                className="gap-2"
                data-testid="nav-link-etfs"
              >
                <Layers className="w-4 h-4" />
                <span className="hidden sm:inline">ETFs</span>
              </Button>
            </Link>
            <Link href="/charts">
              <Button
                variant={location === "/charts" ? "secondary" : "ghost"}
                size="default"
                className="gap-2"
                data-testid="nav-link-charts"
              >
                <LineChart className="w-4 h-4" />
                <span className="hidden sm:inline">Charts</span>
              </Button>
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/etfs" component={Etfs} />
      <Route path="/charts/:symbol" component={Charts} />
      <Route path="/charts" component={Charts} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <NavHeader />
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
