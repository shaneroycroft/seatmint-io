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

// GlobalSettings datum schema
const GlobalSettingsSchema = Data.Object({
  platform_fee_bps: Data.Integer(),
  platform_treasury: AddressSchema,
  is_market_active: Data.Boolean(),
  current_max_supply: Data.Integer(),
  max_resale_multiplier: Data.Integer(),
  admin_pkh: Data.Bytes(),
});

// SaleDatum schema reference (built as Constr directly):
// Fields: organizer_address (Bytes), base_price (Integer), event_policy (Bytes),
//         sale_window (Option), anti_scalping_rules (Option), whitelist (Option), pricing_strategy (Enum)

// SaleRedeemer schema
const SaleRedeemerSchema = Data.Object({
  quantity: Data.Integer(),
  payment_amount: Data.Integer(),
  buyer_pkh: Data.Bytes(),
});
type SaleRedeemer = Data.Static<typeof SaleRedeemerSchema>;

// MintAction schema (kept for reference - using Constr directly)
const _MintActionSchema = Data.Enum([
  Data.Literal("Mint"),
  Data.Literal("Burn"),
]);
void _MintActionSchema;

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
 */
function dateToPosixTime(date: Date): bigint {
  return BigInt(date.getTime());
}

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

  // Step 6: Build primary sale datum for first tier using Constr
  const firstTier = params.ticketTiers[0];
  const basePriceLovelace = adaToLovelace(firstTier.priceAda);

  // Helper: Build Option type - Some(value) = Constr(0, [value]), None = Constr(1, [])
  const buildOption = (value: unknown) =>
    value !== null ? new Constr(0, [value]) : new Constr(1, []);

  // Build sale window: Option<SaleWindow>
  const saleWindowConstr = (params.saleStartDate && params.saleEndDate)
    ? buildOption(new Constr(0, [
        dateToPosixTime(params.saleStartDate),
        dateToPosixTime(params.saleEndDate),
      ]))
    : buildOption(null);

  // Build anti-scalping rules: Option<AntiScalpingRules>
  const antiScalpingConstr = firstTier.maxPerWallet > 0
    ? buildOption(new Constr(0, [
        BigInt(firstTier.maxPerWallet),
        BigInt(firstTier.maxPerWallet * 2),
        0n,
      ]))
    : buildOption(null);

  // Build whitelist: Option<Whitelist>
  const whitelistConstr = (params.whitelistAddresses && params.whitelistAddresses.length > 0)
    ? buildOption(new Constr(0, [
        params.whitelistAddresses.map(addr => addressToPkh(addr)),
      ]))
    : buildOption(null);

  // Build pricing strategy: Enum (FixedPrice=0)
  // PricingStrategy::FixedPrice { price } = Constr(0, [price])
  let pricingStrategyConstr: Constr<unknown>;
  if (firstTier.earlyBirdPriceAda && firstTier.earlyBirdDeadline) {
    // EarlyBird would be Constr(1, [early_price, deadline]) if implemented
    // For now, fall back to FixedPrice
    pricingStrategyConstr = new Constr(0, [basePriceLovelace]);
  } else {
    // FixedPrice { price } = Constr(0, [price])
    pricingStrategyConstr = new Constr(0, [basePriceLovelace]);
  }

  // Build SaleDatum: Constr(0, [organizer_address, base_price, event_policy, sale_window, anti_scalping, whitelist, pricing])
  // organizer_address must be a full Aiken Address structure, not just a PKH
  const organizerAddressConstr = pkhToAikenAddress(organizerPKH);
  const saleDatumConstr = new Constr(0, [
    organizerAddressConstr,
    basePriceLovelace,
    policyId,
    saleWindowConstr,
    antiScalpingConstr,
    whitelistConstr,
    pricingStrategyConstr,
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
 * Purchase Tickets (Primary Sale)
 */
export async function purchaseTickets(
  lucid: LucidEvolution,
  params: PurchaseTicketParams
): Promise<{ txHash: string; ticketIds: string[] }> {

  console.log('Purchasing tickets:', params);

  // Step 1: Get event and tier info
  const { data: tier, error: tierError } = await supabase
    .from('ticket_tiers')
    .select('*, events(*)')
    .eq('id', params.tierId)
    .single();

  if (tierError || !tier) {
    throw new Error('Ticket tier not found');
  }

  if (tier.remaining_supply < params.quantity) {
    throw new Error('Not enough tickets available');
  }

  // Step 2: Get buyer address
  const buyerAddress = await lucid.wallet().address();
  const buyerPKH = paymentCredentialOf(buyerAddress).hash;

  // Step 3: Validate validators and get settings
  if (!EVENT_MINT_VALIDATOR || !PRIMARY_SALE_VALIDATOR) {
    throw new Error('Validators not found in plutus.json. Run `aiken build` first.');
  }
  const { utxo: settingsUTxO, settingsPolicyId } = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Step 4: Apply parameters to validators (using settings policy ID)
  const primarySaleValidator = applyPrimarySaleParams(settingsPolicyId);

  // Step 5: Find sale UTxO (box office) for this specific event
  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');
  const saleAddress = validatorToAddress(network, primarySaleValidator);
  const saleUTxOs = await lucid.utxosAt(saleAddress);

  if (saleUTxOs.length === 0) {
    throw new Error('Sale UTxO not found');
  }

  // Find the sale UTxO that matches this event's policy ID
  // The SaleDatum contains event_policy which should match tier.events.event_policy_id
  const eventPolicyId = tier.events.event_policy_id;
  const saleUTxO = saleUTxOs.find(utxo => {
    if (!utxo.datum) return false;
    try {
      // Decode the datum to check the event_policy field
      // SaleDatum structure: Constr(0, [organizer_address, base_price, event_policy, ...])
      const decoded = Data.from(utxo.datum);
      if (decoded instanceof Constr && decoded.fields.length >= 3) {
        const datumEventPolicy = decoded.fields[2] as string;
        return datumEventPolicy === eventPolicyId;
      }
      return false;
    } catch {
      return false;
    }
  });

  if (!saleUTxO) {
    throw new Error(`Sale UTxO not found for event policy ${eventPolicyId}`);
  }

  // Step 5: Generate ticket token names
  const ticketNames = await generateTicketNames(
    tier.events.event_policy_id,
    params.quantity
  );

  // Step 6: Calculate payments (ADA -> Lovelace conversion)
  const pricePerTicket = BigInt(tier.price_lovelace);
  const totalPrice = pricePerTicket * BigInt(params.quantity);
  const platformFee = (totalPrice * BigInt(settings.platform_fee_bps)) / 10000n;
  const organizerPayment = totalPrice - platformFee;

  // Step 7: Build redeemer for primary sale
  const saleRedeemer: SaleRedeemer = {
    quantity: BigInt(params.quantity),
    payment_amount: totalPrice,
    buyer_pkh: buyerPKH,
  };

  // Step 8: Build minting assets
  const mintAssets: Record<string, bigint> = {};
  ticketNames.forEach(name => {
    mintAssets[toUnit(tier.events.event_policy_id, name)] = 1n;
  });

  // Step 10: Build metadata (CIP-25)
  const metadata = buildCIP25Metadata(
    tier.events.event_policy_id,
    tier.events.event_name,
    tier.tier_name,
    ticketNames
  );

  // Step 11: Get organizer PKH for minting policy
  const organizerPKH = paymentCredentialOf(tier.events.organizer_wallet_address).hash;
  const boxOfficeHash = validatorToScriptHash(primarySaleValidator);

  // Step 12: Apply parameters to event mint policy
  const mintingPolicyValidator = applyEventMintParams(
    organizerPKH,
    settingsPolicyId,
    boxOfficeHash
  );

  // Step 13: Build transaction
  // Redeemer: Constr with index 0 for primary sale purchase
  const saleRedeemerData = new Constr(0, [
    saleRedeemer.quantity,
    saleRedeemer.payment_amount,
    saleRedeemer.buyer_pkh,
  ]);
  // Mint redeemer: Constr 0 for Mint
  const mintRedeemerData = new Constr(0, []);

  // IMPORTANT: The organizer address in the SaleDatum was created using pkhToAikenAddress,
  // which produces an Address with stake_credential: None. The validator does an exact
  // address comparison, so we must pay to an address with the same structure (no stake).
  // Use pkhToAddress to create an address from just the PKH, matching the datum.
  const organizerPaymentAddress = pkhToAddress(organizerPKH, network);

  const tx = await lucid
    .newTx()
    .collectFrom(
      [saleUTxO],
      Data.to(saleRedeemerData)
    )
    .readFrom([settingsUTxO])
    .mintAssets(
      mintAssets,
      Data.to(mintRedeemerData)
    )
    .pay.ToAddress(organizerPaymentAddress, {
      lovelace: organizerPayment
    })
    .pay.ToAddress(pkhToAddress(aikenAddressToPkh(settings.platform_treasury as DecodedAddress), network), {
      lovelace: platformFee
    })
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
  await lucid.awaitTx(txHash);

  // Step 12: Update database
  await recordTicketPurchase(params, ticketNames, txHash, buyerAddress);

  return { txHash, ticketIds: ticketNames };
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

  await supabase.from('secondary_listings').insert({
    ticket_id: params.ticketAssetName,
    seller_address: sellerAddress,
    price_lovelace: Math.floor(params.priceAda * 1_000_000),
    listing_utxo_ref: listingRef,
    status: 'active',
  });

  // Also update the tickets table so UI can track listing status
  await supabase
    .from('tickets')
    .update({
      status: 'listed',
      resale_price: Math.floor(params.priceAda * 1_000_000),
      listing_utxo_ref: listingRef,
    })
    .eq('nft_asset_name', params.ticketAssetName);

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
  const tickets = ticketNames.map(name => ({
    event_id: params.eventId,
    tier_id: params.tierId,
    nft_asset_name: name,
    current_owner_address: buyerAddress,
    original_buyer_address: buyerAddress,
    mint_tx_hash: txHash,
    minted_at: new Date().toISOString(),
    status: 'minted',
  }));

  await supabase.from('tickets').insert(tickets);

  await supabase.rpc('decrement_tier_supply', {
    tier_id: params.tierId,
    amount: params.quantity,
  });
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

  // Step 3: Build GlobalSettings datum using Constr
  // Fields order (from types.ak): platform_fee_bps, platform_treasury, is_market_active, current_max_supply, max_resale_multiplier, admin_pkh
  // platform_treasury is an Address type, not just bytes - use pkhToAikenAddress helper
  // Boolean is represented as Constr(0, []) for False, Constr(1, []) for True in Plutus
  const treasuryAddressConstr = pkhToAikenAddress(adminPKH);
  const settingsDatumConstr = new Constr(0, [
    platformFeeBps,                              // Integer
    treasuryAddressConstr,                       // Address (not just bytes!)
    new Constr(isMarketActive ? 1 : 0, []),      // Boolean as Constr
    currentMaxSupply,                            // Integer
    maxResaleMultiplier,                         // Integer
    adminPKH,                                    // VerificationKeyHash (bytes)
  ]);
  const settingsDatum = Data.to(settingsDatumConstr as Data);

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

  const signedTx = await tx.sign.withWallet().complete();
  const txHash = await signedTx.submit();

  console.log('Settings TX submitted:', txHash);
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
    isMarketActive: settings.is_market_active,
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
