import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { purchaseFromStorefront } from '../services/ticketService';

interface Listing {
  id: string;
  event_id: string;
  event_name: string;
  tier_name: string;
  ticket_number: number;
  seller_address: string;
  original_price: number;
  resale_price: number;
  event_date: string;
  venue: string;
  nft_asset_name: string;
  listing_utxo_ref: string;
  event_policy_id: string;
}

interface ResaleProps {
  lucid: any;
  userAddress: string;
}

// Color scheme based on tier type
const TIER_COLORS: Record<string, string> = {
  vip: 'bg-purple-600',
  backstage: 'bg-red-600',
  premium: 'bg-amber-600',
  general: 'bg-blue-600',
  standard: 'bg-slate-600',
  default: 'bg-emerald-600',
};

const getTierColor = (tierName: string): string => {
  const lower = tierName.toLowerCase();
  for (const [key, value] of Object.entries(TIER_COLORS)) {
    if (lower.includes(key)) return value;
  }
  return TIER_COLORS.default;
};

export const Resale: React.FC<ResaleProps> = ({ lucid, userAddress }) => {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const platformFeePercent = 2;

  const purchaseBreakdown = useMemo(() => {
    if (!selectedListing) return null;
    const price = selectedListing.resale_price;
    const fee = (price * platformFeePercent) / 100;
    return {
      subtotal: price,
      fee: fee,
      total: price + fee
    };
  }, [selectedListing]);

  useEffect(() => {
    loadListings();
  }, [userAddress]);

  const loadListings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          *,
          events (event_name, event_date, venue_name, event_policy_id),
          ticket_tiers (tier_name, price_lovelace)
        `)
        .eq('status', 'listed')
        .neq('current_owner_address', userAddress);

      if (error) throw error;

      const formattedListings: Listing[] = (data || []).map(ticket => ({
        id: ticket.id,
        event_id: ticket.event_id,
        event_name: ticket.events?.event_name || 'Unknown Event',
        tier_name: ticket.ticket_tiers?.tier_name || 'General',
        ticket_number: ticket.ticket_number,
        seller_address: ticket.current_owner_address,
        original_price: (ticket.ticket_tiers?.price_lovelace || 0) / 1_000_000,
        resale_price: ticket.resale_price ? ticket.resale_price / 1_000_000 : 0,
        event_date: ticket.events?.event_date || '',
        venue: ticket.events?.venue_name || '',
        nft_asset_name: ticket.nft_asset_name || '',
        listing_utxo_ref: ticket.listing_utxo_ref || '',
        event_policy_id: ticket.events?.event_policy_id || '',
      }));

      setListings(formattedListings);
    } catch (err) {
      console.error('Failed to load listings:', err);
      setError('Failed to load resale listings');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (!selectedListing || !selectedListing.listing_utxo_ref) return;

    setError(null);
    setSuccess(null);
    setIsPurchasing(true);

    try {
      const result = await purchaseFromStorefront(lucid, {
        listingUtxoRef: selectedListing.listing_utxo_ref,
        eventId: selectedListing.event_id,
      });

      setSuccess(`Ticket purchased! TX: ${result.txHash.slice(0, 16)}...`);
      setSelectedListing(null);
      loadListings();
    } catch (err) {
      console.error('Purchase failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to purchase ticket');
    } finally {
      setIsPurchasing(false);
    }
  };

  const filteredListings = listings.filter(listing =>
    listing.event_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    listing.venue.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-500">Loading resale listings...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col lg:flex-row bg-white">
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto border-r border-slate-100">
        {/* Header */}
        <div className="p-8 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-orange-600 font-bold text-xs uppercase tracking-[0.2em] mb-1">
                Secondary Market
              </p>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">
                Resale Tickets
              </h2>
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search listings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full md:w-80 px-4 py-2 pl-10 bg-slate-100 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Listings Grid */}
        {filteredListings.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-16">
            <div className="border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
              <h4 className="text-lg font-bold text-slate-800 mb-2">
                {searchQuery ? 'No matching listings' : 'No tickets for resale'}
              </h4>
              <p className="text-slate-400 text-sm">
                {searchQuery ? 'Try a different search term' : 'Check back later for resale listings'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-slate-100">
            {filteredListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isSelected={selectedListing?.id === listing.id}
                onClick={() => {
                  setSelectedListing(listing);
                  setError(null);
                  setSuccess(null);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sidebar - Purchase Panel */}
      <aside className="w-full lg:w-[400px] bg-slate-50 p-8 flex flex-col shrink-0">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-8">
          Order Summary
        </h3>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex justify-between items-start">
              <p className="text-sm text-red-700">{error}</p>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-2">×</button>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex justify-between items-start">
              <p className="text-sm text-green-700">{success}</p>
              <button onClick={() => setSuccess(null)} className="text-green-400 hover:text-green-600 ml-2">×</button>
            </div>
          </div>
        )}

        {!selectedListing ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-4 border-dashed border-slate-200 rounded-[32px] p-10 bg-white/50">
            <h4 className="text-lg font-bold text-slate-800 mb-2">Select a listing</h4>
            <p className="text-slate-400 text-sm">
              Choose a ticket to review and purchase.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Selected Listing Card */}
            <div className="bg-white p-8 rounded-[32px] shadow-xl border border-white mb-6 relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-2 h-full ${getTierColor(selectedListing.tier_name)}`} />

              <div className="flex justify-between items-start mb-6">
                <h4 className="font-black text-2xl text-slate-900 leading-tight pr-4">
                  {selectedListing.event_name}
                </h4>
                <button
                  onClick={() => setSelectedListing(null)}
                  className="text-slate-400 hover:text-slate-900 text-xl"
                >
                  ×
                </button>
              </div>

              <div className="space-y-2 text-sm text-slate-500 mb-6">
                <p>{selectedListing.venue}</p>
                <p>{new Date(selectedListing.event_date).toLocaleDateString()}</p>
                <p className="font-semibold text-slate-700">{selectedListing.tier_name}</p>
              </div>

              {/* Price Comparison */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-slate-400">Original:</span>
                <span className="text-sm text-slate-500 line-through">₳{selectedListing.original_price}</span>
              </div>

              {purchaseBreakdown && (
                <>
                  <div className="space-y-4 py-6 border-t border-slate-50">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Resale Price</span>
                      <span className="font-mono font-bold text-slate-900">
                        ₳{purchaseBreakdown.subtotal}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Platform Fee ({platformFeePercent}%)</span>
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

            {/* Seller Info */}
            <div className="bg-white p-4 rounded-xl mb-6">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Seller</p>
              <p className="text-sm font-mono text-slate-600 truncate">
                {selectedListing.seller_address.slice(0, 20)}...{selectedListing.seller_address.slice(-8)}
              </p>
            </div>

            {/* Buy Button */}
            <button
              onClick={handlePurchase}
              disabled={isPurchasing}
              className="w-full bg-orange-600 text-white py-6 rounded-2xl font-black text-lg shadow-xl hover:bg-orange-700 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isPurchasing ? (
                <>
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                'Buy from Resale'
              )}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
};

// Listing Card Component
interface ListingCardProps {
  listing: Listing;
  isSelected: boolean;
  onClick: () => void;
}

const ListingCard: React.FC<ListingCardProps> = ({ listing, isSelected, onClick }) => {
  const tierColor = getTierColor(listing.tier_name);
  const priceChange = ((listing.resale_price - listing.original_price) / listing.original_price) * 100;

  return (
    <div
      onClick={onClick}
      className={`bg-white p-6 flex flex-col cursor-pointer transition-all duration-300 hover:z-20 hover:shadow-2xl ${
        isSelected ? 'ring-2 ring-orange-600 z-10' : ''
      }`}
    >
      {/* Ticket Visual */}
      <div className={`w-full aspect-[16/9] ${tierColor} rounded-2xl mb-5 p-4 flex flex-col justify-between text-white relative overflow-hidden shadow-lg`}>
        {/* Watermark */}
        <div className="absolute top-0 right-0 p-8 opacity-10 scale-150 rotate-12 text-9xl font-black select-none pointer-events-none">
          RESALE
        </div>

        <div className="flex justify-between items-start relative z-10">
          <div className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest italic">
            {listing.tier_name}
          </div>
          <div className={`px-2 py-1 rounded text-[9px] font-bold ${priceChange > 0 ? 'bg-red-500' : 'bg-green-500'}`}>
            {priceChange > 0 ? '+' : ''}{priceChange.toFixed(0)}%
          </div>
        </div>

        <div className="relative z-10">
          <h4 className="text-xl font-black leading-tight mb-1 truncate">{listing.event_name}</h4>
          <p className="text-xs font-medium opacity-80 uppercase tracking-wider">{listing.venue}</p>
        </div>
      </div>

      {/* Details Below Card */}
      <div className="flex justify-between items-end">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
            {new Date(listing.event_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
          <p className="text-sm text-slate-500">
            <span className="line-through">₳{listing.original_price}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black text-slate-900 tracking-tighter">
            ₳{listing.resale_price}
          </p>
        </div>
      </div>
    </div>
  );
};
