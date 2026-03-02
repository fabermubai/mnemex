import PeerWallet from 'trac-wallet';
import { applyStateMessageFactory } from 'trac-msb/src/messages/state/applyStateMessageFactory.js';
import { bigIntTo16ByteBuffer, bufferToBigInt } from 'trac-msb/src/utils/amountSerialization.js';

const BECH32M_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Send a TNK transfer via the MSB.
 *
 * @param {MainSettlementBus} msb — raw MSB instance (not MsbClient wrapper)
 * @param {string} toAddress — bech32m recipient address ("trac1...")
 * @param {string} amountStr — amount as bigint string (e.g. "30000000000000000" = 0.03 TNK)
 * @param {object} [wallet] — wallet to sign with (defaults to msb.wallet; pass peer.wallet for peer-funded transfers)
 * @returns {Promise<{ success: boolean, txHash: string|null, error: string|null }>}
 */
export async function sendTNK(msb, toAddress, amountStr, wallet) {
    wallet = wallet || msb.wallet;
    if (!wallet) {
        return { success: false, txHash: null, error: 'Wallet not initialized' };
    }

    // Validate bech32m address before hitting MSB
    const decoded = PeerWallet.decodeBech32mSafe(toAddress);
    if (!decoded) {
        const dataPart = typeof toAddress === 'string' ? toAddress.slice(5) : '';
        const invalid = [...dataPart].filter(c => !BECH32M_CHARS.includes(c));
        const hint = invalid.length > 0
            ? ` (invalid character${invalid.length > 1 ? 's' : ''}: ${[...new Set(invalid)].map(c => `'${c}'`).join(', ')} — common confusion: 1↔l, 0↔o)`
            : ' (checksum mismatch)';
        return { success: false, txHash: null, error: `Invalid bech32m address${hint}` };
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
