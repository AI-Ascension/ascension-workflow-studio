import {
  DefinitionRecordSchema,
  DraftRecordSchema,
  WorkflowDefinitionSchema,
  type DefinitionRecord,
  type DraftRecord,
  type StudioOwnerDefinition,
  type StudioOwnerDraft,
} from "@studio/contracts";

export function ownerDefinitionToRecord(owner: StudioOwnerDefinition): DefinitionRecord {
  const definition = WorkflowDefinitionSchema.parse(owner.definition);
  return DefinitionRecordSchema.parse({
    id: owner.id,
    title: owner.title,
    description: owner.description,
    source: owner.source,
    updatedAt: `revision-${owner.published_revision}`,
    definition,
    capabilities: definition.capabilities.required,
    definitionDigest: owner.definition_digest,
  });
}

export function ownerDraftToRecord(owner: StudioOwnerDraft): DraftRecord {
  const document = WorkflowDefinitionSchema.parse(owner.document);
  const conflict = owner.conflict
    ? {
      serverRevision: owner.conflict.server_revision,
      serverDocument: WorkflowDefinitionSchema.parse(owner.conflict.server_document),
      serverLayout: owner.conflict.server_layout,
    }
    : null;
  return DraftRecordSchema.parse({
    draftId: owner.draft_id,
    definitionId: owner.definition_id,
    revision: owner.revision,
    etag: owner.etag,
    document,
    layout: owner.layout,
    updatedAt: owner.updated_at,
    conflict,
  });
}
