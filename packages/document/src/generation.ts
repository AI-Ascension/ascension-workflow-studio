/**
 * Monotonic edit generation used to reject obsolete asynchronous results.
 * A result computed for an older generation must never update newer state.
 */
export interface EditGeneration {
  current(): number;
  bump(): number;
  isCurrent(token: number): boolean;
}

export function createEditGeneration(initial = 0): EditGeneration {
  let generation = initial;
  return {
    current: () => generation,
    bump: () => {
      generation += 1;
      return generation;
    },
    isCurrent: (token: number) => token === generation,
  };
}
