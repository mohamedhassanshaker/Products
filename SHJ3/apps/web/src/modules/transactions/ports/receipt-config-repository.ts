/** `ReceiptConfigs` — the singleton row for B11 tab 3's three receipt switches. */

export interface ReceiptConfigRow {
  readonly sendInConversation: boolean;
  readonly emailPdfCopy: boolean;
  readonly allowRefundRequestsFromAssistant: boolean;
}

export interface ReceiptConfigRepository {
  get(): Promise<ReceiptConfigRow>;
  set(input: {
    readonly sendInConversation: boolean;
    readonly emailPdfCopy: boolean;
    readonly allowRefundRequestsFromAssistant: boolean;
    readonly now: Date;
  }): Promise<ReceiptConfigRow>;
}
