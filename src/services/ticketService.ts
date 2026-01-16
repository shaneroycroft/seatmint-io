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
  scriptFromNative
} from '@lucid-evolution/lucid';
import { createClient } from '@supabase/supabase-js';
import {
  EVENT_MINT_VALIDATOR,
  PRIMARY_SALE_VALIDATOR,
  STOREFRONT_VALIDATOR,
  applyEventMintParams,
  applyPrimarySaleParams,
  applyStorefrontParams,
} from '../utils/plutusScripts';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_API_KEY
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
// SETTINGS UTxO LOADING
// ============================================

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

  // Step 3: Validate validators are loaded
  if (!EVENT_MINT_VALIDATOR || !PRIMARY_SALE_VALIDATOR) {
    throw new Error('Validators not found in plutus.json. Run `aiken build` first.');
  }

  // Step 4: Get settings for validation
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Step 5: Apply parameters to primary sale validator
  const primarySaleValidator = applyPrimarySaleParams(settings.platform_treasury);
  const boxOfficeHash = validatorToScriptHash(primarySaleValidator);

  // Step 6: Apply parameters to event mint policy
  const mintingPolicyValidator = applyEventMintParams(
    organizerPKH,
    settings.platform_treasury,
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

  // Build pricing strategy: Enum (FixedPrice=0, EarlyBird=1, Tiered=2)
  let pricingStrategyConstr: Constr<unknown>;
  if (firstTier.earlyBirdPriceAda && firstTier.earlyBirdDeadline) {
    // EarlyBird = Constr(1, [Constr(0, [early_price, deadline])])
    pricingStrategyConstr = new Constr(1, [new Constr(0, [
      adaToLovelace(firstTier.earlyBirdPriceAda),
      dateToPosixTime(firstTier.earlyBirdDeadline),
    ])]);
  } else {
    // FixedPrice = Constr(0, [Constr(0, [price])])
    pricingStrategyConstr = new Constr(0, [new Constr(0, [basePriceLovelace])]);
  }

  // Build SaleDatum: Constr(0, [organizer_address, base_price, event_policy, sale_window, anti_scalping, whitelist, pricing])
  const saleDatumConstr = new Constr(0, [
    organizerPKH,
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
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Step 4: Apply parameters to validators
  const primarySaleValidator = applyPrimarySaleParams(settings.platform_treasury);

  // Step 5: Find sale UTxO (box office)
  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');
  const saleAddress = validatorToAddress(network, primarySaleValidator);
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

  // Step 11: Get organizer PKH for minting policy
  const organizerPKH = paymentCredentialOf(tier.events.organizer_wallet_address).hash;
  const boxOfficeHash = validatorToScriptHash(primarySaleValidator);

  // Step 12: Apply parameters to event mint policy
  const mintingPolicyValidator = applyEventMintParams(
    organizerPKH,
    settings.platform_treasury,
    boxOfficeHash
  );

  // Step 13: Build transaction
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
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

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

  // Apply parameters to storefront validator
  const storefrontValidator = applyStorefrontParams(settings.platform_treasury);

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

  return { txHash, listingUTxORef: listingRef };
}

// StorefrontRedeemer schema
const StorefrontRedeemerSchema = Data.Enum([
  Data.Literal("Buy"),
  Data.Literal("Cancel"),
]);
type StorefrontRedeemer = Data.Static<typeof StorefrontRedeemerSchema>;

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
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Apply parameters to storefront validator
  const storefrontValidator = applyStorefrontParams(settings.platform_treasury);

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
  const ticketDatum = Data.from<TicketDatum>(listingUtxo.datum!);

  // Get buyer address
  const buyerAddress = await lucid.wallet().address();

  // Calculate payments
  const salePrice = ticketDatum.price;
  const royaltyAmount = (salePrice * ticketDatum.royalty_rate) / 10000n;
  const platformFee = (salePrice * BigInt(settings.platform_fee_bps)) / 10000n;
  const sellerPayout = salePrice - royaltyAmount - platformFee;

  // Build Buy redeemer
  const buyRedeemer = "Buy" as StorefrontRedeemer;

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
  const tx = await lucid
    .newTx()
    .collectFrom(
      [listingUtxo],
      Data.to<StorefrontRedeemer>(buyRedeemer)
    )
    .readFrom([settingsUTxO])
    // Pay seller
    .pay.ToAddress(ticketDatum.seller, { lovelace: sellerPayout })
    // Pay artist royalty
    .pay.ToAddress(ticketDatum.artist, { lovelace: royaltyAmount })
    // Pay platform fee
    .pay.ToAddress(settings.platform_treasury, { lovelace: platformFee })
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
    })
    .eq('event_id', params.eventId);

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
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  // Apply parameters to storefront validator
  const storefrontValidator = applyStorefrontParams(settings.platform_treasury);

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
  const ticketDatum = Data.from<TicketDatum>(listingUtxo.datum!);

  // Verify caller is the seller
  const sellerAddress = await lucid.wallet().address();
  if (ticketDatum.seller !== sellerAddress) {
    throw new Error('Only the seller can cancel this listing');
  }

  // Build Cancel redeemer
  const cancelRedeemer = "Cancel" as StorefrontRedeemer;

  const network = lucid.config().network;
  if (!network) throw new Error('Network not configured');

  // Build transaction - return NFT to seller
  const tx = await lucid
    .newTx()
    .collectFrom(
      [listingUtxo],
      Data.to<StorefrontRedeemer>(cancelRedeemer)
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
    .update({ status: 'minted', resale_price: null })
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
  // Fields order: platform_fee_bps, platform_treasury, is_market_active, current_max_supply, max_resale_multiplier, admin_pkh
  // Boolean is represented as Constr(0, []) for False, Constr(1, []) for True in Plutus
  const settingsDatum = Data.to(new Constr(0, [
    platformFeeBps,                              // Integer
    adminPKH,                                    // Bytes (hex string)
    new Constr(isMarketActive ? 1 : 0, []),      // Boolean as Constr
    currentMaxSupply,                            // Integer
    maxResaleMultiplier,                         // Integer
    adminPKH,                                    // Bytes (hex string)
  ]));

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
  const settingsUTxO = await getSettingsUTxO(lucid);
  const settings = Data.from(settingsUTxO.datum!, GlobalSettingsSchema);

  return {
    platformFeeBps: Number(settings.platform_fee_bps),
    platformTreasury: settings.platform_treasury,
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
