import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    public constructor(_callback: ResizeObserverCallback) {}
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
  } as typeof ResizeObserver;
}
