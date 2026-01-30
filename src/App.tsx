import { useState, useEffect } from "react";
import { useLucid } from "./hooks/useLucid";
import { useGenesis } from "./hooks/useGenesis";
import { TicketMarketplace } from "./components/TicketMarketplace";
import { EventsPage } from "./components/EventsPage";
import { OrganizerDashboard } from "./components/OrganizerDashboard";
import { Layout } from "./components/layout";
import { ToastProvider, useToast } from "./contexts/ToastContext";
import { BRAND } from "./constants";
import { checkOrganizerAccess } from "./services/ticketService";

type AppTab = 'setup' | 'events' | 'my-tickets' | 'organizer';

// Main App wrapper that provides ToastContext
export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

// Inner component that can use toast notifications
function AppContent() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<AppTab>('setup');
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [checkingOrganizer, setCheckingOrganizer] = useState(false);

  const {
    lucid,
    address,
    isConnected,
    isConnecting,
    error: walletError,
    connectWallet,
    disconnectWallet,
    availableWallets,
    walletChanged,
    acknowledgeWalletChange,
  } = useLucid();

  const {
    isInitialized,
    isInitializing,
    isChecking,
    platformAddress,
    error: genesisError,
    initializePlatform
  } = useGenesis();

  // Handle wallet changes - redirect to setup tab
  useEffect(() => {
    if (walletChanged) {
      console.log('🔄 Wallet changed detected in App, redirecting to setup...');
      setActiveTab('setup');
      setIsOrganizer(false);  // Reset organizer status
      acknowledgeWalletChange();
      toast.info('Wallet Changed', 'Your wallet has changed. Please verify your connection.');
    }
  }, [walletChanged, acknowledgeWalletChange, toast]);

  // Check organizer access when wallet connects or changes
  useEffect(() => {
    const checkAccess = async () => {
      if (!lucid || !address || !isInitialized) {
        setIsOrganizer(false);
        return;
      }

      setCheckingOrganizer(true);
      try {
        const hasAccess = await checkOrganizerAccess(lucid);
        setIsOrganizer(hasAccess);
        console.log('Organizer access check:', hasAccess ? '✅ Has Settings NFT' : '❌ No Settings NFT');
      } catch (err) {
        console.error('Failed to check organizer access:', err);
        setIsOrganizer(false);
      } finally {
        setCheckingOrganizer(false);
      }
    };

    checkAccess();
  }, [lucid, address, isInitialized]);

  const handleInitialize = async () => {
    if (lucid && address) {
      await initializePlatform(lucid, address);
    }
  };

  const isPlatformReady = isConnected && isInitialized && lucid && address;

  return (
    <Layout
      isConnected={isConnected}
      address={address ?? undefined}
      onDisconnect={disconnectWallet}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as AppTab)}
      isPlatformReady={!!isPlatformReady}
      isOrganizer={isOrganizer}
    >
      {/* Setup Tab */}
      {activeTab === 'setup' && (
        <div className="h-full flex items-center justify-center p-8">
          <div className="max-w-lg w-full space-y-6">
            {/* Step 1: Connect Wallet */}
            <div className="bg-white rounded-2xl shadow-xl border border-warm-100 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  isConnected ? 'bg-forest-700 text-white' : 'bg-warm-200 text-warm-600'
                }`}>
                  {isConnected ? '✓' : '1'}
                </div>
                <h2 className="text-xl font-semibold text-warm-900">Connect Wallet</h2>
              </div>

              {!isConnected ? (
                <>
                  {availableWallets.length === 0 ? (
                    <div className="bg-sand-50 border border-sand-200 rounded-xl p-4">
                      <p className="text-sand-800 font-medium">No wallets detected</p>
                      <p className="text-sand-600 text-sm mt-1">
                        Please install a Cardano wallet extension (Nami, Eternl, Lace, etc.)
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {availableWallets.map((wallet) => (
                        <button
                          key={wallet}
                          onClick={() => connectWallet(wallet)}
                          disabled={isConnecting}
                          className="w-full flex items-center justify-between p-4 bg-warm-50 hover:bg-warm-100 rounded-xl transition-colors disabled:opacity-50"
                        >
                          <span className="font-medium text-warm-700 capitalize">{wallet}</span>
                          {isConnecting && (
                            <span className="text-sm text-warm-500">Connecting...</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {walletError && (
                    <div className="mt-4 bg-terracotta-50 border border-terracotta-200 rounded-xl p-4">
                      <p className="text-terracotta-700 text-sm">{walletError}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-forest-600">
                    <div className="w-2 h-2 bg-forest-500 rounded-full" />
                    <span className="font-semibold">Connected</span>
                  </div>
                  <p className="text-xs font-mono text-warm-500 bg-warm-50 p-3 rounded-lg break-all">
                    {address}
                  </p>
                </div>
              )}
            </div>

            {/* Step 2: Initialize Platform */}
            <div className={`bg-white rounded-2xl shadow-xl border border-warm-100 p-8 transition-opacity ${
              !isConnected ? 'opacity-50' : ''
            }`}>
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  isInitialized ? 'bg-forest-700 text-white' : 'bg-warm-200 text-warm-600'
                }`}>
                  {isInitialized ? '✓' : '2'}
                </div>
                <h2 className="text-xl font-semibold text-warm-900">Initialize Platform</h2>
              </div>

              {!isConnected ? (
                <p className="text-warm-500">Connect your wallet first</p>
              ) : isChecking ? (
                <div className="flex items-center gap-3 text-warm-500">
                  <span className="w-5 h-5 border-2 border-warm-300 border-t-forest-500 rounded-full animate-spin" />
                  <span>Checking platform status...</span>
                </div>
              ) : !isInitialized ? (
                <>
                  <p className="text-warm-600 mb-4">
                    Create the genesis transaction to initialize the {BRAND.name} platform on Preview testnet.
                  </p>
                  <button
                    onClick={handleInitialize}
                    disabled={isInitializing}
                    className="w-full py-4 bg-forest-600 hover:bg-forest-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isInitializing ? 'Initializing...' : 'Initialize Platform'}
                  </button>

                  {genesisError && (
                    <div className="mt-4 bg-terracotta-50 border border-terracotta-200 rounded-xl p-4">
                      <p className="text-terracotta-700 text-sm">{genesisError}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-forest-50 border border-forest-200 rounded-xl p-4">
                  <p className="text-forest-800 font-semibold mb-2">Platform Ready</p>
                  <p className="text-xs font-mono text-forest-700 break-all">
                    {platformAddress}
                  </p>
                </div>
              )}
            </div>

            {/* Ready Message */}
            {isPlatformReady && (
              <div className="bg-gradient-to-r from-forest-600 to-forest-700 rounded-2xl p-6 text-white text-center">
                <p className="font-semibold text-lg mb-1">You're all set!</p>
                <p className="text-forest-100 text-sm">
                  Browse "Events" for new tickets, check "Resale" for deals, or manage yours in "My Tickets".
                </p>
                {checkingOrganizer ? (
                  <p className="text-forest-200 text-xs mt-3">Checking organizer access...</p>
                ) : isOrganizer ? (
                  <p className="text-sand-200 text-xs mt-3 font-semibold">
                    ✨ Organizer access enabled
                  </p>
                ) : (
                  <p className="text-forest-200 text-xs mt-3">
                    Standard user access. Organizer features require the Settings NFT.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Events Tab (Primary + Resale Markets) */}
      {activeTab === 'events' && isPlatformReady && (
        <EventsPage lucid={lucid} userAddress={address!} />
      )}

      {/* My Tickets Tab */}
      {activeTab === 'my-tickets' && isPlatformReady && (
        <TicketMarketplace lucid={lucid} userAddress={address!} />
      )}

      {/* Organizer Dashboard (includes Events, Venue Designer, Settings) */}
      {activeTab === 'organizer' && isPlatformReady && isOrganizer && (
        <OrganizerDashboard lucid={lucid} userAddress={address!} />
      )}
    </Layout>
  );
}
