import { applyStateMessageFactory } from 'trac-msb/src/messages/state/applyStateMessageFactory.js';
import { bigIntTo16ByteBuffer, bufferToBigInt } from 'trac-msb/src/utils/amountSerialization.js';

/**
 * Send a TNK transfer via the MSB.
 *
 * @param {MainSettlementBus} msb — raw MSB instance (not MsbClient wrapper)
 * @param {string} toAddress — bech32m recipient address ("trac1...")
 * @param {string} amountStr — amount as bigint string (e.g. "30000000000000000" = 0.03 TNK)
 * @returns {Promise<{ success: boolean, txHash: string|null, error: string|null }>}
 */
export async function sendTNK(msb, toAddress, amountStr) {
    const wallet = msb.wallet;
    if (!wallet) {
        return { success: false, txHash: null, error: 'Wallet not initialized' };
    }

    const amountBigInt = BigInt(amountStr);
    const amountBuffer = bigIntTo16ByteBuffer(amountBigInt);
    const txValidity = await msb.state.getIndexerSequenceState();

    const payload = await applyStateMessageFactory(wallet, msb.config)
        .buildPartialTransferOperationMessage(
            wallet.address,
            toAddress,
            amountBuffer,
            txValidity,
            "json"
        );

    const success = await msb.broadcastPartialTransaction(payload);
    return {
        success: !!success,
        txHash: payload.tro?.tx || null,
        error: success ? null : 'Broadcast failed'
    };
}

/**
 * Verify that a TNK transfer has been confirmed on the MSB.
 *
 * @param {MainSettlementBus} msb — raw MSB instance
 * @param {string} txHash — 64-char hex transaction hash
 * @returns {Promise<number|null>} — confirmed sequence number, or null if not confirmed
 */
export async function verifyTNKTransfer(msb, txHash) {
    return await msb.state.getTransactionConfirmedLength(txHash);
}
