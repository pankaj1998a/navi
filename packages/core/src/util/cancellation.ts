export enum CancellationReason {
  MANUAL = 'manual',
  FOLLOW_UP = 'follow_up',
  NEW_COMMAND = 'new_command',
  TIMEOUT = 'timeout',
  DEPENDENCY_FAILED = 'dependency_failed',
  ERROR = 'error'
}

export type CancellationHandler = (reason: CancellationReason) => void | Promise<void>;

/**
 * CancellationToken provides a way to coordinate cancellation across asynchronous operations
 * with granular reason tracking.
 */
export class CancellationToken {
  private _reason: CancellationReason | null = null;
  private _isCancelled = false;
  private _handlers = new Set<CancellationHandler>();

  /**
   * Whether the token has been cancelled.
   */
  get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * The reason for cancellation, if any.
   */
  get reason(): CancellationReason | null {
    return this._reason;
  }

  /**
   * Cancels the token with a specific reason.
   * Triggers all registered cleanup handlers.
   */
  async cancel(reason: CancellationReason) {
    if (this._isCancelled) return;
    
    this._isCancelled = true;
    this._reason = reason;

    const cleanupPromises = Array.from(this._handlers).map(async (handler) => {
      try {
        await handler(reason);
      } catch (err) {
        // We use console.error here as we want to ensure all handlers run 
        // even if one fails.
        console.error('Error in cancellation handler:', err);
      }
    });

    await Promise.all(cleanupPromises);
  }

  /**
   * Registers a handler to be called when cancellation occurs.
   * If the token is already cancelled, the handler is called immediately.
   */
  onCancellation(handler: CancellationHandler): () => void {
    if (this._isCancelled) {
      // Execute immediately if already cancelled
      Promise.resolve().then(() => {
        try {
          handler(this._reason!);
        } catch (err) {
          console.error('Error in immediate cancellation handler:', err);
        }
      });
      return () => {};
    }
    
    this._handlers.add(handler);
    return () => this._handlers.delete(handler);
  }

  /**
   * Throws an error if the token has been cancelled.
   */
  throwIfCancelled() {
    if (this._isCancelled) {
      const error = new Error(`Operation cancelled: ${this._reason}`);
      (error as any).reason = this._reason;
      throw error;
    }
  }
}
