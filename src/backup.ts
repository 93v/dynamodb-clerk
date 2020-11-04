import PromisePool from "@supercharge/promise-pool";
import { DocumentClient, TableDescription } from "aws-sdk/clients/dynamodb";
import { Dynatron } from "dynatron";
import { preStringify } from "dynatron/dist/utils/misc-utils";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { prompt } from "inquirer";
import Listr, { ListrTask, ListrTaskWrapper } from "listr";
import ora from "ora";
import { join } from "path";
import prettyBytes from "pretty-bytes";
import { sync as rmSync } from "rimraf";
import tar from "tar";
import { argv } from "yargs";

import { BACKUP_PATH_PREFIX } from "./_constants";
import { db } from "./_db";
import Store from "./_store";
import { millisecondsToStr, shuffledArray } from "./_utils";

interface MaxLengths {
  itemCountLength: number;
  tableNameLength: number;
}

const MAX_TOTAL_SEGMENTS = 500;

const backupSegment = async (
  dbInstance: Dynatron,
  tableName: string,
  tableDescription: TableDescription,
  tableBackupPath: string,
  totalSegments: number,
  segment: number,
  segmentProgresses: number[],
  task?: ListrTaskWrapper,
) => {
  let segmentScanComplete = false;

  let startKey: DocumentClient.Key | null = null;

  let part = 0;

  while (!segmentScanComplete) {
    part++;

    const result: DocumentClient.ScanOutput = await dbInstance
      .scan()
      .totalSegments(totalSegments)
      .segment(segment)
      .start(startKey)
      .$(true, true);

    if (result.LastEvaluatedKey) {
      startKey = result.LastEvaluatedKey;
    } else {
      segmentScanComplete = true;
    }

    const scannedItems = result.Items;

    const segmentText = `${segment}`.padStart(8, "0");
    const totalSegmentsText = `${totalSegments}`.padStart(8, "0");

    const fileName = `segment-${segmentText}-of-${totalSegmentsText}-part-${part}`;

    writeFileSync(
      `${tableBackupPath}/data/${fileName}.json`,
      JSON.stringify(scannedItems?.map((r) => preStringify(r))),
    );
    if (task != null) {
      const maxLengths = Store.get<MaxLengths>("maxLengths");

      segmentProgresses[segment] = segmentProgresses[segment] || 0;

      segmentProgresses[segment] =
        segmentProgresses[segment] + (scannedItems?.length || 0);

      const totalSegmentProgress = segmentProgresses.reduce((a, b) => a + b, 0);

      const tableProgress = Math.min(
        (tableDescription?.ItemCount || 0) === 0
          ? 1
          : totalSegmentProgress / (tableDescription?.ItemCount || 0),
        1,
      );

      task.title = `${tableName.padEnd(maxLengths?.tableNameLength || 0)} - ${
        tableProgress >= 0.99995 && tableProgress <= 1 ? "~" : ""
      }${(tableProgress * 100).toFixed(2)}%`;
    }
  }
};

const backupTable = async (tableName: string, task?: ListrTaskWrapper) => {
  const tableDescription = await db("").Tables.describe(tableName).$();

  if (tableDescription == null) {
    return;
  }

  const tableBackupPath = `${BACKUP_PATH_PREFIX}/${Store.get(
    "backupPathFolder",
  )}/${tableName}`;

  mkdirSync(tableBackupPath);
  mkdirSync(`${tableBackupPath}/data`);

  writeFileSync(
    `${tableBackupPath}/description.json`,
    JSON.stringify(tableDescription, null, 2),
  );

  const totalSegments = Math.min(
    MAX_TOTAL_SEGMENTS,
    Math.ceil((tableDescription.TableSizeBytes || 0) / 1024) || 1,
  );

  const segmentProgresses = Array(totalSegments).fill(0);

  const dbInstance = db(tableName);

  await new PromisePool()
    .for(shuffledArray([...Array(totalSegments).keys()]))
    .withConcurrency(20)
    .process(async (segment) => {
      const result = await backupSegment(
        dbInstance,
        tableName,
        tableDescription,
        tableBackupPath,
        totalSegments,
        segment as number,
        segmentProgresses,
        task,
      );

      return result;
    });
};

export const startBackupProcess = async () => {
  if (!existsSync(BACKUP_PATH_PREFIX)) {
    mkdirSync(BACKUP_PATH_PREFIX);
  }

  let profile = Store.get<string>("profile");

  if (profile == null && Store.get<"remote" | "local">("env") === "local") {
    profile = "local";
    Store.set("profile", profile);
  }

  const BACKUP_PATH_FOLDER = profile || new Date().toISOString();
  Store.set("backupPathFolder", BACKUP_PATH_FOLDER);
  const BACKUP_PATH = join(BACKUP_PATH_PREFIX, BACKUP_PATH_FOLDER);

  const spinner = ora("Loading tables");
  const spinner2 = ora("Optimizing");

  try {
    spinner.start();
    const tableNames = await db("").Tables.list().$();

    if (tableNames == null || tableNames.length === 0) {
      spinner.stop();
      console.log("There are no tables.");
      return;
    }

    const tableDescriptions = await Promise.all(
      tableNames.map((tableName) => db("").Tables.describe(tableName).$()),
    );

    const sortedTables = tableDescriptions
      .map((desc) => ({
        itemCount: desc?.ItemCount || null,
        tableName: desc?.TableName || null,
        tableSize: desc?.TableSizeBytes || null,
      }))
      .sort((a, b) => (b.tableSize || 0) - (a.tableSize || 0));

    const maxLengths: MaxLengths = sortedTables.reduce(
      (p, c) => ({
        itemCountLength: Math.max(
          p.itemCountLength,
          (c.itemCount || 0).toString().length,
        ),
        tableNameLength: Math.max(
          p.tableNameLength,
          (c.tableName || "").length,
        ),
      }),
      { itemCountLength: 0, tableNameLength: 0 },
    );

    Store.set("maxLengths", maxLengths);

    spinner.stop();

    const tablesFromArgs = argv.tables as string | null;

    let tables: string[];

    if (tablesFromArgs === "*") {
      tables = sortedTables
        .map((t) => t.tableName)
        .filter((s) => s != null) as string[];
    } else if (tablesFromArgs) {
      const predefinedTables = tablesFromArgs.split(",");
      tables = sortedTables
        .map((t) => t.tableName)
        .filter((s) => s != null && predefinedTables.includes(s)) as string[];
    } else {
      const tablesResponse: { tables: string[] } = await prompt([
        {
          choices: sortedTables.map((table) => ({
            checked: true,
            name: `${(table.tableName || "").padEnd(
              maxLengths.tableNameLength,
              " ",
            )} - Items: ~${(table.itemCount || 0)
              .toString()
              .padEnd(maxLengths.itemCountLength, " ")} - Size: ~${prettyBytes(
              table.tableSize || 0,
            )}`,
            short: table.tableName,
            value: table.tableName,
          })),
          message: "Select the tables you want to backup",
          name: "tables",
          type: "checkbox",
        },
      ]);

      tables = tablesResponse.tables;
    }

    if (
      existsSync(`${BACKUP_PATH}.tgz`) ||
      (existsSync(BACKUP_PATH) && readdirSync(BACKUP_PATH).length > 0)
    ) {
      const forceFromArgs = argv.force;

      let overwriteOldBackups: boolean;

      if (forceFromArgs != null) {
        overwriteOldBackups = true;
      } else {
        const overwriteResponse: {
          overwriteOldBackups: boolean;
        } = await prompt([
          {
            default: true,
            message: `Backup exists. If you continue all data in it will be overwritten.
 Do you want to continue?`,
            name: "overwriteOldBackups",
            type: "confirm",
          },
        ]);

        overwriteOldBackups = overwriteResponse.overwriteOldBackups;
      }

      if (!overwriteOldBackups) {
        return;
      }
    }

    const start = Date.now();

    rmSync(BACKUP_PATH);
    mkdirSync(BACKUP_PATH);

    console.clear();

    tables.reverse();

    if (tables.length > 0) {
      const tasks = new Listr(
        [
          ...tables.map(
            (table): ListrTask => ({
              title: table,

              task: async (_, task) => {
                await backupTable(table, task);
                task.title = `${table.padEnd(
                  maxLengths.tableNameLength || 0,
                )} - Done`;
              },
            }),
          ),
        ],
        { concurrent: true },
      );

      await tasks.run();
    }

    spinner2.start();

    await tar.c(
      {
        C: BACKUP_PATH_PREFIX,
        file: `${BACKUP_PATH}.tgz`,
        gzip: true,
        portable: true,
      },
      [BACKUP_PATH_FOLDER],
    );
    rmSync(BACKUP_PATH);

    spinner2.stop();

    console.log(
      `${tables.length} tables backed up in ${millisecondsToStr(
        Date.now() - start,
      )}`,
    );
    console.log(
      `Backup Size: ${prettyBytes(lstatSync(`${BACKUP_PATH}.tgz`).size)}`,
    );
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    spinner2.stop();
    spinner.stop();
    process.exit();
  }
};
