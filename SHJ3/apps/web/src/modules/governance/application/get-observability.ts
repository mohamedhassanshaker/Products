import type {
  ServiceHealthRepository,
  ServiceHealthSampleRow,
} from "../ports/service-health-repository.js";

/** B14 tab 3's table — current samples, already carrying a persisted `status`
 *  (computed by `RecordServiceHealthSample` at write time; this use case never
 *  recomputes it, so a read reflects exactly what was last recorded). */
export class GetObservability {
  constructor(private readonly deps: { readonly samples: ServiceHealthRepository }) {}

  async execute(): Promise<readonly ServiceHealthSampleRow[]> {
    return this.deps.samples.listLatest();
  }
}
