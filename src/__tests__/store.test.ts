import Store from "../_store";

describe("Store", () => {
  describe("Store instance", () => {
    it("should include required functions and data object", () => {
      expect(Store).toHaveProperty("set");
      expect(Store).toHaveProperty("get");
      expect(Store).toHaveProperty("reset");
      expect(Store).toHaveProperty("data");
    });
  });

  describe("Set a value", () => {
    it("When a value is provided it should save normally", () => {
      const id = "id";
      const value = "value";
      Store.set(id, value);
      expect(Store.get(id)).toEqual(value);
    });
  });

  describe("Reset the store", () => {
    it("should include required functions", () => {
      const id = "id";
      const value = "value";
      Store.set(id, value);
      Store.reset();
      expect(Store.get(id)).toBeUndefined();
    });
  });
});
