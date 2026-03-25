import { useState, useMemo, useCallback } from "react";

/* ================= TYPES ================= */

export type Exchange = "NFO" | "BFO" | "NCD" | "BCD";
export type Product = "Futures" | "Options";
export type OptionType = "Calls" | "Puts";
export type Side = "Buy" | "Sell";

export interface FnOFormState {
    exchange: Exchange;
    product: Product;
    symbol: string | null;
    expiry: string | null;
    optionType: OptionType;
    strike: number;
    qty: number;
    trade_type: Side;
    ltp: number;   // effective price: ask if Buy, bid if Sell, fallback to last
}

export interface BasketItem extends FnOFormState {
    id: number;
    token: number;
    contract: string;
    initialMargin: number;
    exposure: number;
    netPremium: number;
    total: number;
    isCalculating: boolean;
}

export interface CombinedMargin {
    span: number;
    exposure: number;
    total: number;
    benefit: number;
    isCalculating: boolean;
}

/* ================= CONSTANTS ================= */

export const EXCHANGE_SEGMENT: Record<Exchange, number> = {
    NFO: 2,
    BFO: 5,
    NCD: 3,
    BCD: 6,
};

const initialFormState: FnOFormState = {
    exchange: "NFO",
    product: "Options",
    symbol: null,
    expiry: null,
    optionType: "Calls",
    strike: 0,
    qty: 0,
    trade_type: "Buy",
    ltp: 0,
};

/* ================= MARGIN API CALL ================= */

async function fetchMarginFromAPI(
    tokens: { token: number; exchange_segment: number; ltp: number; netqty: number; side: 1 | 2 }[]
): Promise<{ spanMargin: number; expMargin: number; netPremium: number }> {
    const response = await fetch("/api/margin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            request: {
                data: { tokens },
                request_type: "subscribe",
                streaming_type: "MarginCalculation",
            },
        }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch margin");
    }

    return await response.json();
}

/* ================= EFFECTIVE PRICE HELPER ================= */

// BUY  → ask (what you pay)
// SELL → bid (what you receive)
// Fallback to LTP if bid/ask is 0 (illiquid / deep OTM)
function getEffectivePrice(bid: number, ask: number, ltp: number, side: Side): number {
    if (side === "Buy")  return ask > 0 ? ask  : ltp;
    if (side === "Sell") return bid > 0 ? bid  : ltp;
    return ltp;
}

/* ================= MAIN HOOK ================= */

export function useFnOLogic() {
    const [basket, setBasket] = useState<BasketItem[]>([]);
    const [form, setForm] = useState<FnOFormState>(initialFormState);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [combinedMargin, setCombinedMargin] = useState<CombinedMargin>({
        span: 0, exposure: 0, total: 0, benefit: 0, isCalculating: false,
    });

    /* ── SUMMARY ── */
    const summary = useMemo(() => {
        return basket.reduce(
            (acc, curr) => ({
                span:       acc.span       + curr.initialMargin,
                exposure:   acc.exposure   + curr.exposure,
                netPremium: acc.netPremium + curr.netPremium,
                total:      acc.total      + curr.total,
            }),
            { span: 0, exposure: 0, netPremium: 0, total: 0 }
        );
    }, [basket]);

    /* ── FETCH COMBINED MARGIN ── */
    const fetchCombinedMargin = useCallback(async (currentBasket: BasketItem[]) => {
        const readyItems = currentBasket.filter(item => !item.isCalculating && item.token);
        if (readyItems.length < 2) {
            setCombinedMargin({ span: 0, exposure: 0, total: 0, benefit: 0, isCalculating: false });
            return;
        }

        setCombinedMargin(prev => ({ ...prev, isCalculating: true }));

        try {
            const tokens = readyItems.map(item => ({
                token:            item.token,
                exchange_segment: EXCHANGE_SEGMENT[item.exchange],
                ltp:              item.ltp > 0 ? item.ltp : 1,
                netqty:           item.qty,
                side:             item.trade_type === "Buy" ? 1 as const : 2 as const,
            }));

            const { spanMargin, expMargin } = await fetchMarginFromAPI(tokens);

            // Keep as-is — negative values represent hedge benefit
            const combinedSpan  = isFinite(spanMargin) ? spanMargin : 0;
            const combinedExp   = isFinite(expMargin)  ? expMargin  : 0;
            const combinedTotal = Number((combinedSpan + combinedExp).toFixed(2));

            const individualTotal = readyItems.reduce((sum, item) =>
                sum + item.initialMargin + item.exposure, 0
            );

            const benefit = Math.max(0, individualTotal - combinedTotal);

            setCombinedMargin({
                span:          combinedSpan,
                exposure:      combinedExp,
                total:         combinedTotal,
                benefit,
                isCalculating: false,
            });

        } catch {
            setCombinedMargin(prev => ({ ...prev, isCalculating: false }));
        }
    }, []);

    /* ── ADD POSITION ── */
    const handleAdd = async () => {
        setError(null);

        if (!form.symbol)  { setError("Please select a symbol."); return; }
        if (!form.expiry)  { setError("Please select an expiry."); return; }
        if (!form.qty || form.qty === 0) { setError("Please enter a valid quantity."); return; }
        if (form.product === "Options" && (!form.strike || form.strike === 0)) {
            setError("Please select a strike price."); return;
        }

        const isDuplicate = basket.some(item =>
            item.symbol     === form.symbol &&
            item.expiry     === form.expiry &&
            item.strike     === form.strike &&
            item.optionType === form.optionType &&
            item.product    === form.product
        );
        if (isDuplicate) { setError("This contract is already in your basket."); return; }

        /* ── Capture all values before resetForm() ── */
        const symbol     = form.symbol;
        const expiry     = form.expiry;
        const exchange   = form.exchange;
        const product    = form.product;
        const strike     = form.strike;
        const optionType = form.optionType;
        const qty        = form.qty;
        const side       = form.trade_type;

        // form.ltp at this point is already the effective price (ask/bid/last)
        // as set by fetchPrice() in page.tsx when the user selected strike/side
        const effectivePrice = form.ltp;

        const tempId = Date.now();
        const optSuffix = product === "Options"
            ? ` ${strike} ${optionType === "Calls" ? "CE" : "PE"}`
            : " FUT";

        setBasket(prev => [...prev, {
            ...form,
            id:            tempId,
            token:         0,
            contract:      `${symbol} ${expiry}${optSuffix}`,
            initialMargin: 0,
            exposure:      0,
            netPremium:    0,
            total:         0,
            isCalculating: true,
        }]);

        // Form is NOT reset here — user resets manually via the Reset button

        try {
            /* ── 1. Token lookup — returns both exchange token and greek token ── */
            const { token, greekToken } = await fetch("/api/contracts/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbol,
                    expiry,
                    exchange,
                    strike:     product === "Futures" ? 0 : Number(strike),
                    optionType: product === "Futures" ? "XX" : optionType === "Calls" ? "CE" : "PE",
                }),
            }).then(r => r.json());

            if (!token) throw new Error(`No token found for ${symbol}`);

            /* ── 2. Fetch live quote using greekToken ── */
            let ltp   = effectivePrice;
            let close = 0;
            let bid   = 0;
            let ask   = 0;

            if (product === "Options" && greekToken) {
                try {
                   
                    const quoteRes = await fetch("/api/greeksoft/quote", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ greekToken }),
                    });
                     
                    const quote = await quoteRes.json();
                    console.log("fetch quote for options",quoteRes);
                    bid   = quote.bid   ?? 0;
                    ask   = quote.ask   ?? 0;
                    ltp   = quote.ltp   || effectivePrice;
                    close = quote.close || 0;
                } catch {
                    // fall back to effectivePrice from form
                }
            }

            /* ── 3. Single price source (same for margin API + premium) ── */
            // Spread validity — reject if spread > 10% of ask (too wide = illiquid)
            const isSpreadValid = bid > 0 && ask > 0 && (ask - bid) / ask < 0.1;

            // Price chain: LTP (if spread valid) → mid → close → effectivePrice
            const rawPrice = ltp > 0 && isSpreadValid
                ? ltp
                : isSpreadValid
                    ? (bid + ask) / 2
                    : close || effectivePrice;

            // Round to nearest tick (Math.round — no directional bias)
            const roundToTick = (x: number) => Math.round(x / 0.05) * 0.05;
            const price = roundToTick(rawPrice) || effectivePrice;

            console.log("Price selection:", { ltp, bid, ask, close, isSpreadValid, rawPrice, price });

            const marginLtp = product === "Futures"
                ? 0.01
                : (price > 0 ? price : 1);

            /* ── 4. Margin calculation ── */
            const exchange_segment = EXCHANGE_SEGMENT[exchange as Exchange];
            const tradeSide: 1 | 2 = side === "Buy" ? 1 : 2;

            const { spanMargin, expMargin } = await fetchMarginFromAPI([
                { token, exchange_segment, ltp: marginLtp, netqty: Number(qty), side: tradeSide }
            ]);

            // Keep margins as-is — negative values are valid hedge benefits
            // Only guard against NaN/Infinity from API failures
            const spanFinal = isFinite(spanMargin) ? spanMargin : 0;
            const expFinal  = isFinite(expMargin)  ? expMargin  : 0;

            /* ── 5. Premium — same price as margin API ── */
            const rawPremium = product === "Options" && price > 0
                ? price * Number(qty)
                : 0;

            // BUY → positive (buyer pays), SELL → negative (seller receives)
            const premiumSigned = side === "Buy" ? rawPremium : -rawPremium;

            /* ── 6. Total — round ONLY at end ── */
            const total = product === "Options"
                ? Number((spanFinal + expFinal + premiumSigned).toFixed(2))
                : Number((spanFinal + expFinal).toFixed(2));

            /* ── 7. Patch row ── */
            setBasket(prev => {
                const newBasket = prev.map(item =>
                    item.id === tempId
                        ? {
                            ...item,
                            token,
                            ltp:           price,
                            initialMargin: Number(spanFinal.toFixed(2)),
                            exposure:      Number(expFinal.toFixed(2)),
                            netPremium:    Number(premiumSigned.toFixed(2)),
                            total,
                            isCalculating: false,
                        }
                        : item
                );
                fetchCombinedMargin(newBasket);
                return newBasket;
            });

        } catch (err: unknown) {
            setBasket(prev => prev.filter(i => i.id !== tempId));
            setError(err instanceof Error ? err.message : "An unexpected error occurred");
        }
    };

    /* ── HELPERS ── */
    const resetForm   = () => setForm(initialFormState);
    const resetBasket = () => {
        setBasket([]);
        setCombinedMargin({ span: 0, exposure: 0, total: 0, benefit: 0, isCalculating: false });
    };
    const removeItem  = (id: number) => {
        setBasket(prev => {
            const newBasket = prev.filter(i => i.id !== id);
            fetchCombinedMargin(newBasket);
            return newBasket;
        });
    };

    return {
        basket,
        form,
        setForm,
        summary,
        combinedMargin,
        handleAdd,
        removeItem,
        resetBasket,
        resetForm,
        error,
        loading,
    };
}