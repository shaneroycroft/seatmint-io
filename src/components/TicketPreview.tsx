import React from 'react';

interface TicketPreviewProps {
  eventName: string;
  venue: string;
  eventDate: string;
  tierName: string;
  tierType?: 'general' | 'vip' | 'backstage';
  priceAda: number;
  bannerImageUrl?: string;
  organizerName?: string;
}

const TIER_COLORS: Record<string, { bg: string; gradient: string }> = {
  general: { bg: 'bg-blue-600', gradient: 'from-blue-500 to-blue-700' },
  vip: { bg: 'bg-purple-600', gradient: 'from-purple-500 to-purple-700' },
  backstage: { bg: 'bg-red-600', gradient: 'from-red-500 to-red-700' },
  default: { bg: 'bg-emerald-600', gradient: 'from-emerald-500 to-emerald-700' },
};

const getTierColor = (tierName: string, tierType?: string) => {
  if (tierType && TIER_COLORS[tierType]) {
    return TIER_COLORS[tierType];
  }

  const lowerName = tierName.toLowerCase();
  if (lowerName.includes('vip')) return TIER_COLORS.vip;
  if (lowerName.includes('backstage') || lowerName.includes('premium')) return TIER_COLORS.backstage;
  if (lowerName.includes('general') || lowerName.includes('standard')) return TIER_COLORS.general;

  return TIER_COLORS.default;
};

export const TicketPreview: React.FC<TicketPreviewProps> = ({
  eventName,
  venue,
  eventDate,
  tierName,
  tierType,
  priceAda,
  bannerImageUrl,
  organizerName = 'Event Organizer',
}) => {
  const colors = getTierColor(tierName, tierType);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Date TBD';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const displayName = eventName || 'Event Name';
  const displayVenue = venue || 'Venue';
  const displayTier = tierName || 'General Admission';
  const displayPrice = priceAda || 0;

  return (
    <div className="font-sans">
      {/* Ticket Card */}
      <div
        className={`relative aspect-[16/9] rounded-2xl p-5 flex flex-col justify-between text-white overflow-hidden shadow-xl min-h-[180px] ${
          bannerImageUrl ? '' : `bg-gradient-to-br ${colors.gradient}`
        }`}
        style={bannerImageUrl ? { background: `url(${bannerImageUrl}) center/cover` } : undefined}
      >
        {/* Background overlay for images */}
        {bannerImageUrl && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40" />
        )}

        {/* Watermark */}
        <div className="absolute -top-5 -right-8 text-[120px] font-black opacity-[0.08] rotate-12 select-none pointer-events-none tracking-tighter">
          TICKET
        </div>

        {/* Top Row - Badges */}
        <div className="flex justify-between items-start relative z-10">
          <div className="bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-widest italic">
            {displayTier}
          </div>
          <div className="bg-white/15 backdrop-blur-md px-2 py-1 rounded-md text-[9px] font-bold tracking-wide">
            NFT
          </div>
        </div>

        {/* Bottom Row - Event Info */}
        <div className="relative z-10">
          <h4 className="text-xl font-black leading-tight mb-1 truncate drop-shadow-lg">
            {displayName}
          </h4>
          <p className="text-xs font-medium opacity-90 uppercase tracking-wider">
            {displayVenue}
          </p>
        </div>
      </div>

      {/* Ticket Details Below Card */}
      <div className="mt-4 flex justify-between items-end">
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
            {formatDate(eventDate)}
          </p>
          <p className="text-sm font-semibold text-slate-600">
            {organizerName}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black text-slate-900 tracking-tighter">
            ₳{displayPrice}
          </p>
        </div>
      </div>

      {/* Decorative Divider */}
      <div className="mt-4 border-t-2 border-dashed border-slate-200 relative">
        {/* Notch Left */}
        <div className="absolute -left-3 -top-2 w-4 h-4 bg-slate-50 rounded-full" />
        {/* Notch Right */}
        <div className="absolute -right-3 -top-2 w-4 h-4 bg-slate-50 rounded-full" />
      </div>

      {/* Bottom Info */}
      <div className="mt-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-slate-500 font-medium">
            Verified on Cardano
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-semibold tracking-wider">
          SEATMINT
        </span>
      </div>
    </div>
  );
};

// Compact version for lists/grids
export const TicketPreviewCompact: React.FC<TicketPreviewProps> = (props) => {
  const colors = getTierColor(props.tierName, props.tierType);

  return (
    <div
      className={`relative aspect-[3/2] rounded-xl p-3 flex flex-col justify-between text-white overflow-hidden min-h-[100px] ${
        props.bannerImageUrl ? '' : `bg-gradient-to-br ${colors.gradient}`
      }`}
      style={props.bannerImageUrl ? { background: `url(${props.bannerImageUrl}) center/cover` } : undefined}
    >
      {props.bannerImageUrl && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/10" />
      )}

      <div className="relative z-10">
        <span className="bg-white/20 px-2 py-0.5 rounded text-[9px] font-bold uppercase">
          {props.tierName || 'General'}
        </span>
      </div>

      <div className="relative z-10">
        <p className="text-sm font-extrabold mb-0.5 truncate">
          {props.eventName || 'Event Name'}
        </p>
        <p className="text-[10px] opacity-80">
          {props.venue || 'Venue'}
        </p>
      </div>
    </div>
  );
};

export default TicketPreview;
