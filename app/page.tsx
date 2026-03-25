"use client";

import React from "react";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { formatCurrency } from "@/utils/formatters";
import {
    useFnOLogic,
    Exchange,
    Product,
    OptionType,
} from "./logic/fnoLogic";

const exchanges: Exchange[] = ["NFO", "BFO", "NCD", "BCD"];
const products: Product[] = ["Futures", "Options"];
const optionTypes: OptionType[] = ["Calls", "Puts"];

/* ── Fetch effective price using bid/ask (broker-accurate) ── */
async function fetchPrice(greekToken: number, side: "Buy" | "Sell"): Promise<number> {
    try {
        const res = await fetch("/api/greeksoft/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ greekToken })
        });
        if (!res.ok) return 0;
        const text = await res.text();
        if (!text) return 0;

        const { ltp = 0, close = 0, bid = 0, ask = 0 } = JSON.parse(text);

        // Fallback chain: bid/ask (live) → ltp (last trade) → close (prev day)
        // close is used after market hours when bid/ask/ltp are all 0
        const fallback = ltp || close;

        if (side === "Buy")  return ask > 0 ? ask : fallback;
        if (side === "Sell") return bid > 0 ? bid : fallback;
        return fallback;
    } catch {
        return 0;
    }
}

export default function FnOMarginCalculator() {

    /* ================= HOOK FIRST ================= */
    const {
        basket,
        form,
        setForm,
        summary,
        combinedMargin,
        handleAdd,
        removeItem,
        resetForm,
        resetBasket,
        loading,
        error,
    } = useFnOLogic();

    /* ================= STATE ================= */
    const [symbolList, setSymbolList] = React.useState<{ symbol: string; lot_size: number }[]>([]);
    const [expiries, setExpiries] = React.useState<string[]>([]);
    const [strikes, setStrikes] = React.useState<number[]>([]);
    const [symbolSearch, setSymbolSearch] = React.useState("");
    const [showDropdown, setShowDropdown] = React.useState(false);

    // Guard: prevents useEffects from firing during handleAdd → resetForm()
    const isSubmitting = React.useRef(false);
    // Tracks the strike auto-set by the strikes useEffect so the strike-change
    // useEffect doesn't fire a duplicate quote fetch for it
    const autoSetStrike = React.useRef<number>(0);

    /* ================= LOAD SYMBOLS ================= */
    React.useEffect(() => {
        fetch(`/api/contracts/symbols?exchange=${form.exchange}`)
            .then(r => r.json())
            .then(d => setSymbolList(d.symbols ?? []));
    }, [form.exchange]);

    /* ================= LOAD EXPIRIES ================= */
    React.useEffect(() => {
        if (isSubmitting.current) return;
        if (!form.symbol) { setExpiries([]); return; }
        fetch(`/api/contracts/expiries?symbol=${form.symbol}&exchange=${form.exchange}`)
            .then(r => r.json())
            .then(d => setExpiries(d.expiries ?? []));
    }, [form.symbol, form.exchange]);

    /* ================= LOAD STRIKES + AUTO-FILL LTP ================= */
    React.useEffect(() => {
        if (isSubmitting.current) return;
        if (!form.symbol || !form.expiry || form.product !== "Options") return;

        fetch(`/api/contracts/strikes?symbol=${form.symbol}&expiry=${form.expiry}&exchange=${form.exchange}`)
            .then(r => r.json())
            .then(async d => {
                if (isSubmitting.current) return;
                const list: number[] = d.strikes ?? [];
                setStrikes(list);

                const midStrike = list.length > 0 ? list[Math.floor(list.length / 2)] : 0;
                autoSetStrike.current = midStrike; // mark so strike-change effect skips it
                setForm(prev => ({ ...prev, strike: midStrike }));

                if (!midStrike) return;

                const tokenRes = await fetch("/api/contracts/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        symbol:     form.symbol,
                        expiry:     form.expiry,
                        exchange:   form.exchange,
                        strike:     midStrike,
                        optionType: form.optionType === "Calls" ? "CE" : "PE",
                    })
                });
                const { greekToken } = await tokenRes.json();
                if (!greekToken) return;

                const ltp = await fetchPrice(greekToken, form.trade_type);
                if (ltp > 0) setForm(prev => ({ ...prev, ltp }));
            });

    }, [form.symbol, form.expiry, form.product, form.exchange, form.optionType]);

    /* ================= RE-FETCH LTP ON STRIKE CHANGE ================= */
    React.useEffect(() => {
        if (isSubmitting.current) return;
        if (!form.symbol || !form.expiry || form.product !== "Options" || !form.strike) return;
        // Skip if this strike was auto-set by the strikes useEffect (it already fetched quote)
        if (form.strike === autoSetStrike.current) { autoSetStrike.current = 0; return; }

        fetch("/api/contracts/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                symbol:     form.symbol,
                expiry:     form.expiry,
                exchange:   form.exchange,
                strike:     form.strike,
                optionType: form.optionType === "Calls" ? "CE" : "PE",
            })
        })
            .then(r => r.json())
            .then(async ({ greekToken }) => {
                if (isSubmitting.current) return;
                if (!greekToken) return;
                const ltp = await fetchPrice(greekToken, form.trade_type);
                if (ltp > 0) setForm(prev => ({ ...prev, ltp }));
            });

    }, [form.strike]); // only re-run when user manually changes strike

    /* ================= FILTERED SYMBOLS ================= */
    const filteredSymbols = symbolSearch.length > 0
        ? symbolList.filter(s => s.symbol.toLowerCase().includes(symbolSearch.toLowerCase()))
        : symbolList;

    const currentLotSize = symbolList.find(s => s.symbol === form.symbol)?.lot_size;
    const hasBenefit = basket.length >= 2 && combinedMargin.benefit > 0;

    /* ================= RENDER ================= */
    return (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
            <h1 className="text-2xl lg:text-3xl font-bold text-arihant-violet mb-4 lg:mb-6">
                F&amp;O Margin Calculator
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">

                {/* ── INPUT PANEL ── */}
                <div className="lg:col-span-2 xl:col-span-3 rounded-2xl border border-border/40 bg-white p-4 lg:p-6 xl:p-8 shadow-sm space-y-4 lg:space-y-5">

                    {/* ── All fields on a consistent 2-column grid ── */}
                    <div className="grid grid-cols-2 gap-4">

                        {/* Exchange */}
                        <Field label="Exchange">
                            <select
                                value={form.exchange}
                                onChange={(e) => {
                                    setSymbolSearch("");
                                    setForm({
                                        ...form,
                                        exchange: e.target.value as Exchange,
                                        symbol: null,
                                        expiry: null,
                                        strike: 0,
                                    });
                                }}
                                className={selectCls}
                            >
                                {exchanges.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </Field>

                        {/* Product */}
                        <Field label="Product">
                            <select
                                value={form.product}
                                onChange={(e) => setForm({ ...form, product: e.target.value as Product, strike: 0 })}
                                className={selectCls}
                            >
                                {products.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </Field>

                        {/* Symbol — spans both columns */}
                        <div className="col-span-2">
                            <Field label="Symbol">
                                <div className="relative">
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        value={symbolSearch}
                                        placeholder="Search e.g. NIFTY, BANKNIFTY"
                                        onChange={(e) => {
                                            setSymbolSearch(e.target.value);
                                            setShowDropdown(true);
                                            if (form.symbol) {
                                                setForm({ ...form, symbol: null, expiry: null, strike: 0 });
                                            }
                                        }}
                                        onFocus={() => setShowDropdown(true)}
                                        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                                        className={inputCls}
                                    />
                                    {showDropdown && filteredSymbols.length > 0 && (
                                        <ul className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-border/40 bg-white shadow-xl text-sm">
                                            {filteredSymbols.map((s) => (
                                                <li
                                                    key={s.symbol}
                                                    onMouseDown={() => {
                                                        setSymbolSearch(s.symbol);
                                                        setShowDropdown(false);
                                                        setForm({
                                                            ...form,
                                                            symbol: s.symbol,
                                                            expiry: null,
                                                            strike: 0,
                                                            qty: Number(s.lot_size) || 0,
                                                        });
                                                    }}
                                                    className="px-3 py-2.5 hover:bg-gray-50 cursor-pointer border-b last:border-0 flex justify-between items-center"
                                                >
                                                    <span className="font-medium">{s.symbol}</span>
                                                    <span className="text-gray-400 text-xs">Lot: {s.lot_size}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </Field>
                        </div>

                        {/* Expiry — spans both columns */}
                        {form.symbol && (
                            <div className="col-span-2">
                                <Field label="Expiry">
                                    <select
                                        value={form.expiry ?? ""}
                                        onChange={(e) => setForm({ ...form, expiry: e.target.value || null, strike: 0 })}
                                        className={selectCls}
                                    >
                                        <option value="" disabled>-- Select Expiry --</option>
                                        {expiries.map((e) => (
                                            <option key={e} value={e}>
                                                {new Date(e).toLocaleDateString("en-IN", {
                                                    day: "2-digit", month: "short", year: "numeric"
                                                })}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                            </div>
                        )}

                        {/* Strike + Option Type — each takes one column */}
                        {form.product === "Options" && form.expiry && (
                            <>
                                <Field label="Strike Price">
                                    <select
                                        value={form.strike || ""}
                                        onChange={(e) => setForm({ ...form, strike: Number(e.target.value) })}
                                        className={selectCls}
                                    >
                                        <option value="" disabled>-- Select Strike --</option>
                                        {strikes.map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </Field>

                                <Field label="Option Type">
                                    <select
                                        value={form.optionType}
                                        onChange={(e) => setForm({ ...form, optionType: e.target.value as OptionType })}
                                        className={selectCls}
                                    >
                                        {optionTypes.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                </Field>
                            </>
                        )}

                        {/* Net Quantity — spans both columns */}
                        <div className="col-span-2">
                            <Field label={`Net Quantity${currentLotSize ? ` (Lot size: ${currentLotSize})` : ""}`}>
                                <input
                                    type="number"
                                    value={form.qty ?? 0}
                                    onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
                                    className={inputCls}
                                />
                            </Field>
                        </div>

                        {/* Buy / Sell — spans both columns */}
                        <div className="col-span-2 flex gap-6">
                            <Radio label="Buy"  checked={form.trade_type === "Buy"}  onChange={() => setForm({ ...form, trade_type: "Buy" })} />
                            <Radio label="Sell" checked={form.trade_type === "Sell"} onChange={() => setForm({ ...form, trade_type: "Sell" })} />
                        </div>

                    </div>

                    {/* ── Error ── */}
                    {error && (
                        <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
                            {error}
                        </div>
                    )}

                    {/* ── Actions ── */}
                    <div className="flex flex-wrap gap-3 pt-2 lg:pt-4">
                        <button
                            onClick={async () => {
                                isSubmitting.current = true;
                                await handleAdd();
                                isSubmitting.current = false;
                            }}
                            disabled={loading}
                            className="rounded-lg bg-arihant-violet px-6 py-2.5 lg:px-8 lg:py-3 text-white text-sm lg:text-base font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2"
                        >
                            {loading && (
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                                </svg>
                            )}
                            {loading ? "Calculating…" : "Add Position"}
                        </button>
                        <button
                            onClick={() => { resetForm(); resetBasket(); setSymbolSearch(""); }}
                            className="rounded-lg border border-border/40 px-6 py-2.5 lg:px-8 lg:py-3 text-sm lg:text-base font-medium hover:bg-gray-50 transition-colors"
                        >
                            Reset
                        </button>
                    </div>
                </div>

                {/* ── SUMMARY CARD ── */}
                <div className="lg:col-span-1 rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden h-fit">
                    <div className="bg-arihant-violet px-4 py-3 lg:px-5 lg:py-4 text-white text-xs font-bold uppercase tracking-widest">
                        Margin Summary
                    </div>
                    <div className="p-4 lg:p-5 xl:p-6 space-y-3">
                        <SummaryRow label="Net Premium"     value={summary.netPremium} />
                        <SummaryRow label="Span Margin"     value={Math.max(0, summary.span)} />
                        <SummaryRow label="Exposure Margin" value={Math.max(0, summary.exposure)} />

                        <div className="pt-3 border-t flex justify-between items-center">
                            <span className="text-sm font-bold text-gray-900">Total (Without Benefit)</span>
                            <span className="text-sm font-semibold tabular-nums">{formatCurrency(summary.total)}</span>
                        </div>

                        {/* ── Margin Benefit ── */}
                        {basket.length >= 2 && (
                            <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2 space-y-1">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-600">Combined Span</span>
                                    <span className="tabular-nums">
                                        {combinedMargin.isCalculating
                                            ? <span className="inline-block w-16 h-4 bg-green-200 rounded animate-pulse"/>
                                            : formatCurrency(combinedMargin.span)
                                        }
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-600">Combined Exposure</span>
                                    <span className="tabular-nums">
                                        {combinedMargin.isCalculating
                                            ? <span className="inline-block w-16 h-4 bg-green-200 rounded animate-pulse"/>
                                            : formatCurrency(combinedMargin.exposure)
                                        }
                                    </span>
                                </div>
                                {hasBenefit && (
                                    <div className="flex justify-between items-center text-sm font-semibold text-green-700 pt-1 border-t border-green-200">
                                        <span>Margin Benefit</span>
                                        <span className="tabular-nums">
                                            {combinedMargin.isCalculating
                                                ? <span className="inline-block w-16 h-4 bg-green-200 rounded animate-pulse"/>
                                                : `- ${formatCurrency(combinedMargin.benefit)}`
                                            }
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="pt-2 border-t flex justify-between items-center">
                            <span className="text-sm font-bold text-gray-900">Total Required</span>
                            <span className="text-base font-black text-arihant-violet">
                                {combinedMargin.isCalculating
                                    ? <span className="inline-block w-20 h-5 bg-gray-200 rounded animate-pulse"/>
                                    : formatCurrency(
                                        basket.length >= 2
                                            ? combinedMargin.total + summary.netPremium
                                            : summary.total
                                    )
                                }
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── BASKET TABLE ── */}
            {basket.length > 0 && (
                <div className="mt-4 lg:mt-6 rounded-2xl border border-border/40 bg-white shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-border/40">
                                <tr>
                                    {["Contract", "Product", "Trade Type", "Option Type", "Strike", "Qty", "Initial Margin", "Exposure", "Total", ""].map(h => (
                                        <th key={h} className="px-3 py-3 lg:px-4 lg:py-3.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20">
                                {basket.map((row) => (
                                    <tr key={row.id} className={`transition-colors ${row.isCalculating ? "opacity-60" : "hover:bg-gray-50"}`}>
                                        <td className="px-3 py-3 lg:px-4 font-semibold text-gray-900 whitespace-nowrap">{row.contract}</td>
                                        <td className="px-3 py-3 lg:px-4 text-gray-500 whitespace-nowrap">{row.product}</td>
                                        <td className={`px-3 py-3 lg:px-4 font-bold whitespace-nowrap ${row.trade_type === "Buy" ? "text-green-600" : "text-red-500"}`}>
                                            {row.trade_type}
                                        </td>
                                        <td className="px-3 py-3 lg:px-4 text-gray-500 whitespace-nowrap">
                                            {row.product === "Futures" ? "—" : row.optionType}
                                        </td>
                                        <td className="px-3 py-3 lg:px-4 text-gray-600 whitespace-nowrap">
                                            {!row.strike || row.strike <= 0 ? "—" : row.strike}
                                        </td>
                                        <td className="px-3 py-3 lg:px-4 tabular-nums whitespace-nowrap">{row.qty}</td>
                                        <td className="px-3 py-3 lg:px-4 tabular-nums whitespace-nowrap">
                                            {row.isCalculating
                                                ? <span className="inline-block w-16 h-4 bg-gray-200 rounded animate-pulse"/>
                                                : formatCurrency(Math.max(0, row.initialMargin))
                                            }
                                        </td>
                                        <td className="px-3 py-3 lg:px-4 tabular-nums whitespace-nowrap">
                                            {row.isCalculating
                                                ? <span className="inline-block w-16 h-4 bg-gray-200 rounded animate-pulse"/>
                                                : formatCurrency(row.exposure)
                                            }
                                        </td>
                                        <td className="px-3 py-3 lg:px-4 tabular-nums whitespace-nowrap font-semibold">
                                            {row.isCalculating
                                                ? <span className="inline-block w-16 h-4 bg-gray-200 rounded animate-pulse"/>
                                                : formatCurrency(row.total)
                                            }
                                        </td>
                                        <td className="px-3 py-3 lg:px-4">
                                            <button
                                                onClick={() => removeItem(row.id)}
                                                disabled={row.isCalculating}
                                                className="text-gray-300 hover:text-red-500 transition-colors disabled:cursor-not-allowed"
                                            >
                                                <DeleteOutlineIcon fontSize="small"/>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-gray-50 font-bold border-t-2 border-border/40">
                                    <td className="px-3 py-3 lg:px-4" colSpan={6}>Total</td>
                                    <td className="px-3 py-3 lg:px-4 tabular-nums">{formatCurrency(Math.max(0, summary.span))}</td>
                                    <td className="px-3 py-3 lg:px-4 tabular-nums">{formatCurrency(Math.max(0, summary.exposure))}</td>
                                    <td className="px-3 py-3 lg:px-4 tabular-nums">{formatCurrency(summary.total)}</td>
                                    <td />
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </section>
    );
}

/* ================= SHARED STYLES ================= */
const inputCls  = "mt-1 w-full rounded-lg border-2 border-gray-300 px-3 py-2 lg:px-4 lg:py-2.5 text-sm lg:text-base focus:outline-none focus:border-arihant-violet focus:ring-1 focus:ring-arihant-violet transition-colors";
const selectCls = "mt-1 w-full rounded-lg border-2 border-gray-300 px-3 py-2 lg:px-4 lg:py-2.5 text-sm lg:text-base bg-white focus:outline-none focus:border-arihant-violet focus:ring-1 focus:ring-arihant-violet transition-colors";

/* ================= UI HELPERS ================= */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
            {children}
        </div>
    );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(value)}</span>
        </div>
    );
}

function Radio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
    return (
        <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={checked} onChange={onChange} className="accent-arihant-violet w-4 h-4"/>
            <span className={`text-sm lg:text-base font-medium transition-colors ${checked ? "text-arihant-violet" : "text-gray-500"}`}>
                {label}
            </span>
        </label>
    );
}