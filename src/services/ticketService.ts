import {
  LucidEvolution,
  Data,
  fromText,
  toUnit,
  UTxO,
  Script,
  paymentCredentialOf,
  validatorToScriptHash,
  mintingPolicyToId,
  validatorToAddress,
  applyParamsToScript,
  getAddressDetails
} from '@lucid-evolution/lucid';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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

// GlobalSettings datum schema
const GlobalSettingsSchema = Data.Object({
  platform_fee_bps: Data.Integer(),
  platform_treasury: Data.Bytes(),
  is_market_active: Data.Boolean(),
  current_max_supply: Data.Integer(),
  max_resale_multiplier: Data.Integer(),
  admin_pkh: Data.Bytes(),
});

// SaleDatum schema (primary sales) - Pillar 2: Box Office
const SaleDatumSchema = Data.Object({
  organizer_address: Data.Bytes(),
  base_price: Data.Integer(),
  event_policy: Data.Bytes(),
  sale_window: Data.Nullable(Data.Object({
    start_time: Data.Integer(), // POSIX time in milliseconds
    end_time: Data.Integer(),   // POSIX time in milliseconds
  })),
  anti_scalping_rules: Data.Nullable(Data.Object({
    max_per_transaction: Data.Integer(),
    max_per_wallet: Data.Integer(),
    cooldown_period: Data.Integer(), // in milliseconds
  })),
  whitelist: Data.Nullable(Data.Object({
    approved_addresses: Data.Array(Data.Bytes()), // PKH bytes
  })),
  pricing_strategy: Data.Enum([
    Data.Object({ FixedPrice: Data.Object({ price: Data.Integer() }) }),
    Data.Object({ EarlyBird: Data.Object({ early_price: Data.Integer(), deadline: Data.Integer() }) }),
    Data.Object({ Tiered: Data.Object({ tiers: Data.Map(Data.Integer(), Data.Integer()) }) }),
  ]),
});
type SaleDatum = Data.Static<typeof SaleDatumSchema>;

// SaleRedeemer schema
const SaleRedeemerSchema = Data.Object({
  quantity: Data.Integer(),
  payment_amount: Data.Integer(),
  buyer_pkh: Data.Bytes(),
});
type SaleRedeemer = Data.Static<typeof SaleRedeemerSchema>;

// MintAction schema
const MintActionSchema = Data.Enum([
  Data.Literal("Mint"),
  Data.Literal("Burn"),
]);
type MintAction = Data.Static<typeof MintActionSchema>;

// TicketDatum schema (secondary market listings)
const TicketDatumSchema = Data.Object({
  event_policy: Data.Bytes(),
  token_name: Data.Bytes(),
  original_mint_price: Data.Integer(),
  price: Data.Integer(),
  artist: Data.Bytes(),
  royalty_rate: Data.Integer(),
  seller: Data.Bytes(),
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
 * Convert address to payment credential hash (hex bytes)
 */
function addressToPkh(address: string): string {
  const details = getAddressDetails(address);
  if (!details.paymentCredential || details.paymentCredential.type !== 'Key') {
    throw new Error('Invalid address: no key-based payment credential');
  }
  return details.paymentCredential.hash;
}

// ============================================
// SCRIPT LOADING
// ============================================

interface CompiledScripts {
  mintingPolicy: string;
  primarySaleValidator: string;
  storefrontValidator: string;
  settingsValidator: string;
}

let cachedScripts: CompiledScripts | null = null;

/**
 * Load compiled Aiken scripts from backend
 */
async function loadScripts(): Promise<CompiledScripts> {
  if (cachedScripts) return cachedScripts;

  const { data, error } = await supabase
    .from('platform_config')
    .select('compiled_scripts')
    .single();

  if (error) throw new Error(`Failed to load scripts: ${error.message}`);

  cachedScripts = data.compiled_scripts;
  return cachedScripts!;
}

/**
 * Get platform settings UTxO (referenced by all transactions)
 */
async function getSettingsUTxO(lucid: LucidEvolution): Promise<UTxO> {
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

  return utxos[0];
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

  // Step 3: Load scripts
  const scripts = await loadScripts();

  // Step 4: Get settings for validation
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Step 5: Apply minting policy parameters
  const primarySaleScript: Script = { type: 'PlutusV3', script: scripts.primarySaleValidator };
  const boxOfficeHash = validatorToScriptHash(primarySaleScript);

  const mintingPolicyWithParams = applyParamsToScript(
    scripts.mintingPolicy,
    [
      organizerPKH,
      settings.platform_treasury,
      boxOfficeHash,
    ]
  );

  const mintingPolicyScript: Script = { type: 'PlutusV3', script: mintingPolicyWithParams };
  const policyId = mintingPolicyToId(mintingPolicyScript);

  console.log('Policy ID:', policyId);

  // Step 6: Build primary sale datum for first tier
  const firstTier = params.ticketTiers[0];
  const basePriceLovelace = adaToLovelace(firstTier.priceAda);

  // Build sale window if provided (Date -> POSIX time)
  const saleWindow = (params.saleStartDate && params.saleEndDate) ? {
    start_time: dateToPosixTime(params.saleStartDate),
    end_time: dateToPosixTime(params.saleEndDate),
  } : null;

  // Build anti-scalping rules
  const antiScalpingRules = firstTier.maxPerWallet > 0 ? {
    max_per_transaction: BigInt(firstTier.maxPerWallet),
    max_per_wallet: BigInt(firstTier.maxPerWallet * 2),
    cooldown_period: 0n,
  } : null;

  // Build whitelist if provided (addresses -> PKH bytes)
  const whitelist = params.whitelistAddresses && params.whitelistAddresses.length > 0 ? {
    approved_addresses: params.whitelistAddresses.map(addr => addressToPkh(addr)),
  } : null;

  // Build pricing strategy using Constr
  let pricingStrategy: { FixedPrice: { price: bigint } } | { EarlyBird: { early_price: bigint; deadline: bigint } };

  if (firstTier.earlyBirdPriceAda && firstTier.earlyBirdDeadline) {
    pricingStrategy = {
      EarlyBird: {
        early_price: adaToLovelace(firstTier.earlyBirdPriceAda),
        deadline: dateToPosixTime(firstTier.earlyBirdDeadline),
      }
    };
  } else {
    pricingStrategy = {
      FixedPrice: { price: basePriceLovelace }
    };
  }

  const saleDatum: SaleDatum = {
    organizer_address: organizerPKH,
    base_price: basePriceLovelace,
    event_policy: policyId,
    sale_window: saleWindow,
    anti_scalping_rules: antiScalpingRules,
    whitelist: whitelist,
    pricing_strategy: pricingStrategy,
  };

  // Step 7: Build transaction to create sale UTxO
  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');
  const saleAddress = validatorToAddress(network, primarySaleScript);

  const tx = await lucid
    .newTx()
    .pay.ToAddressWithData(
      saleAddress,
      { kind: 'inline', value: Data.to<SaleDatum>(saleDatum) },
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

  // Step 3: Load scripts and settings
  const scripts = await loadScripts();
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Step 4: Find sale UTxO (box office)
  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');
  const saleValidatorScript: Script = { type: 'PlutusV3', script: scripts.primarySaleValidator };
  const saleAddress = validatorToAddress(network, saleValidatorScript);
  const saleUTxOs = await lucid.utxosAt(saleAddress);

  if (saleUTxOs.length === 0) {
    throw new Error('Sale UTxO not found');
  }

  const saleUTxO = saleUTxOs[0];

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

  // Step 8: Build mint redeemer
  const mintRedeemer = "Mint" as MintAction;

  // Step 9: Build minting assets
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

  // Step 11: Build transaction
  const mintingPolicyScript: Script = { type: 'PlutusV3', script: scripts.mintingPolicy };

  const tx = await lucid
    .newTx()
    .collectFrom(
      [saleUTxO],
      Data.to<SaleRedeemer>(saleRedeemer)
    )
    .readFrom([settingsUTxO])
    .mintAssets(
      mintAssets,
      Data.to<MintAction>(mintRedeemer)
    )
    .pay.ToAddress(tier.events.organizer_wallet_address, {
      lovelace: organizerPayment
    })
    .pay.ToAddress(settings.platform_treasury, {
      lovelace: platformFee
    })
    .pay.ToAddressWithData(
      saleAddress,
      { kind: 'inline', value: saleUTxO.datum! },
      { lovelace: 2_000_000n }
    )
    .attachMetadata(721, metadata)
    .addSigner(buyerAddress)
    .attach.MintingPolicy(mintingPolicyScript)
    .attach.SpendingValidator(saleValidatorScript)
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

  const sellerAddress = await lucid.wallet().address();
  const scripts = await loadScripts();

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

  // Build ticket datum with proper type annotations
  const ticketDatumValue: TicketDatum = {
    event_policy: event.event_policy_id,
    token_name: fromText(params.ticketAssetName),
    original_mint_price: BigInt(tier.price_lovelace),
    price: adaToLovelace(params.priceAda), // ADA -> Lovelace conversion
    artist: event.organizer_wallet_address,
    royalty_rate: 1000n, // 10% in basis points
    seller: sellerAddress,
    event_id: fromText(params.eventId),
    seat_number: null,
  };
  const ticketDatum = Data.to<TicketDatum>(ticketDatumValue);

  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');
  const storefrontScript: Script = { type: 'PlutusV3', script: scripts.storefrontValidator };
  const storefrontAddress = validatorToAddress(network, storefrontScript);

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

  return { txHash, listingUTxORef: listingRef };
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
  await supabase.from('events').insert({
    id: eventId,
    event_name: params.eventName,
    event_description: params.eventDescription,
    event_date: params.eventDate.toISOString(),
    event_location: params.location,
    venue_name: params.venue,
    organizer_wallet_address: organizerAddress,
    banner_image_url: params.bannerImageUrl,
    category: params.category,
    status: 'active',
    event_policy_id: policyId,
  });

  const tiersToInsert = params.ticketTiers.map(tier => ({
    event_id: eventId,
    tier_name: tier.tierName,
    tier_description: tier.tierDescription,
    price_lovelace: Math.floor(tier.priceAda * 1_000_000), // ADA -> Lovelace
    total_supply: tier.totalSupply,
    remaining_supply: tier.totalSupply,
    max_per_wallet: tier.maxPerWallet,
  }));

  await supabase.from('ticket_tiers').insert(tiersToInsert);
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
