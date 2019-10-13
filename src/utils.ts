export const isRetryableDBError = (ex: any) =>
  ["ProvisionedThroughputExceededException", "ThrottlingException"].includes(
    ex.code,
  );

export const numberEnding = (n: number) => (Math.abs(n) === 1 ? "" : "s");

export const millisecondsToStr = (milliseconds: number) => {
  if (milliseconds < 0) {
    throw new Error("Value should be positive");
  }
  let temp = Math.floor(milliseconds / 1_000);
  const years = Math.floor(temp / 31_536_000);
  if (years) {
    return years + " year" + numberEnding(years);
  }
  const days = Math.floor((temp %= 31_536_000) / 86_400);
  if (days) {
    return days + " day" + numberEnding(days);
  }
  const hours = Math.floor((temp %= 86_400) / 3_600);
  if (hours) {
    return hours + " hour" + numberEnding(hours);
  }
  const minutes = Math.floor((temp %= 3_600) / 60);
  if (minutes) {
    return minutes + " minute" + numberEnding(minutes);
  }
  const seconds = temp % 60;
  if (seconds) {
    return seconds + " second" + numberEnding(seconds);
  }
  return "less than a second";
};

export const findCommon = (
  arr: string[],
  type: "prefix" | "suffix" = "prefix",
) => {
  if (arr.length === 0) {
    return null;
  }
  const firstElement = arr[0];

  let common = "";

  for (
    let i = type === "prefix" ? 0 : firstElement.length;
    type === "prefix" ? i < firstElement.length : i > 0;
    type === "prefix" ? i++ : i--
  ) {
    const toTest =
      type === "prefix"
        ? firstElement.substring(0, i)
        : firstElement.substring(i, firstElement.length);

    if (
      arr.every((str) =>
        str[type === "prefix" ? "startsWith" : "endsWith"](toTest),
      )
    ) {
      common = toTest;
    } else {
      break;
    }
  }

  return common || null;
};

export const intersection = <T>(a: T[], b: T[]) => {
  const s = new Set(b);
  return a.filter((v) => s.has(v));
};

export const assertNever = (obj: never): never => {
  throw new Error("Unexpected value: " + obj);
};
