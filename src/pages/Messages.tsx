import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { ConversationList } from '@/components/dm/ConversationList';
import { ChatArea } from '@/components/dm/ChatArea';
import { DMStatusInfo } from '@/components/dm/DMStatusInfo';
import { useDMContext } from '@/contexts/DMContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const Messages = () => {
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const isMobile = useIsMobile();
  const { clearCacheAndReload } = useDMContext();

  useSeoMeta({
    title: 'Messages',
    description: 'Private encrypted messaging on Nostr',
  });

  // On mobile, show only one panel at a time
  const showConversationList = !isMobile || !selectedPubkey;
  const showChatArea = !isMobile || selectedPubkey;

  const handleSelectConversation = (pubkey: string) => {
    setSelectedPubkey(pubkey);
  };

  const handleBack = () => {
    setSelectedPubkey(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 h-screen flex flex-col">
        {/* Status Modal */}
        <Dialog open={statusModalOpen} onOpenChange={setStatusModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Messaging Status</DialogTitle>
              <DialogDescription>
                View loading status, cache info, and connection details
              </DialogDescription>
            </DialogHeader>
            <DMStatusInfo clearCacheAndReload={clearCacheAndReload} />
          </DialogContent>
        </Dialog>

        <div className="flex-1 flex gap-4 overflow-hidden">
          {/* Conversation List - Left Sidebar */}
          <div className={cn(
            "md:w-80 md:flex-shrink-0",
            isMobile && !showConversationList && "hidden",
            isMobile && showConversationList && "w-full"
          )}>
            <ConversationList
              selectedPubkey={selectedPubkey}
              onSelectConversation={handleSelectConversation}
              className="h-full"
              onStatusClick={() => setStatusModalOpen(true)}
            />
          </div>

          {/* Chat Area - Right Panel */}
          <div className={cn(
            "flex-1 md:min-w-0",
            isMobile && !showChatArea && "hidden",
            isMobile && showChatArea && "w-full"
          )}>
            <ChatArea
              pubkey={selectedPubkey}
              onBack={isMobile ? handleBack : undefined}
              className="h-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Messages;
