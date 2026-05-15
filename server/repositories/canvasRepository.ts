import type { DatabaseSync } from "node:sqlite";

export class CanvasRepository {
  constructor(readonly db: DatabaseSync) {}
}
