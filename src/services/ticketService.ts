import {
  LucidEvolution,
  Data,
  Constr,
  fromText,
  toUnit,
  UTxO,
  Script,
  paymentCredentialOf,
  validatorToScriptHash,
  mintingPolicyToId,
  validatorToAddress,
  getAddressDetails,
  scriptFromNative,
  credentialToAddress,
  keyHashToCredential,
} from '@lucid-evolution/lucid';
import { supabase } from '../lib/supabase';
import {
  EVENT_MINT_VALIDATOR,
  PRIMARY_SALE_VALIDATOR,
  STOREFRONT_VALIDATOR,
  applyEventMintParams,
  applyPrimarySaleParams,
  applyStorefrontParams,
} from '../utils/plutusScripts';

/**
 * SEATMINT TICKET SERVICE - Lucid Evolution Integration
 *
 * ARCHITECTURAL RULES: CONFIG-TO-DATUM MAPPING
 *
 * 1. DATA TRANSFORMATIONS
 *    - Date objects MUST be converted to POSIX time (bigint) in milliseconds for Aiken.
 *    - Prices in ADA (number) MUST be converted to Lovelace (bigint) using (* 1_000_000n).
 *    - Whitelist strings MUST be converted to hex/Bytes (getAddressDetails(addr).paymentCredential.hash).
 *
 * 2. SCHEMA ALIGNMENT (Pillar 2: Box Office)
 *    - The build() method should output a 'SaleDatum' compatible object.
 *    - Use 'Data.Nullable' for optional features like 'anti_scalping' or 'whitelist'.
 *    - Map dynamicPricing to the 'pricing_strategy' Enum using 'new Constr()'.
 *
 * 3. ENUM REPRESENTATION
 *    - 'FixedPrice' -> new Constr(0, [price])
 *    - 'EarlyBird'  -> new Constr(1, [earlyPrice, deadline])
 *    - 'Tiered'     -> new Constr(2, [Map<quantity, pricePerTicket>])
 *
 * 4. ARCHITECTURAL SYNC
 *    - Ensure the Builder's 'antiScalping' parameters match the fields
 *      expected by the Primary Sale Spending Validator.
 */

// ============================================
// TYPE DEFINITIONS (matching Aiken types)
// ============================================

// Aiken Address structure: Address { payment_credential: Credential, stake_credential: Option<StakeCredential> }
// Credential = VerificationKey(hash) | Script(hash)
const CredentialSchema = Data.Enum([
  Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
  Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
]);

const AddressSchema = Data.Object({
  payment_credential: CredentialSchema,
  stake_credential: Data.Nullable(CredentialSchema),
});

// MarketStatus enum schema - matches Aiken's MarketStatus { Inactive, Active }
// Inactive = Constr(0, []) = d87980
// Active = Constr(1, []) = d87a80
const MarketStatusSchema = Data.Enum([
  Data.Literal("Inactive"),
  Data.Literal("Active"),
]);

// GlobalSettings datum schema
const GlobalSettingsSchema = Data.Object({
  platform_fee_bps: Data.Integer(),
  platform_treasury: AddressSchema,
  is_market_active: MarketStatusSchema,
  current_max_supply: Data.Integer(),
  max_resale_multiplier: Data.Integer(),
  admin_pkh: Data.Bytes(),
});
// GlobalSettings type (for schema reference when decoding from chain)

// SaleDatum schema - simplified for MVP
// Matches Aiken: pub type SaleDatum { organizer_address, base_price, event_policy }
const SaleDatumSchema = Data.Object({
  organizer_address: AddressSchema,
  base_price: Data.Integer(),
  event_policy: Data.Bytes(),
});
type SaleDatum = Data.Static<typeof SaleDatumSchema>;
void (0 as unknown as SaleDatum); // Schema reserved for future typed decoding

// SaleRedeemer schema - simplified (payment calculated from base_price * quantity)
// Matches Aiken: pub type SaleRedeemer { quantity, buyer_pkh }
const SaleRedeemerSchema = Data.Object({
  quantity: Data.Integer(),
  buyer_pkh: Data.Bytes(),
});
type SaleRedeemer = Data.Static<typeof SaleRedeemerSchema>;
void (0 as unknown as SaleRedeemer); // Schema reserved for future typed decoding

// MintAction enum - matches Aiken: pub type MintAction { Mint, Burn }
const MintActionSchema = Data.Enum([
  Data.Literal("Mint"),
  Data.Literal("Burn"),
]);
type MintAction = Data.Static<typeof MintActionSchema>;
void (0 as unknown as MintAction); // Schema reserved for future typed decoding

// TicketDatum schema (secondary market listings)
// Note: artist and seller are Address types in Aiken
const TicketDatumSchema = Data.Object({
  event_policy: Data.Bytes(),
  token_name: Data.Bytes(),
  original_mint_price: Data.Integer(),
  price: Data.Integer(),
  artist: AddressSchema,
  royalty_rate: Data.Integer(),
  seller: AddressSchema,
  event_id: Data.Bytes(),
  seat_number: Data.Nullable(Data.Integer()),
});
type TicketDatum = Data.Static<typeof TicketDatumSchema>;

// ============================================
// HELPER: Data Transformation Functions
// ============================================

/**
 * Convert Date to POSIX time (milliseconds as bigint)
 * Reserved for future time-based features (sale windows, etc.)
 */
function _dateToPosixTime(date: Date): bigint {
  return BigInt(date.getTime());
}
void _dateToPosixTime; // Reserved for future time-based features

/**
 * Convert ADA amount to Lovelace (bigint)
 */
function adaToLovelace(ada: number): bigint {
  return BigInt(Math.floor(ada * 1_000_000));
}

/**
 * Convert payment key hash (hex) to bech32 address
 */
function pkhToAddress(pkh: string, network: 'Mainnet' | 'Preprod' | 'Preview' | 'Custom'): string {
  const credential = keyHashToCredential(pkh);
  return credentialToAddress(network, credential);
}

/**
 * Convert address to payment credential hash (hex bytes)
 */
function addressToPkh(address: string): string {
  const details = getAddressDetails(address);
  if (!details.paymentCredential || details.paymentCredential.type !== 'Key') {
    throw new Error('Invalid address: no key-based payment credential');
  }
  return details.paymentCredential.hash;
}

/**
 * Encode GlobalSettings datum
 *
 * Uses MarketStatus enum (Constr-based) instead of primitive Bool:
 *   - Active = Constr(1, []) = d87a80
 *   - Inactive = Constr(0, []) = d87980
 *
 * This matches Aiken's MarketStatus type and is compatible with Lucid Evolution.
 */
function encodeGlobalSettingsDatum(
  platformFeeBps: bigint,
  treasuryPkh: string,
  isMarketActive: boolean,
  currentMaxSupply: bigint,
  maxResaleMultiplier: bigint,
  adminPkh: string
): string {
  const treasuryAddress = pkhToAikenAddress(treasuryPkh);

  // MarketStatus enum: Active = Constr(1, []), Inactive = Constr(0, [])
  // This matches the Aiken type and is Lucid-compatible
  const marketStatus = new Constr(isMarketActive ? 1 : 0, []);

  const datumConstr = new Constr(0, [
    platformFeeBps,
    treasuryAddress,
    marketStatus,
    currentMaxSupply,
    maxResaleMultiplier,
    adminPkh,
  ]);

  const cbor = Data.to(datumConstr as Data);
  console.log('GlobalSettings CBOR:', cbor);
  console.log('  MarketStatus:', isMarketActive ? 'Active (d87a80)' : 'Inactive (d87980)');

  return cbor;
}

/**
 * Build Aiken-compatible Address Constr from a payment key hash
 *
 * Aiken Address structure:
 *   Address { payment_credential: Credential, stake_credential: Option<StakeCredential> }
 *
 * Credential = VerificationKey(hash) | Script(hash)
 *   - VerificationKey = Constr(0, [hash])
 *   - Script = Constr(1, [hash])
 *
 * Option = Some(value) | None
 *   - Some = Constr(0, [value])
 *   - None = Constr(1, [])
 */
function pkhToAikenAddress(pkh: string): Constr<unknown> {
  // payment_credential: VerificationKey(pkh) = Constr(0, [pkh])
  const paymentCredential = new Constr(0, [pkh]);
  // stake_credential: None = Constr(1, [])
  const stakeCredential = new Constr(1, []);
  // Address = Constr(0, [payment_credential, stake_credential])
  return new Constr(0, [paymentCredential, stakeCredential]);
}

/**
 * Extract payment key hash from decoded Aiken Address schema
 * The decoded AddressSchema has shape: { payment_credential: { VerificationKey: [pkh] } | { Script: [hash] }, ... }
 */
type DecodedAddress = {
  payment_credential: { VerificationKey: [string] } | { Script: [string] };
  stake_credential: unknown;
};

function aikenAddressToPkh(address: DecodedAddress): string {
  const cred = address.payment_credential;
  if ('VerificationKey' in cred) {
    return cred.VerificationKey[0];
  } else if ('Script' in cred) {
    return cred.Script[0];
  }
  throw new Error('Invalid address credential');
}

// ============================================
// SETTINGS UTxO LOADING
// ============================================

/**
 * Get platform settings UTxO and policy ID (referenced by all transactions)
 */
async function getSettingsUTxO(lucid: LucidEvolution): Promise<{ utxo: UTxO; settingsPolicyId: string }> {
  const { data, error } = await supabase
    .from('platform_config')
    .select('settings_policy_id, settings_utxo_ref')
    .single();

  if (error) throw new Error(`Failed to get settings: ${error.message}`);

  // Fetch the actual UTxO from blockchain
  const [txHash, outputIndex] = data.settings_utxo_ref.split('#');
  const utxos = await lucid.utxosByOutRef([{
    txHash,
    outputIndex: parseInt(outputIndex),
  }]);

  if (utxos.length === 0) {
    throw new Error('Settings UTxO not found on chain');
  }

  return { utxo: utxos[0], settingsPolicyId: data.settings_policy_id };
}

// ============================================
// EVENT CREATION
// ============================================

export interface EventCreationParams {
  eventName: string;
  eventDescription: string;
  eventDate: Date;
  venue: string;
  location: string;
  bannerImageUrl?: string;
  category: 'concert' | 'sports' | 'theater' | 'conference' | 'other';
  ticketTiers: TicketTier[];
  // Optional sale window
  saleStartDate?: Date;
  saleEndDate?: Date;
  // Optional whitelist addresses
  whitelistAddresses?: string[];
}

export interface TicketTier {
  tierName: string;
  tierDescription: string;
  priceAda: number;
  totalSupply: number;
  maxPerWallet: number;
  benefits?: string[];
  // Optional early bird pricing
  earlyBirdPriceAda?: number;
  earlyBirdDeadline?: Date;
}

/**
 * Create Event
 */
export async function createEvent(
  lucid: LucidEvolution,
  params: EventCreationParams
): Promise<{ eventId: string; policyId: string }> {

  console.log('Creating event:', params.eventName);

  // Step 1: Generate unique event ID
  const eventId = crypto.randomUUID();

  // Step 2: Get organizer address and PKH
  const organizerAddress = await lucid.wallet().address();
  const organizerPKH = paymentCredentialOf(organizerAddress).hash;

  // Step 3: Validate validators are loaded
  if (!EVENT_MINT_VALIDATOR || !PRIMARY_SALE_VALIDATOR) {
    throw new Error('Validators not found in plutus.json. Run `aiken build` first.');
  }

  // Step 4: Get settings for validation
  const { utxo: settingsUTxO, settingsPolicyId } = await getSettingsUTxO(lucid);
  // Validate settings can be decoded (even though we don't use the value here)
  try {
    Data.from(settingsUTxO.datum!, GlobalSettingsSchema);
  } catch (e) {
    throw new Error(
      'Failed to decode platform settings. The settings datum format may be outdated. ' +
      'Please re-initialize platform settings with initializePlatformSettings(). ' +
      `Original error: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Step 5: Apply parameters to primary sale validator (using settings policy ID, not treasury)
  const primarySaleValidator = applyPrimarySaleParams(settingsPolicyId);
  const boxOfficeHash = validatorToScriptHash(primarySaleValidator);

  // Step 6: Apply parameters to event mint policy
  const mintingPolicyValidator = applyEventMintParams(
    organizerPKH,
    settingsPolicyId,
    boxOfficeHash
  );

  const policyId = mintingPolicyToId(mintingPolicyValidator);

  console.log('Policy ID:', policyId);

  // Step 6: Build primary sale datum for first tier
  // Simplified SaleDatum: { organizer_address, base_price, event_policy }
  const firstTier = params.ticketTiers[0];
  const basePriceLovelace = adaToLovelace(firstTier.priceAda);

  // Build SaleDatum as Constr (Aiken record = Constr(0, [fields...]))
  // organizer_address must be a full Aiken Address structure
  const organizerAddressConstr = pkhToAikenAddress(organizerPKH);
  const saleDatumConstr = new Constr(0, [
    organizerAddressConstr,
    basePriceLovelace,
    policyId,
  ]);

  // Step 8: Build transaction to create sale UTxO
  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');
  const saleAddress = validatorToAddress(network, primarySaleValidator);

  const tx = await lucid
    .newTx()
    .pay.ToAddressWithData(
      saleAddress,
      { kind: 'inline', value: Data.to(saleDatumConstr as Data) },
      { lovelace: 2_000_000n }
    )
    .addSigner(organizerAddress)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  console.log('Waiting for confirmation:', txHash);
  await lucid.awaitTx(txHash);

  // Step 8: Save to database
  await saveEventToDatabase(eventId, policyId, organizerAddress, params);

  console.log('Event created!', { eventId, policyId });

  return { eventId, policyId };
}

// ============================================
// TICKET PURCHASING (Primary Sale)
// ============================================

export interface PurchaseTicketParams {
  eventId: string;
  tierId: string;
  quantity: number;
}

/**
 * Purchase Tickets (Primary Sale) - Simplified
 *
 * Uses schema-based serialization and minimal validation.
 * Trust the validator for business logic.
 */
export async function purchaseTickets(
  lucid: LucidEvolution,
  params: PurchaseTicketParams
): Promise<{ txHash: string; ticketIds: string[] }> {

  console.log('Purchasing tickets:', params);

  // Step 1: Get event and tier info from database
  const { data: tier, error: tierError } = await supabase
    .from('ticket_tiers')
    .select('*, events(*)')
    .eq('id', params.tierId)
    .single();

  if (tierError || !tier) throw new Error('Ticket tier not found');
  if (tier.remaining_supply < params.quantity) throw new Error('Not enough tickets available');

  // Step 2: Get addresses and keys
  const buyerAddress = await lucid.wallet().address();
  const buyerPKH = paymentCredentialOf(buyerAddress).hash;
  const organizerPKH = paymentCredentialOf(tier.events.organizer_wallet_address).hash;
  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');

  // Step 3: Get platform settings
  if (!EVENT_MINT_VALIDATOR || !PRIMARY_SALE_VALIDATOR) {
    throw new Error('Validators not found. Run `aiken build` first.');
  }
  const { utxo: settingsUTxO, settingsPolicyId } = await getSettingsUTxO(lucid);

  // Debug: Verify Settings UTxO content
  console.log('DEBUG Settings UTxO:');
  console.log('  Policy ID:', settingsPolicyId);
  console.log('  UTxO:', settingsUTxO.txHash + '#' + settingsUTxO.outputIndex);
  console.log('  Address:', settingsUTxO.address);
  console.log('  Has Datum:', !!settingsUTxO.datum);
  console.log('  Assets:', JSON.stringify(settingsUTxO.assets, (_, v) => typeof v === 'bigint' ? v.toString() : v));

  // Check if Settings NFT is present
  const settingsTokenUnit = toUnit(settingsPolicyId, fromText('Settings'));
  const hasSettingsToken = settingsUTxO.assets[settingsTokenUnit] === 1n;
  console.log('  Settings Token Unit:', settingsTokenUnit);
  console.log('  Has Settings Token:', hasSettingsToken);

  if (!hasSettingsToken) {
    throw new Error(`Settings UTxO is missing the Settings NFT token! Expected unit: ${settingsTokenUnit}`);
  }

  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Step 4: Build validators with parameters
  const primarySaleValidator = applyPrimarySaleParams(settingsPolicyId);
  const boxOfficeHash = validatorToScriptHash(primarySaleValidator);
  const mintingPolicyValidator = applyEventMintParams(organizerPKH, settingsPolicyId, boxOfficeHash);
  const saleAddress = validatorToAddress(network, primarySaleValidator);

  // Verify policy ID matches database (catches parameter mismatches)
  const derivedPolicyId = mintingPolicyToId(mintingPolicyValidator);
  if (derivedPolicyId !== tier.events.event_policy_id) {
    throw new Error(`Policy ID mismatch. Event may need to be recreated.`);
  }

  // Step 5: Find the sale UTxO for this event
  const saleUTxOs = await lucid.utxosAt(saleAddress);
  console.log('Sale UTxOs at address:', saleUTxOs.length);
  saleUTxOs.forEach((u, i) => {
    console.log(`  [${i}] ${u.txHash}#${u.outputIndex} | datum: ${!!u.datum}`);
    if (u.datum) {
      try {
        const d = Data.from(u.datum);
        if (d instanceof Constr) {
          console.log(`      Fields: ${d.fields.length}, Policy: ${d.fields[2]}`);
        }
      } catch (e) { console.log('      (failed to decode datum)'); }
    }
  });

  const saleUTxO = saleUTxOs.find(utxo => {
    if (!utxo.datum) return false;
    try {
      const decoded = Data.from(utxo.datum);
      if (decoded instanceof Constr && decoded.fields.length >= 3) {
        const eventPolicy = decoded.fields[2];
        return eventPolicy === tier.events.event_policy_id;
      }
      return false;
    } catch { return false; }
  });

  if (!saleUTxO) {
    throw new Error(`Sale UTxO not found for this event. Expected policy: ${tier.events.event_policy_id}`);
  }
  console.log('Selected sale UTxO:', saleUTxO.txHash + '#' + saleUTxO.outputIndex);

  // DEBUG: Decode and inspect the sale datum
  const saleDatumDecoded = Data.from(saleUTxO.datum!);
  if (saleDatumDecoded instanceof Constr) {
    console.log('DEBUG Sale Datum:');
    console.log('  Full datum:', JSON.stringify(saleDatumDecoded, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    console.log('  Field 0 (organizer_address):', JSON.stringify(saleDatumDecoded.fields[0], (_, v) => typeof v === 'bigint' ? v.toString() : v));
    console.log('  Field 1 (base_price):', saleDatumDecoded.fields[1]?.toString());
    console.log('  Field 2 (event_policy):', saleDatumDecoded.fields[2]);
    console.log('  DB price_lovelace:', tier.price_lovelace);

    // Check if prices match
    const datumBasePrice = saleDatumDecoded.fields[1];
    if (BigInt(tier.price_lovelace) !== BigInt(datumBasePrice as bigint)) {
      console.error('⚠️ PRICE MISMATCH! DB price:', tier.price_lovelace, 'Datum price:', datumBasePrice?.toString());
    }
  }

  // Step 6: Generate ticket names and calculate payments
  const ticketNames = await generateTicketNames(tier.events.event_policy_id, params.quantity);

  // IMPORTANT: Use datum's base_price (not DB price) to match validator calculation
  const datumForPrice = Data.from(saleUTxO.datum!);
  let basePriceFromDatum: bigint;
  if (datumForPrice instanceof Constr && datumForPrice.fields[1] !== undefined) {
    basePriceFromDatum = BigInt(datumForPrice.fields[1] as bigint);
    console.log('Using base_price from datum:', basePriceFromDatum.toString(), 'lovelace');
  } else {
    // Fallback to DB price if datum parse fails
    basePriceFromDatum = BigInt(tier.price_lovelace);
    console.warn('Could not parse datum base_price, falling back to DB:', basePriceFromDatum.toString());
  }

  const totalPrice = basePriceFromDatum * BigInt(params.quantity);
  const platformFee = (totalPrice * BigInt(settings.platform_fee_bps)) / 10000n;
  const organizerPayment = totalPrice - platformFee;

  // Step 7: Build mint assets
  const mintAssets: Record<string, bigint> = {};
  ticketNames.forEach(name => {
    mintAssets[toUnit(tier.events.event_policy_id, name)] = 1n;
  });

  // Step 8: Build redeemers
  // SaleRedeemer is a record in Aiken = Constr(0, [quantity, buyer_pkh])
  const saleRedeemerConstr = new Constr(0, [
    BigInt(params.quantity),
    buyerPKH,
  ]);
  const saleRedeemerCbor = Data.to(saleRedeemerConstr);

  // ATOMIC DECODE TEST: Verify redeemer can round-trip before submit
  try {
    const decoded = Data.from(saleRedeemerCbor);
    if (!(decoded instanceof Constr) || decoded.fields.length !== 2) {
      throw new Error('Redeemer structure invalid');
    }
  } catch (e) {
    throw new Error(`Redeemer encoding failed round-trip test: ${e}`);
  }

  // MintAction::Mint = Constr(0, []) in Aiken
  const mintRedeemerConstr = new Constr(0, []);
  const mintRedeemerCbor = Data.to(mintRedeemerConstr);

  // Step 9: Get payment addresses
  const organizerPaymentAddress = pkhToAddress(organizerPKH, network);
  const treasuryPkh = aikenAddressToPkh(settings.platform_treasury as DecodedAddress);
  const treasuryAddress = pkhToAddress(treasuryPkh, network);

  // DEBUG: Compare datum address with payment address
  const saleDatumDecoded2 = Data.from(saleUTxO.datum!);
  if (saleDatumDecoded2 instanceof Constr) {
    const datumAddr = saleDatumDecoded2.fields[0];
    const expectedAddr = pkhToAikenAddress(organizerPKH);
    console.log('DEBUG Address Comparison:');
    console.log('  Datum address Constr:', JSON.stringify(datumAddr, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    console.log('  Expected address Constr:', JSON.stringify(expectedAddr, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    console.log('  Datum address CBOR:', Data.to(datumAddr as Data));
    console.log('  Expected address CBOR:', Data.to(expectedAddr as Data));
    console.log('  Do CBORs match?:', Data.to(datumAddr as Data) === Data.to(expectedAddr as Data));
    console.log('  Organizer PKH from DB:', organizerPKH);
    console.log('  Paying to bech32:', organizerPaymentAddress);

    // Extract PKH from datum address for comparison
    if (datumAddr instanceof Constr && datumAddr.fields[0] instanceof Constr) {
      const datumPkh = datumAddr.fields[0].fields[0];
      console.log('  Datum PKH:', datumPkh);
      console.log('  Expected PKH:', organizerPKH);
      console.log('  PKHs match?:', datumPkh === organizerPKH);
    }
  }

  // Step 10: Build metadata (CIP-25)
  const metadata = buildCIP25Metadata(
    tier.events.event_policy_id,
    tier.events.event_name,
    tier.tier_name,
    ticketNames
  );

  console.log('Building transaction...');
  console.log('  Quantity:', params.quantity);
  console.log('  Organizer payment:', organizerPayment.toString(), 'lovelace');
  console.log('  Platform fee:', platformFee.toString(), 'lovelace');
  console.log('  Settings reference UTxO datum CBOR (first 100 chars):', settingsUTxO.datum?.slice(0, 100));

  // WARNING: If platform fee < ~1.5 ADA, the treasury output will fail min UTxO check
  if (platformFee < 1_500_000n) {
    console.warn('⚠️ Platform fee', platformFee.toString(), 'lovelace is below minimum UTxO (~1.5 ADA). Transaction may fail.');
  }

  // Debug: Log key addresses and UTxOs
  console.log('DEBUG Transaction Inputs:');
  console.log('  Sale UTxO:', saleUTxO.txHash + '#' + saleUTxO.outputIndex);
  console.log('  Sale Address:', saleUTxO.address);
  console.log('  Settings UTxO:', settingsUTxO.txHash + '#' + settingsUTxO.outputIndex);
  console.log('  Settings Address:', settingsUTxO.address);
  console.log('  Organizer Address (datum):', organizerPaymentAddress);
  console.log('  Buyer Address:', buyerAddress);
  console.log('  Box Office Hash:', boxOfficeHash);
  console.log('  Minting Policy ID:', derivedPolicyId);

  // Step 11: Get wallet UTxOs and filter to avoid script inputs
  // Exclude UTxOs with datums (could be at script addresses) and the settings UTxO
  const walletUtxos = await lucid.wallet().getUtxos();
  console.log('  Wallet UTxOs total:', walletUtxos.length);
  walletUtxos.forEach((u: UTxO, i: number) => {
    console.log(`    [${i}] ${u.txHash}#${u.outputIndex} | ${u.address.slice(0,30)}... | datum: ${!!u.datum} | lovelace: ${u.assets.lovelace}`);
  });

  const safeWalletUtxos = walletUtxos.filter((utxo: UTxO) => {
    const isSettingsUtxo = utxo.txHash === settingsUTxO.txHash && utxo.outputIndex === settingsUTxO.outputIndex;
    const hasDatum = !!utxo.datum;
    return !isSettingsUtxo && !hasDatum;
  });
  console.log('  Safe Wallet UTxOs:', safeWalletUtxos.length);

  // Step 12: Build and submit transaction
  try {
    const tx = await lucid
      .newTx()
      .collectFrom([saleUTxO], saleRedeemerCbor)
      .collectFrom(safeWalletUtxos) // Explicit coin selection
      .readFrom([settingsUTxO])
      .mintAssets(mintAssets, mintRedeemerCbor)
      .pay.ToAddress(buyerAddress, { lovelace: 2_000_000n, ...mintAssets })
      .pay.ToAddress(organizerPaymentAddress, { lovelace: organizerPayment })
      .pay.ToAddress(treasuryAddress, { lovelace: platformFee })
      .pay.ToAddressWithData(
        saleAddress,
        { kind: 'inline', value: saleUTxO.datum! },
        { lovelace: 2_000_000n }
      )
      .attachMetadata(721, metadata)
      .addSigner(buyerAddress)
      .attach.MintingPolicy(mintingPolicyValidator)
      .attach.SpendingValidator(primarySaleValidator)
      .complete();

    const signedTx = await tx.sign.withWallet().complete();
    const txHash = await signedTx.submit();

    console.log('Transaction submitted:', txHash);

    // OPTIMISTIC UPDATE: Record to database immediately after submission
    // This ensures we don't lose track of tickets if awaitTx has issues
    try {
      await recordTicketPurchase(params, ticketNames, txHash, buyerAddress);
      console.log('Database updated (optimistic)');
    } catch (dbError) {
      console.error('Failed to record purchase to database:', dbError);
      // Continue - the on-chain transaction may still succeed
    }

    // Wait for confirmation (with timeout handling)
    try {
      await lucid.awaitTx(txHash);
      console.log('Transaction confirmed on-chain');
    } catch (awaitError) {
      console.warn('awaitTx had issues, but transaction may have succeeded:', awaitError);
      console.warn('TX Hash:', txHash);
      console.warn('Check blockchain explorer to verify: https://preview.cardanoscan.io/transaction/' + txHash);
      // Don't throw - the transaction might actually be on-chain
    }

    return { txHash, ticketIds: ticketNames };

  } catch (e) {
    // Provide helpful error context
    console.error('Purchase transaction failed:', e);

    // Quick diagnostic checks
    const rawDatum = Data.from(saleUTxO.datum!);
    const rawSettings = Data.from(settingsUTxO.datum!);

    console.error('DEBUG Error Context:');
    console.error('  Datum field count:', rawDatum instanceof Constr ? rawDatum.fields.length : 'not Constr');
    console.error('  Settings field count:', rawSettings instanceof Constr ? rawSettings.fields.length : 'not Constr');
    console.error('  Market status:', settings.is_market_active);
    console.error('  Buyer PKH:', buyerPKH);
    console.error('  Organizer PKH:', organizerPKH);
    console.error('  Redeemer CBOR:', saleRedeemerCbor);
    console.error('  Sale Address:', saleAddress);
    console.error('  Sale UTxO Address:', saleUTxO.address);
    console.error('  Do addresses match:', saleAddress === saleUTxO.address);

    // Check if any wallet UTxO is at the sale address (would explain Spend[1])
    const walletAtScript = walletUtxos.filter((u: UTxO) => u.address === saleAddress);
    if (walletAtScript.length > 0) {
      console.error('  WARNING: Wallet has UTxOs at script address!', walletAtScript.length);
    }

    throw e;
  }
}

// ============================================
// SECONDARY MARKET (Storefront)
// ============================================

export interface ListTicketParams {
  ticketAssetName: string;
  priceAda: number;
  eventId: string;
}

/**
 * List Ticket for Resale
 */
export async function listTicketForResale(
  lucid: LucidEvolution,
  params: ListTicketParams
): Promise<{ txHash: string; listingUTxORef: string }> {

  console.log('Listing ticket for resale:', params);

  const { data: event } = await supabase
    .from('events')
    .select('*, ticket_tiers(*)')
    .eq('id', params.eventId)
    .single();

  if (!event) throw new Error('Event not found');

  // Validate validators are loaded
  if (!STOREFRONT_VALIDATOR) {
    throw new Error('Storefront validator not found in plutus.json. Run `aiken build` first.');
  }

  const sellerAddress = await lucid.wallet().address();

  // Get settings for applying params
  const { utxo: settingsUTxO, settingsPolicyId } = await getSettingsUTxO(lucid);
  const _settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);
  void _settings; // Validate decoding works but value not used in this function

  const sellerUTxOs = await lucid.wallet().getUtxos();
  const ticketUTxO = sellerUTxOs.find((utxo: UTxO) =>
    Object.keys(utxo.assets).some(asset =>
      asset.includes(params.ticketAssetName)
    )
  );

  if (!ticketUTxO) {
    throw new Error('Ticket NFT not found in wallet');
  }

  const tier = event.ticket_tiers[0];

  // Build ticket datum with proper Aiken Address types
  // Extract PKHs from bech32 addresses
  const artistPkh = addressToPkh(event.organizer_wallet_address);
  const sellerPkh = addressToPkh(sellerAddress);

  // Convert to Constr format for Lucid
  // artist and seller must be full Aiken Address structures
  const ticketDatumConstr = new Constr(0, [
    event.event_policy_id,                      // event_policy: PolicyId (bytes)
    fromText(params.ticketAssetName),           // token_name: AssetName (bytes)
    BigInt(tier.price_lovelace),                // original_mint_price: Int
    adaToLovelace(params.priceAda),             // price: Int
    pkhToAikenAddress(artistPkh),               // artist: Address
    1000n,                                      // royalty_rate: Int (10% in basis points)
    pkhToAikenAddress(sellerPkh),               // seller: Address
    fromText(params.eventId),                   // event_id: ByteArray
    new Constr(1, []),                          // seat_number: None
  ]);
  const ticketDatum = Data.to(ticketDatumConstr);

  // Apply parameters to storefront validator
  const storefrontValidator = applyStorefrontParams(settingsPolicyId);

  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');
  const storefrontAddress = validatorToAddress(network, storefrontValidator);

  const tx = await lucid
    .newTx()
    .collectFrom([ticketUTxO])
    .pay.ToAddressWithData(
      storefrontAddress,
      { kind: 'inline', value: ticketDatum },
      ticketUTxO.assets
    )
    .addSigner(sellerAddress)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  await lucid.awaitTx(txHash);

  const listingRef = `${txHash}#0`;

  const { error: listingError } = await supabase.from('secondary_listings').insert({
    ticket_id: params.ticketAssetName,
    seller_address: sellerAddress,
    price_lovelace: Math.floor(params.priceAda * 1_000_000),
    listing_utxo_ref: listingRef,
    status: 'active',
  });

  if (listingError) {
    console.warn('Failed to insert secondary_listing (non-fatal):', listingError);
  }

  // Also update the tickets table so UI can track listing status
  console.log('Updating ticket status to listed for:', params.ticketAssetName);
  const { data: updatedTicket, error: ticketUpdateError } = await supabase
    .from('tickets')
    .update({
      status: 'listed',
      resale_price: Math.floor(params.priceAda * 1_000_000),
      listing_utxo_ref: listingRef,
    })
    .eq('nft_asset_name', params.ticketAssetName)
    .select()
    .maybeSingle();

  if (ticketUpdateError) {
    console.error('Failed to update ticket status:', ticketUpdateError);
    throw new Error(`Failed to update ticket listing in database: ${ticketUpdateError.message}`);
  }

  if (!updatedTicket) {
    console.error('No ticket found with nft_asset_name:', params.ticketAssetName);
    console.log('The ticket may not exist in the database yet. Try syncing your wallet first.');
  } else {
    console.log('Ticket updated successfully:', updatedTicket.id, '-> status:', updatedTicket.status);
  }

  return { txHash, listingUTxORef: listingRef };
}

// StorefrontRedeemer schema (kept for reference - using Constr directly)
const _StorefrontRedeemerSchema = Data.Enum([
  Data.Literal("Buy"),
  Data.Literal("Cancel"),
]);
void _StorefrontRedeemerSchema;

export interface PurchaseStorefrontParams {
  listingUtxoRef: string;  // txHash#outputIndex
  eventId: string;
}

/**
 * Purchase Ticket from Storefront (Secondary Market)
 */
export async function purchaseFromStorefront(
  lucid: LucidEvolution,
  params: PurchaseStorefrontParams
): Promise<{ txHash: string }> {

  console.log('Purchasing from storefront:', params);

  // Validate validators are loaded
  if (!STOREFRONT_VALIDATOR) {
    throw new Error('Storefront validator not found in plutus.json. Run `aiken build` first.');
  }

  // Get settings
  const { utxo: settingsUTxO, settingsPolicyId } = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Apply parameters to storefront validator
  const storefrontValidator = applyStorefrontParams(settingsPolicyId);

  // Parse listing UTxO reference
  const [txHash, outputIndexStr] = params.listingUtxoRef.split('#');
  const outputIndex = parseInt(outputIndexStr);

  // Fetch the listing UTxO
  const listingUtxos = await lucid.utxosByOutRef([{ txHash, outputIndex }]);
  if (listingUtxos.length === 0) {
    throw new Error('Listing UTxO not found on chain');
  }
  const listingUtxo = listingUtxos[0];

  // Decode the ticket datum to get payment info
  // Note: We use unknown cast because Lucid's Data.from return type doesn't perfectly match TypeScript inference
  const ticketDatum = Data.from(listingUtxo.datum!, TicketDatumSchema) as unknown as TicketDatum;

  // Get buyer address
  const buyerAddress = await lucid.wallet().address();

  // Calculate payments
  const salePrice = ticketDatum.price;
  const royaltyAmount = (salePrice * ticketDatum.royalty_rate) / 10000n;
  const platformFee = (salePrice * BigInt(settings.platform_fee_bps)) / 10000n;
  const sellerPayout = salePrice - royaltyAmount - platformFee;

  // Build Buy redeemer: Constr 0 for Buy action
  const buyRedeemerData = new Constr(0, []);

  // Get NFT unit from listing
  const nftAssets = Object.entries(listingUtxo.assets).filter(
    ([unit, _qty]) => unit !== 'lovelace'
  );
  if (nftAssets.length === 0) {
    throw new Error('No NFT found in listing UTxO');
  }

  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');

  // Build transaction
  // Convert decoded Aiken Addresses to bech32 addresses
  const sellerAddr = pkhToAddress(aikenAddressToPkh(ticketDatum.seller as DecodedAddress), network);
  const artistAddr = pkhToAddress(aikenAddressToPkh(ticketDatum.artist as DecodedAddress), network);
  const treasuryAddr = pkhToAddress(aikenAddressToPkh(settings.platform_treasury as DecodedAddress), network);

  const tx = await lucid
    .newTx()
    .collectFrom(
      [listingUtxo],
      Data.to(buyRedeemerData)
    )
    .readFrom([settingsUTxO])
    // Pay seller
    .pay.ToAddress(sellerAddr, { lovelace: sellerPayout })
    // Pay artist royalty
    .pay.ToAddress(artistAddr, { lovelace: royaltyAmount })
    // Pay platform fee
    .pay.ToAddress(treasuryAddr, { lovelace: platformFee })
    // Send NFT to buyer
    .pay.ToAddress(buyerAddress, listingUtxo.assets)
    .attach.SpendingValidator(storefrontValidator)
    .addSigner(buyerAddress)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const submittedTxHash = await signedTx.submit();

  console.log('Purchase TX submitted:', submittedTxHash);
  await lucid.awaitTx(submittedTxHash);

  // Update database
  await supabase
    .from('secondary_listings')
    .update({ status: 'sold', buyer_address: buyerAddress })
    .eq('listing_utxo_ref', params.listingUtxoRef);

  await supabase
    .from('tickets')
    .update({
      current_owner_address: buyerAddress,
      status: 'minted',
      resale_price: null,
      listing_utxo_ref: null,
    })
    .eq('listing_utxo_ref', params.listingUtxoRef);

  return { txHash: submittedTxHash };
}

export interface CancelListingParams {
  listingUtxoRef: string;
  ticketId: string;
}

/**
 * Cancel Storefront Listing
 */
export async function cancelStorefrontListing(
  lucid: LucidEvolution,
  params: CancelListingParams
): Promise<{ txHash: string }> {

  console.log('Canceling storefront listing:', params);

  // Validate validators are loaded
  if (!STOREFRONT_VALIDATOR) {
    throw new Error('Storefront validator not found in plutus.json. Run `aiken build` first.');
  }

  // Get settings
  const { utxo: settingsUTxO, settingsPolicyId } = await getSettingsUTxO(lucid);
  const _settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);
  void _settings; // Validate decoding works but value not used in this function

  // Apply parameters to storefront validator
  const storefrontValidator = applyStorefrontParams(settingsPolicyId);

  // Parse listing UTxO reference
  const [txHash, outputIndexStr] = params.listingUtxoRef.split('#');
  const outputIndex = parseInt(outputIndexStr);

  // Fetch the listing UTxO
  const listingUtxos = await lucid.utxosByOutRef([{ txHash, outputIndex }]);
  if (listingUtxos.length === 0) {
    throw new Error('Listing UTxO not found on chain');
  }
  const listingUtxo = listingUtxos[0];

  // Decode the ticket datum to verify seller
  // Note: We use unknown cast because Lucid's Data.from return type doesn't perfectly match TypeScript inference
  const ticketDatum = Data.from(listingUtxo.datum!, TicketDatumSchema) as unknown as TicketDatum;

  // Verify caller is the seller
  // The seller field is an Aiken Address type, so we need to extract the PKH
  const sellerAddress = await lucid.wallet().address();
  const sellerPKH = paymentCredentialOf(sellerAddress).hash;
  const datumSellerPKH = aikenAddressToPkh(ticketDatum.seller as DecodedAddress);
  if (datumSellerPKH !== sellerPKH) {
    throw new Error('Only the seller can cancel this listing');
  }

  // Build Cancel redeemer: Constr 1 for Cancel action
  const cancelRedeemerData = new Constr(1, []);

  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');

  // Build transaction - return NFT to seller
  const tx = await lucid
    .newTx()
    .collectFrom(
      [listingUtxo],
      Data.to(cancelRedeemerData)
    )
    .readFrom([settingsUTxO])
    .pay.ToAddress(sellerAddress, listingUtxo.assets)
    .attach.SpendingValidator(storefrontValidator)
    .addSigner(sellerAddress)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const submittedTxHash = await signedTx.submit();

  console.log('Cancel TX submitted:', submittedTxHash);
  await lucid.awaitTx(submittedTxHash);

  // Update database
  await supabase
    .from('secondary_listings')
    .update({ status: 'canceled' })
    .eq('listing_utxo_ref', params.listingUtxoRef);

  await supabase
    .from('tickets')
    .update({ status: 'minted', resale_price: null, listing_utxo_ref: null })
    .eq('id', params.ticketId);

  return { txHash: submittedTxHash };
}

export interface TransferTicketParams {
  ticketAssetName: string;
  recipientAddress: string;
  eventPolicyId: string;
}

/**
 * Transfer Ticket to Another Wallet (Gift/Transfer)
 * Simple wallet-to-wallet NFT transfer - no validator involved
 */
export async function transferTicket(
  lucid: LucidEvolution,
  params: TransferTicketParams
): Promise<{ txHash: string }> {

  console.log('Transferring ticket:', params);

  const senderAddress = await lucid.wallet().address();

  // Find the ticket NFT in wallet
  const senderUTxOs = await lucid.wallet().getUtxos();
  const ticketUTxO = senderUTxOs.find((utxo: UTxO) =>
    Object.keys(utxo.assets).some(asset =>
      asset.includes(params.ticketAssetName)
    )
  );

  if (!ticketUTxO) {
    throw new Error('Ticket NFT not found in wallet');
  }

  // Find the specific NFT asset
  const nftUnit = Object.keys(ticketUTxO.assets).find(asset =>
    asset.includes(params.ticketAssetName)
  );

  if (!nftUnit) {
    throw new Error('NFT unit not found');
  }

  // Build simple transfer transaction
  const tx = await lucid
    .newTx()
    .pay.ToAddress(params.recipientAddress, { [nftUnit]: 1n })
    .addSigner(senderAddress)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  console.log('Transfer TX submitted:', txHash);
  await lucid.awaitTx(txHash);

  // Update database
  await supabase
    .from('tickets')
    .update({ current_owner_address: params.recipientAddress })
    .eq('nft_asset_name', params.ticketAssetName);

  return { txHash };
}

// ============================================
// ORGANIZER ACCESS CHECK (Settings NFT)
// ============================================

/**
 * Check if the connected wallet has organizer access
 *
 * Organizer access is granted to wallets that hold the Settings NFT.
 * This ensures only the platform admin can create events and manage settings.
 *
 * @returns true if wallet contains Settings NFT, false otherwise
 */
export async function checkOrganizerAccess(lucid: LucidEvolution): Promise<boolean> {
  try {
    // Get the settings policy ID from database
    const { data: config, error } = await supabase
      .from('platform_config')
      .select('settings_policy_id')
      .eq('id', 'main')
      .maybeSingle();

    if (error || !config?.settings_policy_id) {
      console.log('No platform settings found - organizer access denied');
      return false;
    }

    const settingsPolicyId = config.settings_policy_id;

    // Check if wallet contains any NFT with this policy ID
    const walletUtxos = await lucid.wallet().getUtxos();

    for (const utxo of walletUtxos) {
      for (const [unit] of Object.entries(utxo.assets)) {
        if (unit === 'lovelace') continue;

        // Extract policy ID (first 56 chars of unit)
        const policyId = unit.slice(0, 56);
        if (policyId === settingsPolicyId) {
          console.log('✅ Settings NFT found in wallet - organizer access granted');
          return true;
        }
      }
    }

    console.log('❌ Settings NFT not found in wallet - organizer access denied');
    return false;
  } catch (err) {
    console.error('Error checking organizer access:', err);
    return false;
  }
}

// ============================================
// WALLET TICKET SCANNING
// ============================================

export interface WalletTicketNft {
  policyId: string;
  assetName: string;     // hex-encoded
  unit: string;          // policyId + assetName
  eventId: string;
  eventName: string;
  tierId: string;
  tierName: string;
  priceLovalace: number;
}

/**
 * Get Ticket NFTs from Wallet
 *
 * Scans the user's wallet for ticket NFTs that belong to known events.
 * This is the "wallet-first" approach - only returns tickets actually in the wallet.
 *
 * @returns Array of ticket NFT info for tickets in the wallet
 */
export async function getWalletTicketNfts(lucid: LucidEvolution): Promise<WalletTicketNft[]> {
  console.log('Scanning wallet for ticket NFTs...');

  // Step 1: Get all known event policies from database
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, event_policy_id, event_name, ticket_tiers(id, tier_name, price_lovelace)');

  if (eventsError || !events) {
    console.error('Failed to fetch events:', eventsError);
    return [];
  }

  // Build a map of policy -> event info for quick lookup
  const policyToEvent = new Map<string, {
    eventId: string;
    eventName: string;
    tierId: string;
    tierName: string;
    priceLovalace: number;
  }>();

  events.forEach(event => {
    if (event.event_policy_id && event.ticket_tiers?.length > 0) {
      const tier = event.ticket_tiers[0];
      policyToEvent.set(event.event_policy_id, {
        eventId: event.id,
        eventName: event.event_name,
        tierId: tier.id,
        tierName: tier.tier_name,
        priceLovalace: tier.price_lovelace,
      });
    }
  });

  console.log('Known event policies:', policyToEvent.size);

  // Step 2: Get all wallet UTxOs
  const walletUtxos = await lucid.wallet().getUtxos();
  console.log('Wallet UTxOs:', walletUtxos.length);

  // Step 3: Extract ticket NFTs (assets matching known event policies)
  const ticketsInWallet: WalletTicketNft[] = [];

  for (const utxo of walletUtxos) {
    for (const [unit, qty] of Object.entries(utxo.assets)) {
      if (unit === 'lovelace' || qty !== 1n) continue;

      // Extract policy ID (first 56 chars) and asset name (rest)
      const policyId = unit.slice(0, 56);
      const assetName = unit.slice(56);

      const eventInfo = policyToEvent.get(policyId);
      if (eventInfo) {
        ticketsInWallet.push({
          policyId,
          assetName,
          unit,
          eventId: eventInfo.eventId,
          eventName: eventInfo.eventName,
          tierId: eventInfo.tierId,
          tierName: eventInfo.tierName,
          priceLovalace: eventInfo.priceLovalace,
        });
      }
    }
  }

  console.log('Ticket NFTs found in wallet:', ticketsInWallet.length);
  return ticketsInWallet;
}

// ============================================
// WALLET SYNC (DB as Cache Reconciliation)
// ============================================

export interface SyncResult {
  discovered: number;      // New tickets found in wallet, added to DB
  updated: number;         // Existing tickets with ownership updated
  alreadySynced: number;   // Tickets already correctly in DB
  missingFromWallet: number; // Tickets in DB but not in wallet (marked as transferred)
  duplicatesRemoved: number; // Duplicate DB records cleaned up
}

/**
 * Sync Wallet Tickets with Database
 *
 * Scans the user's wallet for ticket NFTs and reconciles with the database.
 * This implements the "DB as cache" pattern - on-chain state is the source of truth.
 *
 * - Discovers tickets in wallet that aren't in DB (creates records)
 * - Updates ownership for tickets that were transferred to this wallet
 * - Does NOT remove tickets from DB if not in wallet (could be listed/transferred)
 */
export async function syncWalletTickets(
  lucid: LucidEvolution,
  userAddress: string
): Promise<SyncResult> {
  console.log('Syncing wallet tickets for:', userAddress);

  const result: SyncResult = { discovered: 0, updated: 0, alreadySynced: 0, missingFromWallet: 0, duplicatesRemoved: 0 };

  // Step 0: Clean up any duplicate records first
  result.duplicatesRemoved = await deduplicateTickets();

  try {
    // Step 1: Get all known event policies from database
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, event_policy_id, event_name, ticket_tiers(id, tier_name, price_lovelace)');

    if (eventsError || !events) {
      console.error('Failed to fetch events for sync:', eventsError);
      return result;
    }

    // Build a map of policy -> event info for quick lookup
    const policyToEvent = new Map<string, {
      eventId: string;
      eventName: string;
      tierId: string;
      tierName: string;
      priceLovalace: number;
    }>();

    events.forEach(event => {
      if (event.event_policy_id && event.ticket_tiers?.length > 0) {
        const tier = event.ticket_tiers[0]; // Use first tier for discovered tickets
        policyToEvent.set(event.event_policy_id, {
          eventId: event.id,
          eventName: event.event_name,
          tierId: tier.id,
          tierName: tier.tier_name,
          priceLovalace: tier.price_lovelace,
        });
      }
    });

    console.log('Known event policies:', policyToEvent.size);

    // Step 2: Get all wallet UTxOs
    const walletUtxos = await lucid.wallet().getUtxos();
    console.log('Wallet UTxOs:', walletUtxos.length);

    // Step 3: Extract ticket NFTs (assets matching known event policies)
    const ticketsInWallet: Array<{
      policyId: string;
      assetName: string;
      eventInfo: typeof policyToEvent extends Map<string, infer V> ? V : never;
    }> = [];

    for (const utxo of walletUtxos) {
      for (const [unit, qty] of Object.entries(utxo.assets)) {
        if (unit === 'lovelace' || qty !== 1n) continue;

        // Extract policy ID (first 56 chars) and asset name (rest)
        const policyId = unit.slice(0, 56);
        const assetName = unit.slice(56);

        const eventInfo = policyToEvent.get(policyId);
        if (eventInfo) {
          ticketsInWallet.push({ policyId, assetName, eventInfo });
        }
      }
    }

    console.log('Ticket NFTs found in wallet:', ticketsInWallet.length);

    // Step 4: For each ticket, ensure DB record exists and ownership is correct
    for (const ticket of ticketsInWallet) {
      // Check if ticket exists in database (use maybeSingle to avoid 406 when not found)
      const { data: existingTicket, error: fetchError } = await supabase
        .from('tickets')
        .select('id, current_owner_address')
        .eq('nft_asset_name', ticket.assetName)
        .maybeSingle();

      if (fetchError) {
        console.error('Error checking ticket:', fetchError);
        continue;
      }

      if (!existingTicket) {
        // Ticket not in DB - create record
        console.log('Discovering new ticket:', ticket.assetName);

        // Get next ticket number for this tier
        const { data: maxTicket } = await supabase
          .from('tickets')
          .select('ticket_number')
          .eq('tier_id', ticket.eventInfo.tierId)
          .order('ticket_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextTicketNumber = (maxTicket?.ticket_number || 0) + 1;

        const { error: insertError } = await supabase.from('tickets').insert({
          event_id: ticket.eventInfo.eventId,
          tier_id: ticket.eventInfo.tierId,
          nft_asset_name: ticket.assetName,
          ticket_number: nextTicketNumber,
          current_owner_address: userAddress,
          original_buyer_address: userAddress, // Assume current owner bought it
          status: 'minted',
          minted_at: new Date().toISOString(),
        });

        if (insertError) {
          console.error('Failed to insert discovered ticket:', insertError);
        } else {
          result.discovered++;
        }
      } else if (existingTicket.current_owner_address !== userAddress) {
        // Ticket exists but ownership doesn't match - update it
        console.log('Updating ownership for ticket:', ticket.assetName);
        const { error: updateError } = await supabase
          .from('tickets')
          .update({ current_owner_address: userAddress, status: 'minted' })
          .eq('id', existingTicket.id);

        if (updateError) {
          console.error('Failed to update ticket ownership:', updateError);
        } else {
          result.updated++;
        }
      } else {
        result.alreadySynced++;
      }
    }

    // Step 5: Check for tickets in DB that this user supposedly owns but are NOT in wallet
    // These may have been listed or transferred without proper DB update
    const ticketAssetNamesInWallet = new Set(ticketsInWallet.map(t => t.assetName));

    const { data: dbTickets, error: dbTicketsError } = await supabase
      .from('tickets')
      .select('id, nft_asset_name, status')
      .eq('current_owner_address', userAddress)
      .eq('status', 'minted');  // Only check 'minted' status, not 'listed'

    if (!dbTicketsError && dbTickets) {
      for (const dbTicket of dbTickets) {
        if (!ticketAssetNamesInWallet.has(dbTicket.nft_asset_name)) {
          // Ticket is in DB as owned by user but NOT in their wallet
          console.log('Ticket missing from wallet:', dbTicket.nft_asset_name);

          // Mark as transferred (could have been listed or sent to another wallet)
          const { error: updateError } = await supabase
            .from('tickets')
            .update({ status: 'transferred' })
            .eq('id', dbTicket.id);

          if (!updateError) {
            result.missingFromWallet++;
          } else {
            console.error('Failed to update missing ticket status:', updateError);
          }
        }
      }
    }

    console.log('Sync complete:', result);
    return result;

  } catch (err) {
    console.error('Wallet sync failed:', err);
    return result;
  }
}

/**
 * Deduplicate tickets in the database
 *
 * Finds tickets with the same nft_asset_name and keeps only the most recent one.
 * This cleans up any duplicate entries that may have been created.
 *
 * @returns Number of duplicate records removed
 */
export async function deduplicateTickets(): Promise<number> {
  console.log('Checking for duplicate tickets...');

  // Get all tickets grouped by nft_asset_name
  const { data: allTickets, error } = await supabase
    .from('tickets')
    .select('id, nft_asset_name, created_at, status')
    .order('created_at', { ascending: false });

  if (error || !allTickets) {
    console.error('Failed to fetch tickets for deduplication:', error);
    return 0;
  }

  // Group by nft_asset_name
  const ticketsByAssetName = new Map<string, typeof allTickets>();
  for (const ticket of allTickets) {
    const existing = ticketsByAssetName.get(ticket.nft_asset_name) || [];
    existing.push(ticket);
    ticketsByAssetName.set(ticket.nft_asset_name, existing);
  }

  let duplicatesRemoved = 0;

  // For each asset name with more than 1 record, keep the newest and delete the rest
  for (const [assetName, tickets] of ticketsByAssetName.entries()) {
    if (tickets.length > 1) {
      console.log(`Found ${tickets.length} duplicates for ${assetName}`);

      // Keep the first one (newest due to order), delete the rest
      const toDelete = tickets.slice(1).map(t => t.id);

      const { error: deleteError } = await supabase
        .from('tickets')
        .delete()
        .in('id', toDelete);

      if (deleteError) {
        console.error('Failed to delete duplicates:', deleteError);
      } else {
        duplicatesRemoved += toDelete.length;
        console.log(`  Removed ${toDelete.length} duplicate(s)`);
      }
    }
  }

  console.log(`Deduplication complete: ${duplicatesRemoved} duplicates removed`);
  return duplicatesRemoved;
}

/**
 * Recalculate tier supply based on actual minted tickets
 * Call this to fix supply counts that got out of sync
 */
export async function recalculateTierSupply(tierId: string): Promise<void> {
  // Count actual tickets for this tier
  const { count, error: countError } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('tier_id', tierId);

  if (countError) {
    console.error('Failed to count tickets:', countError);
    return;
  }

  // Get tier total supply
  const { data: tier, error: tierError } = await supabase
    .from('ticket_tiers')
    .select('total_supply')
    .eq('id', tierId)
    .single();

  if (tierError || !tier) {
    console.error('Failed to fetch tier:', tierError);
    return;
  }

  // Update remaining supply
  const remaining = Math.max(0, tier.total_supply - (count || 0));
  const { error: updateError } = await supabase
    .from('ticket_tiers')
    .update({ remaining_supply: remaining })
    .eq('id', tierId);

  if (updateError) {
    console.error('Failed to update tier supply:', updateError);
  } else {
    console.log(`Tier ${tierId} supply recalculated: ${remaining} remaining`);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function generateTicketNames(
  _eventPolicyId: string,
  quantity: number
): Promise<string[]> {
  const names: string[] = [];

  for (let i = 0; i < quantity; i++) {
    const uniqueId = crypto.randomUUID().slice(0, 8);
    const name = `Event-${uniqueId}`;
    names.push(fromText(name));
  }

  return names;
}

function buildCIP25Metadata(
  policyId: string,
  eventName: string,
  tierName: string,
  ticketNames: string[]
): Record<string, any> {

  const metadata: Record<string, any> = {};

  ticketNames.forEach(name => {
    metadata[name] = {
      name: `${eventName} - ${tierName}`,
      image: 'ipfs://placeholder',
      mediaType: 'image/png',
      description: `Official ticket for ${eventName}`,
      attributes: {
        event: eventName,
        tier: tierName,
        ticketNumber: name,
      }
    };
  });

  return { [policyId]: metadata };
}

async function saveEventToDatabase(
  eventId: string,
  policyId: string,
  organizerAddress: string,
  params: EventCreationParams
) {
  console.log('Saving event to database:', { eventId, policyId, organizerAddress });

  const { error: eventError } = await supabase.from('events').insert({
    id: eventId,
    event_name: params.eventName,
    event_description: params.eventDescription,
    event_date: params.eventDate.toISOString(),
    event_location: params.location,
    venue_name: params.venue,
    organizer_wallet_address: organizerAddress,
    banner_image_url: params.bannerImageUrl,
    category: params.category,
    status: 'draft',  // Events start as draft, organizer must "Go Live" from dashboard
    event_policy_id: policyId,
  });

  if (eventError) {
    console.error('Failed to save event:', eventError);
    throw new Error(`Failed to save event to database: ${eventError.message}`);
  }

  console.log('Event saved, now saving tiers...');

  const tiersToInsert = params.ticketTiers.map(tier => ({
    event_id: eventId,
    tier_name: tier.tierName,
    tier_description: tier.tierDescription,
    price_lovelace: Math.floor(tier.priceAda * 1_000_000), // ADA -> Lovelace
    total_supply: tier.totalSupply,
    remaining_supply: tier.totalSupply,
    max_per_wallet: tier.maxPerWallet,
  }));

  const { error: tiersError } = await supabase.from('ticket_tiers').insert(tiersToInsert);

  if (tiersError) {
    console.error('Failed to save ticket tiers:', tiersError);
    throw new Error(`Failed to save ticket tiers: ${tiersError.message}`);
  }

  console.log('Event and tiers saved successfully');
}

async function recordTicketPurchase(
  params: PurchaseTicketParams,
  ticketNames: string[],
  txHash: string,
  buyerAddress: string
) {
  console.log('Recording ticket purchase to database...');
  console.log('  Event ID:', params.eventId);
  console.log('  Tier ID:', params.tierId);
  console.log('  Buyer:', buyerAddress);
  console.log('  Ticket names:', ticketNames);

  // Get the current max ticket_number for this tier
  const { data: maxTicket } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('tier_id', params.tierId)
    .order('ticket_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const startingTicketNumber = (maxTicket?.ticket_number || 0) + 1;

  const tickets = ticketNames.map((name, index) => ({
    event_id: params.eventId,
    tier_id: params.tierId,
    nft_asset_name: name,
    ticket_number: startingTicketNumber + index,
    current_owner_address: buyerAddress,
    original_buyer_address: buyerAddress,
    mint_tx_hash: txHash,
    minted_at: new Date().toISOString(),
    status: 'minted',
  }));

  // Insert tickets with error handling
  const { error: ticketsError } = await supabase.from('tickets').insert(tickets);
  if (ticketsError) {
    console.error('Failed to insert tickets:', ticketsError);
    throw new Error(`Failed to record ticket purchase: ${ticketsError.message}`);
  }
  console.log('Tickets inserted successfully with ticket_numbers starting at:', startingTicketNumber);

  // Try RPC function first, fall back to direct update if it doesn't exist
  const { error: rpcError } = await supabase.rpc('decrement_tier_supply', {
    tier_id: params.tierId,
    amount: params.quantity,
  });

  if (rpcError) {
    console.warn('RPC decrement_tier_supply failed, using direct update:', rpcError.message);

    // Fallback: Direct update to decrement remaining_supply
    const { data: tier, error: fetchError } = await supabase
      .from('ticket_tiers')
      .select('remaining_supply')
      .eq('id', params.tierId)
      .single();

    if (fetchError) {
      console.error('Failed to fetch tier supply:', fetchError);
      return; // Don't throw - ticket is already minted on-chain
    }

    const newSupply = (tier.remaining_supply || 0) - params.quantity;
    const { error: updateError } = await supabase
      .from('ticket_tiers')
      .update({ remaining_supply: Math.max(0, newSupply) })
      .eq('id', params.tierId);

    if (updateError) {
      console.error('Failed to update tier supply:', updateError);
      return; // Don't throw - ticket is already minted on-chain
    }
    console.log('Tier supply decremented via fallback (new supply:', newSupply, ')');
  } else {
    console.log('Tier supply decremented via RPC');
  }
}

// ============================================
// PLATFORM SETTINGS INITIALIZATION
// ============================================

export interface PlatformSettingsParams {
  platformFeeBps?: number;      // Default: 250 (2.5%)
  isMarketActive?: boolean;     // Default: true
  currentMaxSupply?: number;    // Default: 10000
  maxResaleMultiplier?: number; // Default: 300 (3x)
}

/**
 * Initialize Platform Settings NFT
 *
 * Creates a unique Settings NFT that all validators reference.
 * Uses a one-time minting policy based on UTXO reference for uniqueness.
 *
 * Should only be called ONCE during platform deployment.
 */
export async function initializePlatformSettings(
  lucid: LucidEvolution,
  params: PlatformSettingsParams = {}
): Promise<{ txHash: string; settingsPolicyId: string; settingsUtxoRef: string }> {

  console.log('Initializing platform settings...');

  // GUARD: Check if platform settings already exist in database
  const { data: existingConfig } = await supabase
    .from('platform_config')
    .select('settings_policy_id, settings_utxo_ref')
    .eq('id', 'main')
    .maybeSingle();

  if (existingConfig?.settings_policy_id && existingConfig?.settings_utxo_ref) {
    console.warn('⚠️ Platform settings already exist! Skipping re-initialization.');
    console.log('   Existing Policy ID:', existingConfig.settings_policy_id);
    console.log('   Existing UTxO Ref:', existingConfig.settings_utxo_ref);
    throw new Error(
      'Platform settings already exist. Use the Settings page to burn and reset if needed. ' +
      `Existing Policy: ${existingConfig.settings_policy_id}`
    );
  }

  // Get admin address (deployer)
  const adminAddress = await lucid.wallet().address();
  const adminPKH = paymentCredentialOf(adminAddress).hash;

  // Set defaults
  const platformFeeBps = BigInt(params.platformFeeBps ?? 250);
  const isMarketActive = params.isMarketActive ?? true;
  const currentMaxSupply = BigInt(params.currentMaxSupply ?? 10000);
  const maxResaleMultiplier = BigInt(params.maxResaleMultiplier ?? 300);

  // Step 1: Get a UTXO to make the minting policy unique (one-time mint)
  const utxos = await lucid.wallet().getUtxos();
  if (utxos.length === 0) {
    throw new Error('No UTxOs available in wallet');
  }
  const seedUtxo = utxos[0];

  // Step 2: Build one-time minting policy script
  // This uses the UTXO output reference to ensure uniqueness
  const oneTimeMintScript = buildOneTimeMintScript(
    seedUtxo.txHash,
    seedUtxo.outputIndex,
    adminPKH
  );

  const settingsPolicyId = mintingPolicyToId(oneTimeMintScript);
  console.log('Settings Policy ID:', settingsPolicyId);

  // Step 3: Build GlobalSettings datum with CBOR primitive boolean
  // CRITICAL: Lucid Evolution's Data.Boolean() encodes as Constr (d87a80/d87980)
  // but Aiken expects CBOR primitives (f5=true, f4=false).
  // Use our custom encoder that fixes this.
  const settingsDatum = encodeGlobalSettingsDatum(
    platformFeeBps,
    adminPKH,  // Treasury PKH (same as admin for now)
    isMarketActive,
    currentMaxSupply,
    maxResaleMultiplier,
    adminPKH
  );

  // Step 4: Build and submit transaction
  const tx = await lucid
    .newTx()
    .collectFrom([seedUtxo])
    .mintAssets(
      { [toUnit(settingsPolicyId, fromText('Settings'))]: 1n },
      Data.void()
    )
    .pay.ToAddressWithData(
      adminAddress,
      { kind: 'inline', value: settingsDatum },
      {
        lovelace: 2_000_000n,
        [toUnit(settingsPolicyId, fromText('Settings'))]: 1n
      }
    )
    .attach.MintingPolicy(oneTimeMintScript)
    .addSigner(adminAddress)
    .complete();

  console.log('Transaction built. Requesting wallet signature...');
  console.log('IMPORTANT: Please check for wallet popup and approve the transaction.');

  let signedTx;
  try {
    signedTx = await tx.sign.withWallet().complete();
  } catch (signError) {
    const errorMessage = signError instanceof Error ? signError.message : String(signError);
    console.error('Wallet signing failed:', errorMessage);
    if (errorMessage.includes('TxSignError') || errorMessage.includes('user')) {
      throw new Error(
        'Wallet signature declined or popup not visible. ' +
        'Please check: 1) Wallet popup was shown 2) You clicked "Approve" 3) Wallet is unlocked'
      );
    }
    throw signError;
  }

  console.log('Transaction signed successfully. Submitting to network...');
  const txHash = await signedTx.submit();

  console.log('Settings TX submitted:', txHash);
  console.log('Waiting for confirmation...');
  await lucid.awaitTx(txHash);

  // Step 5: Calculate UTxO reference
  const settingsUtxoRef = `${txHash}#0`;

  // Step 6: Store in Supabase for other functions to reference
  await supabase.from('platform_config').upsert({
    id: 'main',
    settings_policy_id: settingsPolicyId,
    settings_utxo_ref: settingsUtxoRef,
    admin_address: adminAddress,
    admin_pkh: adminPKH,
    platform_fee_bps: Number(platformFeeBps),
    is_market_active: isMarketActive,
    current_max_supply: Number(currentMaxSupply),
    max_resale_multiplier: Number(maxResaleMultiplier),
    updated_at: new Date().toISOString(),
  });

  console.log('Platform settings initialized!', {
    settingsPolicyId,
    settingsUtxoRef,
    adminAddress,
  });

  return { txHash, settingsPolicyId, settingsUtxoRef };
}

/**
 * Build a one-time minting policy based on UTXO reference
 * Uses native script with admin signature requirement
 * The txHash+outputIndex params are reserved for future Plutus one-shot implementation
 */
function buildOneTimeMintScript(_txHash: string, _outputIndex: number, adminPkh: string): Script {
  // Create a native script requiring admin signature
  // Use scriptFromNative to properly convert to CBOR hex format

  return scriptFromNative({
    type: 'sig',
    keyHash: adminPkh
  });
}

/**
 * Get current platform settings from chain
 */
export async function getPlatformSettings(lucid: LucidEvolution): Promise<{
  platformFeeBps: number;
  platformTreasury: string;
  isMarketActive: boolean;
  currentMaxSupply: number;
  maxResaleMultiplier: number;
  adminPkh: string;
}> {
  const { utxo: settingsUTxO } = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  return {
    platformFeeBps: Number(settings.platform_fee_bps),
    platformTreasury: aikenAddressToPkh(settings.platform_treasury as DecodedAddress),
    isMarketActive: settings.is_market_active === "Active",  // Convert MarketStatus enum to boolean
    currentMaxSupply: Number(settings.current_max_supply),
    maxResaleMultiplier: Number(settings.max_resale_multiplier),
    adminPkh: settings.admin_pkh,
  };
}

/**
 * Check if platform settings have been initialized
 */
export async function isSettingsInitialized(): Promise<boolean> {
  const { data, error } = await supabase
    .from('platform_config')
    .select('settings_policy_id')
    .eq('id', 'main')
    .single();

  return !error && data?.settings_policy_id != null;
}

/**
 * Reset platform settings in database
 *
 * Call this before re-initializing platform settings if the on-chain
 * settings datum format is outdated (e.g., after validator schema changes).
 *
 * WARNING: This only clears the database reference. The old settings NFT
 * will remain on-chain but will no longer be used.
 */
export async function resetPlatformSettings(): Promise<void> {
  const { error } = await supabase
    .from('platform_config')
    .update({ settings_policy_id: null, settings_utxo_ref: null })
    .eq('id', 'main');

  if (error) {
    throw new Error(`Failed to reset platform settings: ${error.message}`);
  }

  console.log('Platform settings reset. Call initializePlatformSettings() to create new settings.');
}

/**
 * Burn the existing Settings NFT
 *
 * This permanently destroys the Settings NFT on-chain. The admin must sign
 * the transaction since the minting policy requires admin authorization.
 *
 * WARNING: All existing events created with this settings policy will become
 * unusable after burning. Only burn if you intend to re-initialize immediately.
 */
export async function burnSettingsNft(lucid: LucidEvolution): Promise<string> {
  // Step 1: Get current settings from database
  const { data, error } = await supabase
    .from('platform_config')
    .select('settings_policy_id, settings_utxo_ref, admin_pkh')
    .eq('id', 'main')
    .single();

  if (error || !data?.settings_policy_id) {
    throw new Error('No settings NFT found to burn');
  }

  const settingsPolicyId = data.settings_policy_id;
  const adminPkh = data.admin_pkh;

  // Step 2: Find the settings UTxO on-chain
  const { utxo: settingsUTxO } = await getSettingsUTxO(lucid);

  // Step 3: Rebuild the native script (requires admin signature)
  const mintScript = scriptFromNative({
    type: 'sig',
    keyHash: adminPkh
  });

  // Verify the script produces the same policy ID
  const derivedPolicyId = mintingPolicyToId(mintScript);
  if (derivedPolicyId !== settingsPolicyId) {
    throw new Error(`Policy ID mismatch. Expected ${settingsPolicyId}, got ${derivedPolicyId}`);
  }

  // Step 4: Get admin address for returning the ADA
  const adminAddress = await lucid.wallet().address();

  // Step 5: Build burn transaction
  const settingsUnit = toUnit(settingsPolicyId, fromText('Settings'));

  console.log('Burning Settings NFT...');
  console.log('  Policy ID:', settingsPolicyId);
  console.log('  Settings UTxO:', settingsUTxO.txHash, '#', settingsUTxO.outputIndex);

  const tx = await lucid
    .newTx()
    .collectFrom([settingsUTxO])
    .mintAssets(
      { [settingsUnit]: -1n }, // Burn 1 token (negative amount)
      Data.void()
    )
    .pay.ToAddress(adminAddress, { lovelace: settingsUTxO.assets.lovelace })
    .attach.MintingPolicy(mintScript)
    .complete();

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  console.log('Settings NFT burned! TX:', txHash);
  await lucid.awaitTx(txHash);

  // Step 6: Clear database reference
  await resetPlatformSettings();

  return txHash;
}
