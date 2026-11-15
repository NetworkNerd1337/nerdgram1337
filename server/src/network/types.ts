export type NetworkAddress = {
  address: string;
  prefix: number;
};

export type NetworkDevice = {
  name: string;
  platform: string;
  role: string;
  site: string;
  managementIp: string;
};

export type NetworkInterface = {
  device: string;
  name: string;
  description: string;
  adminStatus: "" | "up" | "down";
  operStatus: "" | "up" | "down";
  ipv4: NetworkAddress[];
  ipv6: NetworkAddress[];
  /** Empty string is the default VRF. The word `default` is the same VRF. */
  vrf: string;
  switchportMode: "" | "access" | "trunk";
  accessVlan: number | null;
  /** Null means the field was omitted. An empty array means no allowed VLANs. */
  trunkVlans: number[] | null;
  nativeVlan: number | null;
  lag: string;
};

export type NetworkEndpoint = {
  device: string;
  interface: string;
};

export type NetworkLink = {
  a: NetworkEndpoint;
  b: NetworkEndpoint;
};

export type NetworkVlan = {
  id: number;
  name: string;
};

export type NetworkNeighbors = {
  cdp: string;
  lldp: string;
  localDevice: string;
};

export type NetworkDocument = {
  schemaVersion: 1;
  devices: NetworkDevice[];
  interfaces: NetworkInterface[];
  links: NetworkLink[];
  vlans: NetworkVlan[];
  neighbors: NetworkNeighbors;
};

export type SchemaIssue = {
  path: string;
  message: string;
};
