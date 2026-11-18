/**
 * One translator is one file. The registry discovers it. The CLI and the
 * convert route never name a source.
 */

export type TranslatorWarning = {
  /** JSON pointer into the source export. Empty when the warning is about the whole file. */
  path: string;
  message: string;
};

export type CanonicalAddress = {
  address: string;
  prefix: number;
};

export type CanonicalDevice = {
  name: string;
  platform?: string;
  model?: string;
  role?: string;
  site?: string;
  managementIp?: string;
  diagram?: string;
};

export type CanonicalInterface = {
  device: string;
  name: string;
  description?: string;
  speed?: string;
  adminStatus?: "up" | "down";
  operStatus?: "up" | "down";
  ipv4?: CanonicalAddress[];
  ipv6?: CanonicalAddress[];
  vrf?: string;
  switchportMode?: "access" | "trunk";
  accessVlan?: number;
  trunkVlans?: number[];
  nativeVlan?: number;
  lag?: string;
};

export type CanonicalEndpoint = {
  device: string;
  interface: string;
};

export type CanonicalLink = {
  a: CanonicalEndpoint;
  b: CanonicalEndpoint;
  label?: string;
};

export type CanonicalVlan = {
  id: number;
  name?: string;
};

/** schemaVersion 1 document. Empty optional fields are omitted so the closed schema accepts it. */
export type CanonicalDocument = {
  schemaVersion: 1;
  format: "network";
  devices: CanonicalDevice[];
  interfaces: CanonicalInterface[];
  links: CanonicalLink[];
  vlans: CanonicalVlan[];
};

export type TranslatorResult = {
  document: CanonicalDocument;
  warnings: TranslatorWarning[];
};

/**
 * Installed translator. `id` is the CLI name and the `/convert/<id>` segment.
 * `name`, `formatHint`, and `placeholder` are what a picker shows. The client
 * has no mapping logic.
 */
export type TranslatorModule = {
  id: string;
  name: string;
  formatHint: string;
  placeholder: string;
  convert: (input: unknown) => TranslatorResult;
};

export type TranslatorInfo = {
  id: string;
  name: string;
  formatHint: string;
  placeholder: string;
};
