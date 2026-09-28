interface Disposable {
  dispose(): void;
}

/**
 * Collects every GPU resource (geometry, material, texture) created for one level so the whole level
 * can be released in a single call. Tracking the same object twice is harmless.
 */
export class ResourceBag {
  private readonly items = new Set<Disposable>();

  track<T extends Disposable>(item: T): T {
    this.items.add(item);
    return item;
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }
}
