import lucid from '../blockchain/lucid.js';

async function testLucid() {
  try {
    const address = 'addr_test1qrqqad9uw3q7p39hkwuwfyj23zyn0z8ajxa6rlgj87yh3ugfflurewt7mqa53een7rn6sygyswuta5lau44ca6sf24ts8wvqn8'; // Replace with your actual Lace Preprod address
    console.log('Testing address:', address);

    // Test UTXO retrieval to verify Lucid and Blockfrost connection
    const utxos = await lucid.utxosAt(address);
    console.log('UTXOs:', utxos);

    // Optional: Basic address validation (string check)
    if (typeof address === 'string' && address.startsWith('addr_test1')) {
      console.log('Address format appears valid for Preprod.');
    } else {
      console.warn('Address may not be a valid Preprod test address.');
    }
  } catch (error) {
    console.error('Error testing Lucid:', error.message);
  }
}

testLucid();