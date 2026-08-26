// W2 worker territory — implementation in progress.
// Stub written first per working method; filled in after reading schema + docs.

export interface CreateDbOptions {
  readonly connectionString?: string;
}

export function createDb(_options: CreateDbOptions | string = {}): never {
  throw new Error("wip");
}
