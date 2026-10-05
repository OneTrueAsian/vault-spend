/** Synthetic preview only. This module is excluded from the production mobile entry. */
import fixture from "../core/tests/fixtures/mobile_snapshot_v1.json";
import { parseMobileSnapshot } from "./mobileSnapshot";
import type { MobileSnapshotV1 } from "./mobileSnapshotTypes";
const sample = structuredClone(fixture) as MobileSnapshotV1;
sample.profile.name = "Our household (synthetic)";
sample.history.months = Array.from({ length: 12 }, (_, i) => { const month = new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7); return { month, income: i === 11 ? "0" : "6800", spending: i === 11 ? "0" : String(3800 + i * 43), savingsRatePct: i === 11 ? null : String((6800 - 3800 - i * 43) / 6800 * 100).slice(0, 15) }; });
sample.history.fromMonth = sample.history.months[0].month;
sample.history.throughMonth = "2026-10";
sample.accounts[0].name = "Everyday checking with a long account name";
sample.accounts[1].name = "Emergency fund";
export const mobilePreviewSnapshots = [parseMobileSnapshot(JSON.stringify(sample)), parseMobileSnapshot(JSON.stringify({ ...sample, profile: { id: "profile-second", name: "My personal finances (synthetic)", icon: null }, accounts: sample.accounts.map(a => ({ ...a, name: `Personal ${a.name}` })) }))];
