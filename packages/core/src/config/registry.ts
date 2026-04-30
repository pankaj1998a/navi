import z from 'zod/v4';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

export interface StorageAdapter {
  load(): any;
  save(data: any): void;
}

export class FileStorageAdapter implements StorageAdapter {
  constructor(private filePath: string) {}

  load(): any {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error(`Failed to load settings from ${this.filePath}:`, e);
      return {};
    }
  }

  save(data: any): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`Failed to save settings to ${this.filePath}:`, e);
    }
  }
}

export class SettingsRegistry<T extends z.ZodObject<any>> {
  private data: z.infer<T>;
  private listeners = new Set<(change: SettingsChangeEvent) => void>();
  private migrations = new Map<string, (data: any) => any>();

  constructor(
    private schema: T, 
    private storage: StorageAdapter,
    private defaultValues: Partial<z.infer<T>> = {}
  ) {
    const rawData = this.storage.load();
    // Pre-migration check could happen here if we had a version field
    this.data = { ...defaultValues, ...rawData };
  }

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
      (this.data as any)[key] = value;
      this.storage.save(this.data);
      this.emit('change', { key: key as string, value });
      return { success: true, value: undefined };
    } else {
      return { success: false, error: new ValidationError(result.error.issues) };
    }
  }

  get<K extends keyof z.infer<T>>(key: K): z.infer<T>[K] {
    return (this.data as any)[key];
  }

  getAll(): z.infer<T> {
    return { ...this.data };
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

  /**
   * Registers a migration function for a specific target version.
   */
  registerMigration(targetVersion: string, migrationFn: (data: any) => any) {
    this.migrations.set(targetVersion, migrationFn);
  }

  /**
   * Performs migration if needed.
   * Note: This assumes the schema has a 'version' field.
   */
  async migrate(): Promise<void> {
    const currentVersion = (this.data as any).version || '0.0.0';
    
    // Sort versions to ensure sequential migration
    const versions = Array.from(this.migrations.keys()).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    let migrated = false;
    let workingData = { ...this.data };

    for (const version of versions) {
      if (version.localeCompare(currentVersion, undefined, { numeric: true, sensitivity: 'base' }) > 0) {
        const migrator = this.migrations.get(version);
        if (migrator) {
          workingData = await migrator(workingData);
          migrated = true;
        }
      }
    }

    if (migrated) {
      const validation = this.schema.safeParse(workingData);
      if (validation.success) {
        this.data = validation.data;
        this.storage.save(this.data);
      } else {
        console.error('Migration resulted in invalid data:', validation.error);
      }
    }
  }
}
