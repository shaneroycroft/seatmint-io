import React, { useState, useEffect, useMemo } from 'react';

interface TicketPreviewProps {
  eventName: string;
  venue: string;
  venueAddress?: string;
  eventDate: string;
  tierName: string;
  tierType?: 'general' | 'vip' | 'backstage';
  priceAda: number;
  bannerImageUrl?: string;
  organizerName?: string;
  ticketId?: string;
  interactive?: boolean;
  qrCycleSeconds?: number;
}

const TIER_STYLES: Record<string, { bg: string; gradient: string; isVip?: boolean }> = {
  general: { bg: 'bg-forest-600', gradient: 'from-forest-500 to-forest-700' },
  vip: { bg: 'bg-warm-900', gradient: 'from-warm-900 via-warm-800 to-warm-900', isVip: true },
  backstage: { bg: 'bg-terracotta-600', gradient: 'from-terracotta-500 to-terracotta-700' },
  default: { bg: 'bg-forest-600', gradient: 'from-forest-500 to-forest-700' },
};

const getTierStyle = (tierName: string, tierType?: string) => {
  if (tierType && TIER_STYLES[tierType]) {
    return TIER_STYLES[tierType];
  }

  const lowerName = tierName.toLowerCase();
  if (lowerName.includes('vip')) return TIER_STYLES.vip;
  if (lowerName.includes('backstage') || lowerName.includes('premium')) return TIER_STYLES.backstage;
  if (lowerName.includes('general') || lowerName.includes('standard')) return TIER_STYLES.general;

  return TIER_STYLES.default;
};

// Generate a cycling token based on ticket ID and time window
const generateCyclingToken = (ticketId: string, cycleSeconds: number): string => {
  const timeWindow = Math.floor(Date.now() / (cycleSeconds * 1000));
  const combined = `${ticketId}-${timeWindow}`;
  // Simple hash for demo - in production use crypto
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
};

export const TicketPreview: React.FC<TicketPreviewProps> = ({
  eventName,
  venue,
  venueAddress = '123 Event Street, City, State 12345',
  eventDate,
  tierName,
  tierType,
  priceAda,
  bannerImageUrl,
  organizerName = 'Event Organizer',
  ticketId = 'TKT-001',
  interactive = true,
  qrCycleSeconds = 30,
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [cycleProgress, setCycleProgress] = useState(100);
  const [currentToken, setCurrentToken] = useState('');

  const style = getTierStyle(tierName, tierType);
  const isVip = style.isVip;

  // QR code cycling logic
  useEffect(() => {
    if (!interactive) return;

    const updateToken = () => {
      setCurrentToken(generateCyclingToken(ticketId, qrCycleSeconds));
    };

    updateToken();
    const tokenInterval = setInterval(updateToken, qrCycleSeconds * 1000);

    // Progress bar animation
    const progressInterval = setInterval(() => {
      const timeInCycle = Date.now() % (qrCycleSeconds * 1000);
      const progress = 100 - (timeInCycle / (qrCycleSeconds * 1000)) * 100;
      setCycleProgress(progress);
    }, 100);

    return () => {
      clearInterval(tokenInterval);
      clearInterval(progressInterval);
    };
  }, [ticketId, qrCycleSeconds, interactive]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Date TBD';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const displayName = eventName || 'Event Name';
  const displayVenue = venue || 'Venue';
  const displayTier = tierName || 'General Admission';
  const displayPrice = priceAda || 0;

  // QR Code URL (using public API)
  const qrData = useMemo(() => {
    return `SEATMINT:${ticketId}:${currentToken}`;
  }, [ticketId, currentToken]);

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}&bgcolor=ffffff&color=000000&margin=1`;

  return (
    <div className="font-sans">
      {/* 3D Flip Container */}
      <div
        className="relative cursor-pointer"
        style={{ perspective: '1000px' }}
        onClick={() => interactive && setIsFlipped(!isFlipped)}
      >
        <div
          className="relative transition-transform duration-700"
          style={{
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
          }}
        >
          {/* FRONT OF TICKET */}
          <div
            className="relative"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div
              className={`relative aspect-[16/9] rounded-2xl p-5 flex flex-col justify-between text-white overflow-hidden shadow-xl min-h-[180px] ${
                bannerImageUrl ? '' : `bg-gradient-to-br ${style.gradient}`
              }`}
              style={bannerImageUrl ? { background: `url(${bannerImageUrl}) center/cover` } : undefined}
            >
              {/* VIP Special Texture Overlay */}
              {isVip && !bannerImageUrl && (
                <>
                  {/* Noise texture */}
                  <div
                    className="absolute inset-0 opacity-20 mix-blend-overlay"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                    }}
                  />
                  {/* Gold accent lines */}
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-sand-400/50 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-sand-400/50 to-transparent" />
                  </div>
                </>
              )}

              {/* Plastic Sheen Effect (for non-VIP) */}
              {!isVip && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 40%, rgba(255,255,255,0) 60%, rgba(255,255,255,0.1) 100%)',
                  }}
                />
              )}

              {/* Background overlay for images */}
              {bannerImageUrl && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40" />
              )}

              {/* Watermark */}
              <div className="absolute -top-5 -right-8 text-[120px] font-black opacity-[0.08] rotate-12 select-none pointer-events-none tracking-tighter">
                {isVip ? 'VIP' : 'TICKET'}
              </div>

              {/* VIP Gold Sheen Text */}
              {isVip && !bannerImageUrl && (
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-6xl font-black tracking-wider select-none pointer-events-none"
                  style={{
                    background: 'linear-gradient(135deg, #d4af37 0%, #f9f295 25%, #d4af37 50%, #f9f295 75%, #d4af37 100%)',
                    backgroundSize: '200% 200%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    animation: 'shimmer 3s ease-in-out infinite',
                    textShadow: '0 0 30px rgba(212, 175, 55, 0.3)',
                  }}
                >
                  VIP
                </div>
              )}

              {/* Top Row - Badges */}
              <div className="flex justify-between items-start relative z-10">
                <div className={`backdrop-blur-md px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-widest ${
                  isVip ? 'bg-sand-500/30 text-sand-200 border border-sand-400/30' : 'bg-white/20 italic'
                }`}>
                  {displayTier}
                </div>
                <div className="bg-white/15 backdrop-blur-md px-2 py-1 rounded-md text-[9px] font-semibold tracking-wide">
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

              {/* Flip hint */}
              {interactive && (
                <div className="absolute bottom-2 right-2 text-[9px] text-white/40 font-medium">
                  Tap to flip
                </div>
              )}
            </div>
          </div>

          {/* BACK OF TICKET */}
          <div
            className="absolute inset-0"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)'
            }}
          >
            <div className={`relative aspect-[16/9] rounded-2xl p-5 flex flex-col text-white overflow-hidden shadow-xl min-h-[180px] ${
              isVip ? 'bg-warm-900' : 'bg-warm-800'
            }`}>
              {/* Texture for VIP */}
              {isVip && (
                <div
                  className="absolute inset-0 opacity-10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                  }}
                />
              )}

              {/* Content Grid */}
              <div className="flex h-full gap-4 relative z-10">
                {/* QR Code Section */}
                <div className="flex flex-col items-center justify-center">
                  <div className="bg-white p-2 rounded-lg shadow-lg">
                    <img
                      src={qrCodeUrl}
                      alt="Ticket QR Code"
                      className="w-24 h-24"
                    />
                  </div>
                  {/* Cycle Progress Bar */}
                  <div className="mt-2 w-24">
                    <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-forest-400 transition-all duration-100"
                        style={{ width: `${cycleProgress}%` }}
                      />
                    </div>
                    <p className="text-[8px] text-white/50 text-center mt-1">
                      Code refreshes for security
                    </p>
                  </div>
                </div>

                {/* Info Section */}
                <div className="flex-1 flex flex-col justify-between py-1">
                  <div>
                    <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-1">Venue</p>
                    <p className="text-sm font-semibold text-white mb-0.5">{displayVenue}</p>
                    <p className="text-[11px] text-white/70 leading-tight">{venueAddress}</p>
                  </div>

                  <div className="flex gap-4">
                    <div>
                      <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest">Date</p>
                      <p className="text-xs font-semibold text-white">{formatDate(eventDate)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest">Time</p>
                      <p className="text-xs font-semibold text-white">{formatTime(eventDate) || 'TBD'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-forest-500 animate-pulse" />
                    <span className="text-[10px] text-white/60 font-medium">
                      ID: {ticketId} • Token: {currentToken}
                    </span>
                  </div>
                </div>
              </div>

              {/* Flip hint */}
              {interactive && (
                <div className="absolute bottom-2 right-2 text-[9px] text-white/40 font-medium">
                  Tap to flip
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ticket Details Below Card */}
      <div className="mt-4 flex justify-between items-end">
        <div>
          <p className="text-[10px] font-semibold text-warm-400 uppercase tracking-widest mb-1">
            {formatDate(eventDate)}
          </p>
          <p className="text-sm font-semibold text-warm-600">
            {organizerName}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-black tracking-tighter ${isVip ? 'text-sand-600' : 'text-warm-900'}`}>
            ₳{displayPrice}
          </p>
        </div>
      </div>

      {/* Decorative Divider */}
      <div className="mt-4 border-t-2 border-dashed border-warm-200 relative">
        <div className="absolute -left-3 -top-2 w-4 h-4 bg-warm-50 rounded-full" />
        <div className="absolute -right-3 -top-2 w-4 h-4 bg-warm-50 rounded-full" />
      </div>

      {/* Bottom Info */}
      <div className="mt-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-forest-500" />
          <span className="text-[11px] text-warm-500 font-medium">
            Verified on Cardano
          </span>
        </div>
        <span className="text-[10px] text-warm-400 font-semibold tracking-wider">
          SEATMINT
        </span>
      </div>

      {/* CSS for shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
};

// Compact version for lists/grids
export const TicketPreviewCompact: React.FC<TicketPreviewProps> = (props) => {
  const style = getTierStyle(props.tierName, props.tierType);
  const isVip = style.isVip;

  return (
    <div
      className={`relative aspect-[3/2] rounded-xl p-3 flex flex-col justify-between text-white overflow-hidden min-h-[100px] ${
        props.bannerImageUrl ? '' : `bg-gradient-to-br ${style.gradient}`
      }`}
      style={props.bannerImageUrl ? { background: `url(${props.bannerImageUrl}) center/cover` } : undefined}
    >
      {/* VIP texture */}
      {isVip && !props.bannerImageUrl && (
        <div
          className="absolute inset-0 opacity-20 mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          }}
        />
      )}

      {/* Plastic sheen for non-VIP */}
      {!isVip && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 50%)',
          }}
        />
      )}

      {props.bannerImageUrl && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/10" />
      )}

      <div className="relative z-10">
        <span className={`px-2 py-0.5 rounded text-[9px] font-semibold uppercase ${
          isVip ? 'bg-sand-500/30 text-sand-200 border border-sand-400/30' : 'bg-white/20'
        }`}>
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
