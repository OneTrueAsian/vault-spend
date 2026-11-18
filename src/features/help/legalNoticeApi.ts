import { invoke } from "@tauri-apps/api/core";

export interface LegalNoticeAcknowledgement {
  /** The notice version last acknowledged on this computer, or null if none. */
  version: string | null;
  acknowledged_at: string | null;
  /** True only for an e2e run that asked to start past the notice. */
  skip: boolean;
}

export function getLegalNoticeAcknowledgement(): Promise<LegalNoticeAcknowledgement> {
  return invoke<LegalNoticeAcknowledgement>("get_legal_notice_acknowledgement");
}

export function acknowledgeLegalNotice(version: string): Promise<void> {
  return invoke("acknowledge_legal_notice", { version });
}
