export interface ILSOFProcess {
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

export interface IPSProcess {
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
