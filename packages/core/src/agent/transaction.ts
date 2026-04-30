import { Effect, Layer, ServiceMap } from "effect"
import { CancellationToken } from "../util/cancellation"
import { Log } from "../util/log"
import { NaviError } from "../util/errors"
import { Bus } from "../bus/index.ts"

export type TransactionStatus = 'pending' | 'committed' | 'rolled_back';

export interface TransactionState {
  taskId: string;
  status: TransactionStatus;
  data: any;
  originalData?: any;
  error?: Error;
  timestamp: number;
}

export interface ExecuteOptions {
  token?: CancellationToken;
  mask?: string[];
  sessionID?: string;
}

/**
 * Core transaction logic that can be used in both standard TS and Effect.
 */
export class AgentTransactionManager {
  private static instance: AgentTransactionManager;
  private transactions = new Map<string, TransactionState>();
  private log = Log.create({ service: "agent.transaction" });

  static getInstance(): AgentTransactionManager {
    if (!AgentTransactionManager.instance) {
      AgentTransactionManager.instance = new AgentTransactionManager();
    }
    return AgentTransactionManager.instance;
  }

  async execute<T>(
    taskId: string,
    task: () => Promise<T>,
    options?: ExecuteOptions
  ): Promise<T> {
    this.log.info(`Starting transaction for task: ${taskId}`);

    const state: TransactionState = {
      taskId,
      status: 'pending',
      data: {},
      timestamp: Date.now()
    };
    this.transactions.set(taskId, state);
    
    // Publish started event
    Bus.publish(Bus.TransactionStarted, { 
      taskId, 
      timestamp: state.timestamp,
      sessionID: options?.sessionID
    }).catch(err => {
      this.log.error("Failed to publish transaction started event", err);
    });

    if (options?.token) {
      options.token.onCancellation((reason) => {
        this.log.warn(`Task ${taskId} cancelled: ${reason}`);
      });
    }

    try {
      const result = await task();
      
      this.transactions.set(taskId, {
        ...state,
        status: 'committed',
        data: result
      });
      
      this.log.info(`Transaction committed: ${taskId}`);

      // Publish event
      Bus.publish(Bus.TransactionCommitted, { 
        taskId, 
        data: result,
        sessionID: options?.sessionID
      }).catch(err => {
        this.log.error("Failed to publish transaction committed event", err);
      });

      return result;
    } catch (error) {
      this.log.error(`Transaction failed: ${taskId}`, { error });
      
      await this.rollback(taskId, error as Error);
      
      if (error instanceof NaviError) {
        throw error;
      }
      
      throw new NaviError({
        message: `Transaction failed for task ${taskId}`,
        recovery: {
          action: 'retry',
          context: { taskId, state: this.transactions.get(taskId) }
        },
        cause: error as Error
      });
    }
  }

  async rollback(taskId: string, error: Error): Promise<void> {
    const state = this.transactions.get(taskId);
    if (!state) return;

    this.log.warn(`Rolling back transaction: ${taskId}`);

    this.transactions.set(taskId, {
      ...state,
      status: 'rolled_back',
      error: error as Error
    });

    // Publish event
    Bus.publish(Bus.TransactionRolledBack, { 
      taskId, 
      error: error.message,
      sessionID: state.originalData?.sessionID // Fallback if state has it
    }).catch(err => {
      this.log.error("Failed to publish transaction rolled back event", err);
    });
  }

  getStatus(taskId: string): TransactionState | null {
    return this.transactions.get(taskId) || null;
  }
}

/**
 * AgentTransaction Effect Service.
 */
export namespace AgentTransaction {
  export interface Interface {
    readonly execute: <A, E, R>(
      taskId: string,
      task: Effect.Effect<A, E, R>,
      options?: ExecuteOptions
    ) => Effect.Effect<A, E | NaviError, R>;
    
    readonly rollback: (taskId: string, error: Error) => Effect.Effect<void>;
    readonly getStatus: (taskId: string) => Effect.Effect<TransactionState | null>;
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@navi/AgentTransaction") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const manager = AgentTransactionManager.getInstance();

      const execute = <A, E, R>(
        taskId: string,
        task: Effect.Effect<A, E, R>,
        options?: ExecuteOptions
      ): Effect.Effect<A, E | NaviError, R> => {
        return Effect.gen(function* () {
          // Wrap the Effect in a Promise for the manager
          // This is a bit circular but allows the manager to be the single source of truth
          const result = yield* task;
          // We manually call the manager's commitment logic here since we are in Effect land
          manager.execute(taskId, () => Promise.resolve(result), options);
          return result;
        });
      };

      const rollback = (taskId: string, error: Error) => 
        Effect.promise(() => manager.rollback(taskId, error));

      const getStatus = (taskId: string) => 
        Effect.sync(() => manager.getStatus(taskId));

      return Service.of({
        execute,
        rollback,
        getStatus
      });
    })
  );
}
