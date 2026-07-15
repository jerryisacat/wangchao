declare module "node:dns/promises" {
  export interface LookupAddress {
    address: string;
    family: number;
  }
  export function lookup(hostname: string, options: { all: true }): Promise<LookupAddress[]>;
  export function lookup(hostname: string, options?: { all?: false }): Promise<LookupAddress>;
}
