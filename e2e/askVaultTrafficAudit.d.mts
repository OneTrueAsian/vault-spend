export type TrafficAudit = { installed: string[]; requests: string[]; commands: string[]; before: unknown; after: unknown };
export function installTrafficRecorder(): void;
export function assertTrafficAudit(audit: TrafficAudit, allowed: string[]): void;
export function nearestRank(values: number[], quantile: number): number;
export function classifyDifferential(before: string[][], after: string[][]): { violations: unknown[]; clarificationChanges: unknown[]; otherChanges: unknown[] };
