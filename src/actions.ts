import { prompt } from "inquirer";
import { ActionOptions } from "./constants";
import Store from "./store";

export const configureAction = async () => {
  const argv =
    Store.get<Record<string, string | null | undefined>>("argv") || {};

  const actionFromArgs = argv.action;

  let action: ActionOptions | null = null;

  if (actionFromArgs != null) {
    if (
      Object.values(ActionOptions).includes(
        (actionFromArgs as unknown) as ActionOptions,
      )
    ) {
      action = (actionFromArgs as unknown) as ActionOptions;
    } else {
      console.log("\nUnsupported action. Please select one!\n");
    }
  }

  if (action == null) {
    const response: { action: ActionOptions } = await prompt([
      {
        choices: Object.entries(ActionOptions).map(([name, value]) => ({
          disabled: [ActionOptions["Restore To Remote"]].includes(value),
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

  Store.set("action", action);

  Store.set(
    "env",
    [
      ActionOptions["Backup From Local"],
      ActionOptions["Restore To Local"],
    ].includes(action)
      ? "local"
      : "remote",
  );
};
