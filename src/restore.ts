import retry from "async-retry";
import { DynamoDB } from "aws-sdk";
import {
  BatchWriteItemInput,
  CreateTableInput,
  DescribeTableOutput,
  GlobalSecondaryIndex,
  LocalSecondaryIndex,
  ScanOutput,
  WriteRequests,
} from "aws-sdk/clients/dynamodb";
import { readdirSync, readFileSync, statSync } from "fs";
import { prompt } from "inquirer";
import Listr, { ListrTask } from "listr";
import ora from "ora";
import { basename, extname, join } from "path";
import { sync as rmSync } from "rimraf";
import tar from "tar";
import { argv } from "yargs";

import { BACKUP_PATH_PREFIX, RETRY_OPTIONS } from "./constants";
import Store from "./store";
import { findCommon, isRetryableDBError, millisecondsToStr } from "./utils";

const BATCH_OPTIONS = { writeLimit: 25 };

const restoreTable = async (
  tableName: string,
  extractionFolder: string,
  tableNamesConversionMapping: Record<string, string>,
) => {
  const db = Store.get<DynamoDB>("db");
  if (db == null) {
    throw new Error("Database config not found");
  }

  const path = `${BACKUP_PATH_PREFIX}/${extractionFolder}/${tableName}`;

  try {
    const tableDescription: DescribeTableOutput = JSON.parse(
      readFileSync(`${path}/description.json`, "utf8"),
    );

    const table = tableDescription.Table;

    if (table == null) {
      return;
    }

    const dbTableName =
      tableNamesConversionMapping[table.TableName || tableName] || tableName;

    try {
      await db.deleteTable({ TableName: dbTableName }).promise();
      // eslint-disable-next-line no-empty
    } catch {}

    try {
      const params: CreateTableInput = {
        ...table,
        AttributeDefinitions: table.AttributeDefinitions || [],
        KeySchema: table.KeySchema || [],
        TableName: dbTableName,

        LocalSecondaryIndexes:
          table.LocalSecondaryIndexes != null
            ? table.LocalSecondaryIndexes.map(
                (si): LocalSecondaryIndex => ({
                  ...si,
                  IndexName: si.IndexName || "",
                  KeySchema: si.KeySchema || [],
                  Projection: si.Projection || {},
                }),
              )
            : undefined,

        GlobalSecondaryIndexes:
          table.GlobalSecondaryIndexes != null
            ? table.GlobalSecondaryIndexes.map(
                (si): GlobalSecondaryIndex => {
                  const config = {
                    ...si,
                    IndexName: si.IndexName || "",
                    KeySchema: si.KeySchema || [],
                    Projection: si.Projection || {},

                    ...(si.ProvisionedThroughput != null
                      ? {
                          ProvisionedThroughput: {
                            ReadCapacityUnits:
                              si.ProvisionedThroughput.ReadCapacityUnits || 1,
                            WriteCapacityUnits:
                              si.ProvisionedThroughput.WriteCapacityUnits || 1,
                          },
                        }
                      : {
                          BillingMode:
                            table.BillingModeSummary?.BillingMode ||
                            "PAY_PER_REQUEST",
                          ProvisionedThroughput: undefined,
                        }),
                  };

                  for (const p of [
                    "IndexStatus",
                    "IndexSizeBytes",
                    "IndexArn",
                    "ItemCount",
                  ]) {
                    delete config[p];
                  }

                  return config;
                },
              )
            : undefined,

        ...(table.ProvisionedThroughput != null
          ? {
              ProvisionedThroughput: {
                ReadCapacityUnits:
                  table.ProvisionedThroughput.ReadCapacityUnits || 1,
                WriteCapacityUnits:
                  table.ProvisionedThroughput.WriteCapacityUnits || 1,
              },
            }
          : {
              BillingMode:
                table.BillingModeSummary?.BillingMode || "PAY_PER_REQUEST",
              ProvisionedThroughput: undefined,
            }),
      };

      for (const p of [
        "BillingModeSummary",
        "CreationDateTime",
        "ItemCount",
        "LatestStreamArn",
        "LatestStreamLabel",
        "SSEDescription",
        "TableArn",
        "TableId",
        "TableSizeBytes",
        "TableStatus",
      ]) {
        delete params[p];
      }

      await db.createTable(params).promise();
      // eslint-disable-next-line no-empty
    } catch {}

    const dataFiles = readdirSync(`${path}/data`).filter(
      (file) => extname(file) === ".json",
    );

    await Promise.all(
      dataFiles.map(async (dataFile) => {
        const data: ScanOutput = JSON.parse(
          readFileSync(`${path}/data/${dataFile}`, "utf8"),
        );

        const items = data.Items || [];

        const requests: WriteRequests = items.map((item) => ({
          PutRequest: { Item: item },
        }));

        const params: BatchWriteItemInput = { RequestItems: {} };

        await retry(async (bail) => {
          try {
            while (requests.length > 0) {
              let writeCompleted = false;
              params.RequestItems[dbTableName] = requests.splice(
                0,
                BATCH_OPTIONS.writeLimit,
              );
              while (!writeCompleted) {
                const result = await db.batchWriteItem(params).promise();
                if (
                  result.UnprocessedItems != null &&
                  result.UnprocessedItems[dbTableName] != null
                ) {
                  params.RequestItems = result.UnprocessedItems;
                } else {
                  writeCompleted = true;
                }
              }
            }
            return true;
          } catch (ex) {
            if (!isRetryableDBError(ex)) {
              bail(ex);
              return;
            }
            throw ex;
          }
        }, RETRY_OPTIONS);
      }),
    );
  } catch (error) {
    console.error(error);
  }
};

export const startRestoreProcess = async () => {
  const files = readdirSync(BACKUP_PATH_PREFIX).filter((file) => {
    const stat = statSync(`${BACKUP_PATH_PREFIX}/${file}`);
    return (
      !stat.isDirectory() &&
      extname(`${BACKUP_PATH_PREFIX}/${file}`) === ".tgz" &&
      stat.size > 0
    );
  });

  const archiveFromArgs = argv.archive as string | null;

  let archive: string | null = null;

  if (archiveFromArgs != null) {
    if (
      files.map((file) => basename(file)).find((f) => f === archiveFromArgs)
    ) {
      archive = archiveFromArgs;
    } else {
      console.log(
        "\nArchive does not exist or is invalid. Please select one!\n",
      );
    }
  }

  if (archive == null) {
    const response: { archive: string } = await prompt([
      {
        choices: files.map((file) => basename(file)),
        message: "Select the archive",
        name: "archive",
        type: "list",
      },
    ]);
    archive = response.archive;
  }

  const spinner = ora("Decompressing the archive").start();

  try {
    const db = Store.get<DynamoDB>("db");
    if (db == null) {
      throw new Error("Database config not found");
    }

    await tar.x({
      C: BACKUP_PATH_PREFIX,
      file: join(BACKUP_PATH_PREFIX, archive),
    });

    const filesInArchive = await new Promise((resolve) => {
      tar.t({
        C: BACKUP_PATH_PREFIX,
        file: join(BACKUP_PATH_PREFIX, archive || ""),
        noResume: true,
        onentry: (entry) => {
          resolve(entry);
        },
      });
    });

    const dbTables = await db.listTables().promise();

    const extractionFolder: string = (
      (filesInArchive as any).path || ""
    ).replace("/", "");

    const tablesInArchive = readdirSync(
      `${BACKUP_PATH_PREFIX}/${extractionFolder}`,
    );

    spinner.stop();

    const tablesInDB = dbTables.TableNames || [];

    let archiveHasPattern = true;

    const archiveTablesSearchPatternFromArgs = argv[
      "archive-tables-search-pattern"
    ] as string | null;

    let archiveTablesSearchPattern: string | null = null;

    if (archiveTablesSearchPatternFromArgs != null) {
      archiveTablesSearchPattern = archiveTablesSearchPatternFromArgs;
    }

    if (archiveTablesSearchPattern == null) {
      let defaultArchiveTablesSearchPattern = "";

      const archiveTablesCommonPrefix = findCommon(tablesInArchive);
      const archiveTablesCommonSuffix = findCommon(tablesInArchive, "suffix");

      if (archiveTablesCommonPrefix != null) {
        defaultArchiveTablesSearchPattern += `^${archiveTablesCommonPrefix}`;
      }

      defaultArchiveTablesSearchPattern += `(.+)`;

      if (archiveTablesCommonSuffix != null) {
        defaultArchiveTablesSearchPattern += `${archiveTablesCommonSuffix}$`;
      }

      if (
        archiveTablesCommonPrefix != null &&
        archiveTablesCommonPrefix === archiveTablesCommonSuffix
      ) {
        defaultArchiveTablesSearchPattern = archiveTablesCommonPrefix;
        archiveHasPattern = false;
      }

      const response: { archiveTablesSearchPattern: string } = await prompt([
        {
          default:
            defaultArchiveTablesSearchPattern !== ""
              ? `${defaultArchiveTablesSearchPattern}`
              : null,
          message:
            "Enter the archive table names search pattern (string, regex)",
          name: "archiveTablesSearchPattern",
          type: "input",
        },
      ]);
      archiveTablesSearchPattern = response.archiveTablesSearchPattern;
    }

    const dbTablesReplacePatternFromArgs = argv["db-tables-replace-pattern"] as
      | string
      | null;

    let dbTablesReplacePattern: string | null = null;

    if (dbTablesReplacePatternFromArgs != null) {
      dbTablesReplacePattern = dbTablesReplacePatternFromArgs;
    }

    if (dbTablesReplacePattern == null) {
      let defaultDBTablesReplacePattern = "";

      const dbTablesCommonPrefix = findCommon(tablesInDB);
      const dbTablesCommonSuffix = findCommon(tablesInDB, "suffix");

      if (dbTablesCommonPrefix != null) {
        defaultDBTablesReplacePattern += `${dbTablesCommonPrefix}`;
      }

      defaultDBTablesReplacePattern += `$1`;

      if (dbTablesCommonSuffix != null) {
        defaultDBTablesReplacePattern += `${dbTablesCommonSuffix}$`;
      }

      if (
        dbTablesCommonPrefix != null &&
        dbTablesCommonPrefix === dbTablesCommonSuffix
      ) {
        defaultDBTablesReplacePattern = dbTablesCommonPrefix;

        if (archiveHasPattern) {
          defaultDBTablesReplacePattern += `$1`;
        }
      }

      const response: { dbTablesReplacePattern: string } = await prompt([
        {
          default: defaultDBTablesReplacePattern
            ? defaultDBTablesReplacePattern
            : null,
          message:
            "Enter the DynamoDB table names replace pattern (string, regex)",
          name: "dbTablesReplacePattern",
          type: "input",
        },
      ]);
      dbTablesReplacePattern = response.dbTablesReplacePattern;
    }

    const tableNamesConversionMapping = {};

    tablesInArchive.forEach((tableName) => {
      if (
        archiveTablesSearchPattern != null &&
        dbTablesReplacePattern != null
      ) {
        tableNamesConversionMapping[tableName] = tableName.replace(
          new RegExp(archiveTablesSearchPattern, "g"),
          dbTablesReplacePattern,
        );
      } else {
        tableNamesConversionMapping[tableName] = tableName;
      }
    });

    const start = Date.now();

    console.clear();

    if (tablesInArchive.length > 0) {
      const tasks = new Listr(
        [
          ...tablesInArchive.map(
            (tableName): ListrTask => ({
              title: tableName,

              task: async () =>
                restoreTable(
                  tableName,
                  extractionFolder,
                  tableNamesConversionMapping,
                ),
            }),
          ),
        ],
        { concurrent: true },
      );

      await tasks.run();
    }

    rmSync(`${BACKUP_PATH_PREFIX}/${extractionFolder}`);

    console.log(`Elapsed Time: ${millisecondsToStr(Date.now() - start)}`);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    spinner.stop();
  }
};
