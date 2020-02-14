import { spawn } from "child_process";
import { lstatSync, readdirSync } from "fs";
import { join } from "path";

import { LSOFProcess, PSProcess } from "../types/process";

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
    type === "prefix" ? i <= firstElement.length : i >= 0;
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

const asyncSpawn = (
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

const parseProcess = <T>(d: any, titles: string[] = []) => {
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

const getDynamoDBLocalProcesses = async () => {
  const data = await asyncSpawn(`ps`, ["lx"]);

  const [titles, ...parsedData] = data
    .split("\n")
    .map((line) => line.replace(/ +/gi, "\t").split("\t"));

  return parsedData
    .map((d) => parseProcess<PSProcess>(d, titles))
    .reduce((acc, val) => acc.concat(val), [] as PSProcess[])
    .filter(
      (d) =>
        d.command?.includes("java") &&
        Object.values(d).some((v) => (v || "").includes("DynamoDBLocal.jar")),
    );
};

const getJavaProcessesListeningToTCPPorts = async () => {
  const data = await asyncSpawn(`lsof`, ["-PiTCP", "-sTCP:LISTEN"]);

  const [titles, ...parsedData] = data
    .split("\n")
    .map((line) => line.replace(/ +/gi, "\t").split("\t"));

  return parsedData
    .map((d) => parseProcess<LSOFProcess>(d, titles))
    .reduce((acc, val) => acc.concat(val), [] as LSOFProcess[])
    .filter((d) => d.command?.includes("java"));
};

export const getLocalDynamoDBPorts = async () => {
  const [dynamoDBLocalProcesses, javaProcesses] = await Promise.all([
    getDynamoDBLocalProcesses(),
    getJavaProcessesListeningToTCPPorts(),
  ]);

  const portsFromJavaProcesses = javaProcesses.map(
    (p) => p.name?.split(":")[1],
  );
  const portsFromDBLocalProcesses = dynamoDBLocalProcesses.map((p) => {
    let port: string | null = null;

    const keys = Object.keys(p);

    Object.values(p).forEach((v, i) => {
      if (v === "-port") {
        port = p[keys[i + 1]] || null;
      }
    });

    return port;
  });

  const availablePorts = intersection(
    portsFromJavaProcesses,
    portsFromDBLocalProcesses,
  );

  return availablePorts;
};
