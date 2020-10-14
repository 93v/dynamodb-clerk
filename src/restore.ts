import PromisePool from "@supercharge/promise-pool";
// import {
//   CreateTableInput,
//   DescribeTableOutput,
//   GlobalSecondaryIndex,
//   LocalSecondaryIndex,
// } from "aws-sdk/clients/dynamodb";
import { readdirSync, readFileSync, statSync } from "fs";
import { prompt } from "inquirer";
import Listr, { ListrTask, ListrTaskWrapper } from "listr";
import ora from "ora";
import { basename, extname, join } from "path";
import { sync as rmSync } from "rimraf";
import tar from "tar";
import { argv } from "yargs";

import { BACKUP_PATH_PREFIX } from "./_constants";
import { db } from "./_db";
import { findCommon, millisecondsToStr } from "./_utils";

const convertWithPatterns = (
  str: string,
  searchPattern: string | null,
  replacePattern: string | null,
) => {
  if (searchPattern == null || replacePattern == null) {
    return str;
  }

  return str.replace(new RegExp(searchPattern, "g"), replacePattern);
};

const restoreTable = async (
  tableName: string,
  extractionFolder: string,
  namesSearchPattern: string | null,
  namesReplacePattern: string | null,
  task?: ListrTaskWrapper,
) => {
  const path = `${BACKUP_PATH_PREFIX}/${extractionFolder}/${tableName}`;

  try {
    const tableDescription = JSON.parse(
      readFileSync(`${path}/description.json`, "utf8"),
    );

    const table = tableDescription;

    if (table == null) {
      return;
    }

    const dbTableName = convertWithPatterns(
      table.TableName || tableName,
      namesSearchPattern,
      namesReplacePattern,
    );

    const tableData = await db("").Tables.describe(dbTableName).$();

    if (tableData == null) {
      return;
    }

    const dataFiles = readdirSync(`${path}/data`).filter(
      (file) => extname(file) === ".json",
    );

    let processedFiles = 0;

    await new PromisePool()
      .for(dataFiles)
      .withConcurrency(10)
      .process(async (dataFile) => {
        const data = JSON.parse(
          readFileSync(`${path}/data/${dataFile}`, "utf8"),
        );

        await db(dbTableName)
          .batchPut(data || [])
          .$();

        processedFiles++;

        const tableProgress = Math.min(
          (dataFiles.length || 0) === 0
            ? 1
            : processedFiles / (dataFiles.length || 0),
          1,
        );

        if (task != null) {
          task.title = `${tableName.padEnd(100 || 0)} - ${
            tableProgress >= 0.99995 && tableProgress <= 1 ? "~" : ""
          }${(tableProgress * 100).toFixed(2)}%`;
        }

        return true;
      });
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

    const dbTables = await db("").Tables.list().$();

    const extractionFolder: string = (
      (filesInArchive as any).path || ""
    ).replace("/", "");

    const tablesInArchive = readdirSync(
      `${BACKUP_PATH_PREFIX}/${extractionFolder}`,
    );

    spinner.stop();

    const tablesInDB = dbTables || [];

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
            "Enter the archive table names and indexes search pattern (string, regex)",
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
            "Enter the DynamoDB table names and indexes replace pattern (string, regex)",
          name: "dbTablesReplacePattern",
          type: "input",
        },
      ]);
      dbTablesReplacePattern = response.dbTablesReplacePattern;
    }

    const start = Date.now();

    console.clear();

    if (tablesInArchive.length > 0) {
      const tasks = new Listr(
        [
          ...tablesInArchive.map(
            (tableName): ListrTask => ({
              title: tableName,

              task: async (_, task) => {
                await restoreTable(
                  tableName,
                  extractionFolder,
                  archiveTablesSearchPattern,
                  dbTablesReplacePattern,
                  task,
                );
                task.title = `${tableName.padEnd(100 || 0)} - Done`;
              },
            }),
          ),
        ],
        { concurrent: 5 },
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
