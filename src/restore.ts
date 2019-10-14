import retry from "async-retry";
import { DynamoDB } from "aws-sdk";
import {
  // CreateTableInput,
  BatchWriteItemInput,
  DescribeTableOutput,
  // ScanInput,
  ScanOutput,
  WriteRequests,
} from "aws-sdk/clients/dynamodb";
import {
  // mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import { prompt } from "inquirer";
import Listr, { ListrTask } from "listr";
import ora from "ora";
import { basename, extname, join } from "path";
import { sync as rmSync } from "rimraf";
import tar from "tar";
import { oc } from "ts-optchain";
import { BACKUP_PATH_PREFIX, RETRY_OPTIONS } from "./constants";
import Store from "./store";
import { findCommon, isRetryableDBError, millisecondsToStr } from "./utils";

const BATCH_OPTIONS = { writeLimit: 25 };

const restoreTable = async (
  tableName: string,
  extractionFolder: string,
  tableNamesConversionMapping: Record<string, string>,
) => {
  const path = `${BACKUP_PATH_PREFIX}/${extractionFolder}/${tableName}`;

  const db = Store.get<DynamoDB>("db");
  if (db == null) {
    throw new Error("Database config not found");
  }

  try {
    const tableDescription: DescribeTableOutput = JSON.parse(
      readFileSync(`${path}/description.json`, "utf8"),
    );

    const table = tableDescription.Table;

    if (table == null) {
      return;
    }

    const dbTableName =
      tableNamesConversionMapping[oc(table).TableName(tableName)] || tableName;

    let tableExists = false;

    try {
      const tableDescriptionOnDB = await db
        .describeTable({ TableName: dbTableName })
        .promise();

      tableExists = tableDescriptionOnDB != null;
    } catch (error) {
      tableExists = false;

      console.log("Table Exists?", tableExists);
      return;
    }

    const dataFiles = readdirSync(`${path}/data`).filter(
      (file) => extname(file) === ".json",
    );

    await Promise.all(
      dataFiles.map(async (dataFile) => {
        const data: ScanOutput = JSON.parse(
          readFileSync(`${path}/data/${dataFile}`, "utf8"),
        );

        const items = oc(data).Items([]);

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
                  result.UnprocessedItems &&
                  result.UnprocessedItems[dbTableName]
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

    // if (!tableExists) {
    //   const params: CreateTableInput = {
    //     AttributeDefinitions: oc(table).AttributeDefinitions([]),
    //     KeySchema: oc(table).KeySchema([]),
    //     TableName: dbTableName,

    //     LocalSecondaryIndexes: table.LocalSecondaryIndexes
    //       ? oc(table)
    //           .LocalSecondaryIndexes([])
    //           .map(
    //             (lsi): LocalSecondaryIndex => ({
    //               IndexName: oc(lsi).IndexName(""),
    //               KeySchema: oc(lsi).KeySchema([]),
    //               Projection: oc(lsi).Projection({}),
    //             }),
    //           )
    //       : undefined,

    //     GlobalSecondaryIndexes: table.GlobalSecondaryIndexes
    //       ? oc(table)
    //           .GlobalSecondaryIndexes([])
    //           .map(
    //             (gsi): GlobalSecondaryIndex => {
    //               console.log("GSI C", oc(gsi).IndexName(""));
    //               return {
    //                 IndexName: oc(gsi).IndexName(""),
    //                 KeySchema: oc(gsi).KeySchema([]),
    //                 Projection: oc(gsi).Projection({}),
    //                 // ProvisionedThroughput: {
    //                 //   ReadCapacityUnits: oc(
    //                 //     gsi,
    //                 //   ).ProvisionedThroughput.ReadCapacityUnits(1),
    //                 //   WriteCapacityUnits: oc(
    //                 //     gsi,
    //                 //   ).ProvisionedThroughput.WriteCapacityUnits(1),
    //                 // },
    //               };
    //             },
    //           )
    //       : undefined,

    //     BillingMode: oc(table).BillingModeSummary.BillingMode(),

    //     // ProvisionedThroughput: table.ProvisionedThroughput
    //     //   ? {
    //     //       ReadCapacityUnits: oc(
    //     //         table,
    //     //       ).ProvisionedThroughput.ReadCapacityUnits(1),
    //     //       WriteCapacityUnits: oc(
    //     //         table,
    //     //       ).ProvisionedThroughput.WriteCapacityUnits(1),
    //     //     }
    //     //   : undefined,

    //     StreamSpecification: oc(table).StreamSpecification(),

    //     SSESpecification: table.SSEDescription
    //       ? { SSEType: oc(table).SSEDescription.SSEType() }
    //       : undefined,
    //   };
    //   await db.createTable(params).promise();
    // } else {
    //   const params: UpdateTableInput = {
    //     AttributeDefinitions: oc(table).AttributeDefinitions([]),
    //     TableName: dbTableName,

    //     GlobalSecondaryIndexUpdates:
    //       table.GlobalSecondaryIndexes && false
    //         ? oc(table)
    //             .GlobalSecondaryIndexes([])
    //             .map(
    //               (gsi): GlobalSecondaryIndexUpdate => {
    //                 console.log("GSI U", oc(gsi).IndexName(""));
    //                 return {};
    //                 // return {
    //                 //   Update: {
    //                 //     IndexName: oc(gsi).IndexName(""),
    //                 //     ProvisionedThroughput: {
    //                 //       ReadCapacityUnits: oc(
    //                 //         gsi,
    //                 //       ).ProvisionedThroughput.ReadCapacityUnits(1),
    //                 //       WriteCapacityUnits: oc(
    //                 //         gsi,
    //                 //       ).ProvisionedThroughput.WriteCapacityUnits(1),
    //                 //     },
    //                 //   },
    //                 // };
    //               },
    //             )
    //         : undefined,

    //     BillingMode: oc(table).BillingModeSummary.BillingMode(),

    //     // ProvisionedThroughput: table.ProvisionedThroughput
    //     //   ? {
    //     //       ReadCapacityUnits: oc(
    //     //         table,
    //     //       ).ProvisionedThroughput.ReadCapacityUnits(1),
    //     //       WriteCapacityUnits: oc(
    //     //         table,
    //     //       ).ProvisionedThroughput.WriteCapacityUnits(1),
    //     //     }
    //     //   : undefined,

    //     StreamSpecification: oc(table).StreamSpecification(),

    //     SSESpecification: table.SSEDescription
    //       ? { SSEType: oc(table).SSEDescription.SSEType() }
    //       : undefined,
    //   };
    //   await db.updateTable(params).promise();
    // }

    // Create the table in the DB
    // Read data from the archive
    // Restore data to the DB
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

  const argv =
    Store.get<Record<string, string | null | undefined>>("argv") || {};

  const archiveFromArgs = argv.archive;

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
        file: join(BACKUP_PATH_PREFIX, archive!),
        noResume: true,
        onentry: (entry) => {
          resolve(entry);
        },
      });
    });

    const dbTables = await db.listTables().promise();

    const extractionFolder: string = oc(filesInArchive as any)
      .path("")
      .replace("/", "");

    const tablesInArchive = readdirSync(
      `${BACKUP_PATH_PREFIX}/${extractionFolder}`,
    );

    spinner.stop();

    const tablesInDB = oc(dbTables).TableNames([]);

    const archiveTablesCommonPrefix = findCommon(tablesInArchive);
    const archiveTablesCommonSuffix = findCommon(tablesInArchive, "suffix");
    let archiveHasPattern = true;
    const dbTablesCommonPrefix = findCommon(tablesInDB);
    const dbTablesCommonSuffix = findCommon(tablesInDB, "suffix");

    const archiveTablesSearchPatternFromArgs =
      argv["archive-tables-search-pattern"];

    let archiveTablesSearchPattern: string | null = null;

    if (archiveTablesSearchPatternFromArgs != null) {
      archiveTablesSearchPattern = archiveTablesSearchPatternFromArgs;
    }

    if (archiveTablesSearchPattern == null) {
      let defaultArchiveTablesSearchPattern = "";

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

    const dbTablesReplacePatternFromArgs = argv["db-tables-replace-pattern"];

    let dbTablesReplacePattern: string | null = null;

    if (dbTablesReplacePatternFromArgs != null) {
      dbTablesReplacePattern = dbTablesReplacePatternFromArgs;
    }

    if (dbTablesReplacePattern == null) {
      let defaultDBTablesReplacePattern = "";

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
