import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { fetchCurrentPrices, fetchHistoricalPrices, fetchHoldingsWithPerformance } from "./stockPrices";
import { insertThemeSchema, insertEtfSchema, stockPrices } from "@shared/schema";
import { sql } from "drizzle-orm";
import { log } from "./index";
import cron from "node-cron";

const backfillInProgress = new Set<string>();

async function backfillSymbol(symbol: string): Promise<void> {
  if (backfillInProgress.has(symbol)) return;
  backfillInProgress.add(symbol);
  const prices = await storage.getStockPrices(symbol, 1095);
  const ohlcvCount = prices.filter((p) => p.highPrice != null && p.lowPrice != null).length;
  if (prices.length >= 700 && ohlcvCount >= prices.length * 0.5) {
    backfillInProgress.delete(symbol);
    return;
  }
  log(`Backfilling ${symbol} (${prices.length} bars on hand)`, "stocks");
  try {
    const historicalPrices = await fetchHistoricalPrices(symbol, 1095);
    for (const hp of historicalPrices) {
      await storage.upsertStockPrice({
        symbol,
        date: hp.date,
        openPrice: hp.open,
        highPrice: hp.high,
        lowPrice: hp.low,
        closePrice: hp.close,
        volume: hp.volume,
      });
    }
    log(`Backfilled ${historicalPrices.length} bars for ${symbol}`, "stocks");
  } catch (err) {
    log(`Failed to backfill ${symbol}: ${err}`, "stocks");
  } finally {
    backfillInProgress.delete(symbol);
  }
}

async function backfillThemeStockOHLCV(): Promise<void> {
  try {
    // Cover theme stocks, ETFs, and any orphaned symbol in stock_prices with < 700 bars
    const themeSymbols = await storage.getAllUniqueSymbols();
    const etfSymbols = await storage.getAllEtfSymbols();
    const lowBarResult = await db.execute(
      sql`SELECT DISTINCT symbol FROM stock_prices GROUP BY symbol HAVING COUNT(*) < 700`
    );
    const lowBarSymbols = (lowBarResult.rows as { symbol: string }[]).map((r) => r.symbol);
    const allSymbols = Array.from(new Set([...themeSymbols, ...etfSymbols, ...lowBarSymbols]));

    for (const symbol of allSymbols) {
      await backfillSymbol(symbol);
    }
  } catch (err) {
    log(`Error in OHLCV backfill: ${err}`, "stocks");
  }
}

async function updateAllPrices(): Promise<{ updated: number; errors: number }> {
  const themeSymbols = await storage.getAllUniqueSymbols();
  const etfSymbols = await storage.getAllEtfSymbols();
  const symbolSet = new Set([...themeSymbols, ...etfSymbols]);
  const symbols = Array.from(symbolSet);
  if (symbols.length === 0) return { updated: 0, errors: 0 };

  const prices = await fetchCurrentPrices(symbols);
  let updated = 0;
  let errors = 0;
  const today = new Date().toISOString().split("T")[0];

  for (const [symbol, bar] of Array.from(prices.entries())) {
    try {
      await storage.upsertStockPrice({
        symbol,
        date: today,
        closePrice: bar.close,
        openPrice: bar.open,
        highPrice: bar.high,
        lowPrice: bar.low,
        volume: bar.volume,
      });
      updated++;
    } catch (err) {
      errors++;
      log(`Failed to save price for ${symbol}: ${err}`, "stocks");
    }
  }

  const failed = symbols.length - prices.size;
  if (failed > 0) errors += failed;

  log(`Quick refresh: ${updated} updated, ${errors} errors`, "stocks");
  return { updated, errors };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/themes", async (_req, res) => {
    try {
      const themes = await storage.getThemesWithPerformance();
      res.json(themes);
    } catch (err) {
      log(`Error getting themes: ${err}`, "api");
      res.status(500).json({ message: "Failed to fetch themes" });
    }
  });

  app.post("/api/themes", async (req, res) => {
    try {
      const parsed = insertThemeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid theme data", errors: parsed.error.issues });
      }
      const theme = await storage.createTheme(parsed.data);

      res.status(201).json(theme);
    } catch (err) {
      log(`Error creating theme: ${err}`, "api");
      res.status(500).json({ message: "Failed to create theme" });
    }
  });

  app.patch("/api/themes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid theme ID" });
      }
      const { name, description } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ message: "Theme name is required" });
      }
      const theme = await storage.updateTheme(id, {
        name: name.trim(),
        description: description !== undefined ? description : undefined,
      });
      res.json(theme);
    } catch (err: any) {
      if (err.message === "Theme not found") {
        return res.status(404).json({ message: err.message });
      }
      log(`Error updating theme: ${err}`, "api");
      res.status(500).json({ message: "Failed to update theme" });
    }
  });

  app.delete("/api/themes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid theme ID" });
      }
      await storage.deleteTheme(id);
      res.json({ message: "Theme deleted" });
    } catch (err) {
      log(`Error deleting theme: ${err}`, "api");
      res.status(500).json({ message: "Failed to delete theme" });
    }
  });

  app.post("/api/themes/:id/stocks", async (req, res) => {
    try {
      const themeId = parseInt(req.params.id, 10);
      if (isNaN(themeId)) {
        return res.status(400).json({ message: "Invalid theme ID" });
      }
      const { symbol } = req.body;
      if (!symbol || typeof symbol !== "string" || symbol.trim().length === 0) {
        return res.status(400).json({ message: "Symbol is required" });
      }

      const cleanSymbol = symbol.toUpperCase().trim();

      const stock = await storage.addStockToTheme({ themeId, symbol: cleanSymbol });

      try {
        const historicalPrices = await fetchHistoricalPrices(cleanSymbol, 1095);
        for (const hp of historicalPrices) {
          await storage.upsertStockPrice({
            symbol: cleanSymbol,
            date: hp.date,
            openPrice: hp.open,
            highPrice: hp.high,
            lowPrice: hp.low,
            closePrice: hp.close,
            volume: hp.volume,
          });
        }
        log(`Fetched ${historicalPrices.length} historical prices for ${cleanSymbol}`, "stocks");
      } catch (err) {
        log(`Warning: Could not fetch historical prices for ${cleanSymbol}: ${err}`, "stocks");
      }

      res.status(201).json(stock);
    } catch (err: any) {
      if (err.message?.includes("already in this theme")) {
        return res.status(409).json({ message: err.message });
      }
      log(`Error adding stock: ${err}`, "api");
      res.status(500).json({ message: "Failed to add stock" });
    }
  });

  app.delete("/api/themes/:id/stocks/:symbol", async (req, res) => {
    try {
      const themeId = parseInt(req.params.id, 10);
      if (isNaN(themeId)) {
        return res.status(400).json({ message: "Invalid theme ID" });
      }
      const symbol = req.params.symbol.toUpperCase();
      await storage.removeStockFromTheme(themeId, symbol);
      res.json({ message: "Stock removed" });
    } catch (err) {
      log(`Error removing stock: ${err}`, "api");
      res.status(500).json({ message: "Failed to remove stock" });
    }
  });

  // ── Stock Chart Helpers ──────────────────────────────────────────────────
  const sectorCache = new Map<string, { sector: string; fetchedAt: number }>();

  async function fetchSector(symbol: string): Promise<string | null> {
    const cached = sectorCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) return cached.sector;
    try {
      const url = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol)}?apiKey=${process.env.POLYGON_API_KEY || ""}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const sector = data?.results?.sic_description ?? null;
      if (sector) sectorCache.set(symbol, { sector, fetchedAt: Date.now() });
      return sector;
    } catch { return null; }
  }

  function computeRSI(closes: number[], period = 14): number[] {
    if (closes.length < period + 1) return [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      avgGain += Math.max(change, 0);
      avgLoss += Math.max(-change, 0);
    }
    avgGain /= period; avgLoss /= period;
    const rsi: number[] = [];
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
      rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
    return rsi;
  }

  app.get("/api/stocks/:symbol/chart", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const prices = await storage.getStockPrices(symbol, 1095);

      // If this symbol has sparse data and isn't being backfilled, kick one off in the background
      const ohlcvCount = prices.filter((p) => p.highPrice != null && p.lowPrice != null).length;
      if ((prices.length < 700 || ohlcvCount < prices.length * 0.5) && !backfillInProgress.has(symbol)) {
        backfillSymbol(symbol).catch((err) =>
          log(`On-demand backfill failed for ${symbol}: ${err}`, "stocks")
        );
      }

      const latest = await storage.getLatestPrice(symbol);
      const currentPrice = latest?.closePrice ?? null;
      const themes = await storage.getThemesForSymbol(symbol);

      const sorted = prices
        .filter((p) => p.closePrice > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

      // ADR 20-day
      const withHL = sorted.filter((p) => p.highPrice != null && p.lowPrice != null).slice(-20);
      const adr = withHL.length >= 2
        ? withHL.reduce((s, p) => s + ((p.highPrice! - p.lowPrice!) / p.closePrice) * 100, 0) / withHL.length
        : null;

      // ATR14
      let atr14: number | null = null;
      if (sorted.length >= 15) {
        const trs: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          const h = sorted[i].highPrice ?? sorted[i].closePrice;
          const l = sorted[i].lowPrice ?? sorted[i].closePrice;
          const pc = sorted[i - 1].closePrice;
          trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        }
        const last14 = trs.slice(-14);
        atr14 = last14.reduce((s, v) => s + v, 0) / 14;
      }

      // ATR Multiple
      let atrMultiple: number | null = null;
      if (sorted.length >= 50 && currentPrice !== null && atr14 !== null && atr14 > 0) {
        const sma50 = sorted.slice(-50).reduce((s, p) => s + p.closePrice, 0) / 50;
        if (sma50 > 0) atrMultiple = ((currentPrice - sma50) / sma50) / (atr14 / currentPrice);
      }

      // Dollar volume & avg vol
      const withVol = sorted.filter((p) => p.volume != null && p.volume > 0);
      const vol20 = withVol.slice(-20);
      const avgVolume20d = vol20.length > 0 ? vol20.reduce((s, p) => s + p.volume!, 0) / vol20.length : null;
      const dollarVolume = currentPrice !== null && avgVolume20d !== null ? avgVolume20d * currentPrice : null;
      const vol5 = withVol.slice(-5);
      const avg5d = vol5.length > 0 ? vol5.reduce((s, p) => s + p.volume!, 0) / vol5.length : null;
      const volumeDirection = avgVolume20d !== null && avg5d !== null
        ? (avg5d > avgVolume20d ? "rising" : "falling") : null;

      // RSI(14) + direction
      const closes = sorted.map((p) => p.closePrice);
      const rsiSeries = computeRSI(closes, 14);
      const rsi14 = rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1] : null;
      const rsiPrev = rsiSeries.length > 5 ? rsiSeries[rsiSeries.length - 6] : null;

      const sector = await fetchSector(symbol);

      res.json({
        symbol,
        currentPrice,
        sector,
        themes,
        adr,
        atrMultiple,
        dollarVolume,
        avgVolume20d,
        volumeDirection,
        rsi14,
        rsiPrev,
        priceHistory: sorted.map((p) => ({
          date: p.date,
          open: p.openPrice,
          high: p.highPrice,
          low: p.lowPrice,
          close: p.closePrice,
          volume: p.volume,
        })),
      });
    } catch (err) {
      log(`Error fetching stock chart for ${req.params.symbol}: ${err}`, "api");
      res.status(500).json({ message: "Failed to fetch stock chart data" });
    }
  });

  // ── Chart Drawings ───────────────────────────────────────────────────────────

  app.get("/api/stocks/:symbol/drawings", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const drawings = await storage.getChartDrawings(symbol);
      res.json(drawings);
    } catch (err) {
      log(`Error fetching drawings for ${req.params.symbol}: ${err}`, "api");
      res.status(500).json({ message: "Failed to fetch drawings" });
    }
  });

  app.post("/api/stocks/:symbol/drawings", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const { type, data } = req.body;
      if (!type || typeof type !== "string" || !data || typeof data !== "string") {
        return res.status(400).json({ message: "type and data are required strings" });
      }
      const drawing = await storage.createChartDrawing(symbol, type, data);
      res.status(201).json(drawing);
    } catch (err) {
      log(`Error creating drawing for ${req.params.symbol}: ${err}`, "api");
      res.status(500).json({ message: "Failed to create drawing" });
    }
  });

  app.delete("/api/stocks/:symbol/drawings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid drawing id" });
      await storage.deleteChartDrawing(id);
      res.json({ message: "Drawing deleted" });
    } catch (err) {
      log(`Error deleting drawing ${req.params.id}: ${err}`, "api");
      res.status(500).json({ message: "Failed to delete drawing" });
    }
  });

  app.delete("/api/stocks/:symbol/drawings", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      await storage.clearChartDrawings(symbol);
      res.json({ message: "All drawings cleared" });
    } catch (err) {
      log(`Error clearing drawings for ${req.params.symbol}: ${err}`, "api");
      res.status(500).json({ message: "Failed to clear drawings" });
    }
  });

  app.post("/api/prices/update", async (_req, res) => {
    try {
      const result = await updateAllPrices();
      res.json({
        message: `Updated ${result.updated} symbols${result.errors > 0 ? `, ${result.errors} errors` : ""}`,
        lastRefreshed: new Date().toISOString(),
        ...result,
      });
    } catch (err) {
      log(`Error updating prices: ${err}`, "api");
      res.status(500).json({ message: "Failed to update prices" });
    }
  });

  app.get("/api/prices/last-updated", async (_req, res) => {
    try {
      const result = await db
        .select({ latest: sql<string>`max(fetched_at)` })
        .from(stockPrices);
      const raw = result[0]?.latest || null;
      const latest = raw ? new Date(raw + "Z").toISOString() : null;
      res.json({ lastUpdated: latest });
    } catch (err) {
      log(`Error fetching last update time: ${err}`, "api");
      res.status(500).json({ message: "Failed to get last update time" });
    }
  });

  app.get("/api/themes/:id/price-history", async (req, res) => {
    try {
      const idParam = req.params.id;
      const days = parseInt(req.query.days as string, 10) || 90;

      if (idParam === "all") {
        const allThemes = await storage.getThemes();
        const themeNames: string[] = [];
        const priceHistory: Record<string, Array<{ date: string; price: number }>> = {};

        for (const theme of allThemes) {
          const stocks = await storage.getThemeStocks(theme.id);
          if (stocks.length === 0) continue;

          const stockPriceData: Array<Array<{ date: string; price: number }>> = [];
          for (const stock of stocks) {
            const prices = await storage.getStockPrices(stock.symbol, days);
            if (prices.length > 0) {
              stockPriceData.push(prices.map((p) => ({ date: p.date, price: p.closePrice })));
            }
          }
          if (stockPriceData.length === 0) continue;

          const dateMap = new Map<string, number[]>();
          for (const series of stockPriceData) {
            const basePrice = series[0].price;
            if (basePrice === 0) continue;
            for (const point of series) {
              const pctChange = ((point.price - basePrice) / basePrice) * 100;
              if (!dateMap.has(point.date)) {
                dateMap.set(point.date, []);
              }
              dateMap.get(point.date)!.push(pctChange);
            }
          }

          const themePerf: Array<{ date: string; price: number }> = [];
          for (const [date, changes] of Array.from(dateMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
            const avg = changes.reduce((s, v) => s + v, 0) / changes.length;
            themePerf.push({ date, price: avg });
          }

          themeNames.push(theme.name);
          priceHistory[theme.name] = themePerf;
        }

        return res.json({
          theme: { id: 0, name: "All Themes", description: "All themes aggregated performance" },
          stocks: themeNames,
          priceHistory,
          isThemeLevel: true,
        });
      }

      const themeId = parseInt(idParam, 10);
      if (isNaN(themeId)) {
        return res.status(400).json({ message: "Invalid theme ID" });
      }
      const theme = await storage.getTheme(themeId);
      if (!theme) {
        return res.status(404).json({ message: "Theme not found" });
      }
      const stocks = await storage.getThemeStocks(themeId);
      const priceHistory: Record<string, Array<{ date: string; price: number }>> = {};
      for (const stock of stocks) {
        const prices = await storage.getStockPrices(stock.symbol, days);
        priceHistory[stock.symbol] = prices.map((p) => ({
          date: p.date,
          price: p.closePrice,
        }));
      }
      res.json({ theme, stocks: stocks.map((s) => s.symbol), priceHistory });
    } catch (err) {
      log(`Error getting price history: ${err}`, "api");
      res.status(500).json({ message: "Failed to fetch price history" });
    }
  });

  app.get("/api/etfs/:id/price-history", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ETF ID" });
      }
      const etf = await storage.getEtf(id);
      if (!etf) {
        return res.status(404).json({ message: "ETF not found" });
      }
      const days = parseInt(req.query.days as string, 10) || 365;
      let prices = await storage.getStockPrices(etf.symbol, days);

      const ohlcvCount = prices.filter(
        (p) => p.openPrice != null && p.highPrice != null && p.lowPrice != null && p.volume != null
      ).length;
      const expectedMinBars = Math.floor(days * 0.6);
      const needsBackfill = prices.length === 0 || ohlcvCount < prices.length * 0.5 || prices.length < expectedMinBars;
      if (needsBackfill && !backfillInProgress.has(etf.symbol)) {
        backfillInProgress.add(etf.symbol);
        log(`Backfilling OHLCV for ${etf.symbol} (${ohlcvCount}/${prices.length} complete, expected ~${expectedMinBars})`, "stocks");
        try {
          const historicalPrices = await fetchHistoricalPrices(etf.symbol, days);
          for (const hp of historicalPrices) {
            await storage.upsertStockPrice({
              symbol: etf.symbol,
              date: hp.date,
              openPrice: hp.open,
              highPrice: hp.high,
              lowPrice: hp.low,
              closePrice: hp.close,
              volume: hp.volume,
            });
          }
          prices = await storage.getStockPrices(etf.symbol, days);
        } catch (backfillErr) {
          log(`Backfill failed for ${etf.symbol}: ${backfillErr}`, "stocks");
        } finally {
          backfillInProgress.delete(etf.symbol);
        }
      }

      res.json({
        etf,
        priceHistory: prices.map((p) => ({
          date: p.date,
          open: p.openPrice,
          high: p.highPrice,
          low: p.lowPrice,
          close: p.closePrice,
          volume: p.volume,
        })),
      });
    } catch (err) {
      log(`Error getting ETF price history: ${err}`, "api");
      res.status(500).json({ message: "Failed to fetch ETF price history" });
    }
  });

  app.get("/api/etfs/:id/top-holdings", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ETF ID" });
      }
      const etf = await storage.getEtf(id);
      if (!etf) {
        return res.status(404).json({ message: "ETF not found" });
      }
      const holdings = await fetchHoldingsWithPerformance(etf.symbol);
      res.json({ etf, holdings });
    } catch (err) {
      log(`Error fetching ETF holdings: ${err}`, "api");
      res.status(500).json({ message: "Failed to fetch ETF holdings" });
    }
  });

  app.get("/api/etfs", async (_req, res) => {
    try {
      const etfList = await storage.getEtfsWithPerformance();
      res.json(etfList);
    } catch (err) {
      log(`Error getting ETFs: ${err}`, "api");
      res.status(500).json({ message: "Failed to fetch ETFs" });
    }
  });

  app.post("/api/etfs", async (req, res) => {
    try {
      const parsed = insertEtfSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid ETF data", errors: parsed.error.issues });
      }
      const etf = await storage.createEtf({
        ...parsed.data,
        symbol: parsed.data.symbol.toUpperCase().trim(),
      });

      try {
        const historicalPrices = await fetchHistoricalPrices(etf.symbol, 365);
        for (const hp of historicalPrices) {
          await storage.upsertStockPrice({
            symbol: etf.symbol,
            date: hp.date,
            openPrice: hp.open,
            highPrice: hp.high,
            lowPrice: hp.low,
            closePrice: hp.close,
            volume: hp.volume,
          });
        }
        log(`Fetched ${historicalPrices.length} historical prices for ETF ${etf.symbol}`, "stocks");
      } catch (err) {
        log(`Warning: Could not fetch historical prices for ETF ${etf.symbol}: ${err}`, "stocks");
      }

      res.status(201).json(etf);
    } catch (err) {
      log(`Error creating ETF: ${err}`, "api");
      res.status(500).json({ message: "Failed to create ETF" });
    }
  });

  app.patch("/api/etfs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ETF ID" });
      }
      const { name, description } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ message: "ETF name is required" });
      }
      const etf = await storage.updateEtf(id, {
        name: name.trim(),
        description: description !== undefined ? description : undefined,
      });
      res.json(etf);
    } catch (err: any) {
      if (err.message === "ETF not found") {
        return res.status(404).json({ message: err.message });
      }
      log(`Error updating ETF: ${err}`, "api");
      res.status(500).json({ message: "Failed to update ETF" });
    }
  });

  app.delete("/api/etfs/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ETF ID" });
      }
      await storage.deleteEtf(id);
      res.json({ message: "ETF deleted" });
    } catch (err) {
      log(`Error deleting ETF: ${err}`, "api");
      res.status(500).json({ message: "Failed to delete ETF" });
    }
  });

  cron.schedule("0 17 * * 1-5", async () => {
    log("Running scheduled price update (5:00 PM EST weekdays)", "cron");
    try {
      const result = await updateAllPrices();
      log(`Scheduled update complete: ${result.updated} updated, ${result.errors} errors`, "cron");
    } catch (err) {
      log(`Scheduled update failed: ${err}`, "cron");
    }
  }, {
    timezone: "America/New_York",
  });

  log("Cron job scheduled: daily price update at 5:00 PM EST (Mon-Fri)", "cron");

  setTimeout(() => {
    backfillThemeStockOHLCV().catch((err) =>
      log(`Startup OHLCV backfill error: ${err}`, "stocks")
    );
  }, 5000);

  return httpServer;
}
