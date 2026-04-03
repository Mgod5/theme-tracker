import { db } from "./db";
import { themes, themeStocks } from "@shared/schema";
import { log } from "./index";
import { fetchHistoricalPrices } from "./stockPrices";
import { storage } from "./storage";

export async function seedDatabase() {
  const existingThemes = await db.select().from(themes);
  if (existingThemes.length > 0) {
    log("Database already seeded, skipping", "seed");
    return;
  }

  log("Seeding database with sample themes...", "seed");

  const seedThemes = [
    {
      name: "AI & Machine Learning",
      description: "Companies leading in artificial intelligence and machine learning technologies",
      stocks: ["NVDA", "MSFT", "GOOGL", "META"],
    },
    {
      name: "Cloud Computing",
      description: "Major cloud infrastructure and platform providers",
      stocks: ["AMZN", "MSFT", "GOOGL", "CRM"],
    },
    {
      name: "Electric Vehicles",
      description: "Electric vehicle manufacturers and related companies",
      stocks: ["TSLA", "RIVN", "NIO", "F"],
    },
  ];

  for (const t of seedThemes) {
    const [created] = await db.insert(themes).values({
      name: t.name,
      description: t.description,
    }).returning();

    for (const symbol of t.stocks) {
      await db.insert(themeStocks).values({
        themeId: created.id,
        symbol,
      });

      try {
        const historicalPrices = await fetchHistoricalPrices(symbol, 100);
        for (const hp of historicalPrices) {
          await storage.upsertStockPrice({
            symbol,
            date: hp.date,
            closePrice: hp.close,
          });
        }
        log(`Seeded ${historicalPrices.length} prices for ${symbol}`, "seed");
      } catch (err) {
        log(`Warning: Could not fetch prices for ${symbol}: ${err}`, "seed");
      }
    }

    log(`Created theme: ${t.name}`, "seed");
  }

  log("Seeding complete!", "seed");
}
