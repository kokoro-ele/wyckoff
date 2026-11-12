export type SubscriptionProductId = "byok_monthly" | "byok_lifetime";

export interface SubscriptionProduct {
  id: SubscriptionProductId;
  name: string;
  mode: "subscription" | "payment";
  amount: number;
  currency: "USD";
  entitlement: "byok";
  priceEnv?: string;
}

export const subscriptionProducts: SubscriptionProduct[] = [
  {
    id: "byok_monthly",
    name: "BYOK Monthly",
    mode: "subscription",
    amount: 300,
    currency: "USD",
    entitlement: "byok",
    priceEnv: "STRIPE_PRICE_BYOK_MONTHLY",
  },
  {
    id: "byok_lifetime",
    name: "BYOK Lifetime",
    mode: "payment",
    amount: 2000,
    currency: "USD",
    entitlement: "byok",
  },
];

export function findSubscriptionProduct(id: string): SubscriptionProduct | undefined {
  return subscriptionProducts.find((product) => product.id === id);
}

export function subscriptionCatalog(env: NodeJS.ProcessEnv = process.env) {
  const base = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
  return subscriptionProducts.map((product) => ({
    id: product.id,
    name: product.name,
    mode: product.mode,
    amount: product.amount,
    currency: product.currency,
    available: Boolean(
      base && (product.mode === "payment" || Boolean(product.priceEnv && env[product.priceEnv])),
    ),
  }));
}

export function priceIdFor(product: SubscriptionProduct, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return product.priceEnv ? env[product.priceEnv]?.trim() || undefined : undefined;
}
