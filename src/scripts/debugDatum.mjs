/**
 * Debug script to decode CBOR datum manually
 */

// Simple CBOR decoder for Plutus Data
function decodeCBOR(hexString) {
  const bytes = Buffer.from(hexString, 'hex');
  let pos = 0;

  function readByte() {
    return bytes[pos++];
  }

  function readBytes(n) {
    const result = bytes.slice(pos, pos + n);
    pos += n;
    return result;
  }

  function decodeItem() {
    const initial = readByte();
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    switch (majorType) {
      case 0: // Unsigned integer
        return decodeUnsigned(additionalInfo);
      case 1: // Negative integer
        return -1n - decodeUnsigned(additionalInfo);
      case 2: // Byte string
        const byteLen = decodeUnsigned(additionalInfo);
        return readBytes(Number(byteLen)).toString('hex');
      case 3: // Text string
        const textLen = decodeUnsigned(additionalInfo);
        return readBytes(Number(textLen)).toString('utf8');
      case 4: // Array
        return decodeArray(additionalInfo);
      case 5: // Map
        return decodeMap(additionalInfo);
      case 6: // Tag
        const tag = decodeUnsigned(additionalInfo);
        const content = decodeItem();
        // Plutus Constr tags: 121-127 for indices 0-6, 1280+ for higher indices
        if (tag >= 121n && tag <= 127n) {
          return { constr: Number(tag - 121n), fields: content };
        } else if (tag >= 1280n) {
          return { constr: Number(tag - 1280n + 7n), fields: content };
        }
        return { tag: Number(tag), content };
      case 7: // Simple values
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        if (additionalInfo === 31) return 'BREAK'; // break code
        return { simple: additionalInfo };
    }
  }

  function decodeUnsigned(info) {
    if (info < 24) return BigInt(info);
    if (info === 24) return BigInt(readByte());
    if (info === 25) return BigInt(readBytes(2).readUInt16BE(0));
    if (info === 26) return BigInt(readBytes(4).readUInt32BE(0));
    if (info === 27) return readBytes(8).readBigUInt64BE(0);
    return BigInt(info);
  }

  function decodeArray(info) {
    if (info === 31) {
      // Indefinite array
      const items = [];
      while (true) {
        const item = decodeItem();
        if (item === 'BREAK') break;
        items.push(item);
      }
      return items;
    }
    const len = Number(decodeUnsigned(info));
    const items = [];
    for (let i = 0; i < len; i++) {
      items.push(decodeItem());
    }
    return items;
  }

  function decodeMap(info) {
    const len = Number(decodeUnsigned(info));
    const map = {};
    for (let i = 0; i < len; i++) {
      const key = decodeItem();
      const value = decodeItem();
      map[String(key)] = value;
    }
    return map;
  }

  return decodeItem();
}

function formatConstr(data, indent = 0) {
  const pad = '  '.repeat(indent);
  if (data && typeof data === 'object' && 'constr' in data) {
    const lines = [`${pad}Constr(${data.constr}, [`];
    if (Array.isArray(data.fields)) {
      for (const field of data.fields) {
        lines.push(formatConstr(field, indent + 1) + ',');
      }
    }
    lines.push(`${pad}])`);
    return lines.join('\n');
  }
  if (typeof data === 'bigint') {
    return `${pad}${data.toString()}`;
  }
  if (typeof data === 'string') {
    if (data.length === 56) {
      return `${pad}"${data}" (28-byte hash)`;
    }
    return `${pad}"${data}"`;
  }
  return `${pad}${JSON.stringify(data)}`;
}

// The raw datum hex from the debug output (UPDATED with latest)
const saleDatumHex = 'd8799fd8799fd8799f581ca1da2df263622af3c219be585b814b65209732598155dab103468c67ffd87a80ff1a02faf080581cc90f698bf537d76797e2aec82903487f37a563ef885f57f6d3f22f50d87a80d8799fd8799f040800ffffd87a80d8799f1a02faf080ffff';

// The settings datum hex (UPDATED with latest)
const settingsDatumHex = 'd8799f18fad8799fd8799f581ca1da2df263622af3c219be585b814b65209732598155dab103468c67ffd87a80ffd87a8019271019012c581ca1da2df263622af3c219be585b814b65209732598155dab103468c67ff';

console.log('=== DECODING SALE DATUM ===\n');
const saleDatum = decodeCBOR(saleDatumHex);
console.log(formatConstr(saleDatum));

console.log('\n\nSaleDatum field interpretation:');
if (saleDatum.constr === 0 && Array.isArray(saleDatum.fields)) {
  const f = saleDatum.fields;
  console.log('1. organizer_address:', formatConstr(f[0], 1));
  console.log('2. base_price:', f[1]?.toString());
  console.log('3. event_policy:', f[2]);
  console.log('4. sale_window:', formatConstr(f[3], 1));
  console.log('5. anti_scalping_rules:', formatConstr(f[4], 1));
  console.log('6. whitelist:', formatConstr(f[5], 1));
  console.log('7. pricing_strategy:', formatConstr(f[6], 1));
}

console.log('\n\n=== DECODING SETTINGS DATUM ===\n');
const settingsDatum = decodeCBOR(settingsDatumHex);
console.log(formatConstr(settingsDatum));

console.log('\n\nGlobalSettings field interpretation:');
if (settingsDatum.constr === 0 && Array.isArray(settingsDatum.fields)) {
  const f = settingsDatum.fields;
  console.log('1. platform_fee_bps:', f[0]?.toString());
  console.log('2. platform_treasury:', formatConstr(f[1], 1));
  console.log('3. is_market_active:', formatConstr(f[2], 1));
  console.log('4. current_max_supply:', f[3]?.toString());
  console.log('5. max_resale_multiplier:', f[4]?.toString());
  console.log('6. admin_pkh:', f[5]);
}

console.log('\n\n=== KEY OBSERVATIONS ===');
console.log(`
Expected Aiken GlobalSettings order:
1. platform_fee_bps: Int
2. platform_treasury: Address
3. is_market_active: Bool
4. current_max_supply: Int
5. max_resale_multiplier: Int
6. admin_pkh: VerificationKeyHash

Aiken Bool encoding:
- True = Constr(1, [])
- False = Constr(0, [])

Note: In the settings datum above, check if is_market_active is encoded correctly!
`);
