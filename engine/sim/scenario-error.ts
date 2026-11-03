/** One problem with a scenario: the field (dotted) and what is wrong. */
export interface ScenarioIssue {
  path: string;
  message: string;
}

/**
 * Thrown by `worldFromScenario` (and `carriedRecord`) for a scenario it cannot build. Its message
 * names every bad field. Kept in its own file so `carry.ts` and `scenario.ts` both use it without
 * importing each other.
 */
export class ScenarioError extends Error {
  readonly issues: readonly ScenarioIssue[];
  constructor(issues: readonly ScenarioIssue[]) {
    super(`invalid scenario:\n${issues.map((i) => `  ${i.path || '(file)'}: ${i.message}`).join('\n')}`);
    this.name = 'ScenarioError';
    this.issues = issues;
  }
}
