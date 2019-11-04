#!/usr/bin/env node --max_old_space_size=4096
import v8 from "v8";
import { argv } from "yargs";
import pkg from "../package.json";
import { configureActionAndEnv } from "./actions";
import { configureDB } from "./dynamodb";
import { initProcess } from "./process";

(async () => {
  if (argv.version != null) {
    console.log(`${pkg.name} version ${pkg.version}`);
    return;
  }

  v8.setFlagsFromString("--max_old_space_size=4096");

  console.clear();

  await configureActionAndEnv();

  await configureDB();

  await initProcess();
})();
