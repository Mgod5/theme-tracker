# Theme Tracker - Investment Theme Performance

## Overview
A stock theme performance tracking application. Users create investment themes (groups of stocks), add/remove stock symbols, and track collective and individual stock performance across 1-day, 1-week, 1-month, and 3-month timeframes.

## Architecture
- **Frontend**: React + Vite + TanStack Query + shadcn/ui + Tailwind CSS
- **Backend**: Express.js + Drizzle ORM + PostgreSQL
- **Stock Data**: Polygon.io API (current prices + historical OHLCV), Yahoo Finance (ETF holdings only)
- **Scheduling**: node-cron for daily 5PM EST (Mon-Fri) price updates

## Key Files
- `shared/schema.ts` - Data models (themes, themeStocks, stockPrices)
- `server/routes.ts` - API endpoints + cron scheduling
- `server/storage.ts` - Database CRUD operations + performance calculation
- `server/stockPrices.ts` - Polygon.io + Yahoo Finance API integration
- `server/seed.ts` - Seed data (AI, Cloud, EV themes)
- `server/db.ts` - Database connection
- `client/src/pages/home.tsx` - Main page
- `client/src/components/theme-card.tsx` - Theme card with expandable stock list
- `client/src/components/add-theme-dialog.tsx` - Create theme dialog
- `client/src/components/add-stock-dialog.tsx` - Add stock to theme dialog

## API Routes
- `GET /api/themes` - List all themes with performance data
- `POST /api/themes` - Create a new theme
- `DELETE /api/themes/:id` - Delete a theme
- `POST /api/themes/:id/stocks` - Add stock to theme (fetches historical prices)
- `DELETE /api/themes/:id/stocks/:symbol` - Remove stock from theme
- `POST /api/prices/update` - Manual price refresh
- `GET /api/etfs` - List all ETFs with performance data
- `POST /api/etfs` - Create a new ETF
- `PATCH /api/etfs/:id` - Update ETF name/description
- `DELETE /api/etfs/:id` - Delete an ETF
- `GET /api/etfs/:id/price-history` - Get OHLCV price history for ETF (with auto-backfill)
- `GET /api/etfs/:id/top-holdings` - Get top 10 holdings with 30-day performance (Yahoo Finance quoteSummary + crumb auth)

## Database Schema
- `themes` - id (serial), name, description
- `theme_stocks` - id (serial), themeId (FK), symbol
- `stock_prices` - id (serial), symbol, date, openPrice, highPrice, lowPrice, closePrice, volume, fetchedAt
- `etfs` - id (serial), symbol, name, description
- `chart_drawings` - id (serial), symbol, type ("trend-line"|"text"), data (JSON text)

## Polygon.io API
- API key stored in `POLYGON_API_KEY` environment secret
- Current prices: `GET /v2/aggs/ticker/{symbol}/prev` (previous day close with OHLCV)
- Historical bars: `GET /v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}` (daily OHLCV)
- All requests use `adjusted=true` for split-adjusted prices

## Yahoo Finance Auth (ETF holdings only)
- The v10 quoteSummary endpoint requires cookie+crumb authentication
- Crumb is fetched from `https://query2.finance.yahoo.com/v1/test/getcrumb` with cookies from `https://fc.yahoo.com`
- Crumb is cached for 30 minutes in `server/stockPrices.ts`
- Only used for ETF top holdings data (Polygon doesn't provide ETF holdings)

## Recent Changes
- 2026-04-01: Increased historical data backfill from 100 to 1095 days (3 years); chart endpoint queries 1095 days; no additional API feeds/costs (Polygon Massive tier supports 15+ years)
- 2026-04-01: Added drawing tools to stock chart page — Trend Line (click 2 points, extended line across chart) and Text annotation (click to place, type label); SVG overlay with amber color; Clear All button; Escape cancels pending drawing; drawings re-render correctly on chart scroll/zoom
- 2026-04-01: Added stock chart page (/charts/:symbol) — candlestick chart with SMA 10/20/50/200 + VWAP; stats header (ADR, $Vol, ATR Mult, RSI14, Avg Vol 20d); RSI direction (green rising/red falling); Avg Vol direction (5d vs 20d); Sector from Polygon ref API (sic_description, cached 24h); Theme badges; click any symbol in Dashboard to navigate to chart
- 2026-04-01: Added GET /api/stocks/:symbol/chart endpoint; added getThemesForSymbol to IStorage
- 2026-03-25: Added ATR% Multiple from 50 MA column to theme stock table (between Symbol and ADR); formula: ((close - sma50) / sma50) / (atr14 / close); uses ATR14 (True Range method) and SMA50
- 2026-03-10: Switched stock/ETF price data from Yahoo Finance to Polygon.io API; kept Yahoo Finance for ETF holdings only
- 2026-03-10: Added 20-day ADR (Average Daily Range) column to theme stock table in blue font
- 2026-03-05: Added top 10 ETF holdings with 30-day performance display
- 2026-03-05: Added expand/collapse for ETF cards with Expand All / Collapse All buttons
- 2026-02-09: Initial build - schema, frontend, backend, seed data, cron scheduling
