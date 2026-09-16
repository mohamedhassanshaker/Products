/** A narrow read of `Teams` — the routing-rule target dropdown and the display name
 *  behind a ticket's/rule's `targetTeamId`. Not a full port: this module only ever
 *  needs `{id, name}` for a select and a label, the same narrow-read precedent
 *  `channels/composition.ts`'s `listBindableAgents` already set for `Agent`. */
export interface TeamOption {
  readonly id: string;
  readonly name: string;
}

export interface TeamRepository {
  list(): Promise<readonly TeamOption[]>;
  findById(id: string): Promise<TeamOption | null>;
}
