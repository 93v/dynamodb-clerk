import { DynamoDB, SharedIniFileCredentials } from "aws-sdk";
import { ServiceConfigurationOptions } from "aws-sdk/lib/service";
import { Agent } from "https";
import { prompt } from "inquirer";
import { oc } from "ts-optchain";
import { AWS_REGIONS } from "./constants";
import { getProfileRegion, listAvailableProfiles } from "./profiles";
import Store from "./store";
import { asyncSpawn, intersection, parseProcess } from "./utils";

const sslAgent = new Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: true,
});

interface ILSOFProcess {
  command?: string;
  pid?: string;
  user?: string;
  fd?: string;
  type?: string;
  device?: string;
  "size/off"?: string;
  node?: string;
  name?: string;
  [key: string]: string | undefined;
}

interface IPSProcess {
  ""?: string;
  uid?: string;
  pid?: string;
  ppid?: string;
  cpu?: string;
  pri?: string;
  ni?: string;
  vsz?: string;
  rss?: string;
  wchan?: string;
  stat?: string;
  tt?: string;
  time?: string;
  command?: string;
  [key: string]: string | undefined;
}

const getDynamoDBLocalProcesses = async () => {
  const data = await asyncSpawn(`ps`, ["lx"]);

  const [titles, ...parsedData] = data
    .split("\n")
    .map((line) => line.replace(/ +/gi, "\t").split("\t"));

  return parsedData
    .map((d) => parseProcess<IPSProcess>(d, titles))
    .reduce((acc, val) => acc.concat(val), [] as IPSProcess[])
    .filter(
      (d) =>
        oc(d)
          .command("")
          .includes("java") &&
        Object.values(d).some((v) => (v || "").includes("DynamoDBLocal.jar")),
    );
};

const getJavaProcessesListeningToTCPPorts = async () => {
  const data = await asyncSpawn(`lsof`, ["-PiTCP", "-sTCP:LISTEN"]);

  const [titles, ...parsedData] = data
    .split("\n")
    .map((line) => line.replace(/ +/gi, "\t").split("\t"));

  return parsedData
    .map((d) => parseProcess<ILSOFProcess>(d, titles))
    .reduce((acc, val) => acc.concat(val), [] as ILSOFProcess[])
    .filter((d) =>
      oc(d)
        .command("")
        .includes("java"),
    );
};

const configureForLocal = async () => {
  const [dynamoDBLocalProcesses, javaProcesses] = await Promise.all([
    getDynamoDBLocalProcesses(),
    getJavaProcessesListeningToTCPPorts(),
  ]);

  const portsFromJavaProcesses = javaProcesses.map(
    (p) =>
      oc(p)
        .name("")
        .split(":")[1],
  );
  const portsFromDBLocalProcesses = dynamoDBLocalProcesses.map((p) => p.arg8);

  const availablePorts = intersection(
    portsFromJavaProcesses,
    portsFromDBLocalProcesses,
  );

  const argv =
    Store.get<Record<string, string | null | undefined>>("argv") || {};

  const portFromArgs = argv.port;

  let port: string | null = null;

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
    const response: { profile: string } = await prompt([
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

  let region: string | null = null;

  let useProfileRegion = true;

  const regionFromArgs = argv.region;

  if (regionFromArgs != null) {
    if (AWS_REGIONS.find((r) => r.value === regionFromArgs) != null) {
      region = regionFromArgs;
    } else {
      const response: { useProfileRegion: boolean } = await prompt([
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
    region = getProfileRegion(profile);
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
    credentials: new SharedIniFileCredentials({ profile }),
    httpOptions: { agent: sslAgent },
    region,
  };

  Store.set("db", new DynamoDB(options));
};

export const configureDB = async (connectToLocal = false) => {
  if (connectToLocal) {
    return configureForLocal();
  }

  return configureForRemote();
};
