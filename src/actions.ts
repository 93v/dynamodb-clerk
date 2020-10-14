import { prompt } from "inquirer";
import { argv } from "yargs";

import { DBCActionEnv, DBCActionType } from "../types/action";
import { ActionOptions } from "./_constants";
import Store from "./_store";

export const configureActionAndEnv = async () => {
  let action: ActionOptions | null = null;

  if (argv.action != null) {
    if (Object.values(ActionOptions).includes(argv.action as ActionOptions)) {
      action = argv.action as ActionOptions;
    } else {
      console.log("\nUnsupported action. Please select one!\n");
    }
  }

  if (action == null) {
    const response: { action: ActionOptions } = await prompt([
      {
        choices: Object.entries(ActionOptions).map(([name, value]) => ({
          name,
          value,
        })),
        message: "What action do you want to perform?",
        name: "action",
        type: "list",
      },
    ]);
    action = response.action;
  }

  Store.set<DBCActionType>(
    "action",
    [
      ActionOptions["Backup From Local"],
      ActionOptions["Backup From Remote"],
    ].includes(action)
      ? "backup"
      : "restore",
  );

  Store.set<DBCActionEnv>(
    "env",
    [
      ActionOptions["Backup From Local"],
      ActionOptions["Restore To Local"],
    ].includes(action)
      ? "local"
      : "remote",
  );
};
