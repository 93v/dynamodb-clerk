class Store {
  public static set<T>(id: string, value: T) {
    Store.data[id] = value;
  }

  public static get<T>(id: string) {
    return Store.data[id] as T | null;
  }

  public static reset() {
    Store.data = {};
  }

  private static data: Record<string, unknown> = {};
}

export default Store;
