import { z } from 'zod';

export type Result<T, E = Error> = 
  | { success: true; value: T }
  | { success: false; error: E };

export class ValidationError extends Error {
  constructor(public issues: z.ZodIssue[]) {
    super('Validation failed: ' + issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
    this.name = 'ValidationError';
  }
}

export type SettingsChangeEvent = {
  key: string;
  value: any;
};

export class SettingsRegistry<T extends z.ZodObject<any>> {
  private store = new Map<string, any>();
  private listeners = new Set<(change: SettingsChangeEvent) => void>();

  constructor(private schema: T) {}

  set<K extends keyof z.infer<T>>(
    key: K, 
    value: z.infer<T>[K]
  ): Result<void, ValidationError> {
    const fieldSchema = this.schema.shape[key as string];
    if (!fieldSchema) {
      return { 
        success: false, 
        error: new ValidationError([{ 
          code: 'custom', 
          path: [key as string], 
          message: 'Unknown setting key' 
        }]) 
      };
    }

    const result = fieldSchema.safeParse(value);
    if (result.success) {
      this.store.set(key as string, value);
      this.emit('change', { key: key as string, value });
      return { success: true, value: undefined };
    } else {
      return { success: false, error: new ValidationError(result.error.issues) };
    }
  }

  get<K extends keyof z.infer<T>>(key: K): z.infer<T>[K] | undefined {
    return this.store.get(key as string);
  }

  on(event: 'change', listener: (change: SettingsChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: 'change', data: SettingsChangeEvent) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  private migrations = new Map<string, (data: any) => any>();

  /**
   * Registers a migration function for a specific target version.
   */
  registerMigration(targetVersion: string, migrationFn: (data: any) => any) {
    this.migrations.set(targetVersion, migrationFn);
  }

  /**
   * Migrates settings data from an old version to the current one.
   * Follows a sequential path through registered migrations.
   */
  async migrate(data: any, fromVersion: string): Promise<any> {
    let migratedData = { ...data };
    
    // Sort versions to ensure sequential migration
    const versions = Array.from(this.migrations.keys()).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    for (const version of versions) {
      if (version.localeCompare(fromVersion, undefined, { numeric: true, sensitivity: 'base' }) > 0) {
        const migrator = this.migrations.get(version);
        if (migrator) {
          migratedData = await migrator(migratedData);
        }
      }
    }

    return migratedData;
  }
}
