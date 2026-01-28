/**
 * Debug script to decode and verify the SaleDatum structure
 * Run with: npx ts-node src/scripts/debugDatum.ts
 */

import { Data, Constr } from '@lucid-evolution/lucid';

// The raw datum hex from the debug output
const saleDatumHex = 'd8799fd8799fd8799f581ca1da2df263622af3c219be585b814b65209732598155dab103468c67ffd87a80ff1a02faf080581cc1f3fa6b02b81cecbdd1b9431b7dedfd65221f10f2c73724c35d93abd87a80d8799fd8799f040800ffffd87a80d8799f1a02faf080ffff';

// The settings datum hex
const settingsDatumHex = 'd8799f18fad8799fd8799f581ca1da2df263622af3c219be585b814b65209732598155dab103468c67ffd87a80ffd87a8019271019012c581ca1da2df263622af3c219be585b814b65209732598155dab103468c67ff';

console.log('=== DECODING SALE DATUM ===\n');

try {
  const saleDatum = Data.from(saleDatumHex);
  console.log('Decoded sale datum:', JSON.stringify(saleDatum, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2));

  if (saleDatum instanceof Constr) {
    console.log('\nSaleDatum has', saleDatum.fields.length, 'fields');

    // Field 0: organizer_address
    const orgAddr = saleDatum.fields[0];
    console.log('\n1. organizer_address:');
    if (orgAddr instanceof Constr) {
      console.log('   Type: Address (Constr', orgAddr.index, ')');
      const paymentCred = orgAddr.fields[0];
      const stakeCred = orgAddr.fields[1];
      if (paymentCred instanceof Constr) {
        console.log('   payment_credential: Constr', paymentCred.index, '=',
          paymentCred.index === 0 ? 'VerificationKey' : 'Script');
        console.log('   PKH:', paymentCred.fields[0]);
      }
      if (stakeCred instanceof Constr) {
        console.log('   stake_credential: Constr', stakeCred.index, '=',
          stakeCred.index === 1 ? 'None' : 'Some');
      }
    }

    // Field 1: base_price
    console.log('\n2. base_price:', saleDatum.fields[1]?.toString());

    // Field 2: event_policy
    console.log('\n3. event_policy:', saleDatum.fields[2]);

    // Field 3: sale_window
    const saleWindow = saleDatum.fields[3];
    if (saleWindow instanceof Constr) {
      console.log('\n4. sale_window: Constr', saleWindow.index, '=',
        saleWindow.index === 1 ? 'None' : 'Some');
    }

    // Field 4: anti_scalping_rules
    const antiScalping = saleDatum.fields[4];
    console.log('\n5. anti_scalping_rules:');
    if (antiScalping instanceof Constr) {
      console.log('   Constr', antiScalping.index, '=',
        antiScalping.index === 1 ? 'None' : 'Some');
      if (antiScalping.index === 0 && antiScalping.fields[0] instanceof Constr) {
        const rules = antiScalping.fields[0] as Constr<any>;
        console.log('   max_per_transaction:', rules.fields[0]?.toString());
        console.log('   max_per_wallet:', rules.fields[1]?.toString());
        console.log('   cooldown_period:', rules.fields[2]?.toString());
      }
    }

    // Field 5: whitelist
    const whitelist = saleDatum.fields[5];
    if (whitelist instanceof Constr) {
      console.log('\n6. whitelist: Constr', whitelist.index, '=',
        whitelist.index === 1 ? 'None' : 'Some');
    }

    // Field 6: pricing_strategy
    const pricing = saleDatum.fields[6];
    console.log('\n7. pricing_strategy:');
    if (pricing instanceof Constr) {
      console.log('   Constr', pricing.index, '=',
        pricing.index === 0 ? 'FixedPrice' : 'Other');
      console.log('   price:', pricing.fields[0]?.toString());
    }
  }
} catch (e) {
  console.error('Failed to decode sale datum:', e);
}

console.log('\n\n=== DECODING SETTINGS DATUM ===\n');

try {
  const settingsDatum = Data.from(settingsDatumHex);
  console.log('Decoded settings datum:', JSON.stringify(settingsDatum, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2));

  if (settingsDatum instanceof Constr) {
    console.log('\nGlobalSettings has', settingsDatum.fields.length, 'fields');

    // According to types.ak:
    // platform_fee_bps: Int
    // platform_treasury: Address
    // is_market_active: Bool
    // current_max_supply: Int
    // max_resale_multiplier: Int
    // admin_pkh: VerificationKeyHash

    console.log('\n1. platform_fee_bps:', settingsDatum.fields[0]?.toString());

    const treasury = settingsDatum.fields[1];
    console.log('\n2. platform_treasury:');
    if (treasury instanceof Constr) {
      const paymentCred = treasury.fields[0];
      if (paymentCred instanceof Constr) {
        console.log('   PKH:', paymentCred.fields[0]);
      }
    }

    const isActive = settingsDatum.fields[2];
    console.log('\n3. is_market_active:');
    if (isActive instanceof Constr) {
      console.log('   Constr', isActive.index, '=', isActive.index === 1 ? 'True' : 'False');
    }

    console.log('\n4. current_max_supply:', settingsDatum.fields[3]?.toString());
    console.log('\n5. max_resale_multiplier:', settingsDatum.fields[4]?.toString());
    console.log('\n6. admin_pkh:', settingsDatum.fields[5]);
  }
} catch (e) {
  console.error('Failed to decode settings datum:', e);
}

console.log('\n=== EXPECTED AIKEN TYPES ===');
console.log(`
SaleDatum {
  organizer_address: Address,      // Constr(0, [payment_cred, stake_cred])
  base_price: Int,                 // Integer
  event_policy: PolicyId,          // ByteArray (28 bytes)
  sale_window: Option<TimeWindow>, // Constr(1, []) for None
  anti_scalping_rules: Option<AntiScalpingRules>, // Constr(0, [rules]) for Some
  whitelist: Option<Whitelist>,    // Constr(1, []) for None
  pricing_strategy: PricingStrategy, // Constr(0, [price]) for FixedPrice
}

GlobalSettings {
  platform_fee_bps: Int,           // Integer (250 = 2.5%)
  platform_treasury: Address,      // Constr(0, [payment_cred, stake_cred])
  is_market_active: Bool,          // Constr(1, []) for True, Constr(0, []) for False
  current_max_supply: Int,         // Integer
  max_resale_multiplier: Int,      // Integer (300 = 3x)
  admin_pkh: VerificationKeyHash,  // ByteArray (28 bytes)
}
`);
