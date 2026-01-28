/**
 * Test script to verify SaleDatum and SaleRedeemer can be properly decoded
 *
 * Run with: npx ts-node src/scripts/testDatumDecoding.ts
 */

import { Data, Constr } from '@lucid-evolution/lucid';

// Schema definitions matching what we use in ticketService.ts
const CredentialSchema = Data.Enum([
  Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
  Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
]);

const StakeCredentialSchema = Data.Enum([
  Data.Object({ Inline: Data.Tuple([CredentialSchema]) }),
  Data.Object({
    Pointer: Data.Object({
      slot_number: Data.Integer(),
      transaction_index: Data.Integer(),
      certificate_index: Data.Integer(),
    }),
  }),
]);

const AddressSchema = Data.Object({
  payment_credential: CredentialSchema,
  stake_credential: Data.Nullable(StakeCredentialSchema),
});

const TimeWindowSchema = Data.Object({
  start_time: Data.Integer(),
  end_time: Data.Integer(),
});

const AntiScalpingRulesSchema = Data.Object({
  max_per_transaction: Data.Integer(),
  max_per_wallet: Data.Integer(),
  cooldown_period: Data.Integer(),
});

const WhitelistSchema = Data.Object({
  approved_addresses: Data.Array(Data.Bytes()),
});

// PricingStrategy is an enum with only FixedPrice variant
const PricingStrategySchema = Data.Enum([
  Data.Object({ FixedPrice: Data.Object({ price: Data.Integer() }) }),
]);

// Full SaleDatum schema
const SaleDatumSchema = Data.Object({
  organizer_address: AddressSchema,
  base_price: Data.Integer(),
  event_policy: Data.Bytes(),
  sale_window: Data.Nullable(TimeWindowSchema),
  anti_scalping_rules: Data.Nullable(AntiScalpingRulesSchema),
  whitelist: Data.Nullable(WhitelistSchema),
  pricing_strategy: PricingStrategySchema,
});

// SaleRedeemer schema
const SaleRedeemerSchema = Data.Object({
  quantity: Data.Integer(),
  payment_amount: Data.Integer(),
  buyer_pkh: Data.Bytes(),
});

console.log('=== TESTING DATUM ENCODING/DECODING ===\n');

// Test 1: Create a SaleDatum the way we do in createEvent
const testPkh = 'a1da2df263622af3c219be585b814b65209732598155dab103468c67';
const testPolicyId = 'c1f3fa6b02b81cecbdd1b9431b7dedfd65221f10f2c73724c35d93ab';
const testPrice = 50_000_000n; // 50 ADA

// Build using Constr (our current approach)
const pkhToAikenAddress = (pkh: string): Constr<unknown> => {
  const paymentCredential = new Constr(0, [pkh]); // VerificationKey
  const stakeCredential = new Constr(1, []); // None
  return new Constr(0, [paymentCredential, stakeCredential]);
};

const buildOption = (value: unknown) =>
  value !== null ? new Constr(0, [value]) : new Constr(1, []);

// Build SaleDatum as Constr
const saleDatumConstr = new Constr(0, [
  pkhToAikenAddress(testPkh),  // organizer_address
  testPrice,                    // base_price
  testPolicyId,                 // event_policy
  buildOption(null),           // sale_window: None
  buildOption(new Constr(0, [4n, 8n, 0n])), // anti_scalping_rules: Some(rules)
  buildOption(null),           // whitelist: None
  new Constr(0, [testPrice]),  // pricing_strategy: FixedPrice
]);

console.log('1. Built SaleDatum Constr:', JSON.stringify(saleDatumConstr, (_, v) =>
  typeof v === 'bigint' ? v.toString() : v, 2));

// Serialize to CBOR
const saleDatumHex = Data.to(saleDatumConstr as Data);
console.log('2. Serialized to CBOR hex:', saleDatumHex);

// Try to decode back using schema
console.log('\n3. Attempting to decode with SaleDatumSchema...');
try {
  const decoded = Data.from(saleDatumHex, SaleDatumSchema);
  console.log('SUCCESS! Decoded SaleDatum:', JSON.stringify(decoded, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2));
} catch (e) {
  console.error('FAILED to decode with schema:', e);

  // Try raw decode
  console.log('\n4. Raw decode result:');
  const raw = Data.from(saleDatumHex);
  console.log(JSON.stringify(raw, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

// Test SaleRedeemer
console.log('\n\n=== TESTING SALE REDEEMER ===\n');

const buyerPkh = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const saleRedeemerConstr = new Constr(0, [
  1n,           // quantity
  testPrice,    // payment_amount
  buyerPkh,     // buyer_pkh
]);

console.log('1. Built SaleRedeemer Constr:', JSON.stringify(saleRedeemerConstr, (_, v) =>
  typeof v === 'bigint' ? v.toString() : v, 2));

const redeemerHex = Data.to(saleRedeemerConstr as Data);
console.log('2. Serialized to CBOR hex:', redeemerHex);

console.log('\n3. Attempting to decode with SaleRedeemerSchema...');
try {
  const decoded = Data.from(redeemerHex, SaleRedeemerSchema);
  console.log('SUCCESS! Decoded SaleRedeemer:', JSON.stringify(decoded, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2));
} catch (e) {
  console.error('FAILED to decode with schema:', e);

  const raw = Data.from(redeemerHex);
  console.log('\n4. Raw decode result:');
  console.log(JSON.stringify(raw, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

// Now let's decode the actual datum hex from the session
console.log('\n\n=== DECODING ACTUAL DATUM FROM SESSION ===\n');

const actualDatumHex = 'd8799fd8799fd8799f581ca1da2df263622af3c219be585b814b65209732598155dab103468c67ffd87a80ff1a02faf080581cc1f3fa6b02b81cecbdd1b9431b7dedfd65221f10f2c73724c35d93abd87a80d8799fd8799f040800ffffd87a80d8799f1a02faf080ffff';

console.log('Attempting to decode actual sale datum from session...');
try {
  const decoded = Data.from(actualDatumHex, SaleDatumSchema);
  console.log('SUCCESS! Decoded:', JSON.stringify(decoded, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2));
} catch (e) {
  console.error('FAILED:', e);

  console.log('\nRaw decode:');
  const raw = Data.from(actualDatumHex);
  console.log(JSON.stringify(raw, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}
