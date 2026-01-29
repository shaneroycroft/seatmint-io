import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  listTicketForResale,
  purchaseFromStorefront,
  cancelStorefrontListing,
  transferTicket,
  syncWalletTickets,
  getWalletTicketNfts,
} from '../services/ticketService';
import { useToast, TOAST_MESSAGES } from '../contexts/ToastContext';

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
  vip: 'bg-purple-600',
  backstage: 'bg-red-600',
  premium: 'bg-red-600',
  general: 'bg-blue-600',
  standard: 'bg-blue-600',
  default: 'bg-emerald-600',
};

const getTierColor = (tierName: string): string => {
  const lower = tierName.toLowerCase();
  for (const [key, value] of Object.entries(TIER_COLORS)) {
    if (lower.includes(key)) return value;
  }
  return TIER_COLORS.default;
};

export const TicketMarketplace: React.FC<MarketplaceProps> = ({ lucid, userAddress }) => {
  const [listings, setListings] = useState<Ticket[]>([]);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [activeTab, setActiveTab] = useState<'browse' | 'my-tickets'>('browse');
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [_lastSyncResult, setLastSyncResult] = useState<{ discovered: number; updated: number } | null>(null);
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
      // Load marketplace listings (tickets listed by others)
      const { data: listingsData, error: listingsError } = await supabase
        .from('tickets')
        .select(`
          *,
          events (event_name, event_date, venue_name, event_policy_id),
          ticket_tiers (tier_name, price_lovelace)
        `)
        .eq('status', 'listed')
        .neq('current_owner_address', userAddress);

      if (listingsError) {
        console.error('Listings query failed:', listingsError);
      }

      console.log('TicketMarketplace: Found', listingsData?.length || 0, 'listings');
      setListings(formatTickets(listingsData || []));

      // WALLET-FIRST APPROACH for "My Tickets"
      // Only show tickets that are actually in the user's wallet
      if (lucid) {
        const walletNfts = await getWalletTicketNfts(lucid);
        console.log('TicketMarketplace: Wallet contains', walletNfts.length, 'ticket NFTs');

        if (walletNfts.length > 0) {
          // Get the asset names of tickets in wallet
          const walletAssetNames = walletNfts.map(nft => nft.assetName);

          // Query DB only for tickets that are actually in the wallet
          const { data: myTicketsData, error: myTicketsError } = await supabase
            .from('tickets')
            .select(`
              *,
              events (event_name, event_date, venue_name, event_policy_id),
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
            nft_asset_name: nft.assetName,
            listing_utxo_ref: null,
            event_policy_id: nft.policyId,
          }));

          setMyTickets([...formattedFromDb, ...formattedFromWallet]);
        } else {
          // No tickets in wallet
          setMyTickets([]);
        }
      } else {
        // No lucid instance, fall back to DB query (shouldn't happen normally)
        const { data: myTicketsData } = await supabase
          .from('tickets')
          .select(`
            *,
            events (event_name, event_date, venue_name, event_policy_id),
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

  const handlePurchaseTicket = async (ticket: Ticket) => {
    if (!ticket.resale_price || !ticket.listing_utxo_ref) return;

    setIsPurchasing(true);
    const pendingToastId = toast.pending(
      TOAST_MESSAGES.purchaseStarted.title,
      TOAST_MESSAGES.purchaseStarted.message
    );

    try {
      await purchaseFromStorefront(lucid, {
        listingUtxoRef: ticket.listing_utxo_ref,
        eventId: ticket.event_id,
      });
      toast.dismissToast(pendingToastId);
      toast.success(
        TOAST_MESSAGES.purchaseSuccess.title,
        `Your ticket for ${ticket.event_name} is on its way! Check My Tickets shortly.`
      );
      setSelectedTicket(null);
      loadData();
    } catch (err) {
      console.error(err);
      toast.dismissToast(pendingToastId);
      toast.error(
        TOAST_MESSAGES.purchaseFailed.title,
        getFriendlyErrorMessage(err, 'We couldn\'t complete your purchase. Please try again.')
      );
    } finally {
      setIsPurchasing(false);
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
        <div className="text-slate-500">Loading marketplace...</div>
      </div>
    );
  }

  const displayTickets = activeTab === 'browse' ? listings : myTickets;

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white">
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto border-r border-slate-100">
        {/* Header */}
        <div className="p-8 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10 flex justify-between items-end">
          <div>
            <p className="text-blue-600 font-bold text-xs uppercase tracking-[0.2em] mb-1">
              {activeTab === 'browse' ? 'Live Marketplace' : 'Your Collection'}
            </p>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">
              {activeTab === 'browse' ? 'Available Tickets' : 'My Tickets'}
            </h2>
          </div>

          {/* Tab Switcher and Sync */}
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setActiveTab('browse')}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                activeTab === 'browse'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              Browse ({listings.length})
            </button>
            <button
              onClick={() => setActiveTab('my-tickets')}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                activeTab === 'my-tickets'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              My Tickets ({myTickets.length})
            </button>
            <button
              onClick={handleSync}
              disabled={isSyncing || !lucid}
              className="px-3 py-2 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title="Sync wallet with database"
            >
              <svg className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isSyncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        </div>

        {/* Ticket Grid */}
        {displayTickets.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-16">
            <div className="border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
              <h4 className="text-lg font-bold text-slate-800 mb-2">
                {activeTab === 'browse' ? 'No tickets available' : 'No tickets yet'}
              </h4>
              <p className="text-slate-400 text-sm">
                {activeTab === 'browse'
                  ? 'Check back later for new listings'
                  : 'Purchase tickets from events to see them here'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-100">
            {displayTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                isSelected={selectedTicket?.id === ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                mode={activeTab}
                onList={(price) => handleListTicketForSale(ticket, price)}
                onCancel={() => handleCancelListing(ticket)}
                onTransfer={(addr) => handleTransferTicket(ticket, addr)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar - Order Summary */}
      <aside className="w-full lg:w-[400px] bg-slate-50 p-8 flex flex-col shrink-0">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-8">
          Order Summary
        </h3>

        {!selectedTicket ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
            <h4 className="text-lg font-bold text-slate-800 mb-2">Select a ticket</h4>
            <p className="text-slate-400 text-sm">
              Review contract details and finalize purchase.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Selected Ticket Card */}
            <div className="bg-white p-8 rounded-[32px] shadow-xl border border-white mb-6 relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-2 h-full ${getTierColor(selectedTicket.tier_name)}`} />

              <div className="flex justify-between items-start mb-6">
                <h4 className="font-black text-2xl text-slate-900 leading-tight pr-4">
                  {selectedTicket.event_name}
                </h4>
                <button
                  onClick={() => setSelectedTicket(null)}
                  className="text-slate-400 hover:text-slate-900 text-xl"
                >
                  ×
                </button>
              </div>

              <div className="space-y-2 text-sm text-slate-500 mb-6">
                <p>{selectedTicket.venue}</p>
                <p>{new Date(selectedTicket.event_date).toLocaleDateString()}</p>
                <p className="font-semibold text-slate-700">{selectedTicket.tier_name}</p>
              </div>

              {selectedTicket.resale_price && purchaseBreakdown && (
                <>
                  <div className="space-y-4 py-6 border-t border-slate-50">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Price</span>
                      <span className="font-mono font-bold text-slate-900">
                        ₳{purchaseBreakdown.subtotal}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Fee ({platformFeePercent}%)</span>
                      <span className="font-mono font-bold text-slate-900">
                        ₳{purchaseBreakdown.fee.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="pt-6 border-t-2 border-dashed border-slate-100 flex justify-between items-end">
                    <span className="text-xs font-black uppercase text-slate-400 tracking-widest">Total</span>
                    <span className="text-4xl font-black text-slate-900 tracking-tighter">
                      ₳{purchaseBreakdown.total.toFixed(2)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Buy Button */}
            {activeTab === 'browse' && selectedTicket.resale_price && (
              <button
                onClick={() => handlePurchaseTicket(selectedTicket)}
                disabled={isPurchasing}
                className="w-full bg-slate-900 text-white py-6 rounded-2xl font-black text-lg shadow-xl hover:bg-black transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {isPurchasing ? 'Signing...' : 'Confirm & Buy Ticket'}
              </button>
            )}

            {/* My Tickets Actions */}
            {activeTab === 'my-tickets' && (
              <div className="space-y-3">
                {selectedTicket.is_listed ? (
                  <button
                    onClick={() => handleCancelListing(selectedTicket)}
                    disabled={isProcessing}
                    className="w-full bg-red-500 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isProcessing ? 'Processing...' : 'Cancel Listing'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const price = prompt('List price (ADA):');
                        if (price) handleListTicketForSale(selectedTicket, parseFloat(price));
                      }}
                      disabled={isProcessing}
                      className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? 'Processing...' : 'List for Sale'}
                    </button>
                    <button
                      onClick={() => {
                        const recipient = prompt('Recipient address:');
                        if (recipient) handleTransferTicket(selectedTicket, recipient);
                      }}
                      disabled={isProcessing}
                      className="w-full bg-slate-200 text-slate-700 py-4 rounded-2xl font-bold hover:bg-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

// Ticket Card Component
interface TicketCardProps {
  ticket: Ticket;
  isSelected: boolean;
  onClick: () => void;
  mode: 'browse' | 'my-tickets';
  onList: (price: number) => void;
  onCancel: () => void;
  onTransfer: (address: string) => void;
}

const TicketCard: React.FC<TicketCardProps> = ({ ticket, isSelected, onClick, mode }) => {
  const tierColor = getTierColor(ticket.tier_name);
  const maxResalePrice = ticket.original_price * 3;
  const isPriceValid = !ticket.resale_price || ticket.resale_price <= maxResalePrice;

  return (
    <div
      onClick={onClick}
      className={`bg-white p-6 flex flex-col cursor-pointer transition-all duration-300 hover:z-20 hover:shadow-2xl ${
        isSelected ? 'ring-2 ring-blue-600 z-10' : ''
      }`}
    >
      {/* Ticket Visual */}
      <div className={`w-full aspect-[16/9] ${tierColor} rounded-2xl mb-5 p-4 flex flex-col justify-between text-white relative overflow-hidden shadow-lg`}>
        {/* Watermark */}
        <div className="absolute top-0 right-0 p-8 opacity-10 scale-150 rotate-12 text-9xl font-black select-none pointer-events-none">
          TICKET
        </div>

        <div className="flex justify-between items-start relative z-10">
          <div className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest italic">
            {ticket.tier_name}
          </div>
          {ticket.is_listed && (
            <div className="bg-green-500 px-2 py-1 rounded text-[9px] font-bold uppercase">
              Listed
            </div>
          )}
        </div>

        <div className="relative z-10">
          <h4 className="text-xl font-black leading-tight mb-1 truncate">{ticket.event_name}</h4>
          <p className="text-xs font-medium opacity-80 uppercase tracking-wider">{ticket.venue}</p>
        </div>
      </div>

      {/* Details Below Card */}
      <div className="flex justify-between items-end">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
            {new Date(ticket.event_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
          <p className="text-sm font-bold text-slate-700">#{ticket.ticket_number}</p>
        </div>
        <div className="text-right">
          {mode === 'browse' && ticket.resale_price ? (
            <>
              <p className="text-2xl font-black text-slate-900 tracking-tighter">
                ₳{ticket.resale_price}
              </p>
              {!isPriceValid && (
                <p className="text-xs text-red-500 font-medium">Above cap</p>
              )}
            </>
          ) : (
            <p className="text-lg font-bold text-slate-500">
              ₳{ticket.original_price}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
