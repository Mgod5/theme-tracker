import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, date, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const themes = pgTable("themes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
});

export const themeStocks = pgTable("theme_stocks", {
  id: serial("id").primaryKey(),
  themeId: integer("theme_id").notNull().references(() => themes.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
});

export const stockPrices = pgTable("stock_prices", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  date: date("date").notNull(),
  openPrice: real("open_price"),
  highPrice: real("high_price"),
  lowPrice: real("low_price"),
  closePrice: real("close_price").notNull(),
  volume: real("volume"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertThemeSchema = createInsertSchema(themes).omit({ id: true });
export const insertThemeStockSchema = createInsertSchema(themeStocks).omit({ id: true });
export const insertStockPriceSchema = createInsertSchema(stockPrices).omit({ id: true, fetchedAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Theme = typeof themes.$inferSelect;
export type InsertTheme = z.infer<typeof insertThemeSchema>;
export type ThemeStock = typeof themeStocks.$inferSelect;
export type InsertThemeStock = z.infer<typeof insertThemeStockSchema>;
export type StockPrice = typeof stockPrices.$inferSelect;
export type InsertStockPrice = z.infer<typeof insertStockPriceSchema>;

export const chartDrawings = pgTable("chart_drawings", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull(),
  data: text("data").notNull(),
});

export const insertChartDrawingSchema = createInsertSchema(chartDrawings).omit({ id: true });
export type ChartDrawing = typeof chartDrawings.$inferSelect;
export type InsertChartDrawing = z.infer<typeof insertChartDrawingSchema>;

export const etfs = pgTable("etfs", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  description: text("description"),
});

export const insertEtfSchema = createInsertSchema(etfs).omit({ id: true });
export type Etf = typeof etfs.$inferSelect;
export type InsertEtf = z.infer<typeof insertEtfSchema>;

export interface EtfWithPerformance {
  id: number;
  symbol: string;
  name: string;
  description: string | null;
  currentPrice: number | null;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  change3m: number | null;
}

export interface StockPerformance {
  symbol: string;
  currentPrice: number | null;
  adr: number | null;
  atrMultiple: number | null;
  dollarVolume: number | null;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  change3m: number | null;
}

export interface ThemeWithPerformance {
  id: number;
  name: string;
  description: string | null;
  stocks: StockPerformance[];
  avgChange1d: number | null;
  avgChange1w: number | null;
  avgChange1m: number | null;
  avgChange3m: number | null;
}
