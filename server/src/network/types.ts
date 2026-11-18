export type NetworkAddress = {
  address: string;
  prefix: number;
};

export type NetworkDevice = {
  name: string;
  platform: string;
  /** Hardware model, distinct from platform and role. */
  model: string;
  role: string;
  site: string;
  managementIp: string;
  /** Workspace path of a child diagram, without the nerdgram: prefix. */
  diagram: string;
};

export type NetworkInterface = {
  device: string;
  name: string;
  description: string;
  /** Free-text speed, such as 10G. Empty when the file omits it. */
  speed: string;
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
  /** Optional name written on the Layer 2 edge. */
  label: string;
  /**
   * True when the export marked the edge as inferred.
   * False when the field is omitted. A true value is drawn as a dashed edge.
   */
  inferred: boolean;
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
