// @ts-nocheck
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright-core';
import { Log } from '../util/log.js';

const log = Log.create({ service: 'browser-runtime' });

export class BrowserRuntime {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();

  async init(headless: boolean = true): Promise<void> {
    if (!this.browser) {
      log.info('Initializing browser runtime', { headless });
      this.browser = await chromium.launch({
        headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
        ],
      });
    }
  }

  async getPage(sessionId: string): Promise<Page> {
    if (!this.browser) {
      await this.init();
    }

    if (!this.pages.has(sessionId)) {
      const context = await this.browser!.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      this.pages.set(sessionId, page);
      log.info('Created new browser page', { sessionId });
    }

    return this.pages.get(sessionId)!;
  }

  async closePage(sessionId: string): Promise<void> {
    const page = this.pages.get(sessionId);
    if (page) {
      await page.context().close();
      this.pages.delete(sessionId);
      log.info('Closed browser page', { sessionId });
    }
  }

  async closeAll(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.pages.clear();
      log.info('Closed browser runtime completely');
    }
  }
}

export const browserRuntime = new BrowserRuntime();
