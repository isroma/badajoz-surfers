// Minimal typing for the tests, which read public/data/city.json from disk (the project has no
// @types/node). Merges harmlessly with @types/node if that is ever added.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
