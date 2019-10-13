#!/usr/bin/env node

import yargs from "yargs";
import { configureAction } from "./actions";
import { ActionOptions } from "./constants";
import { configureDB } from "./dynamodb";
import { initProcess } from "./process";
import Store from "./store";

(async () => {
  console.clear();

  Store.reset();

  const argv = yargs.argv;

  Store.set("argv", argv);

  await configureAction();

  const action = Store.get<ActionOptions>("action");

  if (action == null) {
    return;
  }

  await configureDB(
    action === ActionOptions["Backup From Local"] ||
      action === ActionOptions["Restore To Local"],
  );

  await initProcess(
    action === ActionOptions["Restore To Local"] ||
      action === ActionOptions["Restore To Remote"]
      ? "restore"
      : "backup",
  );
})();
