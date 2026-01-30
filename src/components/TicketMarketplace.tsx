import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  listTicketForResale,
  cancelStorefrontListing,
  transferTicket,
  syncWalletTickets,
  getWalletTicketNfts,
} from '../services/ticketService';
import { useToast, TOAST_MESSAGES } from '../contexts/ToastContext';
import { TicketPreview } from './TicketPreview';

interface Ticket {
  id: string;
  event_id: string;
  event_name: string;
  tier_name: string;
  ticket_number: number;
  current_owner: string;
  original_price: number;
  resale_price: number | null;
  is_listed: boolean;
  event_date: string;
  venue: string;
  venue_address: string;
  nft_asset_name: string;
  listing_utxo_ref: string | null;
  event_policy_id: string;
}

interface MarketplaceProps {
  lucid: any;
  userAddress: string;
}

// Color scheme based on tier type
const TIER_COLORS: Record<string, string> = {
  vip: 'bg-terracotta-600',
  backstage: 'bg-terracotta-600',
  premium: 'bg-terracotta-600',
  general: 'bg-forest-600',
  standard: 'bg-forest-600',
  default: 'bg-forest-600',
};

const getTierColor = (tierName: string): string => {
  const lower = tierName.toLowerCase();
  for (const [key, value] of Object.entries(TIER_COLORS)) {
    if (lower.includes(key)) return value;
  }
  return TIER_COLORS.default;
};

export const TicketMarketplace: React.FC<MarketplaceProps> = ({ lucid, userAddress }) => {
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [_lastSyncResult, setLastSyncResult] = useState<{ discovered: number; updated: number } | null>(null);
  const [isListingMode, setIsListingMode] = useState(false);
  const [listingPrice, setListingPrice] = useState('');
  const toast = useToast();

  const platformFeePercent = 2;

  const purchaseBreakdown = useMemo(() => {
    if (!selectedTicket || !selectedTicket.resale_price) return null;
    const price = selectedTicket.resale_price;
    const fee = (price * platformFeePercent) / 100;
    return {
      subtotal: price,
      fee: fee,
      total: price + fee
    };
  }, [selectedTicket]);

  // Reset listing mode when ticket changes
  useEffect(() => {
    setIsListingMode(false);
    setListingPrice('');
  }, [selectedTicket]);

  useEffect(() => {
    loadData();
  }, [userAddress]);

  const handleSync = async () => {
    if (!lucid || isSyncing) return;

    setIsSyncing(true);
    try {
      const result = await syncWalletTickets(lucid, userAddress);
      setLastSyncResult({ discovered: result.discovered, updated: result.updated });

      const hasChanges = result.discovered > 0 || result.updated > 0 || result.missingFromWallet > 0 || result.duplicatesRemoved > 0;

      if (hasChanges) {
        // Reload data after sync
        await loadDataInternal();

        // Build appropriate message
        const parts: string[] = [];
        if (result.duplicatesRemoved > 0) parts.push(`${result.duplicatesRemoved} duplicate(s) cleaned up`);
        if (result.discovered > 0) parts.push(`${result.discovered} new ticket(s) found`);
        if (result.updated > 0) parts.push(`${result.updated} ownership updated`);
        if (result.missingFromWallet > 0) parts.push(`${result.missingFromWallet} ticket(s) no longer in wallet`);

        if (result.missingFromWallet > 0) {
          toast.info('Wallet Synced', parts.join(', ') + '. Tickets not in your wallet have been marked as transferred.');
        } else {
          toast.success('Wallet Synced', parts.join(', '));
        }
      } else {
        toast.success('Wallet Synced', 'Your tickets are already up to date');
      }
    } catch (err) {
      console.error('Sync failed:', err);
      toast.error('Sync Failed', 'Could not sync wallet with database');
    } finally {
      setIsSyncing(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    console.log('TicketMarketplace: Loading data for address:', userAddress);

    // Auto-sync wallet on load if lucid is available
    if (lucid) {
      try {
        const syncResult = await syncWalletTickets(lucid, userAddress);
        const hasChanges = syncResult.discovered > 0 || syncResult.updated > 0 || syncResult.missingFromWallet > 0 || syncResult.duplicatesRemoved > 0;
        if (hasChanges) {
          console.log('Auto-sync found changes:', syncResult);
          setLastSyncResult({ discovered: syncResult.discovered, updated: syncResult.updated });
          if (syncResult.duplicatesRemoved > 0) {
            console.log(`Auto-sync: ${syncResult.duplicatesRemoved} duplicate(s) cleaned up`);
          }
          if (syncResult.missingFromWallet > 0) {
            console.log(`Auto-sync: ${syncResult.missingFromWallet} ticket(s) marked as transferred (not in wallet)`);
          }
        }
      } catch (syncErr) {
        console.warn('Auto-sync failed:', syncErr);
      }
    }

    await loadDataInternal();
  };

  const loadDataInternal = async () => {
    try {
      // WALLET-FIRST APPROACH for "My Tickets"
      // Show tickets in wallet + user's listed tickets (at storefront contract)
      if (lucid) {
        const walletNfts = await getWalletTicketNfts(lucid);
        console.log('TicketMarketplace: Wallet contains', walletNfts.length, 'ticket NFTs');

        // Also get user's listed tickets (not in wallet, but user still "owns" them)
        const { data: listedTickets, error: listedError } = await supabase
          .from('tickets')
          .select(`
            *,
            events (event_name, event_date, venue_name, event_location, event_policy_id),
            ticket_tiers (tier_name, price_lovelace)
          `)
          .eq('status', 'listed')
          .eq('current_owner_address', userAddress);

        if (listedError) {
          console.error('Listed tickets query failed:', listedError);
        }
        console.log('TicketMarketplace: User has', listedTickets?.length || 0, 'listed tickets');

        let allMyTickets: Ticket[] = [];

        // Add listed tickets first (formatted from DB)
        if (listedTickets && listedTickets.length > 0) {
          allMyTickets = [...formatTickets(listedTickets)];
        }

        if (walletNfts.length > 0) {
          // Get the asset names of tickets in wallet
          const walletAssetNames = walletNfts.map(nft => nft.assetName);

          // Query DB only for tickets that are actually in the wallet
          const { data: myTicketsData, error: myTicketsError } = await supabase
            .from('tickets')
            .select(`
              *,
              events (event_name, event_date, venue_name, event_location, event_policy_id),
              ticket_tiers (tier_name, price_lovelace)
            `)
            .in('nft_asset_name', walletAssetNames);

          if (myTicketsError) {
            console.error('My tickets query failed:', myTicketsError);
          }

          console.log('TicketMarketplace: Found', myTicketsData?.length || 0, 'matching DB records');

          // If some wallet tickets don't have DB records, create display entries from wallet data
          const dbAssetNames = new Set((myTicketsData || []).map((t: any) => t.nft_asset_name));
          const missingFromDb = walletNfts.filter(nft => !dbAssetNames.has(nft.assetName));

          if (missingFromDb.length > 0) {
            console.log('TicketMarketplace: Creating display entries for', missingFromDb.length, 'tickets not in DB');
          }

          // Format tickets from DB
          const formattedFromDb = formatTickets(myTicketsData || []);

          // Create display entries for wallet tickets not in DB
          const formattedFromWallet = missingFromDb.map((nft, index) => ({
            id: `wallet-${nft.assetName}`,
            event_id: nft.eventId,
            event_name: nft.eventName,
            tier_name: nft.tierName,
            ticket_number: index + 1, // Placeholder number
            current_owner: userAddress,
            original_price: nft.priceLovalace / 1_000_000,
            resale_price: null,
            is_listed: false,
            event_date: '', // Not available from wallet scan
            venue: '',
            venue_address: '', // Not available from wallet scan
            nft_asset_name: nft.assetName,
            listing_utxo_ref: null,
            event_policy_id: nft.policyId,
          }));

          // Add wallet tickets (avoid duplicates with listed)
          const listedAssetNames = new Set((listedTickets || []).map((t: any) => t.nft_asset_name));
          const walletOnlyTickets = [...formattedFromDb, ...formattedFromWallet]
            .filter(t => !listedAssetNames.has(t.nft_asset_name));

          allMyTickets = [...allMyTickets, ...walletOnlyTickets];
        }

        setMyTickets(allMyTickets);
      } else {
        // No lucid instance, fall back to DB query (shouldn't happen normally)
        const { data: myTicketsData } = await supabase
          .from('tickets')
          .select(`
            *,
            events (event_name, event_date, venue_name, event_location, event_policy_id),
            ticket_tiers (tier_name, price_lovelace)
          `)
          .eq('current_owner_address', userAddress);

        setMyTickets(formatTickets(myTicketsData || []));
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTickets = (data: any[]): Ticket[] => {
    return data.map(ticket => ({
      id: ticket.id,
      event_id: ticket.event_id,
      event_name: ticket.events?.event_name || 'Unknown Event',
      tier_name: ticket.ticket_tiers?.tier_name || 'General',
      ticket_number: ticket.ticket_number,
      current_owner: ticket.current_owner_address,
      original_price: (ticket.ticket_tiers?.price_lovelace || 0) / 1_000_000,
      resale_price: ticket.resale_price ? ticket.resale_price / 1_000_000 : null,
      is_listed: ticket.status === 'listed',
      event_date: ticket.events?.event_date || '',
      venue: ticket.events?.venue_name || '',
      venue_address: ticket.events?.event_location || '',
      nft_asset_name: ticket.nft_asset_name || '',
      listing_utxo_ref: ticket.listing_utxo_ref || null,
      event_policy_id: ticket.events?.event_policy_id || '',
    }));
  };

  // Helper to create user-friendly error messages
  const getFriendlyErrorMessage = (err: unknown, defaultMsg: string): string => {
    const errorMessage = err instanceof Error ? err.message : 'Something went wrong';
    if (errorMessage.includes('user rejected') || errorMessage.includes('cancelled')) {
      return 'You cancelled the transaction. No worries - you can try again when ready.';
    }
    if (errorMessage.includes('insufficient')) {
      return 'Your wallet doesn\'t have enough ADA for this transaction.';
    }
    return defaultMsg;
  };

  const handleListTicketForSale = async (ticket: Ticket, priceAda: number) => {
    setIsProcessing(true);
    const pendingToastId = toast.pending(
      TOAST_MESSAGES.listingStarted.title,
      TOAST_MESSAGES.listingStarted.message
    );

    try {
      await listTicketForResale(lucid, {
        ticketAssetName: ticket.nft_asset_name,
        priceAda,
        eventId: ticket.event_id,
      });
      toast.dismissToast(pendingToastId);
      toast.success(
        TOAST_MESSAGES.listingSuccess.title,
        `Your ticket for ${ticket.event_name} is now listed at ₳${priceAda}.`
      );
      loadData();
    } catch (err) {
      console.error(err);
      toast.dismissToast(pendingToastId);
      toast.error(
        TOAST_MESSAGES.listingFailed.title,
        getFriendlyErrorMessage(err, 'We couldn\'t list your ticket. Please try again.')
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelListing = async (ticket: Ticket) => {
    setIsProcessing(true);
    const pendingToastId = toast.pending(
      'Removing Listing',
      'Please confirm in your wallet...'
    );

    try {
      if (!ticket.listing_utxo_ref) {
        throw new Error('No listing reference found');
      }
      await cancelStorefrontListing(lucid, {
        listingUtxoRef: ticket.listing_utxo_ref,
        ticketId: ticket.id,
      });
      toast.dismissToast(pendingToastId);
      toast.success(
        'Listing Removed',
        `Your ticket for ${ticket.event_name} has been removed from the marketplace.`
      );
      loadData();
    } catch (err) {
      console.error(err);
      toast.dismissToast(pendingToastId);
      toast.error(
        'Couldn\'t Remove Listing',
        getFriendlyErrorMessage(err, 'We couldn\'t remove your listing. Please try again.')
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTransferTicket = async (ticket: Ticket, recipientAddress: string) => {
    setIsProcessing(true);
    const pendingToastId = toast.pending(
      TOAST_MESSAGES.transferStarted.title,
      TOAST_MESSAGES.transferStarted.message
    );

    try {
      await transferTicket(lucid, {
        ticketAssetName: ticket.nft_asset_name,
        recipientAddress,
        eventPolicyId: ticket.event_policy_id,
      });
      toast.dismissToast(pendingToastId);
      toast.success(
        TOAST_MESSAGES.transferSuccess.title,
        `Your ticket for ${ticket.event_name} has been sent! The recipient will see it in their wallet shortly.`
      );
      loadData();
    } catch (err) {
      console.error(err);
      toast.dismissToast(pendingToastId);
      toast.error(
        TOAST_MESSAGES.transferFailed.title,
        getFriendlyErrorMessage(err, 'We couldn\'t transfer your ticket. Please check the address and try again.')
      );
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-warm-500">Loading marketplace...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white">
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto border-r border-warm-100">
        {/* Header */}
        <div className="px-6 py-4 border-b sticky top-0 bg-white/95 backdrop-blur-sm z-10 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-warm-900">My Tickets</h2>
            <p className="text-xs text-warm-500">
              {myTickets.length} ticket{myTickets.length !== 1 ? 's' : ''} in your collection
            </p>
          </div>

          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={isSyncing || !lucid}
            className="px-4 py-2 rounded-lg text-sm font-medium text-forest-600 hover:bg-forest-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            title="Sync wallet with database"
          >
            <svg className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isSyncing ? 'Syncing...' : 'Sync Wallet'}
          </button>
        </div>

        {/* Ticket Grid */}
        {myTickets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
            <div className="border-2 border-dashed border-warm-200 rounded-xl p-8 bg-white/50">
              <h4 className="text-sm font-semibold text-warm-700 mb-1">No tickets yet</h4>
              <p className="text-warm-400 text-xs">
                Purchase tickets from the Events page to see them here
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
            {myTickets.map((ticket) => (
              <div
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                className={`cursor-pointer transition-all ${
                  selectedTicket?.id === ticket.id ? 'ring-2 ring-forest-500 rounded-xl' : ''
                }`}
              >
                <TicketPreview
                  eventName={ticket.event_name}
                  venue={ticket.venue}
                  venueAddress={ticket.venue_address}
                  eventDate={ticket.event_date}
                  tierName={ticket.tier_name}
                  priceAda={ticket.resale_price || ticket.original_price}
                  ticketId={`${ticket.nft_asset_name?.slice(0, 8) || ticket.id.slice(0, 8)}`}
                  interactive={true}
                  qrCycleSeconds={30}
                  compact={true}
                />
                {ticket.is_listed && (
                  <div className="mt-1.5 text-center">
                    <span className="bg-sand-100 text-sand-700 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                      Listed ₳{ticket.resale_price}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sidebar - Ticket Details */}
      <aside className="w-full lg:w-[340px] bg-warm-50 p-5 flex flex-col shrink-0 border-l border-warm-200">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400 mb-4">
          Ticket Details
        </h3>

        {!selectedTicket ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-warm-200 rounded-xl p-6 bg-white/50">
            <p className="text-sm font-medium text-warm-600 mb-1">Select a ticket</p>
            <p className="text-warm-400 text-xs">
              Click a ticket to view details
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Selected Ticket Card */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-warm-200 mb-4 relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-1 h-full ${getTierColor(selectedTicket.tier_name)}`} />

              <div className="flex justify-between items-start mb-3">
                <h4 className="font-semibold text-base text-warm-900 leading-tight pr-3">
                  {selectedTicket.event_name}
                </h4>
                <button
                  onClick={() => setSelectedTicket(null)}
                  className="text-warm-400 hover:text-warm-600 text-lg leading-none"
                >
                  ×
                </button>
              </div>

              <div className="space-y-1 text-xs text-warm-500 mb-4">
                {selectedTicket.venue && <p>{selectedTicket.venue}</p>}
                {selectedTicket.event_date && <p>{new Date(selectedTicket.event_date).toLocaleDateString()}</p>}
                <p className="font-medium text-warm-700">{selectedTicket.tier_name} • #{selectedTicket.ticket_number}</p>
              </div>

              {selectedTicket.resale_price && purchaseBreakdown && (
                <>
                  <div className="space-y-2 py-3 border-t border-warm-100">
                    <div className="flex justify-between text-xs">
                      <span className="text-warm-500">Price</span>
                      <span className="font-medium text-warm-900">₳{purchaseBreakdown.subtotal}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-warm-500">Fee ({platformFeePercent}%)</span>
                      <span className="font-medium text-warm-900">₳{purchaseBreakdown.fee.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-dashed border-warm-200 flex justify-between items-center">
                    <span className="text-xs font-medium text-warm-500">Total</span>
                    <span className="text-xl font-semibold text-warm-900">₳{purchaseBreakdown.total.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Ticket Actions */}
            {(
              <div className="space-y-2">
                {selectedTicket.is_listed ? (
                  <>
                    <div className="bg-forest-50 border border-forest-100 rounded-lg p-3 mb-2">
                      <p className="text-forest-700 text-xs font-medium">Listed for Sale</p>
                      <p className="text-forest-800 text-lg font-semibold">₳{selectedTicket.resale_price}</p>
                    </div>
                    <button
                      onClick={() => handleCancelListing(selectedTicket)}
                      disabled={isProcessing}
                      className="w-full bg-terracotta-500 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-terracotta-600 transition-all disabled:opacity-50"
                    >
                      {isProcessing ? 'Processing...' : 'Cancel Listing'}
                    </button>
                  </>
                ) : isListingMode ? (
                  /* Listing Price Input */
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-warm-600 mb-1.5">Set Your Price</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400 text-sm">₳</span>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={listingPrice}
                          onChange={(e) => setListingPrice(e.target.value)}
                          placeholder="0.00"
                          className="w-full pl-8 pr-3 py-2.5 bg-warm-50 border border-warm-200 rounded-lg text-lg font-semibold text-warm-900 focus:outline-none focus:ring-2 focus:ring-forest-500"
                          autoFocus
                        />
                      </div>
                      <p className="text-[11px] text-warm-400 mt-1.5">
                        Max: ₳{(selectedTicket.original_price * 3).toFixed(2)} (3x original)
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        const price = parseFloat(listingPrice);
                        if (price > 0) {
                          handleListTicketForSale(selectedTicket, price);
                          setIsListingMode(false);
                          setListingPrice('');
                        }
                      }}
                      disabled={isProcessing || !listingPrice || parseFloat(listingPrice) <= 0}
                      className="w-full bg-forest-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-forest-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? 'Processing...' : 'Confirm Listing'}
                    </button>
                    <button
                      onClick={() => {
                        setIsListingMode(false);
                        setListingPrice('');
                      }}
                      className="w-full bg-warm-200 text-warm-700 py-2 rounded-lg text-sm font-medium hover:bg-warm-300 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setIsListingMode(true)}
                      disabled={isProcessing}
                      className="w-full bg-forest-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-forest-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      List for Sale
                    </button>
                    <button
                      onClick={() => {
                        const recipient = prompt('Recipient address:');
                        if (recipient) handleTransferTicket(selectedTicket, recipient);
                      }}
                      disabled={isProcessing}
                      className="w-full bg-warm-200 text-warm-700 py-2.5 rounded-lg text-sm font-medium hover:bg-warm-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? 'Processing...' : 'Transfer to Friend'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};
