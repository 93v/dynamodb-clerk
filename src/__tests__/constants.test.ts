import { BACKUP_PATH_PREFIX, RETRY_OPTIONS } from "../_constants";

describe("Constants", () => {
  test("Backup path prefix", () => {
    expect(BACKUP_PATH_PREFIX).toEqual("./backup-data");
  });

  test("Retry min timeout should", () => {
    expect(RETRY_OPTIONS.minTimeout).toEqual(50);
  });

  test("Retry retires count", () => {
    expect(RETRY_OPTIONS.retries).toEqual(10);
  });
});
