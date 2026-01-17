import React from 'react';

interface HeaderProps {
  isConnected: boolean;
  address?: string;
  onDisconnect: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  isPlatformReady: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  isConnected,
  address,
  onDisconnect,
  activeTab,
  onTabChange,
  isPlatformReady,
}) => {
  const tabs = [
    { id: 'setup', label: 'Setup', icon: null, alwaysEnabled: true },
    { id: 'create-event', label: 'Create Event', icon: null, requiresReady: true },
    { id: 'marketplace', label: 'Marketplace', icon: null, requiresReady: true },
  ];

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 shadow-sm">
      {/* Logo & Brand */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
          S
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight text-slate-900">Seatmint</h1>
          <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
            Preview Testnet
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="flex items-center gap-1">
        {tabs.map((tab) => {
          const isDisabled = tab.requiresReady && !isPlatformReady;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && onTabChange(tab.id)}
              disabled={isDisabled}
              className={`
                px-4 py-2 rounded-lg text-sm font-semibold transition-all
                ${isActive
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
                }
                ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Wallet Status */}
      <div className="flex items-center gap-3">
        {isConnected ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-sm font-mono text-slate-600">
                {address?.slice(0, 8)}...{address?.slice(-6)}
              </span>
            </div>
            <button
              onClick={onDisconnect}
              className="px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-500 rounded-full" />
            <span className="text-sm text-slate-500">Not connected</span>
          </div>
        )}
      </div>
    </header>
  );
};
