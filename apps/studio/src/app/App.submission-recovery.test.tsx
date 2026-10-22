import { userEvent } from "@testing-library/user-event";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientError, FixtureClient, RunSubmissionNotStartedError } from "@studio/client";
import type { SubmissionRecoveryResponse } from "@studio/contracts";
import { App } from "./App";

const originalSubmit = FixtureClient.prototype.submitRun;
const missing = (requestId: string): SubmissionRecoveryResponse => ({
  schema_version: "ascension.workflow-submission/v1", request_id: requestId, state: "missing",
  workflow_run_id: null, response: null, error: null,
});
async function selectAdmission(user: ReturnType<typeof userEvent.setup>) {
  const panel = await screen.findByRole("region", { name: "Run admission" });
  await user.selectOptions(await within(panel).findByLabelText("Target instance"), "studio-inspection");
  await user.selectOptions(within(panel).getByLabelText("Execution profile"), "synthetic");
  await user.selectOptions(within(panel).getByLabelText("Game profile"), "sts2-synthetic-v1");
  await user.click(within(panel).getByRole("button", { name: "Run preflight" }));
  await within(panel).findByLabelText("Exact admission binding");
  return panel;
}
async function reviewAdmission(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await screen.findByRole("heading", { name: "Workflow library" });
  await user.click(screen.getAllByRole("button", { name: "Open designer" })[0]);
  await screen.findByRole("heading", { name: "Strict setup" });
  await user.click(screen.getByRole("button", { name: "Run inspection" }));
  return selectAdmission(user);
}
function expectRetained(panel: HTMLElement, requestId: string) {
  expect(panel).toHaveTextContent(requestId);
  expect(within(panel).queryByRole("button", { name: "Cancel run setup" })).not.toBeInTheDocument();
  expect(within(panel).queryByRole("button", { name: "Retry the same request" })).not.toBeInTheDocument();
  expect(within(panel).queryByLabelText("Run target configuration")).not.toBeInTheDocument();
}
afterEach(() => vi.restoreAllMocks());

describe("Studio retains ambiguous original run requests", () => {
  it("recovers an admitted post-launch 409 and blocks replacement, cancellation and adapter switching", async () => {
    const submit = vi.spyOn(FixtureClient.prototype, "submitRun").mockImplementation(async function (this: FixtureClient, ...args) {
      await originalSubmit.apply(this, args);
      throw new ClientError("Synthetic post-launch failure", "live_launch_failed", 409, "unresolved");
    });
    const read = vi.spyOn(FixtureClient.prototype, "recoverRunSubmission");
    const user = userEvent.setup({ delay: null });
    const panel = await reviewAdmission(user);
    await user.click(within(panel).getByRole("button", { name: "Start run" }));
    await within(panel).findByText("Run outcome unknown");
    const requestId = submit.mock.calls[0][3]!.requestId!;
    expectRetained(panel, requestId);
    await user.click(screen.getByRole("button", { name: "Run inspection" }));
    expect(submit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Compatibility" }));
    await user.click(screen.getByRole("button", { name: /Live owner API/ }));
    expect(screen.getByText(/Reconcile the retained submission before switching/)).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole("button", { name: "Check original submission" }));
    expect(await screen.findByText("Owner recovered run.fixture.1 at revision 1.")).toBeInTheDocument();
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(requestId);
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Run admission" })).not.toBeInTheDocument();
  });

  it("permits one deliberate exact retry only after missing readback", async () => {
    const submit = vi.spyOn(FixtureClient.prototype, "submitRun").mockRejectedValueOnce(new Error("lost reply"));
    vi.spyOn(FixtureClient.prototype, "recoverRunSubmission").mockImplementation(async (id) => missing(id));
    const user = userEvent.setup({ delay: null });
    const panel = await reviewAdmission(user);
    await user.click(within(panel).getByRole("button", { name: "Start run" }));
    await within(panel).findByText("Run outcome unknown");
    expect(submit).toHaveBeenCalledOnce();
    await user.click(within(panel).getByRole("button", { name: "Check original submission" }));
    const retry = await within(panel).findByRole("button", { name: "Retry the same request" });
    expect(submit).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(await screen.findByText("Owner accepted run.fixture.1 at revision 1.")).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  });

  it.each(["pending", "failed"] as const)("keeps %s identity while opening its reserved run", async (state) => {
    const submit = vi.spyOn(FixtureClient.prototype, "submitRun").mockRejectedValue(new Error("lost reply"));
    vi.spyOn(FixtureClient.prototype, "recoverRunSubmission").mockImplementation(async (id) => ({
      ...missing(id), state, workflow_run_id: "run.fixture.1", response: null,
      error: state === "failed" ? { class: "unresolved", code: "live_launch_failed", message: "Inspect retained run" } : null,
    } as SubmissionRecoveryResponse));
    const user = userEvent.setup({ delay: null });
    const panel = await reviewAdmission(user);
    await user.click(within(panel).getByRole("button", { name: "Start run" }));
    await within(panel).findByText("Run outcome unknown");
    await user.click(within(panel).getByRole("button", { name: "Check original submission" }));
    await within(panel).findByRole("button", { name: "Inspect retained run" });
    expectRetained(panel, submit.mock.calls[0][3]!.requestId!);
    await user.click(within(panel).getByRole("button", { name: "Inspect retained run" }));
    expect(await screen.findByRole("heading", { name: "Run inspector" })).toBeInTheDocument();
    expectRetained(panel, submit.mock.calls[0][3]!.requestId!);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("retains the ID when readback is unavailable", async () => {
    const submit = vi.spyOn(FixtureClient.prototype, "submitRun").mockRejectedValue(new Error("lost reply"));
    vi.spyOn(FixtureClient.prototype, "recoverRunSubmission").mockRejectedValue(new ClientError("Recovery unavailable", "unavailable", 404));
    const user = userEvent.setup({ delay: null });
    const panel = await reviewAdmission(user);
    await user.click(within(panel).getByRole("button", { name: "Start run" }));
    await within(panel).findByText("Run outcome unknown");
    await user.click(within(panel).getByRole("button", { name: "Check original submission" }));
    expect(await within(panel).findByText(/Recovery unavailable/)).toBeInTheDocument();
    expectRetained(panel, submit.mock.calls[0][3]!.requestId!);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("allows cancellation and a new setup after a first attempt refused before transport", async () => {
    const submit = vi.spyOn(FixtureClient.prototype, "submitRun").mockRejectedValueOnce(
      new RunSubmissionNotStartedError(new ClientError("Session changed", "submission_session_changed", 409)));
    const user = userEvent.setup({ delay: null });
    const panel = await reviewAdmission(user);
    await user.click(within(panel).getByRole("button", { name: "Start run" }));
    expect(await within(panel).findByText(/No run request was sent/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Check original submission" })).not.toBeInTheDocument();
    const firstId = submit.mock.calls[0][3]!.requestId!;
    await user.click(within(panel).getByRole("button", { name: "Cancel run setup" }));
    expect(screen.queryByRole("region", { name: "Run admission" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run inspection" }));
    const second = await selectAdmission(user);
    await user.click(within(second).getByRole("button", { name: "Start run" }));
    await screen.findByText("Owner accepted run.fixture.1 at revision 1.");
    expect(submit.mock.calls[1][3]!.requestId).not.toBe(firstId);
  });

  it("never releases an earlier ambiguous ID when a later retry is refused locally", async () => {
    const submit = vi.spyOn(FixtureClient.prototype, "submitRun")
      .mockRejectedValueOnce(new Error("lost reply"))
      .mockRejectedValueOnce(new RunSubmissionNotStartedError(new ClientError("Session changed", "submission_session_changed", 409)));
    vi.spyOn(FixtureClient.prototype, "recoverRunSubmission").mockImplementation(async (id) => missing(id));
    const user = userEvent.setup({ delay: null });
    const panel = await reviewAdmission(user);
    await user.click(within(panel).getByRole("button", { name: "Start run" }));
    await within(panel).findByText("Run outcome unknown");
    await user.click(within(panel).getByRole("button", { name: "Check original submission" }));
    await user.click(await within(panel).findByRole("button", { name: "Retry the same request" }));
    await within(panel).findByText("Run outcome unknown");
    expectRetained(panel, submit.mock.calls[0][3]!.requestId!);
    await user.click(screen.getByRole("button", { name: "Run inspection" }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  });
});
