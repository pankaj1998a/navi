import { Log } from '../util/log';

export interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: any;
}

/**
 * FlakyTestDetector tracks test failures and attempts reruns to identify
 * non-deterministic failures.
 */
export class FlakyTestDetector {
  private log = Log.create({ service: 'test.flaky-detector' });
  private history = new Map<string, TestResult[]>();
  private readonly maxReruns: number;

  constructor(maxReruns = 3) {
    this.maxReruns = maxReruns;
  }

  /**
   * Executes a test with retry logic to detect flakiness.
   */
  async runWithDetection(name: string, testFn: () => Promise<void>): Promise<TestResult> {
    const start = Date.now();
    let lastError: any;

    for (let attempt = 1; attempt <= this.maxReruns; attempt++) {
      try {
        await testFn();
        
        const result: TestResult = {
          name,
          success: true,
          duration: Date.now() - start
        };
        this.addResult(result);

        if (attempt > 1) {
          this.log.warn(`Flaky test detected and recovered: ${name} (on attempt ${attempt})`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        const result: TestResult = {
          name: name,
          success: false,
          duration: Date.now() - start,
          error
        };
        this.addResult(result);
        
        if (attempt < this.maxReruns) {
          this.log.warn(`Test attempt ${attempt} failed: ${name}. Retrying...`);
          // Add small exponential backoff before retry
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
        } else {
          this.log.error(`Test permanently failed after ${this.maxReruns} attempts: ${name}`);
        }
      }
    }

    return {
      name,
      success: false,
      duration: Date.now() - start,
      error: lastError
    };
  }

  /**
   * Adds a test result to the history.
   */
  private addResult(result: TestResult) {
    const results = this.history.get(result.name) || [];
    results.push(result);
    this.history.set(result.name, results);
  }

  /**
   * Returns a list of test names that have both passed and failed.
   */
  detectFlakyTests(): string[] {
    return Array.from(this.history.entries())
      .filter(([, results]) => this.isFlaky(results))
      .map(([name]) => name);
  }

  private isFlaky(results: TestResult[]): boolean {
    if (results.length < 2) return false;
    let hasPass = false;
    let hasFail = false;
    for (const r of results) {
      if (r.success) hasPass = true;
      else hasFail = true;
      if (hasPass && hasFail) return true;
    }
    return false;
  }

  /**
   * Returns a summary of the test execution and flaky detection.
   */
  getSummary() {
    const flaky = this.detectFlakyTests();
    return {
      totalTestsTracked: this.history.size,
      flakyCount: flaky.length,
      flakyTests: flaky,
      historyDepth: Array.from(this.history.values()).map(r => r.length)
    };
  }

  reset() {
    this.history.clear();
  }
}
