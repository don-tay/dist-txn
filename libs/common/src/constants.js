export const KAFKA_TOPICS = {
    TRANSFER_INITIATED: 'transfer.initiated',
    WALLET_DEBITED: 'wallet.debited',
    WALLET_DEBIT_FAILED: 'wallet.debit-failed',
    WALLET_CREDITED: 'wallet.credited',
    WALLET_CREDIT_FAILED: 'wallet.credit-failed',
    WALLET_REFUNDED: 'wallet.refunded',
    TRANSFER_COMPLETED: 'transfer.completed',
    TRANSFER_FAILED: 'transfer.failed',
};
export var TransferStatus;
(function (TransferStatus) {
    TransferStatus["PENDING"] = "PENDING";
    TransferStatus["DEBITED"] = "DEBITED";
    TransferStatus["COMPLETED"] = "COMPLETED";
    TransferStatus["FAILED"] = "FAILED";
})(TransferStatus || (TransferStatus = {}));
export var LedgerEntryType;
(function (LedgerEntryType) {
    LedgerEntryType["DEBIT"] = "DEBIT";
    LedgerEntryType["CREDIT"] = "CREDIT";
    LedgerEntryType["REFUND"] = "REFUND";
})(LedgerEntryType || (LedgerEntryType = {}));
export const SERVICE_PORTS = {
    TRANSACTION_SERVICE: 3000,
    WALLET_SERVICE: 3001,
};
//# sourceMappingURL=constants.js.map