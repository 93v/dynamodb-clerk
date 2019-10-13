import { spawn } from "child_process";
import { lstatSync, readdirSync } from "fs";
import { join } from "path";

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

export const readSizeRecursive = (item: string): number => {
  const stats = lstatSync(item);

  if (stats.isDirectory()) {
    let totalSize = stats.size || 0;

    const list = readdirSync(item);

    list.forEach((dir) => {
      const dirSize = readSizeRecursive(join(item, dir));

      totalSize += dirSize || 0;
    });

    return totalSize;
  } else {
    return stats.size || 0;
  }
};

export const asyncSpawn = (
  command: string,
  args?: ReadonlyArray<string>,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args);

    const stdOuts: string[] = [];
    const stdErrs: any[] = [];

    child.stdout.on("data", (data) => {
      stdOuts.push(data);
    });

    child.stderr.on("data", (err) => {
      stdErrs.push(err);
    });

    child.on("exit", () => {
      if (stdErrs.length > 0) {
        return reject(stdErrs.join().toString());
      }

      resolve(stdOuts.join());
    });

    child.on("error", (error) => {
      reject(error);
    });
  });

export const parseProcess = <T>(d: any, titles: string[] = []) => {
  const obj = {};

  let propIndex = 0;
  d.forEach((val: T, index: number) => {
    let prop = titles[index];

    if (prop == null) {
      propIndex++;
      prop = `arg${propIndex}`;
    }

    obj[prop.toLowerCase()] = val;
  });

  return obj as T;
};
