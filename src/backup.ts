import retry from "async-retry";
import { DynamoDB } from "aws-sdk";
import { ScanInput } from "aws-sdk/clients/dynamodb";
import filesize from "filesize";
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
import { sync as rmSync } from "rimraf";
import tar from "tar";
import { oc } from "ts-optchain";
import { BACKUP_PATH_PREFIX, RETRY_OPTIONS } from "./constants";
import Store from "./store";
import { isRetryableDBError, millisecondsToStr } from "./utils";

if (!existsSync(BACKUP_PATH_PREFIX)) {
  mkdirSync(BACKUP_PATH_PREFIX);
}

interface IMaxLengths {
  itemCountLength: number;
  tableNameLength: number;
}

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

  const params: ScanInput = { TableName: tableName };

  let scanCompleted = false;

  let index = 0;
  let processedItems = 0;

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
          processedItems += result.Items.length;
          writeFileSync(
            `${tableBackupPath}/data/${index.toString().padStart(4, "0")}.json`,
            JSON.stringify(result, null, 2),
          );
          if (task != null) {
            const maxLengths = Store.get<IMaxLengths>("maxLengths");

            const tableProgress = Math.min(
              oc(tableDescription).Table.ItemCount(0) === 0
                ? 1
                : processedItems / oc(tableDescription).Table.ItemCount(0),
              1,
            );

            task.title = `${tableName.padEnd(
              oc(maxLengths).tableNameLength(0),
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

export const startBackupProcess = async () => {
  let profile = Store.get<string>("profile");

  if (profile == null && Store.get<"remote" | "local">("env") === "local") {
    profile = "local";
    Store.set("profile", profile);
  }

  if (profile == null) {
    throw new Error("Profile not found");
  }
  const BACKUP_PATH = join(BACKUP_PATH_PREFIX, profile);

  const spinner = ora("Loading tables").start();

  const db = Store.get<DynamoDB>("db");
  if (db == null) {
    throw new Error("Database config not found");
  }
  try {
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
        itemCount: oc(desc).Table.ItemCount() || null,
        tableName: oc(desc).Table.TableName() || null,
        tableSize: oc(desc).Table.TableSizeBytes() || null,
      }))
      .sort((a, b) => oc(b).tableSize(0) - oc(a).tableSize(0));

    const maxLengths: IMaxLengths = sortedTables.reduce(
      (p, c) => ({
        itemCountLength: Math.max(
          p.itemCountLength,
          oc(c)
            .itemCount(0)
            .toString().length,
        ),
        tableNameLength: Math.max(
          p.tableNameLength,
          oc(c).tableName("").length,
        ),
      }),
      { itemCountLength: 0, tableNameLength: 0 },
    );

    Store.set("maxLengths", maxLengths);

    spinner.stop();

    const argv =
      Store.get<Record<string, string | null | undefined>>("argv") || {};

    const tablesFromArgs = argv.tables;

    let tables: string[] = [];

    if (tablesFromArgs === "*") {
      tables = sortedTables
        .map((t) => t.tableName)
        .filter((s) => s != null) as string[];
    } else {
      const tablesResponse: { tables: string[] } = await prompt([
        {
          choices: sortedTables.map((table) => ({
            checked: true,
            name: `${oc(table)
              .tableName("")
              .padEnd(maxLengths.tableNameLength, " ")} - Items: ~${oc(table)
              .itemCount(0)
              .toString()
              .padEnd(maxLengths.itemCountLength, " ")} - Size: ~${filesize(
              oc(table).tableSize(0),
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

      let overwriteOldBackups = false;

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
                  oc(maxLengths).tableNameLength(0),
                )} - Done`;
              },
            }),
          ),
        ],
        { concurrent: true },
      );

      await tasks.run();
    }

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

    console.log(`Elapsed Time: ${millisecondsToStr(Date.now() - start)}`);
    console.log(
      `Backup Size: ${filesize(lstatSync(`${BACKUP_PATH}.tgz`).size)}`,
    );
  } catch (error) {
    throw error;
  } finally {
    spinner.stop();
  }
};
