import campaign from "../../../../contracts/accepted/phase1/workflows/campaign.strict.json";
import combatDynamic from "../../../../contracts/accepted/phase1/workflows/combat.dynamic.json";
import setup from "../../../../contracts/accepted/phase1/workflows/setup.strict.json";
import terminal from "../../../../contracts/accepted/phase1/workflows/terminal.strict.json";
import {
  DefinitionRecordSchema,
  WorkflowDefinitionSchema,
  type DefinitionRecord,
} from "@studio/contracts";

function fixture(id: string, title: string, description: string, updatedAt: string, raw: unknown): DefinitionRecord {
  const definition = WorkflowDefinitionSchema.parse(raw as unknown);
  return DefinitionRecordSchema.parse({
    id,
    title,
    description,
    source: "catalog",
    updatedAt,
    definition,
    capabilities: [...definition.capabilities.required],
  });
}

export const fixtureDefinitions: DefinitionRecord[] = [
  fixture("sts2.setup.strict", "Strict setup", "A bounded setup admission path with explicit observation and settlement.", "2026-09-10T00:00:00.000Z", setup),
  fixture("sts2.combat.dynamic", "Adaptive combat", "A bounded dynamic region returning one proposal to protected execution.", "2026-09-10T00:00:00.000Z", combatDynamic),
  fixture("sts2.campaign.strict", "Campaign coordinator", "A strict campaign graph with explicit stage routing and operator terminal state.", "2026-09-10T00:00:00.000Z", campaign),
  fixture("sts2.terminal.strict", "Terminal outcome", "A strict route with explicit true, false, and unknown settlement outcomes.", "2026-09-11T00:00:00.000Z", terminal),
];
