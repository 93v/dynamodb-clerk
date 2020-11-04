#!/usr/bin/env node

import { configureActionAndEnv } from "./actions";
import { configureDB } from "./dynamodb";
import { initProcess } from "./process";

(async () => {
  console.clear();

  process.env.AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1";

  await configureActionAndEnv();

  await configureDB();

  await initProcess();
})();
