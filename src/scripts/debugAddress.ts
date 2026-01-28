/**
 * Debug script to compare address encoding between TypeScript/Lucid and Aiken
 *
 * Run with: npx ts-node src/scripts/debugAddress.ts
 */

import { Data, Constr, getAddressDetails, credentialToAddress, keyHashToCredential } from '@lucid-evolution/lucid';

// Test PKH - same as used in event creation
const testPkh = 'a1da2df263622af3c219be585b814b65209732598155dab103468c67';

console.log('=== ADDRESS ENCODING DEBUG ===\n');

// 1. Create address using credentialToAddress (what pkhToAddress does)
const credential = keyHashToCredential(testPkh);
console.log('1. Credential from PKH:', JSON.stringify(credential, null, 2));

const address = credentialToAddress('Preprod', credential);
console.log('2. Bech32 address:', address);

// 3. Get address details back
const details = getAddressDetails(address);
console.log('3. Address details:', JSON.stringify(details, null, 2));

// 4. How we encode address in Aiken (pkhToAikenAddress)
const pkhToAikenAddress = (pkh: string): Constr<unknown> => {
  // payment_credential: VerificationKey(pkh) = Constr(0, [pkh])
  const paymentCredential = new Constr(0, [pkh]);
  // stake_credential: None = Constr(1, [])
  const stakeCredential = new Constr(1, []);
  // Address = Constr(0, [payment_credential, stake_credential])
  return new Constr(0, [paymentCredential, stakeCredential]);
};

const aikenAddr = pkhToAikenAddress(testPkh);
console.log('\n4. Aiken Address Constr:', JSON.stringify(aikenAddr, null, 2));

// 5. Serialize to CBOR hex
const aikenAddrHex = Data.to(aikenAddr as Data);
console.log('5. Aiken Address CBOR hex:', aikenAddrHex);

// 6. Now let's see what Cardano actually puts in the output
// The issue: when tx outputs are checked by Plutus, the address is serialized as an Address type
// We need to see if the serialization matches

console.log('\n=== KEY INSIGHT ===');
console.log(`
The validator does: output.address == datum.organizer_address

In Aiken, Address is:
  Address {
    payment_credential: Credential,
    stake_credential: Option<StakeCredential>
  }

Our datum encodes:
  Constr(0, [
    Constr(0, [pkh]),     // payment_credential = VerificationKey(pkh)
    Constr(1, [])         // stake_credential = None
  ])

The question is: when Lucid builds the tx output, how does the address get serialized?

For an enterprise address (no stake key), Cardano encodes it as address type 0x60/0x70.
When Plutus deserializes this, it should become an Address with stake_credential = None.

If our encoded address matches, the comparison should succeed.
`);

// 7. Check if there's any discrepancy
console.log('\n=== VERIFICATION ===');
console.log('Address type:', details.type);
console.log('Has stake credential:', details.stakeCredential !== undefined);
console.log('Payment credential hash:', details.paymentCredential?.hash);
console.log('PKH matches:', details.paymentCredential?.hash === testPkh);
