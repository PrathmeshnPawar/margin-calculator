import { Exchange } from "@/app/tools/margin/fno/fnoLogic";

export const calculateFnOMargin = (
  price: number,
  qty: number,
  exchange: Exchange,
): number => {
  const baseMargin = price * qty;
  const multiplier = exchange === "MCX" ? 0.15 : 0.1;

  return baseMargin * multiplier;
};

export const calculateLots = (cash?: number, marginPerLot?: number): number => {
  if (!Number.isFinite(cash) || !Number.isFinite(marginPerLot)) return 0;
  if (marginPerLot! <= 0) return 0;

  return Math.floor(cash! / marginPerLot!);
};
