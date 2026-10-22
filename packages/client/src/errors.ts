export class ClientError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly errorClass?: string,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

/** This invocation failed before its fetcher was called. It does not discharge
 * an earlier ambiguous submission with the same request identity. */
export class RunSubmissionNotStartedError extends ClientError {
  public constructor(public readonly cause: unknown) {
    super(
      cause instanceof Error ? cause.message : "Run request was not sent",
      cause instanceof ClientError ? cause.code : "submission_not_started",
      cause instanceof ClientError ? cause.status : undefined,
      cause instanceof ClientError ? cause.errorClass : undefined,
    );
    this.name = "RunSubmissionNotStartedError";
  }
}

export class CapabilityGateError extends ClientError {
  public constructor(message: string, code = "capability_unavailable") {
    super(message, code, 501);
    this.name = "CapabilityGateError";
  }
}
