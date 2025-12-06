export declare const KAFKA_TOPICS: {
    readonly TRANSFER_INITIATED: "transfer.initiated";
    readonly WALLET_DEBITED: "wallet.debited";
    readonly WALLET_DEBIT_FAILED: "wallet.debit-failed";
    readonly WALLET_CREDITED: "wallet.credited";
    readonly WALLET_CREDIT_FAILED: "wallet.credit-failed";
    readonly WALLET_REFUNDED: "wallet.refunded";
    readonly TRANSFER_COMPLETED: "transfer.completed";
    readonly TRANSFER_FAILED: "transfer.failed";
};
export declare enum TransferStatus {
    PENDING = "PENDING",
    DEBITED = "DEBITED",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED"
}
export declare enum LedgerEntryType {
    DEBIT = "DEBIT",
    CREDIT = "CREDIT",
    REFUND = "REFUND"
}
export declare const SERVICE_PORTS: {
    readonly TRANSACTION_SERVICE: 3000;
    readonly WALLET_SERVICE: 3001;
};
//# sourceMappingURL=constants.d.ts.map