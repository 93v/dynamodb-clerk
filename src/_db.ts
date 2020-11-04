import { Dynatron, DynatronDocumentClientParams } from "dynatron";
import { DBCActionEnv } from "../types/action";
import Store from "./_store";

export const db = (table: string) => {
  let clientConfigs: DynatronDocumentClientParams | null = null;

  const env = Store.get<DBCActionEnv>("env");

  if (env === "local") {
    clientConfigs = {
      mode: "local",
      accessKeyId: Store.get<string>("accessKeyId") as string,
      secretAccessKey: Store.get<string>("secretAccessKey") as string,
      port: Number(Store.get("port")),
    };
  } else {
    clientConfigs = {
      mode: "direct",
      ...(Store.get<string>("profile")
        ? { profile: Store.get<string>("profile") as string }
        : {
            accessKeyId: Store.get<string>("accessKeyId") as string,
            secretAccessKey: Store.get<string>("secretAccessKey") as string,
          }),
      region: Store.get<string>("region") as string,
    };
  }

  return new Dynatron({ table, ...(clientConfigs ? { clientConfigs } : {}) });
};
