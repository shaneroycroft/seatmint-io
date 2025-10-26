import { Blockfrost, Lucid } from '@spacebudz/lucid';
import dotenv from 'dotenv';

dotenv.config();

console.log('Loaded BLOCKFROST_API_KEY:', process.env.BLOCKFROST_API_KEY);
const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
if (!blockfrostApiKey) {
  throw new Error('Missing Blockfrost API Key in .env');
}

const lucid = new Lucid({
  provider: new Blockfrost(
    'https://cardano-preprod.blockfrost.io/api/v0',
    blockfrostApiKey
  ),
});

export default lucid;