export class History<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];
  private readonly maxEntries: number;

  public constructor(private current: T, private readonly copy: (value: T) => T, maxEntries = 128) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("history maxEntries must be a positive safe integer");
    }
    this.maxEntries = maxEntries;
  }

  public present(): T {
    return this.copy(this.current);
  }

  /**
   * Records the next state. Entries are retained by reference: callers must
   * treat committed values as immutable, which the editor's update helpers
   * already guarantee. Copies are produced only when a value is handed back
   * (`present`/`undo`/`redo`), so a high-frequency edit no longer pays for
   * repeated deep snapshots it never reads (P2-089).
   */
  public commit(next: T): void {
    this.past.push(this.current);
    if (this.past.length > this.maxEntries) this.past.shift();
    this.current = next;
    this.future.length = 0;
  }

  public undo(): T {
    const previous = this.past.pop();
    if (previous === undefined) {
      return this.present();
    }
    this.future.push(this.current);
    if (this.future.length > this.maxEntries) this.future.shift();
    this.current = previous;
    return this.present();
  }

  public redo(): T {
    const next = this.future.pop();
    if (next === undefined) {
      return this.present();
    }
    this.past.push(this.current);
    if (this.past.length > this.maxEntries) this.past.shift();
    this.current = next;
    return this.present();
  }

  public canUndo(): boolean {
    return this.past.length > 0;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }
}
