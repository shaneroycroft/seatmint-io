// Import your plutus.json file
import plutusJson from '../plutus.json';

/**
 * Seatmint Plutus Script Utilities
 * Integrates compiled Aiken validators with Lucid Evolution
 */

export interface PlutusValidator {
  title: string;
  compiledCode: string;
  hash: string;
  parameters?: any[];
}

// Extract validators from plutus.json
const validators = plutusJson.validators;

/**
 * Get validator by title
 */
function getValidator(title: string): PlutusValidator | undefined {
  return validators.find(v => v.title.includes(title));
}

/**
 * EVENT MINTING VALIDATOR
 * Mints event/ticket NFTs
 */
export const EVENT_MINT_VALIDATOR = getValidator('event_mint.seatmint_event.mint');

/**
 * PRIMARY SALE VALIDATOR
 * Handles initial ticket sales from organizer to buyer
 */
export const PRIMARY_SALE_VALIDATOR = getValidator('primary_sale.primary_sale.spend');

/**
 * SETTINGS VALIDATOR
 * Manages global platform configuration
 */
export const SETTINGS_VALIDATOR = getValidator('settings.settings.spend');

/**
 * STOREFRONT VALIDATOR
 * Handles secondary market ticket resales
 */
export const STOREFRONT_VALIDATOR = getValidator('storefront.storefront.spend');

/**
 * Get script address from validator hash
 * @param scriptHash - The validator hash from plutus.json
 * @param network - 'Preview' | 'Preprod' | 'Mainnet'
 */
export function getScriptAddress(scriptHash: string, network: string): string {
  // Script addresses start with different prefixes based on network
  const prefix = network === 'Mainnet' ? 'addr' : 'addr_test';
  
  // In production, you'd use Lucid's utils to properly encode this
  // For now, this is a placeholder that returns the hash with proper prefix
  return `${prefix}1${scriptHash}`;
}

/**
 * REDEEMER TYPES
 * These match your Aiken type definitions
 */

// MintAction redeemer
export const MintRedeemer = {
  Mint: { constructor: 0, fields: [] },
  Burn: { constructor: 1, fields: [] },
};

// StorefrontAction redeemer
export const StorefrontRedeemer = {
  Buy: { constructor: 0, fields: [] },
  Cancel: { constructor: 1, fields: [] },
};

/**
 * DATUM BUILDERS
 * Helper functions to construct properly formatted datums
 */

/**
 * Build TicketDatum for storefront listings
 */
export function buildTicketDatum(
  priceLovelace: bigint,
  sellerAddress: string,
  artistAddress: string,
  royaltyRate: number,
  originalMintPriceLovelace: bigint
) {
  return {
    constructor: 0,
    fields: [
      { int: priceLovelace },
      { bytes: sellerAddress },
      { bytes: artistAddress },
      { int: royaltyRate },
      { int: originalMintPriceLovelace },
    ],
  };
}

/**
 * Build GlobalSettings datum
 */
export function buildGlobalSettings(
  platformFeePercent: number,
  platformTreasury: string,
  currentMaxSupply: number,
  maxResaleMultiplier: number,
  isMarketActive: boolean,
  adminPkh: string
) {
  return {
    constructor: 0,
    fields: [
      { int: platformFeePercent },
      { bytes: platformTreasury },
      { int: currentMaxSupply },
      { int: maxResaleMultiplier },
      { constructor: isMarketActive ? 1 : 0, fields: [] }, // Bool
      { bytes: adminPkh },
    ],
  };
}

/**
 * Get all validator addresses for the current network
 */
export function getValidatorAddresses(network: string) {
  return {
    eventMint: EVENT_MINT_VALIDATOR ? getScriptAddress(EVENT_MINT_VALIDATOR.hash, network) : null,
    primarySale: PRIMARY_SALE_VALIDATOR ? getScriptAddress(PRIMARY_SALE_VALIDATOR.hash, network) : null,
    settings: SETTINGS_VALIDATOR ? getScriptAddress(SETTINGS_VALIDATOR.hash, network) : null,
    storefront: STOREFRONT_VALIDATOR ? getScriptAddress(STOREFRONT_VALIDATOR.hash, network) : null,
  };
}

/**
 * Validator info summary
 */
export function getValidatorInfo() {
  return {
    eventMint: {
      hash: EVENT_MINT_VALIDATOR?.hash,
      title: EVENT_MINT_VALIDATOR?.title,
      purpose: 'Mints event/ticket NFTs',
    },
    primarySale: {
      hash: PRIMARY_SALE_VALIDATOR?.hash,
      title: PRIMARY_SALE_VALIDATOR?.title,
      purpose: 'Initial ticket sales',
    },
    settings: {
      hash: SETTINGS_VALIDATOR?.hash,
      title: SETTINGS_VALIDATOR?.title,
      purpose: 'Platform configuration',
    },
    storefront: {
      hash: STOREFRONT_VALIDATOR?.hash,
      title: STOREFRONT_VALIDATOR?.title,
      purpose: 'Secondary market resales',
    },
  };
}

// Export validator hashes for easy access
export const VALIDATOR_HASHES = {
  EVENT_MINT: EVENT_MINT_VALIDATOR?.hash || '',
  PRIMARY_SALE: PRIMARY_SALE_VALIDATOR?.hash || '',
  SETTINGS: SETTINGS_VALIDATOR?.hash || '',
  STOREFRONT: STOREFRONT_VALIDATOR?.hash || '',
};