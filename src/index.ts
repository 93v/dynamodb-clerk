#!/usr/bin/env node

import { configureActionAndEnv } from "./actions";
import { configureDB } from "./dynamodb";
import { initProcess } from "./process";

(async () => {
  console.clear();

  await configureActionAndEnv();

  await configureDB();

  await initProcess();
})();
