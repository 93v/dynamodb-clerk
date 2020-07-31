import retry from "async-retry";
import { DynamoDB } from "aws-sdk";
import { DescribeTableOutput, ScanInput } from "aws-sdk/clients/dynamodb";
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

import { BACKUP_PATH_PREFIX, RETRY_OPTIONS } from "./constants";
import Store from "./store";
import { isRetryableDBError, millisecondsToStr } from "./utils";

interface MaxLengths {
  itemCountLength: number;
  tableNameLength: number;
}

if (!existsSync(BACKUP_PATH_PREFIX)) {
  mkdirSync(BACKUP_PATH_PREFIX);
}

const MAX_TOTAL_SEGMENTS = 100;

const backupSegment = async (
  db: DynamoDB,
  tableName: string,
  tableDescription: DescribeTableOutput,
  tableBackupPath: string,
  totalSegments: number,
  segment: number,
  segmentProgresses: number[],
  task?: ListrTaskWrapper,
) => {
  const params: ScanInput = {
    TableName: tableName,
    TotalSegments: totalSegments,
    Segment: segment,
  };

  let scanCompleted = false;

  let index = 0;
  let segmentProcessedItems = 0;

  return retry(async (bail) => {
    try {
      while (!scanCompleted) {
        const result = await db.scan(params).promise();
        if (result.LastEvaluatedKey == null) {
          scanCompleted = true;
        } else {
          params.ExclusiveStartKey = result.LastEvaluatedKey;
        }
        if (result.Items) {
          index++;
          segmentProcessedItems += result.Items.length;

          const fileName = `${segment
            .toString()
            .padStart(
              totalSegments.toString().length,
              "0",
            )}${index
            .toString()
            .padStart(
              Math.max(
                Math.ceil(
                  (tableDescription.Table?.ItemCount || 0) / totalSegments,
                ).toString().length,
                1,
              ),
              "0",
            )}`;

          writeFileSync(
            `${tableBackupPath}/data/${fileName}.json`,
            JSON.stringify(result, null, 2),
          );
          if (task != null) {
            const maxLengths = Store.get<MaxLengths>("maxLengths");

            segmentProgresses[segment] = segmentProcessedItems;

            const tableProgress = Math.min(
              (tableDescription.Table?.ItemCount || 0) === 0
                ? 1
                : segmentProgresses.reduce((a, b) => a + b, 0) /
                    (tableDescription.Table?.ItemCount || 0),
              1,
            );

            task.title = `${tableName.padEnd(
              maxLengths?.tableNameLength || 0,
            )} - ${(tableProgress * 100).toFixed(2)}%`;
          }
        }
      }
    } catch (error) {
      if (!isRetryableDBError(error)) {
        bail(error);
        return;
      }
      throw error;
    }
  }, RETRY_OPTIONS);
};

const backupTable = async (tableName: string, task?: ListrTaskWrapper) => {
  const db = Store.get<DynamoDB>("db");
  if (db == null) {
    throw new Error("Database config not found");
  }
  const tableDescription = await db
    .describeTable({ TableName: tableName })
    .promise();

  const tableBackupPath = `${BACKUP_PATH_PREFIX}/${Store.get(
    "profile",
  )}/${tableName}`;

  mkdirSync(tableBackupPath);
  mkdirSync(`${tableBackupPath}/data`);

  writeFileSync(
    `${tableBackupPath}/description.json`,
    JSON.stringify(tableDescription, null, 2),
  );

  const totalSegments = Math.min(
    MAX_TOTAL_SEGMENTS,
    tableDescription.Table?.ItemCount || 1,
  );

  const segmentProgresses = Array(totalSegments).fill(0);

  return Promise.all(
    [...Array(totalSegments).keys()].map(async (segment) => {
      return backupSegment(
        db,
        tableName,
        tableDescription,
        tableBackupPath,
        totalSegments,
        segment,
        segmentProgresses,
        task,
      );
    }),
  );
};

export const startBackupProcess = async () => {
  let profile = Store.get<string>("profile");

  if (profile == null && Store.get<"remote" | "local">("env") === "local") {
    profile = "local";
    Store.set("profile", profile);
  }

  if (profile == null) {
    profile = new Date().toISOString();
    Store.set("profile", profile);
  }

  const BACKUP_PATH = join(BACKUP_PATH_PREFIX, profile);

  const spinner = ora("Loading tables");
  const spinner2 = ora("Optimizing");

  const db = Store.get<DynamoDB>("db");
  if (db == null) {
    throw new Error("Database config not found");
  }
  try {
    spinner.start();
    const { TableNames: tableNames } = await db.listTables().promise();

    if (tableNames == null || tableNames.length === 0) {
      spinner.stop();
      console.log("There are no tables.");
      return;
    }

    const tableDescriptions = await Promise.all(
      tableNames.map((tableName) =>
        db.describeTable({ TableName: tableName }).promise(),
      ),
    );

    const sortedTables = tableDescriptions
      .map((desc) => ({
        itemCount: desc.Table?.ItemCount || null,
        tableName: desc.Table?.TableName || null,
        tableSize: desc.Table?.TableSizeBytes || null,
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

    const tablesFromArgs = argv.tables;

    let tables: string[];

    if (tablesFromArgs === "*") {
      tables = sortedTables
        .map((t) => t.tableName)
        .filter((s) => s != null) as string[];
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
      [profile],
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
