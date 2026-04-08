import { log } from "./index";

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "";
const POLYGON_BASE = "https://api.polygon.io";

async function polygonFetch(url: string, retries = 2): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429 && attempt < retries) {
      const wait = Math.pow(2, attempt + 1) * 1000;
      log(`Polygon: Rate limited, retrying in ${wait}ms...`, "stocks");
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    log(`Polygon: HTTP ${res.status} for ${url.split("apiKey")[0]}`, "stocks");
    return null;
  }
  return null;
}

export interface CurrentBar {
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export async function fetchCurrentPrices(symbols: string[]): Promise<Map<string, CurrentBar>> {
  const prices = new Map<string, CurrentBar>();
  if (symbols.length === 0 || !POLYGON_API_KEY) return prices;

  const uniqueSymbols = Array.from(new Set(symbols));

  // Use the snapshot endpoint — returns real-time price during market hours,
  // last trade price after hours, or previous close on weekends/holidays.
  const BATCH = 250;
  for (let i = 0; i < uniqueSymbols.length; i += BATCH) {
    const batch = uniqueSymbols.slice(i, i + BATCH);
    const tickersParam = batch.join(",");
    const url = `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${encodeURIComponent(tickersParam)}&apiKey=${POLYGON_API_KEY}`;
    const res = await polygonFetch(url);
    if (!res) continue;

    let data: any;
    try { data = await res.json(); } catch { continue; }

    const tickers: any[] = data?.tickers ?? [];
    for (const t of tickers) {
      const sym: string = t.ticker;
      // Priority: lastTrade (most current) → day.c (session close) → prevDay.c (prior close)
      const close =
        (t.lastTrade?.p ?? null) !== null
          ? t.lastTrade.p
          : (t.day?.c ?? null) !== null
          ? t.day.c
          : t.prevDay?.c ?? null;

      if (close == null) {
        log(`Polygon snapshot: no price for ${sym}`, "stocks");
        continue;
      }

      // Use today's session OHLCV if available, else fall back to prevDay
      const dayBar = t.day ?? {};
      const prevDay = t.prevDay ?? {};
      prices.set(sym, {
        close,
        open:   dayBar.o  ?? prevDay.o  ?? null,
        high:   dayBar.h  ?? prevDay.h  ?? null,
        low:    dayBar.l  ?? prevDay.l  ?? null,
        volume: dayBar.v  ?? prevDay.v  ?? null,
      });
    }
  }

  // Log any symbols that got no data
  for (const sym of uniqueSymbols) {
    if (!prices.has(sym)) {
      log(`Polygon snapshot: no data for ${sym}`, "stocks");
    }
  }

  return prices;
}

export interface HistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchHistoricalPrices(
  symbol: string,
  periodDays: number
): Promise<HistoricalBar[]> {
  const results: HistoricalBar[] = [];
  if (!POLYGON_API_KEY) return results;

  try {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - periodDays);

    const fromStr = from.toISOString().split("T")[0];
    const toStr = to.toISOString().split("T")[0];

    const url = `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_API_KEY}`;
    const res = await polygonFetch(url);
    if (!res) return results;

    const data = await res.json();
    const bars = data?.results || [];

    for (const bar of bars) {
      if (bar.c != null && bar.o != null && bar.h != null && bar.l != null) {
        const d = new Date(bar.t);
        const dateStr = d.toISOString().split("T")[0];
        results.push({
          date: dateStr,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v || 0,
        });
      }
    }
  } catch (err) {
    log(`Polygon: Error fetching historical for ${symbol}: ${err}`, "stocks");
  }

  return results;
}

export interface EtfHolding {
  symbol: string;
  holdingName: string;
  holdingPercent: number;
}

let cachedCrumb: string | null = null;
let cachedCookies: string | null = null;
let crumbFetchedAt = 0;

async function getYahooCrumb(): Promise<{ crumb: string; cookies: string } | null> {
  const now = Date.now();
  if (cachedCrumb && cachedCookies && now - crumbFetchedAt < 1000 * 60 * 30) {
    return { crumb: cachedCrumb, cookies: cachedCookies };
  }

  try {
    const consentRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      redirect: "manual",
    });
    const setCookies = consentRes.headers.getSetCookie?.() || [];
    const cookieStr = setCookies.map((c: string) => c.split(";")[0]).join("; ");

    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": cookieStr,
      },
    });

    if (!crumbRes.ok) {
      log(`Failed to get Yahoo crumb: ${crumbRes.status}`, "stocks");
      return null;
    }

    const crumb = await crumbRes.text();
    cachedCrumb = crumb;
    cachedCookies = cookieStr;
    crumbFetchedAt = now;
    return { crumb, cookies: cookieStr };
  } catch (err) {
    log(`Error getting Yahoo crumb: ${err}`, "stocks");
    return null;
  }
}

export async function fetchEtfHoldings(etfSymbol: string): Promise<EtfHolding[]> {
  try {
    const auth = await getYahooCrumb();
    if (!auth) return [];

    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(etfSymbol)}?modules=topHoldings&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": auth.cookies,
      },
    });

    if (!res.ok) {
      log(`Failed to fetch holdings for ${etfSymbol}: ${res.status}`, "stocks");
      cachedCrumb = null;
      return [];
    }

    const data = await res.json();
    const topHoldings = data?.quoteSummary?.result?.[0]?.topHoldings?.holdings || [];

    return topHoldings
      .filter((h: any) => h.symbol && h.symbol.trim().length > 0)
      .slice(0, 10)
      .map((h: any) => ({
        symbol: h.symbol,
        holdingName: h.holdingName || h.symbol,
        holdingPercent: h.holdingPercent?.raw ?? 0,
      }));
  } catch (err) {
    log(`Error fetching holdings for ${etfSymbol}: ${err}`, "stocks");
    return [];
  }
}

export interface HoldingPerformance {
  symbol: string;
  name: string;
  weight: number;
  change30d: number | null;
}

export async function fetchHoldingsWithPerformance(etfSymbol: string): Promise<HoldingPerformance[]> {
  const holdings = await fetchEtfHoldings(etfSymbol);
  if (holdings.length === 0 || !POLYGON_API_KEY) return [];

  const from = new Date();
  from.setDate(from.getDate() - 35);
  const fromStr = from.toISOString().split("T")[0];
  const toStr = new Date().toISOString().split("T")[0];

  const results = await Promise.all(
    holdings.map(async (holding): Promise<HoldingPerformance> => {
      try {
        const url = `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(holding.symbol)}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=50&apiKey=${POLYGON_API_KEY}`;
        const res = await polygonFetch(url);

        if (!res) {
          return { symbol: holding.symbol, name: holding.holdingName, weight: holding.holdingPercent, change30d: null };
        }

        const data = await res.json();
        const bars = (data?.results || []).filter((b: any) => b.c != null);

        if (bars.length >= 2) {
          const change = ((bars[bars.length - 1].c - bars[0].c) / bars[0].c) * 100;
          return { symbol: holding.symbol, name: holding.holdingName, weight: holding.holdingPercent, change30d: change };
        }

        return { symbol: holding.symbol, name: holding.holdingName, weight: holding.holdingPercent, change30d: null };
      } catch (err) {
        log(`Polygon: Error fetching 30d perf for ${holding.symbol}: ${err}`, "stocks");
        return { symbol: holding.symbol, name: holding.holdingName, weight: holding.holdingPercent, change30d: null };
      }
    })
  );

  results.sort((a, b) => (b.change30d ?? -Infinity) - (a.change30d ?? -Infinity));
  return results;
}
