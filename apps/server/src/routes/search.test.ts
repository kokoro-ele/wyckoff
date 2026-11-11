import Database from "better-sqlite3";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { workspaceContext } from "../cloud/context.js";
import { initializeDatabase } from "../db/schema.js";
vi.mock("../tickflow/client.js", () => ({
  fetchInstruments: async () => [{symbol:"AAPL.US",code:"AAPL",exchange:"US",region:"US",type:"stock",name:"Apple"}],
  fetchExchangeInstruments: async (exchange: string) => exchange === "US" ? [{symbol:"GOOG.US",code:"GOOG",exchange:"US",region:"US",type:"stock",name:"Alphabet"}] : [],
}));
it("search syncs a partial index populated by the initial chart", async () => {
  const database = new Database(":memory:");
  initializeDatabase(database);
  try {
    await workspaceContext.run({userId:"test",database,dirty:false,deferred:[],state:new Map(),deadline:Date.now()+60000},async () => {
      const {getInstrument,indexSize}=await import("../services/instruments.js");
      await getInstrument("AAPL.US");
      expect(indexSize()).toBe(1);
      const {libraryRoutes}=await import("./library.js");
      const response=await new Hono().route("/api",libraryRoutes).request("/api/search?q=goog");
      expect(response.status).toBe(200);
      const body = await response.json() as { results: Array<{ symbol: string }> };
      expect(body.results).toEqual(expect.arrayContaining([expect.objectContaining({symbol:"GOOG.US"})]));
    });
  } finally {database.close();}
});
