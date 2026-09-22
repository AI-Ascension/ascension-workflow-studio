import {
  ContextOwnerCatalogSchema,
  TargetCatalogResponseSchema,
  type ContextOwnerCatalog,
  type TargetCatalogResponse,
} from "@studio/contracts";

import contextCatalogFixture from "../../../contracts/accepted/context-control/catalog-conformance.json" with { type: "json" };

const FIXTURE_TARGET_CAPABILITIES = [
  "studio.fixture.v1",
  "observe.fair-play.v1",
  "observe.map.v1",
  "actions.catalog.v1",
  "actions.settlement.v1",
  "authority.generation-fence.v1",
  "actions.setup.v1",
  "actions.selection.v1",
  "actions.combat.v1",
  "actions.campaign.v1",
  "actions.map.v1",
  "actions.reward.v1",
  "actions.shop.v1",
  "actions.event.v1",
  "actions.rest.v1",
  "operations.reconcile.v1",
  "terminal.observation.v1",
  "analysis.combat.v1",
] as const;

export function fixtureTargetCatalog(): TargetCatalogResponse {
  return TargetCatalogResponseSchema.parse({
    schema_version: "ascension.workflow-targets/v1",
    catalog_revision: "fixture-target-catalog.v1",
    targets: [{
      instance_id: "studio-inspection",
      execution_profiles: ["synthetic"],
      execution_mode: "synthetic",
      compatibility_revision: "fixture.compatibility.v1",
      capability_revision: "fixture.capabilities.v1",
      availability: "available",
      supported_operations: ["workflow:run", "workflow:live"],
      capabilities: [...FIXTURE_TARGET_CAPABILITIES],
      game_profiles: ["sts2-synthetic-v1"],
      save_profiles: ["save.synthetic.default"],
      inference_profiles: ["inference.synthetic.default"],
    }, {
      instance_id: "studio-inspection-secondary",
      execution_profiles: ["synthetic.secondary"],
      execution_mode: "synthetic",
      compatibility_revision: "fixture.compatibility.v2",
      capability_revision: "fixture.capabilities.v2",
      availability: "available",
      supported_operations: ["workflow:run"],
      capabilities: [...FIXTURE_TARGET_CAPABILITIES],
      game_profiles: ["sts2-synthetic-v1"],
      save_profiles: [],
      inference_profiles: [],
    }],
  });
}

export async function fixtureContextOwnerCatalog(): Promise<ContextOwnerCatalog> {
  return ContextOwnerCatalogSchema.parse(contextCatalogFixture.catalogs.find((row) => row.name === "default")?.catalog);
}
