import type { EnvironmentRepository, EnvironmentRow } from "../ports/environment-repository.js";

/** B14 tab 1's environments table — real `Environments`/`VersionDeployments` counts. */
export class ListEnvironments {
  constructor(private readonly deps: { readonly environments: EnvironmentRepository }) {}

  async execute(): Promise<readonly EnvironmentRow[]> {
    return this.deps.environments.list();
  }
}
