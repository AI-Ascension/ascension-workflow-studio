//! Seals the Studio inference-profile conformance fixture with the PRODUCER's
//! own code and prints the result to stdout.
//!
//! This crate contains no digest arithmetic. It links `sts2-harness` as a path
//! dependency (the sibling checkout that CI pins to
//! `contracts/inference-profile-catalog.lock.json`) and calls the owner's own
//! `InferenceProfileDescriptor::seal` and `inference_catalog_digest`. Because
//! the descriptor types are the producer's own types, the digests below are
//! literally the producer's output rather than a re-implementation of it.
//!
//! `fixture-input.json` states descriptor FIELDS only and carries no digests,
//! so the emitted digests cannot be hand-written.

use serde_json::{Value, json};
use sts2_harness::management::{
    InferenceProfileDescriptor, inference_catalog_digest,
};

const FIXTURE_INPUT: &str = include_str!("fixture-input.json");

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input: Value = serde_json::from_str(FIXTURE_INPUT)?;
    let mut catalogs: Vec<Value> = Vec::new();

    for row in input.as_array().ok_or("fixture input must be an array")? {
        let owner_id = row["owner_id"].as_str().ok_or("owner_id")?.to_owned();
        let owner_version = row["owner_version"].as_str().ok_or("owner_version")?.to_owned();

        // Keep the descriptors TYPED so the producer's digest function receives
        // exactly the type it declares.
        let mut sealed: Vec<InferenceProfileDescriptor> = Vec::new();
        for raw in row["descriptors"].as_array().ok_or("descriptors")? {
            let descriptor: InferenceProfileDescriptor = serde_json::from_value(raw.clone())?;
            // The producer's seal. `validate` is `&self -> Result<(), _>`, so it is
            // called for its refusal side effect rather than chained.
            let descriptor = descriptor.seal()?;
            descriptor.validate()?;
            sealed.push(descriptor);
        }

        let catalog_digest = inference_catalog_digest(&owner_id, &owner_version, &sealed)?;
        let sealed: Vec<Value> =
            sealed.into_iter().map(serde_json::to_value).collect::<Result<_, _>>()?;
        catalogs.push(json!({
            "name": row["name"],
            "binding_usable": row["binding_usable"],
            "catalog": {
                "schema_version": row["schema_version"],
                "owner_id": owner_id,
                "owner_version": owner_version,
                "catalog_digest": catalog_digest,
                "descriptors": sealed,
            },
        }));
    }

    let out = json!({
        "fixture_schema": "ascension.inference-profile.catalog-conformance.fixture.v1",
        "producer": "AI-Ascension/sts2-harness",
        "producer_revision": env!("STS2_HARNESS_PRODUCER_REVISION"),
        "method": "producer_crate_linked_seal",
        "evidence": "synthetic_descriptor_validation_only",
        "catalogs": catalogs,
    });
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}
