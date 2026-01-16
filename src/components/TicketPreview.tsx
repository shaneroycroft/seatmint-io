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

// Color schemes for different ticket types
const TIER_COLORS: Record<string, { bg: string; accent: string }> = {
  general: { bg: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', accent: '#3b82f6' },
  vip: { bg: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)', accent: '#8b5cf6' },
  backstage: { bg: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', accent: '#ef4444' },
  default: { bg: 'linear-gradient(135deg, #10b981 0%, #047857 100%)', accent: '#10b981' },
};

const getTierColor = (tierName: string, tierType?: string): { bg: string; accent: string } => {
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
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Ticket Card */}
      <div
        style={{
          background: bannerImageUrl ? `url(${bannerImageUrl}) center/cover` : colors.bg,
          borderRadius: '16px',
          padding: '20px',
          aspectRatio: '16/9',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          color: 'white',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          minHeight: '180px',
        }}
      >
        {/* Background overlay for images */}
        {bannerImageUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.4) 100%)',
            }}
          />
        )}

        {/* Watermark */}
        <div
          style={{
            position: 'absolute',
            top: '-20px',
            right: '-30px',
            fontSize: '120px',
            fontWeight: 900,
            opacity: 0.08,
            transform: 'rotate(12deg)',
            userSelect: 'none',
            pointerEvents: 'none',
            letterSpacing: '-5px',
          }}
        >
          TICKET
        </div>

        {/* Top Row - Tier Badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
          <div
            style={{
              background: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '10px',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              fontStyle: 'italic',
            }}
          >
            {displayTier}
          </div>

          {/* NFT Badge */}
          <div
            style={{
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(10px)',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '1px',
            }}
          >
            NFT
          </div>
        </div>

        {/* Bottom Row - Event Info */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h4
            style={{
              fontSize: '20px',
              fontWeight: 900,
              lineHeight: 1.2,
              marginBottom: '4px',
              textShadow: '0 2px 10px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </h4>
          <p
            style={{
              fontSize: '12px',
              fontWeight: 500,
              opacity: 0.9,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            {displayVenue}
          </p>
        </div>
      </div>

      {/* Ticket Details Below Card */}
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <p
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: '#94a3b8',
              textTransform: 'uppercase',
              letterSpacing: '2px',
              marginBottom: '4px',
            }}
          >
            {formatDate(eventDate)}
          </p>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>
            {organizerName}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p
            style={{
              fontSize: '24px',
              fontWeight: 900,
              color: '#0f172a',
              letterSpacing: '-1px',
            }}
          >
            ₳{displayPrice}
          </p>
        </div>
      </div>

      {/* Decorative Divider */}
      <div
        style={{
          marginTop: '16px',
          borderTop: '2px dashed #e2e8f0',
          position: 'relative',
        }}
      >
        {/* Notch Left */}
        <div
          style={{
            position: 'absolute',
            left: '-12px',
            top: '-8px',
            width: '16px',
            height: '16px',
            background: '#1a1a1a',
            borderRadius: '50%',
          }}
        />
        {/* Notch Right */}
        <div
          style={{
            position: 'absolute',
            right: '-12px',
            top: '-8px',
            width: '16px',
            height: '16px',
            background: '#1a1a1a',
            borderRadius: '50%',
          }}
        />
      </div>

      {/* Bottom Info */}
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#10b981',
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
            Verified on Cardano
          </span>
        </div>
        <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600, letterSpacing: '1px' }}>
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
      style={{
        background: props.bannerImageUrl ? `url(${props.bannerImageUrl}) center/cover` : colors.bg,
        borderRadius: '12px',
        padding: '12px',
        aspectRatio: '3/2',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: 'white',
        position: 'relative',
        overflow: 'hidden',
        minHeight: '100px',
      }}
    >
      {props.bannerImageUrl && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 100%)',
          }}
        />
      )}

      <div style={{ position: 'relative', zIndex: 1 }}>
        <span
          style={{
            background: 'rgba(255,255,255,0.2)',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          {props.tierName || 'General'}
        </span>
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <p style={{ fontSize: '14px', fontWeight: 800, marginBottom: '2px' }}>
          {props.eventName || 'Event Name'}
        </p>
        <p style={{ fontSize: '10px', opacity: 0.8 }}>
          {props.venue || 'Venue'}
        </p>
      </div>
    </div>
  );
};

export default TicketPreview;
