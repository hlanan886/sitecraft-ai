const requiredChecks = ["envLocal", "nodeModules", "playwright", "chromiumCache", "postgres"];

export function hasRequiredPreflightFailure(checks) {
  return requiredChecks.some((name) => checks[name] !== true);
}
