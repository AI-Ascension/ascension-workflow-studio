import campaign from "../../../../contracts/accepted/phase1/workflows/campaign.strict.json";
import combatDynamic from "../../../../contracts/accepted/phase1/workflows/combat.dynamic.json";
import setup from "../../../../contracts/accepted/phase1/workflows/setup.strict.json";
import terminal from "../../../../contracts/accepted/phase1/workflows/terminal.strict.json";
import {
  DefinitionRecordSchema,
  WorkflowDefinitionSchema,
  type DefinitionRecord,
} from "@studio/contracts";

export const fixtureDefinitions: DefinitionRecord[] = [
  DefinitionRecordSchema.parse({
    id: "sts2.setup.strict",
    title: "Strict setup",
    description: "A bounded setup admission path with explicit observation and settlement.",
    source: "catalog",
    updatedAt: "2026-09-10T00:00:00.000Z",
    definition: WorkflowDefinitionSchema.parse(setup as unknown),
    capabilities: ["observe.fair-play.v1", "actions.catalog.v1", "actions.settlement.v1", "actions.setup.v1"],
  }),
  DefinitionRecordSchema.parse({
    id: "sts2.combat.dynamic",
    title: "Adaptive combat",
    description: "A bounded dynamic region returning one proposal to protected execution.",
    source: "catalog",
    updatedAt: "2026-09-10T00:00:00.000Z",
    definition: WorkflowDefinitionSchema.parse(combatDynamic as unknown),
    capabilities: ["observe.fair-play.v1", "actions.catalog.v1", "actions.settlement.v1", "actions.combat.v1", "analysis.combat.v1"],
  }),
  DefinitionRecordSchema.parse({
    id: "sts2.campaign.strict",
    title: "Campaign coordinator",
    description: "A strict campaign graph with explicit stage routing and operator terminal state.",
    source: "catalog",
    updatedAt: "2026-09-10T00:00:00.000Z",
    definition: WorkflowDefinitionSchema.parse(campaign as unknown),
    capabilities: ["observe.fair-play.v1", "actions.catalog.v1", "actions.settlement.v1", "actions.campaign.v1"],
  }),
  DefinitionRecordSchema.parse({
    id: "sts2.terminal.strict",
    title: "Terminal outcome",
    description: "A strict route with explicit true, false, and unknown settlement outcomes.",
    source: "catalog",
    updatedAt: "2026-09-11T00:00:00.000Z",
    definition: WorkflowDefinitionSchema.parse(terminal as unknown),
    capabilities: ["observe.fair-play.v1", "actions.catalog.v1", "actions.settlement.v1"],
  }),
];
