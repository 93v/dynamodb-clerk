import PropertiesReader from "properties-reader";

export const listAvailableProfiles = () => {
  const awsCredentials = PropertiesReader(
    `${process.env.HOME ||
      process.env.HOMEPATH ||
      process.env.USERPROFILE}/.aws/credentials`,
  );

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

export const getProfileRegion = (profile: string): string | null => {
  const awsCredentials = PropertiesReader(
    `${process.env.HOME ||
      process.env.HOMEPATH ||
      process.env.USERPROFILE}/.aws/credentials`,
  );

  const region =
    awsCredentials.get(`${profile}.aws_region`) ||
    awsCredentials.get(`${profile}.region`);

  if (typeof region === "number" || typeof region === "boolean") {
    return region.toString();
  }

  return region;
};
