import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  listTicketForResale,
  purchaseFromStorefront,
  cancelStorefrontListing,
  transferTicket,
} from '../services/ticketService';

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
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

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

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: listingsData } = await supabase
        .from('tickets')
        .select(`
          *,
          events (event_name, event_date, venue_name),
          ticket_tiers (tier_name, price_lovelace)
        `)
        .eq('status', 'listed')
        .neq('current_owner_address', userAddress);

      const { data: myTicketsData } = await supabase
        .from('tickets')
        .select(`
          *,
          events (event_name, event_date, venue_name),
          ticket_tiers (tier_name, price_lovelace)
        `)
        .eq('current_owner_address', userAddress);

      setListings(formatTickets(listingsData || []));
      setMyTickets(formatTickets(myTicketsData || []));
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

  const handleListTicketForSale = async (ticket: Ticket, priceAda: number) => {
    setError(null);
    setActionInProgress('listing');
    try {
      console.log('Listing ticket:', ticket.id, 'for', priceAda, 'ADA');
      const result = await listTicketForResale(lucid, {
        ticketAssetName: ticket.nft_asset_name,
        priceAda,
        eventId: ticket.event_id,
      });
      console.log('Listed successfully:', result);
      loadData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to list ticket');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCancelListing = async (ticket: Ticket) => {
    setError(null);
    setActionInProgress('canceling');
    try {
      if (!ticket.listing_utxo_ref) {
        throw new Error('No listing UTxO reference found');
      }
      console.log('Canceling listing:', ticket.id);
      const result = await cancelStorefrontListing(lucid, {
        listingUtxoRef: ticket.listing_utxo_ref,
        ticketId: ticket.id,
      });
      console.log('Canceled successfully:', result);
      loadData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to cancel listing');
    } finally {
      setActionInProgress(null);
    }
  };

  const handlePurchaseTicket = async (ticket: Ticket) => {
    if (!ticket.resale_price || !ticket.listing_utxo_ref) return;

    setError(null);
    setIsPurchasing(true);
    try {
      console.log('Purchasing ticket:', ticket.id);
      const result = await purchaseFromStorefront(lucid, {
        listingUtxoRef: ticket.listing_utxo_ref,
        eventId: ticket.event_id,
      });
      console.log('Purchased successfully:', result);
      setSelectedTicket(null);
      loadData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to purchase ticket');
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleTransferTicket = async (ticket: Ticket, recipientAddress: string) => {
    setError(null);
    setActionInProgress('transferring');
    try {
      console.log('Transferring ticket:', ticket.id, 'to', recipientAddress);
      const result = await transferTicket(lucid, {
        ticketAssetName: ticket.nft_asset_name,
        recipientAddress,
        eventPolicyId: ticket.event_policy_id,
      });
      console.log('Transferred successfully:', result);
      loadData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to transfer ticket');
    } finally {
      setActionInProgress(null);
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

          {/* Tab Switcher */}
          <div className="flex gap-2">
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

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex justify-between items-start">
              <p className="text-sm text-red-700">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600 ml-2"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Action in Progress */}
        {actionInProgress && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-sm text-blue-700 flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              {actionInProgress === 'listing' && 'Listing ticket...'}
              {actionInProgress === 'canceling' && 'Canceling listing...'}
              {actionInProgress === 'transferring' && 'Transferring ticket...'}
            </p>
          </div>
        )}

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
                    className="w-full bg-red-500 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-red-600 transition-all"
                  >
                    Cancel Listing
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        const price = prompt('List price (ADA):');
                        if (price) handleListTicketForSale(selectedTicket, parseFloat(price));
                      }}
                      className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-blue-700 transition-all"
                    >
                      List for Sale
                    </button>
                    <button
                      onClick={() => {
                        const recipient = prompt('Recipient address:');
                        if (recipient) handleTransferTicket(selectedTicket, recipient);
                      }}
                      className="w-full bg-slate-200 text-slate-700 py-4 rounded-2xl font-bold hover:bg-slate-300 transition-all"
                    >
                      Transfer to Friend
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
