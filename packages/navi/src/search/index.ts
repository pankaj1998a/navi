import type { SearchProvider } from "../tool/search-pipeline";
export type { SearchProvider };

export interface SearchQuery {
  text: string;
  limit?: number;
  timeRange?: 'day' | 'week' | 'month' | 'year';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
  publishedDate?: string;
}

export interface SearchService {
  search(query: SearchQuery, provider?: SearchProvider | 'exa' | 'tavily' | 'firecrawl'): Promise<SearchResult[]>;
}
