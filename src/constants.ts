import { Options } from "async-retry";

export enum ActionOptions {
  "Backup From Remote" = "backup-from-remote",
  "Backup From Local" = "backup-from-local",
  "Restore To Local" = "restore-to-local",
  "Restore To Remote" = "restore-to-remote",
}

export const RETRY_OPTIONS: Options = {
  minTimeout: 50,
  retries: 10,
};

export const BACKUP_PATH_PREFIX = `./backup-data`;

// List is based on https://docs.aws.amazon.com/general/latest/gr/rande.html
export const AWS_REGIONS = [
  { name: "US East (N. Virginia)", value: "us-east-1" },
  { name: "US East (Ohio)", value: "us-east-2" },
  { name: "US West (N. California)", value: "us-west-1" },
  { name: "US West (Oregon)", value: "us-west-2" },
  { name: "Asia Pacific (Hong Kong)", value: "ap-east-1" },
  { name: "Asia Pacific (Mumbai)", value: "ap-south-1" },
  { name: "Asia Pacific (Tokyo)", value: "ap-northeast-1" },
  { name: "Asia Pacific (Seoul)", value: "ap-northeast-2" },
  { name: "Asia Pacific (Osaka-Local)", value: "ap-northeast-3" },
  { name: "Asia Pacific (Singapore)", value: "ap-southeast-1" },
  { name: "Asia Pacific (Sydney)", value: "ap-southeast-2" },
  { name: "Canada (Central)", value: "ca-central-1" },
  { name: "China (Beijing)", value: "cn-north-1" },
  { name: "China (Ningxia)", value: "cn-northwest-1" },
  { name: "EU (Frankfurt)", value: "eu-central-1" },
  { name: "EU (Ireland)", value: "eu-west-1" },
  { name: "EU (London)", value: "eu-west-2" },
  { name: "EU (Paris)", value: "eu-west-3" },
  { name: "EU (Stockholm)", value: "eu-north-1" },
  { name: "Middle East (Bahrain)", value: "me-south-1" },
  { name: "South America (Sao Paulo)", value: "sa-east-1" },
  { name: "AWS GovCloud (US-East)", value: "us-gov-east-1" },
  { name: "AWS GovCloud (US-West)", value: "us-gov-west-1" },
];
