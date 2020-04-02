#!/usr/bin/env node --max_old_space_size=4096
import v8 from "v8";

import { configureActionAndEnv } from "./actions";
import { configureDB } from "./dynamodb";
import { initProcess } from "./process";

(async () => {
  v8.setFlagsFromString("--max_old_space_size=4096");

  console.clear();

  process.env.AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1";

  await configureActionAndEnv();

  await configureDB();

  await initProcess();
})();
