export class ClientError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

export class CapabilityGateError extends ClientError {
  public constructor(message: string, code = "capability_unavailable") {
    super(message, code, 501);
    this.name = "CapabilityGateError";
  }
}
