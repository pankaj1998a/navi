import { Env } from "../env";
import * as Log from "@navi-ai/core/util/log"

import type { SearchQuery, SearchResult, SearchService } from "./index";
import type { SearchProvider } from "../tool/search-pipeline";
import { executeSearchPipeline } from "../tool/search-pipeline";
import { searchWithProvider } from "../tool/http-search";

const log = Log.create({ service: "search-service" });

export class DefaultSearchService implements SearchService {
  async search(query: SearchQuery, provider?: SearchProvider | 'exa' | 'tavily' | 'firecrawl'): Promise<SearchResult[]> {
    const targetProvider = provider || ((await Env.get("NAVI_WEB_SEARCH_PROVIDER")) as any) || "google";
    const limit = query.limit || 8;

    log.info("searching", { query: query.text, provider: targetProvider });

    try {
      if (targetProvider === "exa") return await this.searchExa(query);
      if (targetProvider === "tavily") return await this.searchTavily(query);
      if (targetProvider === "firecrawl") return await this.searchFirecrawl(query);

      // Use the pipeline for standard providers (google, bing, duckduckgo, browser)
      const execution = await executeSearchPipeline(query.text, limit, [targetProvider as SearchProvider]);
      return execution.results;
    } catch (error) {
      log.error("search failed", { provider: targetProvider, error: String(error) });
      return [];
    }
  }

  private async searchExa(query: SearchQuery): Promise<SearchResult[]> {
    const apiKey = await Env.get("EXA_API_KEY");
    if (!apiKey) throw new Error("EXA_API_KEY not set");

    const body: any = {
      query: query.text,
      numResults: query.limit || 10,
      useAutoprompt: true,
    };

    if (query.timeRange) {
      const now = new Date();
      if (query.timeRange === "day") now.setDate(now.getDate() - 1);
      if (query.timeRange === "week") now.setDate(now.getDate() - 7);
      if (query.timeRange === "month") now.setMonth(now.getMonth() - 1);
      if (query.timeRange === "year") now.setFullYear(now.getFullYear() - 1);
      body.startPublishedDate = now.toISOString();
    }

    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Exa API error: ${await res.text()}`);
    const data = await res.json() as any;
    return (data.results || []).map((r: any) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.highlights?.join("... ") || "",
      publishedDate: r.publishedDate,
    }));
  }

  private async searchTavily(query: SearchQuery): Promise<SearchResult[]> {
    const apiKey = await Env.get("TAVILY_API_KEY");
    if (!apiKey) throw new Error("TAVILY_API_KEY not set");

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.text,
        max_results: query.limit || 8,
        search_depth: "balanced",
      }),
    });

    if (!res.ok) throw new Error(`Tavily API error: ${await res.text()}`);
    const data = await res.json() as any;
    return (data.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }

  private async searchFirecrawl(query: SearchQuery): Promise<SearchResult[]> {
    const apiKey = await Env.get("FIRECRAWL_API_KEY");
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: query.text,
        limit: query.limit || 8,
        lang: "en",
      }),
    });

    if (!res.ok) throw new Error(`Firecrawl API error: ${await res.text()}`);
    const data = await res.json() as any;
    return (data.data || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      content: r.markdown,
    }));
  }
}

export const searchService = new DefaultSearchService();
