import { DynamoDB } from "aws-sdk";
import { ServiceConfigurationOptions } from "aws-sdk/lib/service";
import { Agent } from "https";
import { prompt } from "inquirer";
import { AWS_REGIONS } from "./constants";
import { getProfileProperty, listAvailableProfiles } from "./profiles";
import Store from "./store";
import { getLocalDynamoDBPorts } from "./utils";

const sslAgent = new Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: true,
});

const configureForLocal = async () => {
  const argv =
    Store.get<Record<string, string | null | undefined>>("argv") || {};

  const portFromArgs = argv.port;

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
    const response: { port: string } = await prompt([
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

  const accessKeyIdFromArgs = argv["access-key-id"];

  let accessKeyId: string | null = null;

  if (accessKeyIdFromArgs != null) {
    accessKeyId = accessKeyIdFromArgs;
  }

  if (accessKeyId == null) {
    const response: { accessKeyId: string } = await prompt([
      {
        default: "localAwsAccessKeyId",
        message: "Enter the Access Key Id",
        name: "accessKeyId",
        type: "input",
      },
    ]);
    accessKeyId = response.accessKeyId;
  }

  Store.set("accessKeyId", accessKeyId);

  const secretAccessKeyFromArgs = argv["secret-access-key"];

  let secretAccessKey: string | null = null;

  if (secretAccessKeyFromArgs != null) {
    secretAccessKey = secretAccessKeyFromArgs;
  }

  if (secretAccessKey == null) {
    const response: { secretAccessKey: string } = await prompt([
      {
        default: "localAwsSecretAccessKey",
        message: "Enter the Secret Access Key",
        name: "secretAccessKey",
        type: "input",
      },
    ]);
    secretAccessKey = response.secretAccessKey;
  }

  Store.set("secretAccessKey", secretAccessKey);

  const options: ServiceConfigurationOptions = {
    accessKeyId: Store.get<string>("accessKeyId") || "localAwsAccessKeyId",
    endpoint: `http://localhost:${port}`,
    region: "localhost",
    secretAccessKey:
      Store.get<string>("secretAccessKey") || "localAwsSecretAccessKey",
  };

  Store.set("db", new DynamoDB(options));
};

const configureForRemote = async () => {
  const awsProfiles = listAvailableProfiles();

  const argv =
    Store.get<Record<string, string | null | undefined>>("argv") || {};

  const profileFromArgs = argv.profile;

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
        choices: awsProfiles.map((p) => ({
          disabled: !p.valid,
          value: p.profile,
        })),
        message: "Choose the profile",
        name: "profile",
        type: "list",
      },
    ]);
    profile = response.profile;
  }

  Store.set("profile", profile);

  const awsAccessKeyId = getProfileProperty(profile, "access_key_id");
  const awsSecretAccessKey = getProfileProperty(profile, "secret_access_key");

  let region: string | null = null;

  let useProfileRegion = true;

  const regionFromArgs = argv.region;

  if (regionFromArgs != null) {
    if (AWS_REGIONS.find((r) => r.value === regionFromArgs) != null) {
      region = regionFromArgs;
    } else {
      const response: {
        useProfileRegion: boolean;
      } = await prompt([
        {
          default: true,
          message: `Region is invalid. Selected profile may have a region setting. Do you want to try to use that?`,
          name: "useProfileRegion",
          type: "confirm",
        },
      ]);

      useProfileRegion = response.useProfileRegion;
    }
  }

  if (region == null && useProfileRegion) {
    region = getProfileProperty(profile, "region");
  }

  if (region == null) {
    const regionAnswer: { region: string } = await prompt([
      {
        choices: AWS_REGIONS,
        message: "Choose the region",
        name: "region",
        type: "list",
      },
    ]);
    region = regionAnswer.region;
  }

  Store.set("region", region);

  const options: ServiceConfigurationOptions = {
    accessKeyId: awsAccessKeyId!,
    httpOptions: { agent: sslAgent },
    region,
    secretAccessKey: awsSecretAccessKey!,
  };

  Store.set("db", new DynamoDB(options));
};

export const configureDB = async (connectToLocal = false) => {
  if (connectToLocal) {
    return configureForLocal();
  }

  return configureForRemote();
};
