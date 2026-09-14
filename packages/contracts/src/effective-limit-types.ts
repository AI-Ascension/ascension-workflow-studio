// Types mirror the pinned producer JSON schemas; runtime validation uses those exact bytes.
export type MemoryCapabilitiesV3 = {
  schema: "ascension.context-memory.capabilities.v3";
  product_phase: 3;
  scope: {
    project_id: string;
    run_id: string;
    episode_id: string;
    agent_id: string;
  };
  enabled: boolean;
  local_lexical_retrieval: "supported" | "unsupported" | "unverified";
  extractive_compaction: "supported" | "unsupported" | "unverified";
  abstractive_adapter: "supported" | "unsupported" | "unverified";
  abstractive_live_verified: boolean;
  per_decision_policy: "supported" | "unsupported" | "unverified";
  phase2_approval_required: true;
  persistent_provider_sessions: false;
  provider_side_compaction: false;
  semantic_vector_retrieval: "unsupported";
  hidden_reasoning_access: false;
  direct_game_dispatch: false;
  effective_limits: {
    policy_schema: "ascension.context-memory.policy.v1";
    max_candidates: number;
    max_results: number;
    max_selected: number;
    optional_byte_budget: number;
    max_entries_per_run: number;
    max_corpus_bytes: number;
    max_source_bytes: number;
    max_sources_per_job: number;
    max_job_input_bytes: number;
    max_summary_output_bytes: number;
    max_query_bytes: number;
    max_lineage_depth: number;
    max_global_memory_bytes: number;
    max_global_memory_jobs: number;
    max_retention_resources: number;
    max_retention_bytes: number;
    max_cache_entries: number;
    max_review_records: number;
    max_memory_bindings: number;
    max_usage_attempts: number;
  };
  binding: {
    owner: "sts2-harness";
    owner_revision: "harness-context-memory-v3";
    policy_schema_sha256: string;
    model_revision: "not-applicable";
    adapter_revision: "harness-context-memory-v3";
    adapter_revision_sha256: string;
    descriptor_sha256: string;
  };
  supported_operations: ("search" | "extract" | "generate" | "review" | "select" | "policy" | "adopt" | "revoke" | "evaluate")[];
};

export type ProviderSessionCapabilitiesV3 = {
  schema: "ascension.provider-session.capabilities.v3";
  profile_id: string;
  profile_sha256: string;
  native_version: string;
  native_binary_sha256: string;
  native_schema_sha256: string;
  evidence: "schema_only" | "compiled_peer" | "native_binary_fake_upstream" | "live_provider";
  transport: "owned_stdio";
  enabled_methods: (string)[];
  hardening: {
    tools_enabled: false;
    ambient_history: false;
    encrypted_state: boolean;
    configuration_verified: boolean;
    transform_handling: "verified_suppressed" | "detect_and_fence" | "opaque_approved";
  };
  effective_limits: {
    policy_schema: "ascension.provider-session.policy.v1";
    max_session_items: number;
    max_dependencies: number;
    max_events: number;
    max_operations: number;
    max_prepared: number;
    max_candidates: number;
    max_maintenance_jobs: number;
    max_completed_turns: number;
    max_history_ttl_seconds: number;
    max_frame_bytes: number;
    max_history_bytes: number;
    max_prepared_bytes: number;
    max_suffix_bytes: number;
    max_output_schema_bytes: number;
    max_method_bytes: number;
    max_json_depth: number;
  };
  binding: {
    owner: "sts2-harness";
    owner_revision: "harness-provider-session-v3";
    policy_schema_sha256: string;
    model_revision: string;
    adapter_revision: string;
    adapter_revision_sha256: string;
    descriptor_sha256: string;
  };
  strict_executable: boolean;
  experimental_api: boolean;
  unknown_methods: "deny";
  raw_rpc: false;
};

export type ProviderSessionCapabilitiesV1 = {
  schema: "ascension.provider-session.capabilities.v1";
  profile_id: string;
  profile_sha256: string;
  native_version: string;
  native_binary_sha256: string;
  native_schema_sha256: string;
  evidence: "schema_only" | "compiled_peer" | "native_binary_fake_upstream" | "live_provider";
  transport: "owned_stdio";
  enabled_methods: (string)[];
  hardening: {
    tools_enabled: false;
    ambient_history: false;
    encrypted_state: true;
    configuration_verified: boolean;
    transform_handling: "verified_suppressed" | "detect_and_fence" | "opaque_approved";
  };
  strict_executable: boolean;
  experimental_api: boolean;
  unknown_methods: "deny";
  raw_rpc: false;
};

