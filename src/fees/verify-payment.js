const TRACAPI_BASE = 'https://tracapi.trac.network/v1';

/**
 * Verify a TNK payment transaction against expected recipient and amount.
 *
 * 1. Try TracAPI first (fast, validates recipient + amount)
 * 2. Fall back to MSB local check on network errors only
 * 3. Hard fail (no fallback) on recipient/amount mismatch — that's fraud
 *
 * @param {string} txid — 64-char hex transaction hash
 * @param {string} expectedTo — expected recipient bech32m address
 * @param {string} expectedAmount — expected amount as bigint string
 * @param {object} [msb] — MSB instance for fallback (optional)
 * @param {object} [options]
 * @param {number} [options.apiTimeoutMs=7000]
 * @param {number} [options.msbTimeoutMs=8000]
 * @param {boolean} [options.skipApi=false] — skip TracAPI, use MSB only (for testing)
 * @returns {Promise<{ confirmed: boolean, method: 'api'|'msb'|'none', error?: string }>}
 */
export async function verifyPayment(txid, expectedTo, expectedAmount, msb, options = {}) {
    const { apiTimeoutMs = 7000, msbTimeoutMs = 8000, skipApi = false } = options;

    // Normalize for comparison
    const normalizedTo = (expectedTo || '').toLowerCase();
    const normalizedAmount = BigInt(expectedAmount || '0').toString();

    // 1. Try TracAPI (full validation) — skip in test mode
    if (!skipApi) try {
        const response = await fetch(`${TRACAPI_BASE}/tx/${txid}`, {
            signal: AbortSignal.timeout(apiTimeoutMs)
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.log('[verify] TX not found on TracAPI:', txid.slice(0, 16) + '...');
                return { confirmed: false, method: 'api', error: 'tx_not_found' };
            }
            throw new Error(`TracAPI HTTP ${response.status}`);
        }

        const data = await response.json();
        const tro = data?.txDetails?.tro;

        if (!tro || !tro.to || !tro.am) {
            console.log('[verify] TracAPI returned invalid TX structure for:', txid.slice(0, 16) + '...');
            throw new Error('Invalid TX structure');
        }

        // Check recipient
        const actualTo = tro.to.toLowerCase();
        if (actualTo !== normalizedTo) {
            console.log('[verify] RECIPIENT MISMATCH for', txid.slice(0, 16) + '...',
                '— expected:', normalizedTo.slice(0, 20) + '...', 'got:', actualTo.slice(0, 20) + '...');
            return { confirmed: false, method: 'api', error: 'recipient_mismatch' };
        }

        // Check amount
        const actualAmount = BigInt(tro.am).toString();
        if (actualAmount !== normalizedAmount) {
            console.log('[verify] AMOUNT MISMATCH for', txid.slice(0, 16) + '...',
                '— expected:', normalizedAmount, 'got:', actualAmount);
            return { confirmed: false, method: 'api', error: 'amount_mismatch' };
        }

        console.log('[verify] Payment confirmed via TracAPI:', txid.slice(0, 16) + '...',
            'to:', actualTo.slice(0, 20) + '...', 'amount:', actualAmount);
        return { confirmed: true, method: 'api' };

    } catch (apiError) {
        // Network/timeout error — fall through to MSB
        console.log('[verify] TracAPI unavailable:', apiError.message, '— trying MSB fallback');
    }

    // 2. Fallback to MSB local verification (existence-only check)
    if (msb?.state?.getTransactionConfirmedLength) {
        try {
            const result = await Promise.race([
                msb.state.getTransactionConfirmedLength(txid),
                new Promise(resolve => setTimeout(() => resolve('timeout'), msbTimeoutMs))
            ]);

            if (result === 'timeout') {
                console.log('[verify] MSB verification timeout for:', txid.slice(0, 16) + '...');
                return { confirmed: false, method: 'msb', error: 'msb_timeout' };
            }

            if (result !== null) {
                console.log('[verify] Payment confirmed via MSB (existence-only):', txid.slice(0, 16) + '...');
                return { confirmed: true, method: 'msb' };
            }

            console.log('[verify] TX not found on MSB:', txid.slice(0, 16) + '...');
            return { confirmed: false, method: 'msb', error: 'tx_not_found' };

        } catch (msbError) {
            console.log('[verify] MSB verification error:', msbError.message);
        }
    }

    // 3. Both failed
    return { confirmed: false, method: 'none', error: 'verification_unavailable' };
}
