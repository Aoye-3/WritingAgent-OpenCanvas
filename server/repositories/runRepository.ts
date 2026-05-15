import type { DatabaseSync } from "node:sqlite";

export class RunRepository {
  constructor(readonly db: DatabaseSync) {}
}
