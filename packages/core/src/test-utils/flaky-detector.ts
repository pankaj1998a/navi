export interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: any;
}

/**
 * Identifies tests that exhibit inconsistent behavior across multiple runs.
 */
export class FlakyTestDetector {
  private history = new Map<string, TestResult[]>();
  
  /**
   * Adds a test result to the history.
   */
  addResult(result: TestResult) {
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

  /**
   * A test is considered flaky if it has at least one success and one failure 
   * in its recorded history.
   */
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

  /**
   * Resets the detection history.
   */
  reset() {
    this.history.clear();
  }
}
