import { DBCActionType } from "../types/action";
import { startBackupProcess } from "./backup";
import { startRestoreProcess } from "./restore";
import Store from "./_store";

export const initProcess = async () =>
  Store.get<DBCActionType>("action") === "backup"
    ? startBackupProcess()
    : startRestoreProcess();
