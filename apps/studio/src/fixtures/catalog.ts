import campaign from "../../../../contracts/accepted/phase1/workflows/campaign.strict.json";
import combatDynamic from "../../../../contracts/accepted/phase1/workflows/combat.dynamic.json";
import combatStrict from "../../../../contracts/accepted/phase1/workflows/combat.strict.json";
import event from "../../../../contracts/accepted/phase1/workflows/event.strict.json";
import mapDynamic from "../../../../contracts/accepted/phase1/workflows/map.dynamic.json";
import mapStrict from "../../../../contracts/accepted/phase1/workflows/map.strict.json";
import recovery from "../../../../contracts/accepted/phase1/workflows/recovery.strict.json";
import rest from "../../../../contracts/accepted/phase1/workflows/rest.strict.json";
import reward from "../../../../contracts/accepted/phase1/workflows/reward.strict.json";
import selection from "../../../../contracts/accepted/phase1/workflows/selection.strict.json";
import setup from "../../../../contracts/accepted/phase1/workflows/setup.strict.json";
import shop from "../../../../contracts/accepted/phase1/workflows/shop.strict.json";
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

/**
 * The supported Phase 1 gameplay templates admitted by the owner. Only accepted
 * fixtures are listed; expert-state research items are not presented as live
 * capabilities.
 */
export const fixtureDefinitions: DefinitionRecord[] = [
  fixture("sts2.setup.strict", "Strict setup", "A bounded setup admission path with explicit observation and settlement.", "2026-09-10T00:00:00.000Z", setup),
  fixture("sts2.combat.dynamic", "Adaptive combat", "A bounded dynamic region returning one proposal to protected execution.", "2026-09-10T00:00:00.000Z", combatDynamic),
  fixture("sts2.combat.strict", "Strict combat", "A strict fixed-orchestration combat graph with bounded loops.", "2026-09-10T00:00:00.000Z", combatStrict),
  fixture("sts2.campaign.strict", "Campaign coordinator", "A strict campaign graph with explicit stage routing and operator terminal state.", "2026-09-10T00:00:00.000Z", campaign),
  fixture("sts2.map.dynamic", "Adaptive map", "A bounded dynamic map region gated on map observation capability.", "2026-09-10T00:00:00.000Z", mapDynamic),
  fixture("sts2.map.strict", "Strict map", "A strict map traversal graph with pinned action settlement.", "2026-09-10T00:00:00.000Z", mapStrict),
  fixture("sts2.selection.strict", "Card selection", "A strict card selection graph with explicit settlement.", "2026-09-10T00:00:00.000Z", selection),
  fixture("sts2.shop.strict", "Shop", "A strict shop graph with a reward continuation.", "2026-09-10T00:00:00.000Z", shop),
  fixture("sts2.event.strict", "Event", "A strict event decision graph with a selection continuation.", "2026-09-10T00:00:00.000Z", event),
  fixture("sts2.reward.strict", "Reward", "A strict reward settlement graph.", "2026-09-10T00:00:00.000Z", reward),
  fixture("sts2.rest.strict", "Rest", "A strict rest graph with a selection continuation.", "2026-09-10T00:00:00.000Z", rest),
  fixture("sts2.recovery.strict", "Recovery", "A strict recovery graph that reconciles uncertain effects before resuming.", "2026-09-10T00:00:00.000Z", recovery),
  fixture("sts2.terminal.strict", "Terminal outcome", "A strict route with explicit true, false, and unknown settlement outcomes.", "2026-09-11T00:00:00.000Z", terminal),
];
