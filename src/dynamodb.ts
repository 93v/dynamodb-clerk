import { DynamoDB } from "aws-sdk";
import { ServiceConfigurationOptions } from "aws-sdk/lib/service";
import { Agent } from "https";
import { prompt } from "inquirer";
import { argv } from "yargs";
import { DBCActionEnv } from "../types/action";
import { AWS_REGIONS } from "./constants";
import { getProfileProperty, listAvailableProfiles } from "./profiles";
import Store from "./store";
import { getLocalDynamoDBPorts } from "./utils";

const sslAgent = new Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: true,
});

export const configureDB = async () => {
  const env = Store.get<DBCActionEnv>("env");

  if (env === "local") {
    const portFromArgs = argv.port as string | null;

    let port: string | null = null;

    const availablePorts = await getLocalDynamoDBPorts();

    if (portFromArgs != null) {
      if (availablePorts.includes(portFromArgs.toString())) {
        port = portFromArgs.toString();
      } else {
        console.log("\nThe port is not open. Please select one!\n");
      }
    }

    if (availablePorts.length === 0) {
      console.log("\nLooks like there are no DynamoDB instances running.");
      console.log(
        "\nPlease launch the DynamoDB locally and restart this process.\n",
      );
      process.exit(0);
    }

    if (port == null) {
      const response: {
        port: string;
      } = await prompt([
        {
          choices: availablePorts,
          message: "Select the port of DynamoDB Local?",
          name: "port",
          type: "list",
        },
      ]);
      port = response.port;
    }

    Store.set("port", port);
  }

  const accessKeyIdFromArgs = argv["access-key-id"];
  const secretAccessKeyFromArgs = argv["secret-access-key"];
  const regionFromArgs = argv.region;

  if (
    accessKeyIdFromArgs == null ||
    secretAccessKeyFromArgs == null ||
    (regionFromArgs == null && env !== "local")
  ) {
    const awsProfiles = listAvailableProfiles() || [];

    const profileFromArgs = argv.profile as string | null;

    let profile: string | null = null;

    if (profileFromArgs != null) {
      if (awsProfiles.find((p) => p.profile === profileFromArgs && p.valid)) {
        profile = profileFromArgs;
      } else {
        console.log(
          "\nProfile does not exist or is invalid. Please select one!\n",
        );
      }
    }

    if (profile == null) {
      const response: {
        profile: string;
      } = await prompt([
        {
          choices: [
            {
              name: "-- Enter the configs manually --",
              value: null,
            },
            ...awsProfiles.map((p) => ({
              disabled: !p.valid,
              value: p.profile,
            })),
          ],
          message: "Choose the profile",
          name: "profile",
          type: "list",
        },
      ]);
      profile = response.profile;
    }

    Store.set("profile", profile);

    if (profile != null) {
      const profileAccessKeyId = getProfileProperty(profile, "access_key_id");
      const profileSecretAccessKey = getProfileProperty(
        profile,
        "secret_access_key",
      );
      const profileRegion = getProfileProperty(profile, "region");

      Store.set("accessKeyId", profileAccessKeyId);
      Store.set("secretAccessKey", profileSecretAccessKey);
      Store.set("region", profileRegion);
    }
  }

  if (accessKeyIdFromArgs != null) {
    Store.set("accessKeyId", accessKeyIdFromArgs);
  }

  if (Store.get("accessKeyId") == null) {
    const response: {
      accessKeyId: string;
    } = await prompt([
      {
        default:
          Store.get<DBCActionEnv>("env") === "local"
            ? "localAwsAccessKeyId"
            : undefined,
        message: "Enter the Access Key Id",
        name: "accessKeyId",
        type: "input",
        validate: (v) => !!v,
      },
    ]);
    Store.set("accessKeyId", response.accessKeyId);
  }

  if (secretAccessKeyFromArgs != null) {
    Store.set("secretAccessKey", secretAccessKeyFromArgs);
  }

  if (Store.get("secretAccessKey") == null) {
    const response: {
      secretAccessKey: string;
    } = await prompt([
      {
        default:
          Store.get<DBCActionEnv>("env") === "local"
            ? "localAwsSecretAccessKey"
            : undefined,
        message: "Enter the Secret Access Key",
        name: "secretAccessKey",
        type: "input",
        validate: (v) => !!v,
      },
    ]);
    Store.set("secretAccessKey", response.secretAccessKey);
  }

  if (env !== "local") {
    if (
      regionFromArgs != null &&
      AWS_REGIONS.find((r) => r.value === regionFromArgs) != null
    ) {
      Store.set("region", regionFromArgs);
    }

    if (Store.get("region") == null) {
      const response: {
        region: string;
      } = await prompt([
        {
          choices: AWS_REGIONS,
          message: "Choose the region",
          name: "region",
          type: "list",
        },
      ]);
      Store.set("region", response.region);
    }
  }

  if (env === "local") {
    Store.set("region", "localhost");
  }

  const accessKeyId = Store.get<string>("accessKeyId");
  const secretAccessKey = Store.get<string>("secretAccessKey");
  const region = Store.get<string>("region");

  if (accessKeyId == null || secretAccessKey == null || region == null) {
    console.log("\nLooks like invalid configs have been provided.");
    console.log("\nPlease check everything again and restart this process.\n");
    process.exit(0);
    return;
  }

  const options: ServiceConfigurationOptions = {
    accessKeyId,
    httpOptions: { agent: sslAgent },
    region,
    secretAccessKey,
  };

  if (env === "local") {
    options.endpoint = `http://localhost:${Store.get("port")}`;
  }

  Store.set("db", new DynamoDB(options));
};
