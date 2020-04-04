import { existsSync } from "fs";
import PropertiesReader from "properties-reader";

const awsCredentialsPath = `${
  process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
}/.aws/credentials`;

export const listAvailableProfiles = () => {
  if (!existsSync(awsCredentialsPath)) {
    return [];
  }

  const awsCredentials = PropertiesReader(awsCredentialsPath);

  const credentials = awsCredentials.path() as Record<
    string,
    Record<string, string>
  >;

  return Object.entries(credentials).map(([key, value]) => ({
    profile: key,
    valid:
      value.aws_access_key_id != null && value.aws_secret_access_key != null,
  }));
};

export const getProfileProperty = (
  profile: string,
  property: "region" | "access_key_id" | "secret_access_key",
): string | null => {
  if (!existsSync(awsCredentialsPath)) {
    return null;
  }

  const awsCredentials = PropertiesReader(awsCredentialsPath);

  const value =
    awsCredentials.get(`${profile}.aws_${property}`) ||
    awsCredentials.get(`${profile}.${property}`);

  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }

  return value;
};
