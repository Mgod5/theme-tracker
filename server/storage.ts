import { db } from "./db";
import { eq, and, inArray, desc, sql, lt } from "drizzle-orm";
import {
  themes,
  themeStocks,
  stockPrices,
  etfs,
  chartDrawings,
  type Theme,
  type InsertTheme,
  type ThemeStock,
  type InsertThemeStock,
  type StockPrice,
  type InsertStockPrice,
  type StockPerformance,
  type ThemeWithPerformance,
  type Etf,
  type InsertEtf,
  type EtfWithPerformance,
  type ChartDrawing,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Simple in-memory cache with TTL
// ---------------------------------------------------------------------------
interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<any>>();

function cacheGet<T>(key: string): T | null {
  const e = _cache.get(key);
  if (e && e.expiresAt > Date.now()) return e.data as T;
  return null;
}
function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
export function cacheInvalidate(...keys: string[]): void {
  for (const k of keys) _cache.delete(k);
}

const PERF_TTL = 30_000; // 30 seconds

export interface IStorage {
  getThemes(): Promise<Theme[]>;
  getTheme(id: number): Promise<Theme | undefined>;
  createTheme(data: InsertTheme): Promise<Theme>;
  deleteTheme(id: number): Promise<void>;
  getThemeStocks(themeId: number): Promise<ThemeStock[]>;
  addStockToTheme(data: InsertThemeStock): Promise<ThemeStock>;
  removeStockFromTheme(themeId: number, symbol: string): Promise<void>;
  getAllUniqueSymbols(): Promise<string[]>;
  upsertStockPrice(data: InsertStockPrice): Promise<void>;
  getStockPrices(symbol: string, sinceDays: number): Promise<StockPrice[]>;
  getLatestPrice(symbol: string): Promise<StockPrice | undefined>;
  updateTheme(id: number, data: Partial<InsertTheme>): Promise<Theme>;
  getThemesWithPerformance(): Promise<ThemeWithPerformance[]>;
  getEtfs(): Promise<Etf[]>;
  getEtf(id: number): Promise<Etf | undefined>;
  createEtf(data: InsertEtf): Promise<Etf>;
  updateEtf(id: number, data: Partial<InsertEtf>): Promise<Etf>;
  deleteEtf(id: number): Promise<void>;
  getEtfsWithPerformance(): Promise<EtfWithPerformance[]>;
  getAllEtfSymbols(): Promise<string[]>;
  getThemesForSymbol(symbol: string): Promise<string[]>;
  deleteSymbolHistory(symbol: string, beforeDate?: string): Promise<void>;
  getChartDrawings(symbol: string): Promise<ChartDrawing[]>;
  createChartDrawing(symbol: string, type: string, data: string): Promise<ChartDrawing>;
  deleteChartDrawing(id: number): Promise<void>;
  clearChartDrawings(symbol: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getThemes(): Promise<Theme[]> {
    return db.select().from(themes);
  }

  async getTheme(id: number): Promise<Theme | undefined> {
    const result = await db.select().from(themes).where(eq(themes.id, id));
    return result[0];
  }

  async createTheme(data: InsertTheme): Promise<Theme> {
    const result = await db.insert(themes).values(data).returning();
    cacheInvalidate("themes_perf");
    return result[0];
  }

  async updateTheme(id: number, data: Partial<InsertTheme>): Promise<Theme> {
    const result = await db.update(themes).set(data).where(eq(themes.id, id)).returning();
    if (result.length === 0) throw new Error("Theme not found");
    cacheInvalidate("themes_perf");
    return result[0];
  }

  async deleteTheme(id: number): Promise<void> {
    await db.delete(themes).where(eq(themes.id, id));
    cacheInvalidate("themes_perf");
  }

  async getThemeStocks(themeId: number): Promise<ThemeStock[]> {
    return db.select().from(themeStocks).where(eq(themeStocks.themeId, themeId));
  }

  async addStockToTheme(data: InsertThemeStock): Promise<ThemeStock> {
    const result = await db.insert(themeStocks).values(data).returning();
    cacheInvalidate("themes_perf");
    return result[0];
  }

  async removeStockFromTheme(themeId: number, symbol: string): Promise<void> {
    await db
      .delete(themeStocks)
      .where(and(eq(themeStocks.themeId, themeId), eq(themeStocks.symbol, symbol)));
    cacheInvalidate("themes_perf");
  }

  async getAllUniqueSymbols(): Promise<string[]> {
    const result = await db.selectDistinct({ symbol: themeStocks.symbol }).from(themeStocks);
    return result.map((r) => r.symbol);
  }

  async upsertStockPrice(data: InsertStockPrice): Promise<void> {
    await db
      .insert(stockPrices)
      .values(data)
      .onConflictDoUpdate({
        target: [stockPrices.symbol, stockPrices.date],
        set: {
          closePrice: data.closePrice,
          openPrice: data.openPrice ?? undefined,
          highPrice: data.highPrice ?? undefined,
          lowPrice: data.lowPrice ?? undefined,
          volume: data.volume ?? undefined,
          fetchedAt: new Date(),
        },
      });
    // Invalidate caches so fresh data is served after a price update
    cacheInvalidate("themes_perf", "etfs_perf");
  }

  async getStockPrices(symbol: string, sinceDays: number): Promise<StockPrice[]> {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - sinceDays);
    const sinceDateStr = sinceDate.toISOString().split("T")[0];
    return db
      .select()
      .from(stockPrices)
      .where(and(eq(stockPrices.symbol, symbol), sql`${stockPrices.date} >= ${sinceDateStr}`))
      .orderBy(stockPrices.date);
  }

  async getLatestPrice(symbol: string): Promise<StockPrice | undefined> {
    const result = await db
      .select()
      .from(stockPrices)
      .where(eq(stockPrices.symbol, symbol))
      .orderBy(desc(stockPrices.date))
      .limit(1);
    return result[0];
  }

  // ---------------------------------------------------------------------------
  // Calculation helpers (unchanged logic, same as before)
  // ---------------------------------------------------------------------------

  private calculateChange(prices: StockPrice[], daysAgo: number, currentPrice: number): number | null {
    if (prices.length === 0) return null;
    const sortedPrices = [...prices].sort((a, b) => b.date.localeCompare(a.date));

    if (daysAgo === 1) {
      const uniqueDates = Array.from(new Set(sortedPrices.map((p) => p.date)));
      if (uniqueDates.length < 2) return null;
      const previousPrice = sortedPrices.find((p) => p.date === uniqueDates[1]);
      if (!previousPrice || previousPrice.closePrice === 0) return null;
      return ((currentPrice - previousPrice.closePrice) / previousPrice.closePrice) * 100;
    }

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    const targetDateStr = targetDate.toISOString().split("T")[0];

    let closestPrice: StockPrice | null = null;
    let closestDiff = Infinity;
    for (const p of sortedPrices) {
      const diff = Math.abs(new Date(p.date).getTime() - targetDate.getTime());
      if (diff < closestDiff && p.date <= targetDateStr) {
        closestDiff = diff;
        closestPrice = p;
      }
    }
    if (!closestPrice) closestPrice = sortedPrices[sortedPrices.length - 1];
    if (!closestPrice || closestPrice.closePrice === 0) return null;
    return ((currentPrice - closestPrice.closePrice) / closestPrice.closePrice) * 100;
  }

  private calculateADR(prices: StockPrice[], period: number): number | null {
    const withHL = prices
      .filter((p) => p.highPrice != null && p.lowPrice != null && p.closePrice > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, period);
    if (withHL.length < 2) return null;
    const ranges = withHL.map((p) => ((p.highPrice! - p.lowPrice!) / p.closePrice) * 100);
    return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
  }

  private calculateATR14(prices: StockPrice[]): number | null {
    const sorted = prices
      .filter((p) => p.highPrice != null && p.lowPrice != null && p.closePrice > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 15) return null;
    const trValues: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const high = sorted[i].highPrice!;
      const low = sorted[i].lowPrice!;
      const prevClose = sorted[i - 1].closePrice;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trValues.push(tr);
    }
    const last14 = trValues.slice(-14);
    return last14.reduce((sum, tr) => sum + tr, 0) / last14.length;
  }

  private calculateSMA50(prices: StockPrice[]): number | null {
    const sorted = prices.filter((p) => p.closePrice > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 50) return null;
    const last50 = sorted.slice(-50);
    return last50.reduce((sum, p) => sum + p.closePrice, 0) / 50;
  }

  private calculateAtrMultiple(close: number, sma50: number | null, atr14: number | null): number | null {
    if (sma50 === null || atr14 === null || atr14 === 0 || sma50 === 0) return null;
    return ((close - sma50) / sma50) / (atr14 / close);
  }

  private calculateDollarVolume(prices: StockPrice[], currentPrice: number, period: number): number | null {
    const withVol = prices
      .filter((p) => p.volume != null && p.volume > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, period);
    if (withVol.length < 1) return null;
    const avgVol = withVol.reduce((sum, p) => sum + p.volume!, 0) / withVol.length;
    return avgVol * currentPrice;
  }

  // ---------------------------------------------------------------------------
  // getThemesWithPerformance — 2 DB queries total (was N*2+N+1)
  // ---------------------------------------------------------------------------
  async getThemesWithPerformance(): Promise<ThemeWithPerformance[]> {
    const cached = cacheGet<ThemeWithPerformance[]>("themes_perf");
    if (cached) return cached;

    // Query 1: themes + their stocks in one join
    const rows = await db
      .select({
        themeId: themes.id,
        themeName: themes.name,
        themeDescription: themes.description,
        symbol: themeStocks.symbol,
      })
      .from(themes)
      .leftJoin(themeStocks, eq(themes.id, themeStocks.themeId));

    // Build theme map and collect all unique symbols
    const themeMap = new Map<number, { id: number; name: string; description: string | null; symbols: string[] }>();
    for (const row of rows) {
      if (!themeMap.has(row.themeId)) {
        themeMap.set(row.themeId, { id: row.themeId, name: row.themeName, description: row.themeDescription, symbols: [] });
      }
      if (row.symbol) themeMap.get(row.themeId)!.symbols.push(row.symbol);
    }

    const allSymbols = Array.from(new Set(rows.map((r) => r.symbol).filter(Boolean))) as string[];
    if (allSymbols.length === 0) {
      const result: ThemeWithPerformance[] = Array.from(themeMap.values()).map((t) => ({
        id: t.id, name: t.name, description: t.description, stocks: [],
        avgChange1d: null, avgChange1w: null, avgChange1m: null, avgChange3m: null,
      }));
      cacheSet("themes_perf", result, PERF_TTL);
      return result;
    }

    // Query 2: all prices for all symbols at once (250-day window)
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 250);
    const sinceDateStr = sinceDate.toISOString().split("T")[0];

    const allPrices = await db
      .select()
      .from(stockPrices)
      .where(and(inArray(stockPrices.symbol, allSymbols), sql`${stockPrices.date} >= ${sinceDateStr}`))
      .orderBy(stockPrices.symbol, stockPrices.date);

    // Group prices by symbol in memory
    const pricesBySymbol = new Map<string, StockPrice[]>();
    for (const p of allPrices) {
      if (!pricesBySymbol.has(p.symbol)) pricesBySymbol.set(p.symbol, []);
      pricesBySymbol.get(p.symbol)!.push(p);
    }

    const avg = (vals: (number | null)[]) => {
      const valid = vals.filter((v): v is number => v !== null);
      return valid.length === 0 ? null : valid.reduce((a, b) => a + b, 0) / valid.length;
    };

    const result: ThemeWithPerformance[] = [];
    for (const theme of themeMap.values()) {
      const stockPerformances: StockPerformance[] = [];

      for (const symbol of theme.symbols) {
        const prices = pricesBySymbol.get(symbol) ?? [];
        const sorted = [...prices].sort((a, b) => b.date.localeCompare(a.date));
        const currentPrice = sorted[0]?.closePrice ?? null;

        const change1d = currentPrice !== null ? this.calculateChange(prices, 1, currentPrice) : null;
        const change1w = currentPrice !== null ? this.calculateChange(prices, 7, currentPrice) : null;
        const change1m = currentPrice !== null ? this.calculateChange(prices, 30, currentPrice) : null;
        const change3m = currentPrice !== null ? this.calculateChange(prices, 90, currentPrice) : null;
        const adr = this.calculateADR(prices, 20);
        const atr14 = this.calculateATR14(prices);
        const sma50 = this.calculateSMA50(prices);
        const atrMultiple = currentPrice !== null ? this.calculateAtrMultiple(currentPrice, sma50, atr14) : null;
        const dollarVolume = currentPrice !== null ? this.calculateDollarVolume(prices, currentPrice, 20) : null;

        stockPerformances.push({ symbol, currentPrice, adr, atrMultiple, dollarVolume, change1d, change1w, change1m, change3m });
      }

      result.push({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        stocks: stockPerformances,
        avgChange1d: avg(stockPerformances.map((s) => s.change1d)),
        avgChange1w: avg(stockPerformances.map((s) => s.change1w)),
        avgChange1m: avg(stockPerformances.map((s) => s.change1m)),
        avgChange3m: avg(stockPerformances.map((s) => s.change3m)),
      });
    }

    cacheSet("themes_perf", result, PERF_TTL);
    return result;
  }

  // ---------------------------------------------------------------------------
  // ETF methods
  // ---------------------------------------------------------------------------
  async getEtfs(): Promise<Etf[]> {
    return db.select().from(etfs);
  }

  async getEtf(id: number): Promise<Etf | undefined> {
    const result = await db.select().from(etfs).where(eq(etfs.id, id));
    return result[0];
  }

  async createEtf(data: InsertEtf): Promise<Etf> {
    const result = await db.insert(etfs).values(data).returning();
    cacheInvalidate("etfs_perf");
    return result[0];
  }

  async updateEtf(id: number, data: Partial<InsertEtf>): Promise<Etf> {
    const result = await db.update(etfs).set(data).where(eq(etfs.id, id)).returning();
    if (result.length === 0) throw new Error("ETF not found");
    cacheInvalidate("etfs_perf");
    return result[0];
  }

  async deleteEtf(id: number): Promise<void> {
    await db.delete(etfs).where(eq(etfs.id, id));
    cacheInvalidate("etfs_perf");
  }

  async getAllEtfSymbols(): Promise<string[]> {
    const result = await db.selectDistinct({ symbol: etfs.symbol }).from(etfs);
    return result.map((r) => r.symbol);
  }

  // ---------------------------------------------------------------------------
  // getEtfsWithPerformance — 2 DB queries total (was N*2+1)
  // ---------------------------------------------------------------------------
  async getEtfsWithPerformance(): Promise<EtfWithPerformance[]> {
    const cached = cacheGet<EtfWithPerformance[]>("etfs_perf");
    if (cached) return cached;

    // Query 1: all ETFs
    const allEtfs = await this.getEtfs();
    if (allEtfs.length === 0) return [];

    const symbols = allEtfs.map((e) => e.symbol);

    // Query 2: all prices for all ETF symbols at once (100-day window)
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 100);
    const sinceDateStr = sinceDate.toISOString().split("T")[0];

    const allPrices = await db
      .select()
      .from(stockPrices)
      .where(and(inArray(stockPrices.symbol, symbols), sql`${stockPrices.date} >= ${sinceDateStr}`))
      .orderBy(stockPrices.symbol, stockPrices.date);

    const pricesBySymbol = new Map<string, StockPrice[]>();
    for (const p of allPrices) {
      if (!pricesBySymbol.has(p.symbol)) pricesBySymbol.set(p.symbol, []);
      pricesBySymbol.get(p.symbol)!.push(p);
    }

    const result: EtfWithPerformance[] = allEtfs.map((etf) => {
      const prices = pricesBySymbol.get(etf.symbol) ?? [];
      const sorted = [...prices].sort((a, b) => b.date.localeCompare(a.date));
      const currentPrice = sorted[0]?.closePrice ?? null;

      return {
        id: etf.id,
        symbol: etf.symbol,
        name: etf.name,
        description: etf.description,
        currentPrice,
        change1d: currentPrice !== null ? this.calculateChange(prices, 1, currentPrice) : null,
        change1w: currentPrice !== null ? this.calculateChange(prices, 7, currentPrice) : null,
        change1m: currentPrice !== null ? this.calculateChange(prices, 30, currentPrice) : null,
        change3m: currentPrice !== null ? this.calculateChange(prices, 90, currentPrice) : null,
      };
    });

    cacheSet("etfs_perf", result, PERF_TTL);
    return result;
  }

  async getThemesForSymbol(symbol: string): Promise<string[]> {
    const result = await db
      .select({ name: themes.name })
      .from(themeStocks)
      .innerJoin(themes, eq(themeStocks.themeId, themes.id))
      .where(eq(themeStocks.symbol, symbol));
    return result.map((r) => r.name);
  }

  async deleteSymbolHistory(symbol: string, beforeDate?: string): Promise<void> {
    if (beforeDate) {
      await db
        .delete(stockPrices)
        .where(and(eq(stockPrices.symbol, symbol), lt(stockPrices.date, beforeDate)));
    } else {
      await db.delete(stockPrices).where(eq(stockPrices.symbol, symbol));
    }
    cacheInvalidate("themes_perf", "etfs_perf");
  }

  async getChartDrawings(symbol: string): Promise<ChartDrawing[]> {
    return db.select().from(chartDrawings).where(eq(chartDrawings.symbol, symbol));
  }

  async createChartDrawing(symbol: string, type: string, data: string): Promise<ChartDrawing> {
    const [drawing] = await db.insert(chartDrawings).values({ symbol, type, data }).returning();
    return drawing;
  }

  async deleteChartDrawing(id: number): Promise<void> {
    await db.delete(chartDrawings).where(eq(chartDrawings.id, id));
  }

  async clearChartDrawings(symbol: string): Promise<void> {
    await db.delete(chartDrawings).where(eq(chartDrawings.symbol, symbol));
  }
}

export const storage = new DatabaseStorage();
