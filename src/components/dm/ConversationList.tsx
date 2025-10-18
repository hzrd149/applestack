import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDMContext } from '@/contexts/DMContext';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ConversationListProps {
  selectedPubkey: string | null;
  onSelectConversation: (pubkey: string) => void;
  className?: string;
}

const ConversationItem = ({ 
  pubkey, 
  isSelected, 
  onClick,
  lastMessage,
  lastActivity,
  hasNIP4Messages
}: { 
  pubkey: string; 
  isSelected: boolean; 
  onClick: () => void;
  lastMessage: { decryptedContent?: string; error?: string } | null;
  lastActivity: number;
  hasNIP4Messages: boolean;
}) => {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

  const displayName = metadata?.name || genUserName(pubkey);
  const avatarUrl = metadata?.picture;
  const initials = displayName.slice(0, 2).toUpperCase();

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;

    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    
    const date = new Date(timestamp * 1000);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  };

  const lastMessagePreview = lastMessage?.error 
    ? '🔒 Encrypted message' 
    : lastMessage?.decryptedContent || 'No messages yet';

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-colors hover:bg-accent block overflow-hidden",
        isSelected && "bg-accent"
      )}
    >
      <div className="flex items-start gap-3 max-w-full">
        <Avatar className="h-10 w-10 flex-shrink-0">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="font-medium text-sm truncate">{displayName}</span>
              {hasNIP4Messages && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex-shrink-0">
                        <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-500" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p className="text-xs max-w-[200px]">Some messages use outdated NIP-04 encryption</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
              {formatTime(lastActivity)}
            </span>
          </div>
          
          <p className="text-sm text-muted-foreground truncate">
            {lastMessagePreview}
          </p>
        </div>
      </div>
    </button>
  );
};

const ConversationListSkeleton = () => {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
};

export const ConversationList = ({ 
  selectedPubkey, 
  onSelectConversation,
  className 
}: ConversationListProps) => {
  const { conversations, isLoading } = useDMContext();
  const [activeTab, setActiveTab] = useState<'known' | 'requests'>('known');

  // Filter conversations by type
  const { knownConversations, requestConversations } = useMemo(() => {
    return {
      knownConversations: conversations.filter(c => c.isKnown),
      requestConversations: conversations.filter(c => c.isRequest),
    };
  }, [conversations]);

  // Get the current list based on active tab
  const currentConversations = activeTab === 'known' ? knownConversations : requestConversations;

  if (isLoading) {
    return (
      <Card className={cn("h-full", className)}>
        <ConversationListSkeleton />
      </Card>
    );
  }

  if (conversations.length === 0) {
    return (
      <Card className={cn("h-full flex items-center justify-center p-8", className)}>
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No conversations yet</p>
          <p className="text-xs mt-1">Start a new conversation to get started</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full flex flex-col overflow-hidden", className)}>
      <div className="p-4 border-b flex-shrink-0">
        <h2 className="font-semibold text-lg">Messages</h2>
      </div>
      
      {/* Tab buttons */}
      <div className="px-2 pt-2 flex-shrink-0">
        <div className="grid grid-cols-2 gap-1 bg-muted p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('known')}
            className={cn(
              "text-xs py-2 px-3 rounded-md transition-colors",
              activeTab === 'known' 
                ? "bg-background shadow-sm font-medium" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Active {knownConversations.length > 0 && `(${knownConversations.length})`}
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={cn(
              "text-xs py-2 px-3 rounded-md transition-colors",
              activeTab === 'requests' 
                ? "bg-background shadow-sm font-medium" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Requests {requestConversations.length > 0 && `(${requestConversations.length})`}
          </button>
        </div>
      </div>
      
      {/* Single shared container */}
      <div className="flex-1 min-h-0 mt-2 overflow-hidden">
        {currentConversations.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-center text-muted-foreground px-4">
            <p className="text-sm">No conversations</p>
          </div>
        ) : (
          <ScrollArea key={activeTab} className="h-full block">
            <div className="block w-full px-2 py-2 space-y-1">
              {currentConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.pubkey}
                  pubkey={conversation.pubkey}
                  isSelected={selectedPubkey === conversation.pubkey}
                  onClick={() => onSelectConversation(conversation.pubkey)}
                  lastMessage={conversation.lastMessage}
                  lastActivity={conversation.lastActivity}
                  hasNIP4Messages={conversation.hasNIP4Messages}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </Card>
  );
};
