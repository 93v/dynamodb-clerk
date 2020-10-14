import { given, test } from "sazerac";

import {
  assertNever,
  findCommon,
  intersection,
  isRetryableDBError,
  millisecondsToStr,
  numberEnding,
} from "../_utils";

describe("Utils", () => {
  describe("Retryable Errors", () => {
    it("should be retryable", () => {
      expect(
        isRetryableDBError({ code: "ProvisionedThroughputExceededException" }),
      ).toBe(true);
    });

    it("should be retryable", () => {
      expect(isRetryableDBError({ code: "ThrottlingException" })).toBe(true);
    });

    it("should not be retryable", () => {
      expect(isRetryableDBError("anything else")).toBe(false);
    });
  });

  describe("Number ending", () => {
    test(numberEnding, () => {
      given(1).expect("");
      given(-1).expect("");
      given(0).expect("s");
      given(10).expect("s");
      given(-10).expect("s");
    });
  });

  describe("Milliseconds to string", () => {
    it("should not allow negative numbers", () => {
      expect(() => millisecondsToStr(-1)).toThrow(Error);
    });

    test(millisecondsToStr, () => {
      given(1).expect("less than a second");
      given(1_000).expect("1 second");
      given(1_000_000).expect("16 minutes");
      given(10_000_000).expect("2 hours");
      given(100_000_000).expect("1 day");
      given(1_000_000_000).expect("11 days");
      given(10_000_000_000).expect("115 days");
      given(100_000_000_000).expect("3 years");
    });
  });
});

describe("Find Common substrings in an array of strings", () => {
  test(findCommon, () => {
    given([], "prefix").expect(null);
    given(["communication"]).expect("communication");
    given(["communication"], "suffix").expect("communication");
    given(["communication", "command"]).expect("comm");
    given(["communication", "command"], "prefix").expect("comm");
    given(["communication", "command", "south"], "prefix").expect(null);
    given(["communication", "command", "south"], "suffix").expect(null);
    given(["communication", "evolution"], "suffix").expect("tion");
  });
});

describe("Find intersection of arrays", () => {
  test(intersection, () => {
    given([1, 2, 3], [4, 5, 6]).expect([]);
    given([1, 2, 3], [1, 4, 5, 6]).expect([1]);
  });
});

describe("Assert never", () => {
  it("should always return error", () => {
    expect(() => assertNever("a" as never)).toThrow();
  });
});
