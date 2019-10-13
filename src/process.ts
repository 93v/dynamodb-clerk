import { startBackupProcess } from "./backup";
import { startRestoreProcess } from "./restore";

export const initProcess = async (type: "restore" | "backup") => {
  if (type === "backup") {
    return startBackupProcess();
  }

  return startRestoreProcess();
};
